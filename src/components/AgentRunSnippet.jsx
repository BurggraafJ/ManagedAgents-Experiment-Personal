/**
 * Compacte weergave van de laatste run per agent, of per agent-specifieke
 * datastroom. Werkt als mini-tabel: regels met primaire entiteit + tijd +
 * context-tekst. Alle agents gebruiken hetzelfde visuele patroon
 * (.agent-card__mini-list) zodat de Dashboard-view overal hetzelfde voelt.
 *
 * Data-contract per agent (optioneel, fallback naar summary-tekst):
 *   hubspot-daily-sync    stats.deals_summary    [{company, time, subject}]
 *   auto-draft            stats.drafts_summary   [{to, subject, time}]
 *   linkedin-connect      stats.connects_summary [{company, contact, time}]
 *   kilometerregistratie  stats.maand + stats.ritten (bestaat al)
 *   sales-on-road         gebruikt data.salesEvents direct (via extras)
 */

export default function AgentRunSnippet({ agent, run, extras = {} }) {
  if (agent === 'hubspot-daily-sync')   return <HubSpotSnippet run={run} />
  if (agent === 'auto-draft')           return <AutoDraftSnippet run={run} />
  if (agent === 'linkedin-connect')     return <LinkedInSnippet run={run} />
  if (agent === 'kilometerregistratie') return <KmSnippet run={run} />
  if (agent === 'sales-on-road')        return <SalesOnRoadSnippet events={extras.salesEvents} />
  if (agent === 'sales-todos')          return <SalesTodosSnippet run={run} todos={extras.salesTodos} />
  return <DefaultSnippet run={run} />
}

/* ---------- HubSpot ---------- */

function HubSpotSnippet({ run }) {
  const deals = Array.isArray(run?.stats?.deals_summary) ? run.stats.deals_summary : null

  if (deals && deals.length > 0) {
    return (
      <MiniList
        items={deals}
        primary={d => d.company || '—'}
        time={d => d.time}
        secondary={d => d.subject}
      />
    )
  }

  const companies = extractCompaniesFromSummary(run?.summary || '')
  if (companies.length > 0) {
    return (
      <div className="agent-card__chips">
        {companies.slice(0, 8).map(c => <span key={c} className="agent-card__chip">{c}</span>)}
        {companies.length > 8 && <span className="muted" style={{ fontSize: 11 }}>+{companies.length - 8}</span>}
      </div>
    )
  }

  return <DefaultSnippet run={run} />
}

/* ---------- Auto-draft ---------- */

function AutoDraftSnippet({ run }) {
  const drafts = Array.isArray(run?.stats?.drafts_summary) ? run.stats.drafts_summary : null

  if (drafts && drafts.length > 0) {
    return (
      <MiniList
        items={drafts}
        primary={d => d.to || d.recipient || d.company || '—'}
        time={d => d.time}
        secondary={d => d.subject}
      />
    )
  }

  // Fallback: als er 0 drafts waren en de summary zegt dat — toon neutrale status
  const drafts_created = run?.stats?.drafts_created ?? 0
  const mails_scanned = run?.stats?.mails_scanned ?? 0
  if (drafts_created === 0 && mails_scanned > 0) {
    return (
      <div className="muted" style={{ fontSize: 13 }}>
        {mails_scanned} mail{mails_scanned === 1 ? '' : 's'} gescand, geen drafts nodig
      </div>
    )
  }

  return <DefaultSnippet run={run} />
}

/* ---------- LinkedIn Connect ---------- */

function LinkedInSnippet({ run }) {
  const connects = Array.isArray(run?.stats?.connects_summary) ? run.stats.connects_summary : null

  if (connects && connects.length > 0) {
    return (
      <MiniList
        items={connects}
        primary={c => c.company || '—'}
        time={c => c.time}
        secondary={c => c.contact}
      />
    )
  }

  // Fallback: toon gestructureerde status zonder ruwe summary
  const connects_sent = run?.stats?.connects_sent
  const companies_processed = run?.stats?.companies_processed
  if (typeof connects_sent === 'number') {
    return (
      <div className="muted" style={{ fontSize: 13 }}>
        {connects_sent} connects naar {companies_processed ?? '?'} kantoren
      </div>
    )
  }

  return <DefaultSnippet run={run} />
}

/* ---------- Kilometerregistratie ---------- */

