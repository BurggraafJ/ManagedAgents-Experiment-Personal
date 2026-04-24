import { useMemo, useState, useEffect } from 'react'
import {
  PipelineLookupContext,
  HubSpotUsersContext,
  buildPipelineLookup,
  FilteredSection,
  formatDateTime,
} from './hubspot-common'
import ProposalCardCompact from '../ProposalCardCompact'
import {
  filterAgentProposals,
  groupProposals,
  GROUP_META,
  computeMetrics,
} from './hubspot-shared.jsx'

// Daily Admin — hoofdlayout. Inbox (lijst + detail) toont ALLEEN de twee
// actieve groepen: "Meer informatie nodig" en "Goedkeuren". Alles wat
// verwerkt is (amended verstuurd / geaccepteerd / afgewezen / uitgevoerd /
// gefaald) verhuist naar het Logboek-blok onderaan, zodat het postvak
// echt leger voelt zodra je iets hebt afgehandeld.

export default function HubSpotInboxAView({ data, onRefresh, CardComponent = ProposalCardCompact }) {
  const pipelineLookup = useMemo(() => buildPipelineLookup(data.pipelines || []), [data.pipelines])
  const all = useMemo(() => filterAgentProposals(data), [data])

  // Status-filter geldt alleen voor de 2 actieve groepen; Verwerkt staat
  // los in Logboek met eigen expand/collapse gedrag.
  const [statusFilter, setStatusFilter] = useState({ need_input: true, to_review: true })

  const buckets = useMemo(() => groupProposals(all), [all])

  const inboxList = useMemo(() => {
    const out = []
    if (statusFilter.need_input) out.push(...buckets.need_input)
    if (statusFilter.to_review)  out.push(...buckets.to_review)
    return out
  }, [buckets, statusFilter])

  const [selectedId, setSelectedId] = useState(null)
  useEffect(() => {
    if (!selectedId && inboxList.length > 0) setSelectedId(inboxList[0].id)
    if (selectedId && !inboxList.find(p => p.id === selectedId)) setSelectedId(inboxList[0]?.id || null)
  }, [inboxList, selectedId])
  const selected = inboxList.find(p => p.id === selectedId) || null

  const metrics = useMemo(() => {
    const now = new Date()
    const todayStart = new Date(now); todayStart.setHours(0, 0, 0, 0)
    const weekStart = data.weekStart || (() => {
      const d = new Date(now)
      d.setDate(now.getDate() - ((now.getDay() + 6) % 7))
      d.setHours(0, 0, 0, 0)
      return d
    })()
    const lastWeekStart = new Date(weekStart.getTime() - 7 * 86400000)
    return computeMetrics(all, todayStart, weekStart, lastWeekStart)
  }, [all, data.weekStart])

  const hubspotUsers = data.hubspotUsers || []

  return (
    <PipelineLookupContext.Provider value={pipelineLookup}>
    <HubSpotUsersContext.Provider value={hubspotUsers}>
    <div className="stack" style={{ gap: 'var(--s-5)' }}>

      {/* Alleen groep-filters (Goedkeuren / Meer informatie nodig) — categorie-
          chips zijn weg want ik gebruik ze nooit. Labels blijven op de kaarten. */}
      <div className="va-filters">
        {['to_review', 'need_input'].map(g => (
          <button key={g} type="button"
            className={`cat-filter__chip ${statusFilter[g] === false ? 'is-off' : 'is-on'}`}
            onClick={() => setStatusFilter(prev => ({ ...prev, [g]: !prev[g] }))}>
            {GROUP_META[g].label}
            <span className="cat-filter__count" style={{ marginLeft: 6 }}>{buckets[g].length}</span>
          </button>
        ))}
      </div>

      {/* Inbox split — Goedkeuren bovenaan, Meer informatie nodig eronder */}
      <div className="va-split">
        <aside className="va-list">
          {['to_review', 'need_input'].map(g => (
            buckets[g].length > 0 && statusFilter[g] !== false && (
              <div key={g} className="va-list-group">
                <div className={`va-list-group__head va-list-group__head--${GROUP_META[g].accent}`}>
                  {GROUP_META[g].label} <span>{buckets[g].length}</span>
                </div>
                {buckets[g].map(p => (
                  <ListRow key={p.id} proposal={p} selected={p.id === selectedId} onSelect={() => setSelectedId(p.id)} />
                ))}
              </div>
            )
          ))}
          {inboxList.length === 0 && (
            <div className="empty empty--compact" style={{ padding: 30, fontSize: 12, textAlign: 'center' }}>
              Postvak leeg — alle voorstellen zijn verwerkt.<br />
              <span className="muted" style={{ fontSize: 10.5 }}>Zie Logboek hieronder.</span>
            </div>
          )}
        </aside>
        <main className="va-detail">
          {selected ? (
            // key forceert remount bij item-wissel, zodat lokale state
            // (feedback-tekst, mode, optimistische overrides) niet lekt
            // tussen voorstellen.
            <CardComponent key={selected.id} proposal={selected} onRefresh={onRefresh} />
          ) : (
            <div className="empty empty--compact" style={{ padding: 60 }}>
              {inboxList.length === 0 ? 'Geen actieve voorstellen.' : 'Selecteer een item links.'}
            </div>
          )}
        </main>
      </div>

      {/* Bottom row: Verwerkt (Logboek) + Andere contactmomenten + Cijfers */}
      <div className="va-bottom">
        <LogBlock proposals={buckets.processed} />
        <FilteredBlock filtered={data.filtered || []} />
        <MetricsBlock metrics={metrics} />
      </div>

    </div>
    </HubSpotUsersContext.Provider>
    </PipelineLookupContext.Provider>
  )
}

