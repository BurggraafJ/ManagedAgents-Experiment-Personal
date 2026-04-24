import { useMemo, useState } from 'react'
import { supabase } from '../../lib/supabase'

const AGENT = 'linkedin-connect'

const STATUS_CLASS = {
  pending:            's-idle',
  scheduled:          's-warning',
  sent:               's-success',
  accepted:           's-success',
  declined:           's-error',
  already_connected:  's-idle',
  skipped:            's-idle',
  failed:             's-error',
  blacklisted:        's-idle',
}

const SEGMENT_LABEL = {
  mailbox:                       'inbox',
  hubspot_new:                   'hubspot',
  advocatenkantoor_proefperiode: 'proefperiode-kantoor',
  competitors:                   'concurrent',
  thought_leaders:               'thought leader',
  manual:                        'handmatig',
  other:                         'overig',
}

const EVENT_LABEL = {
  discovered:         'ontdekt',
  queued:             'ingepland',
  sent:               'verstuurd',
  accepted:           'geaccepteerd',
  declined:           'geweigerd',
  already_connected:  'al verbonden',
  skipped:            'overgeslagen',
  failed:             'fout',
  note:               'notitie',
  strategy_edit:      'strategie-edit',
  run_start:          'run gestart',
  run_end:            'run klaar',
  rate_limit:         'rate-limit',
  login_required:     'login nodig',
}