function KmSnippet({ run }) {
  const maand  = run?.stats?.maand
  const ritten = run?.stats?.ritten
  const totaal_km = run?.stats?.totaal_km

  if (maand || ritten) {
    return (
      <ul className="agent-card__mini-list">
        <li className="agent-card__mini-row">
          <span className="agent-card__mini-company">{maand || 'laatste maand'}</span>
          <span className="agent-card__mini-meta">
            {ritten !== undefined && <span>{ritten} ritten</span>}
            {totaal_km !== undefined && <span>{totaal_km} km</span>}
          </span>
        </li>
      </ul>
    )
  }

  return <DefaultSnippet run={run} />
}

/* ---------- Sales On Road ---------- */

function SalesOnRoadSnippet({ events }) {
  const list = Array.isArray(events) ? events.slice(0, 5) : []

  if (list.length === 0) {
    return (
      <div className="muted" style={{ fontSize: 13 }}>
        Wacht op bericht in <span className="mono">#sales-on-road</span>
      </div>
    )
  }

  return (
    <MiniList
      items={list}
      primary={e => e.company_name || <span className="muted">(geen bedrijfsnaam)</span>}
      time={e => e.created_at}
      secondary={e => e.stage_after || (e.status === 'needs_review' ? 'controle nodig' : e.status)}
    />
  )
}

/* ---------- Sales TODO's ---------- */

function SalesTodosSnippet({ run, todos }) {
  const list = Array.isArray(todos) ? todos.filter(t => t.status === 'draft_ready' || t.status === 'pending').slice(0, 5) : []

  if (list.length > 0) {
    const TYPE_LABEL = {
      offerte_reminder:    'offerte-reminder',
      trial_ending:        'trial-eind',
      checkin:             'check-in',
      onboarding_followup: 'onboarding',
      other:               '',
    }
    return (
      <MiniList
        items={list}
        primary={t => t.company_name || '—'}
        time={t => t.created_at}
        secondary={t => TYPE_LABEL[t.type] || t.type}
      />
    )
  }

  // Fallback op stats-summary als geen todos in DB
  const summary = Array.isArray(run?.stats?.todos_summary) ? run.stats.todos_summary : null
  if (summary && summary.length > 0) {
    return (
      <MiniList
        items={summary}
        primary={t => t.company || '—'}
        time={t => t.time}
        secondary={t => t.type}
      />
    )
  }

  return (
    <div className="muted" style={{ fontSize: 13 }}>
      Scant HubSpot op deals die actie vragen
    </div>
  )
}

/* ---------- Helpers ---------- */

function MiniList({ items, primary, time, secondary }) {
  return (
    <ul className="agent-card__mini-list">
      {items.slice(0, 5).map((item, i) => (
        <li key={i} className="agent-card__mini-row">
          <span className="agent-card__mini-company">{primary(item)}</span>
          <span className="agent-card__mini-meta">
            {time?.(item) && <span>{formatShortTime(time(item))}</span>}
            {secondary?.(item) && (
              <span className="agent-card__mini-subject" title={String(secondary(item))}>
                {truncate(String(secondary(item)), 40)}
              </span>
            )}
          </span>
        </li>
      ))}
      {items.length > 5 && (
        <li className="agent-card__mini-row agent-card__mini-row--more">
          +{items.length - 5} meer — zie detailpagina
        </li>
      )}
    </ul>
  )
}

function DefaultSnippet({ run }) {
  return <span>{run?.summary || <span className="muted">—</span>}</span>
}

function extractCompaniesFromSummary(summary) {
  if (!summary) return []
  const paren = summary.match(/\(([^)]+)\)/)
  const source = paren ? paren[1] : null
  if (!source) return []
  return source
    .split(/,\s*/)
    .map(s => s.trim())
    .filter(s => s.length > 0 && s.length < 40 && /^[A-Z]/.test(s))
}

function formatShortTime(raw) {
  if (!raw) return ''
  // Als het al een "09:45" of "09:45-10:30" string is → laat zoals is
  if (typeof raw === 'string' && /^\d{1,2}:\d{2}/.test(raw)) return raw
  const d = new Date(raw)
  if (isNaN(d.getTime())) return String(raw)
  return d.toLocaleTimeString('nl-NL', { hour: '2-digit', minute: '2-digit' })
}

function truncate(s, n) {
  if (!s) return ''
  return s.length > n ? s.slice(0, n - 1) + '…' : s
}