// Cijfers — default ingeklapt. KPI's staan onderaan, niet meer bovenin.
function MetricsBlock({ metrics }) {
  const [open, setOpen] = useState(false)
  return (
    <section className="va-block">
      <button type="button" className="va-block__head" onClick={() => setOpen(v => !v)}>
        <span className="va-block__caret">{open ? '▾' : '▸'}</span>
        <span className="va-block__title">Cijfers</span>
        <span className="va-block__count">{metrics.open}</span>
        <span className="muted va-block__hint">open · vandaag · deze week — scanbare totalen</span>
      </button>
      {open && (
        <div className="va-block__body">
          <div className="va-kpi-row">
            <KpiCard label="Open voorstellen" value={metrics.open} sub={`${metrics.needs_input} wacht op input`} tone="accent" />
            <KpiCard label="Vandaag aangemaakt" value={metrics.today_created} sub={`${metrics.today_accepted} akkoord · ${metrics.today_rejected} afgewezen`} tone="neutral" />
            <KpiCard label="Deze week" value={metrics.week_created} sub={<Trend pct={metrics.week_trend} />} tone="neutral" />
            <KpiCard label="Geaccepteerd deze week" value={metrics.week_accepted} sub="uitgevoerd + accepted" tone="success" />
            <KpiCard label="Afgewezen deze week" value={metrics.week_rejected} sub="rejected + failed" tone="danger" />
          </div>
        </div>
      )}
    </section>
  )
}

function KpiCard({ label, value, sub, tone = 'neutral' }) {
  return (
    <div className={`va-kpi va-kpi--${tone}`}>
      <div className="va-kpi__label">{label}</div>
      <div className="va-kpi__value">{value}</div>
      <div className="va-kpi__sub">{sub || '\u00A0'}</div>
    </div>
  )
}

function Trend({ pct }) {
  if (pct == null || isNaN(pct)) return '—'
  const arrow = pct > 0 ? '↗' : pct < 0 ? '↘' : '→'
  const tone = pct > 0 ? 'trend-up' : pct < 0 ? 'trend-down' : 'trend-flat'
  return <span className={`va-trend va-trend--${tone}`}>{arrow} {pct > 0 ? '+' : ''}{pct}% vs vorige week</span>
}