export default function LinkedInView({ data }) {
  const targets  = data.linkedinTargets  || []
  const activity = data.linkedinActivity || []
  const strategy = data.linkedinStrategy

  const [segmentFilter, setSegmentFilter] = useState('all')
  const [statusFilter, setStatusFilter] = useState('active')

  const today = new Date(); today.setHours(0, 0, 0, 0)
  const weekStart = new Date(today); weekStart.setDate(today.getDate() - ((today.getDay() + 6) % 7))

  // Effectiviteits-metrics. Per run meten we:
  //  - nieuwe connects (sent)   — pure productiewinst
  //  - al-geconnect (already_connected) — overlap met bestaand netwerk; hoge % = targeting te breed
  //  - accept-rate (accepted / sent) — hoe warm de audience is
  //  - hit-rate = sent / (sent + already_connected) — hoe uniek de targeting t.o.v. bestaand netwerk
  const kpis = useMemo(() => {
    const sent     = targets.filter(t => t.status === 'sent' || t.status === 'accepted')
    const sentToday = sent.filter(t => t.sent_at && new Date(t.sent_at) >= today).length
    const sentWeek  = sent.filter(t => t.sent_at && new Date(t.sent_at) >= weekStart).length
    const accepted  = targets.filter(t => t.status === 'accepted').length
    const accRate   = sent.length ? Math.round(100 * accepted / sent.length) : null
    const queued    = targets.filter(t => t.status === 'pending' || t.status === 'scheduled').length
    const failed    = targets.filter(t => t.status === 'failed').length

    // Al-geconnect: over alle runs en binnen deze week
    const alreadyAll  = targets.filter(t => t.status === 'already_connected').length
    const alreadyWeek = targets.filter(t =>
      t.status === 'already_connected' &&
      t.last_attempt_at && new Date(t.last_attempt_at) >= weekStart
    ).length

    // Hit-rate: van alle bezochte profielen deze week, welk % was écht nieuw?
    const touchedWeek = sentWeek + alreadyWeek
    const hitRate = touchedWeek ? Math.round(100 * sentWeek / touchedWeek) : null

    return { sentToday, sentWeek, queued, accRate, failed, alreadyAll, alreadyWeek, hitRate }
  }, [targets, today, weekStart])

  const filteredTargets = useMemo(() => {
    return targets.filter(t => {
      if (segmentFilter !== 'all' && t.segment !== segmentFilter) return false
      if (statusFilter === 'active' && (t.status === 'already_connected' || t.status === 'blacklisted' || t.status === 'skipped')) return false
      if (statusFilter !== 'all' && statusFilter !== 'active' && t.status !== statusFilter) return false
      return true
    })
  }, [targets, segmentFilter, statusFilter])

  const segments = useMemo(() => {
    const counts = {}
    targets.forEach(t => { counts[t.segment] = (counts[t.segment] || 0) + 1 })
    return Object.entries(counts).sort((a, b) => b[1] - a[1])
  }, [targets])

  return (
    <div className="stack" style={{ gap: 'var(--s-7)' }}>

      <section>
        <div className="section__head">
          <h2 className="section__title">Targets {targets.length > 0 && <span className="section__count">{targets.length}</span>}</h2>
          <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
            <select className="select" value={segmentFilter} onChange={e => setSegmentFilter(e.target.value)}>
              <option value="all">alle segmenten</option>
              {segments.map(([seg, n]) => (
                <option key={seg} value={seg}>{SEGMENT_LABEL[seg] || seg} ({n})</option>
              ))}
            </select>
            <select className="select" value={statusFilter} onChange={e => setStatusFilter(e.target.value)}>
              <option value="active">actief (exclusief afgehandelde)</option>
              <option value="all">alle</option>
              <option value="pending">pending</option>
              <option value="scheduled">scheduled</option>
              <option value="sent">verstuurd</option>
              <option value="accepted">geaccepteerd</option>
              <option value="failed">fouten</option>
              <option value="already_connected">al verbonden</option>
            </select>
          </div>
        </div>

        {filteredTargets.length === 0 ? (
          <div className="empty">
            Geen targets in dit filter. De agent vult deze lijst automatisch bij elke run —
            bronnen: Outlook-inbox, HubSpot sales-pipeline, concurrenten, proefperiode-kantoren.
          </div>
        ) : (
          <div className="table-wrap">
            <table className="table">
              <thead>
                <tr>
                  <th>Naam</th>
                  <th>Bedrijf</th>
                  <th>Segment</th>
                  <th>Tactiek</th>
                  <th>Status</th>
                  <th style={{ width: 120 }}>Laatste</th>
                </tr>
              </thead>
              <tbody>
                {filteredTargets.slice(0, 100).map(t => (
                  <tr key={t.id}>
                    <td style={{ fontWeight: 500 }}>
                      {t.linkedin_url
                        ? <a href={t.linkedin_url} target="_blank" rel="noreferrer" style={{ color: 'inherit' }}>{t.full_name}</a>
                        : t.full_name}
                      {t.headline && <div className="muted" style={{ fontSize: 11 }}>{truncate(t.headline, 70)}</div>}
                    </td>
                    <td>{t.company_name || <span className="muted">—</span>}</td>
                    <td><span className="pill">{SEGMENT_LABEL[t.segment] || t.segment}</span></td>
                    <td className="muted" style={{ fontSize: 12 }} title={t.tactic || ''}>
                      {truncate(t.tactic || '—', 60)}
                    </td>
                    <td><span className={`pill ${STATUS_CLASS[t.status] || 's-idle'}`}>{t.status}</span></td>
                    <td className="muted" style={{ fontSize: 12 }}>
                      {formatShortDate(t.sent_at || t.last_attempt_at || t.created_at)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <section>
        <div className="section__head">
          <h2 className="section__title">Logboek</h2>
          <span className="section__hint">laatste 50 events</span>
        </div>
        {activity.length === 0 ? (
          <div className="empty">Nog geen activity-log. Na de eerste run verschijnen events hier.</div>
        ) : (
          <div className="stack stack--sm">
            {activity.slice(0, 50).map(ev => (
              <div key={ev.id} className="card" style={{ display: 'flex', gap: 12, alignItems: 'baseline', padding: '8px 12px' }}>
                <span className="muted mono" style={{ fontSize: 11, minWidth: 100 }}>{formatShortDate(ev.created_at)}</span>
                <span className={`pill ${eventToneClass(ev.event_type)}`} style={{ minWidth: 110, textAlign: 'center' }}>
                  {EVENT_LABEL[ev.event_type] || ev.event_type}
                </span>
                <span style={{ flex: 1, fontSize: 13 }}>{ev.detail || <span className="muted">—</span>}</span>
              </div>
            ))}
          </div>
        )}
      </section>

      <StrategyPanel strategy={strategy} />

      <section>
        <div className="section__head">
          <h2 className="section__title">Cijfers</h2>
          <span className="section__hint">
            effectiviteit: hoeveel écht-nieuwe connects versus mensen die al in je netwerk zaten
          </span>
        </div>
        <div className="grid grid--kpi">
          <KpiCell value={kpis.sentToday} label="Vandaag verstuurd" accent />
          <KpiCell value={kpis.sentWeek}  label="Deze week verstuurd" />
          <KpiCell value={kpis.alreadyWeek} label="Al verbonden (deze week)"
                   tone={kpis.alreadyWeek > kpis.sentWeek ? 'warning' : null} />
          <KpiCell value={kpis.hitRate == null ? '—' : `${kpis.hitRate}%`}
                   label="Hit-rate nieuw / bezocht"
                   tone={kpis.hitRate != null && kpis.hitRate < 50 ? 'warning' : null} />
          <KpiCell value={kpis.accRate == null ? '—' : `${kpis.accRate}%`} label="Accept-rate (cumul.)" />
          <KpiCell value={kpis.queued}    label="In queue" />
          <KpiCell value={kpis.alreadyAll} label="Al verbonden (totaal)" />
          <KpiCell value={kpis.failed}    label="Fouten"
                   tone={kpis.failed > 0 ? 'error' : null} />
        </div>
        {kpis.hitRate != null && kpis.hitRate < 50 && (
          <div className="muted" style={{ fontSize: 12, marginTop: 10 }}>
            ⚠ Minder dan de helft van de bezochte profielen is écht nieuw — de targeting overlapt sterk met je bestaande netwerk.
            Overweeg concurrenten/keywords in de strategie te verbreden of proefperiode-kantoren waar je al veel mensen van kent te deprioriteren.
          </div>
        )}
      </section>
    </div>
  )
}

function StrategyPanel({ strategy }) {
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState(null)
  const [saving, setSaving] = useState(false)
  const [err, setErr] = useState(null)

  const start = () => {
    setDraft({
      daily_quota:      strategy?.daily_quota ?? 15,
      segment_priority: (strategy?.segment_priority || []).join(', '),
      competitors:      (strategy?.competitors || []).join(', '),
      thought_leaders:  (strategy?.thought_leaders || []).join(', '),
      keywords:         (strategy?.keywords || []).join(', '),
      tactic_notes:     strategy?.tactic_notes || '',
      pause_until:      strategy?.pause_until || '',
    })
    setEditing(true); setErr(null)
  }

  const save = async () => {
    setSaving(true); setErr(null)
    const payload = {
      id: 1,
      daily_quota:      Number(draft.daily_quota) || 15,
      segment_priority: splitList(draft.segment_priority),
      competitors:      splitList(draft.competitors),
      thought_leaders:  splitList(draft.thought_leaders),
      keywords:         splitList(draft.keywords),
      tactic_notes:     draft.tactic_notes || null,
      pause_until:      draft.pause_until || null,
      updated_at:       new Date().toISOString(),
      updated_by:       'dashboard',
    }
    const { error } = await supabase.from('linkedin_strategy').upsert(payload, { onConflict: 'id' })
    setSaving(false)
    if (error) setErr(error.message)
    else setEditing(false)
  }

  return (
    <section>
      <div className="section__head">
        <h2 className="section__title">Strategie</h2>
        <span className="section__hint">leidend voor wie de agent kiest</span>
      </div>

      {!editing ? (
        <div className="card">
          <dl className="kv" style={{ display: 'grid', gridTemplateColumns: '180px 1fr', gap: '8px 16px', margin: 0 }}>
            <dt className="muted">Dagquota</dt><dd>{strategy?.daily_quota ?? 15} invites/dag</dd>
            <dt className="muted">Segment-prioriteit</dt><dd>{renderList(strategy?.segment_priority, SEGMENT_LABEL)}</dd>
            <dt className="muted">Concurrenten</dt><dd>{renderList(strategy?.competitors)}</dd>
            <dt className="muted">Thought leaders</dt><dd>{renderList(strategy?.thought_leaders)}</dd>
            <dt className="muted">Keywords</dt><dd>{renderList(strategy?.keywords)}</dd>
            <dt className="muted">Tactiek-notities</dt><dd style={{ whiteSpace: 'pre-wrap' }}>{strategy?.tactic_notes || <span className="muted">—</span>}</dd>
            <dt className="muted">Pause</dt><dd>{strategy?.pause_until ? `tot ${strategy.pause_until}` : <span className="muted">actief</span>}</dd>
          </dl>
          <div style={{ marginTop: 12 }}>
            <button className="btn" onClick={start}>Bewerken</button>
          </div>
        </div>
      ) : (
        <div className="card stack stack--sm">
          <Field label="Dagquota">
            <input className="input" type="number" value={draft.daily_quota}
                   onChange={e => setDraft({ ...draft, daily_quota: e.target.value })} />
          </Field>
          <Field label="Segment-prioriteit (comma-separated, volgorde = prio)">
            <input className="input" value={draft.segment_priority}
                   onChange={e => setDraft({ ...draft, segment_priority: e.target.value })}
                   placeholder="mailbox, hubspot_new, advocatenkantoor_proefperiode, competitors, thought_leaders" />
          </Field>
          <Field label="Concurrenten (kantoor- of persoonsnamen)">
            <input className="input" value={draft.competitors}
                   onChange={e => setDraft({ ...draft, competitors: e.target.value })}
                   placeholder="bv. Juristica, Advocaat.nl, ..." />
          </Field>
          <Field label="Thought leaders (namen of LinkedIn URLs)">
            <input className="input" value={draft.thought_leaders}
                   onChange={e => setDraft({ ...draft, thought_leaders: e.target.value })} />
          </Field>
          <Field label="Keywords voor people-search">
            <input className="input" value={draft.keywords}
                   onChange={e => setDraft({ ...draft, keywords: e.target.value })}
                   placeholder="bv. legal tech, kantoormanager, compliance" />
          </Field>
          <Field label="Tactiek-notities (vrije tekst die de agent meeleest)">
            <textarea className="input" rows={4} value={draft.tactic_notes}
                      onChange={e => setDraft({ ...draft, tactic_notes: e.target.value })}
                      placeholder="bv. 'Prioriteer partners boven associates. Sla recruiters over. Bij proefperiode-kantoren eerst managing partner dan rest.'" />
          </Field>
          <Field label="Pause tot (yyyy-mm-dd, leeg = actief)">
            <input className="input" type="date" value={draft.pause_until || ''}
                   onChange={e => setDraft({ ...draft, pause_until: e.target.value })} />
          </Field>
          {err && <div className="s-error" style={{ fontSize: 12 }}>{err}</div>}
          <div style={{ display: 'flex', gap: 8 }}>
            <button className="btn btn--accent" disabled={saving} onClick={save}>{saving ? 'Opslaan…' : 'Opslaan'}</button>
            <button className="btn" disabled={saving} onClick={() => setEditing(false)}>Annuleer</button>
          </div>
        </div>
      )}
    </section>
  )
}

function Field({ label, children }) {
  return (
    <label style={{ display: 'block' }}>
      <div className="muted" style={{ fontSize: 12, marginBottom: 4 }}>{label}</div>
      {children}
    </label>
  )
}

function renderList(arr, labelMap) {
  if (!arr || arr.length === 0) return <span className="muted">—</span>
  return arr.map((v, i) => (
    <span key={i} className="pill" style={{ marginRight: 6 }}>{labelMap?.[v] || v}</span>
  ))
}

function splitList(s) {
  if (!s) return []
  return String(s).split(',').map(x => x.trim()).filter(Boolean)
}

function eventToneClass(event) {
  if (event === 'sent' || event === 'accepted' || event === 'run_end') return 's-success'
  if (event === 'failed' || event === 'rate_limit' || event === 'login_required') return 's-error'
  if (event === 'queued' || event === 'discovered') return 's-idle'
  if (event === 'strategy_edit') return 's-warning'
  return ''
}

function KpiCell({ value, label, accent, tone }) {
  const color =
    accent          ? 'var(--accent)'
  : tone === 'error'   ? 'var(--error)'
  : tone === 'warning' ? 'var(--warning, #d98f00)'
                       : 'var(--text)'
  return (
    <div className="kpi">
      <div className="kpi__value" style={{ fontVariantNumeric: 'tabular-nums', color }}>{value}</div>
      <div className="kpi__label">{label}</div>
    </div>
  )
}

function formatShortDate(iso) {
  if (!iso) return '—'
  return new Date(iso).toLocaleString('nl-NL', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' })
}

function truncate(s, n) {
  if (!s) return ''
  return s.length > n ? s.slice(0, n - 1) + '…' : s
}