function ListRow({ proposal, selected, onSelect }) {
  const isRevised = !!proposal.amended_from && proposal.status === 'pending'
  const needsInfo = proposal.needs_info === true && !proposal.amended_from
  const cat = proposal.category || 'overig'
  return (
    <button type="button"
      className={`va-row ${selected ? 'is-selected' : ''} ${isRevised ? 'is-revised' : ''} ${needsInfo ? 'is-needs' : ''}`}
      onClick={onSelect}>
      <div className="va-row__top">
        <span className={`va-dot va-dot--${cat}`} aria-hidden="true" />
        <span className="va-row__subject">{proposal.subject}</span>
      </div>
      <div className="va-row__meta">
        {needsInfo && <span className="va-row__tag va-row__tag--warn">input</span>}
        {isRevised && <span className="va-row__tag va-row__tag--accent">✎ herzien</span>}
        <span className="va-row__time">{formatDateTime(proposal.created_at)}</span>
      </div>
    </button>
  )
}

// Logboek — toont alles in de 'processed' bucket. Gesorteerd op meest recent,
// max 25 items. Compact genoeg voor scan, met uitbreidbaar per-status filter
// als de lijst lang wordt.
function LogBlock({ proposals }) {
  const [open, setOpen] = useState(false)
  const [showStatus, setShowStatus] = useState({ amended: true, accepted: true, executed: true, rejected: true, failed: true })
  const filtered = proposals.filter(p => showStatus[p.status] !== false)
  const items = filtered.slice(0, 25)

  const counts = proposals.reduce((acc, p) => { acc[p.status] = (acc[p.status] || 0) + 1; return acc }, {})

  return (
    <section className="va-block">
      <button type="button" className="va-block__head" onClick={() => setOpen(v => !v)}>
        <span className="va-block__caret">{open ? '▾' : '▸'}</span>
        <span className="va-block__title">Logboek · Verwerkt</span>
        <span className="va-block__count">{proposals.length}</span>
        <span className="muted va-block__hint">alles wat uit je postvak is — wacht op run, geaccepteerd, afgewezen of gefaald</span>
      </button>
      {open && (
        <div className="va-block__body">
          {proposals.length === 0 ? (
            <div className="empty empty--compact" style={{ padding: 14, fontSize: 11 }}>Nog niks verwerkt.</div>
          ) : (
            <>
              <div className="va-log-filters">
                {[
                  ['amended',  'Wacht op run'],
                  ['accepted', 'Geaccepteerd'],
                  ['executed', 'Uitgevoerd'],
                  ['rejected', 'Afgewezen'],
                  ['failed',   'Gefaald'],
                ].map(([key, label]) => (
                  <button key={key} type="button"
                    className={`cat-filter__chip ${showStatus[key] === false ? 'is-off' : 'is-on'}`}
                    onClick={() => setShowStatus(prev => ({ ...prev, [key]: !prev[key] }))}>
                    {label} <span className="cat-filter__count" style={{ marginLeft: 6 }}>{counts[key] || 0}</span>
                  </button>
                ))}
              </div>
              <div className="va-log-list">
                {items.map(p => <LogLine key={p.id} proposal={p} />)}
                {filtered.length > items.length && (
                  <div className="muted va-log-truncated">
                    … nog {filtered.length - items.length} verborgen (meest recente 25 getoond).
                  </div>
                )}
              </div>
            </>
          )}
        </div>
      )}
    </section>
  )
}

// Duidelijke labels die zowel status als voortgang tonen.
const STATUS_META = {
  amended:  { label: 'Wacht op volgende run',      hint: 'agent pakt dit op bij eerstvolgende sync en schrijft nieuw voorstel' },
  accepted: { label: 'Goedgekeurd — wacht op run', hint: 'agent heeft nog niet uitgevoerd; gebeurt bij eerstvolgende sync' },
  executed: { label: 'Uitgevoerd ✓',               hint: 'door agent afgehandeld — check HubSpot/Jira/Kanban' },
  rejected: { label: 'Afgewezen',                  hint: 'jij hebt dit voorstel weggeklikt' },
  failed:   { label: 'Gefaald',                    hint: 'agent kon de actie niet uitvoeren — zie foutregel' },
}

function LogLine({ proposal }) {
  const [open, setOpen] = useState(false)
  const when = proposal.executed_at || proposal.reviewed_at || proposal.created_at
  const meta = STATUS_META[proposal.status] || { label: proposal.status, hint: '' }
  const actions = Array.isArray(proposal.proposal?.actions) ? proposal.proposal.actions : []
  const exec = proposal.execution_result || null
  const hasDetails = actions.length > 0 || !!exec

  return (
    <div className={`va-log-line va-log-line--${proposal.status} ${open ? 'is-open' : ''}`}>
      <button
        type="button"
        className="va-log-line__row"
        onClick={() => hasDetails && setOpen(v => !v)}
        disabled={!hasDetails}
      >
        <span className="va-log-line__caret">{hasDetails ? (open ? '▾' : '▸') : ''}</span>
        <span className="va-log-line__status" title={meta.hint}>{meta.label}</span>
        <span className="va-log-line__subject">{proposal.subject}</span>
        <span className="va-log-line__time">{formatDateTime(when)}</span>
      </button>

      {open && hasDetails && (
        <div className="va-log-line__body">
          {actions.length > 0 && (
            <ul className="va-log-line__actions">
              {actions.map((a, i) => <LogActionSummary key={i} action={a} />)}
            </ul>
          )}
          {exec && proposal.status === 'executed' && <LogExecutionResult exec={exec} />}
          {exec?.error && (
            <div className="va-log-line__error">⚠ {exec.error}</div>
          )}
        </div>
      )}
    </div>
  )
}

function LogActionSummary({ action }) {
  const type = action?.type || 'actie'
  const label = action?.label || ''
  const p = action?.payload || {}
  // Korte one-liner per actie — voldoende om in HubSpot te kunnen verifiëren.
  let tail = ''
  if (type === 'stage' && p.transitionName) tail = `→ ${p.transitionName}`
  else if (type === 'stage' && (p.dealstage || p.stage)) tail = `→ ${p.dealstage || p.stage}`
  else if (type === 'task' && (p.title || p.due)) tail = [p.title, p.due && `deadline ${p.due}`].filter(Boolean).join(' · ')
  else if ((type === 'jira' || type === 'card') && (p.issueKey || p.summary || p.board)) {
    tail = [p.issueKey, p.operation, p.summary, p.board].filter(Boolean).join(' · ')
  } else if (type === 'contact' && (p.firstname || p.email)) {
    tail = [p.firstname && `${p.firstname} ${p.lastname || ''}`.trim(), p.email].filter(Boolean).join(' · ')
  } else if (type === 'company' && (p.name || p.domain)) {
    tail = [p.name, p.domain].filter(Boolean).join(' · ')
  } else if (type === 'note' && p.content) {
    tail = p.content.length > 80 ? p.content.slice(0, 80).trim() + '…' : p.content
  }
  return (
    <li className="va-log-action">
      <span className={`va-log-action__type va-log-action__type--${type}`}>{type}</span>
      <span className="va-log-action__text">{label || tail || '(geen details)'}</span>
      {label && tail && <span className="va-log-action__tail">{tail}</span>}
    </li>
  )
}

function LogExecutionResult({ exec }) {
  // Toon alleen de handige IDs + korte notatie die Jelle kan gebruiken om
  // in HubSpot/Jira te checken. Filtert meta-velden eruit.
  const entries = Object.entries(exec).filter(([k, v]) =>
    v != null && v !== '' && k !== 'error' && typeof v !== 'object'
  )
  if (entries.length === 0) return null
  return (
    <dl className="va-log-result">
      {entries.map(([k, v]) => (
        <div key={k} className="va-log-result__pair">
          <dt>{k}</dt><dd>{String(v)}</dd>
        </div>
      ))}
    </dl>
  )
}

function FilteredBlock({ filtered }) {
  const [open, setOpen] = useState(false)
  return (
    <section className="va-block">
      <button type="button" className="va-block__head" onClick={() => setOpen(v => !v)}>
        <span className="va-block__caret">{open ? '▾' : '▸'}</span>
        <span className="va-block__title">Andere contactmomenten</span>
        <span className="va-block__count">{filtered.length}</span>
        <span className="muted va-block__hint">records die agent heeft weggefilterd — klik + om alsnog op te pakken</span>
      </button>
      {open && (
        <div className="va-block__body">
          <FilteredSection filtered={filtered} />
        </div>
      )}
    </section>
  )
}
