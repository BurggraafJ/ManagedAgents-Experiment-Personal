import { useMemo, useState, useEffect } from 'react'
import {
  PipelineLookupContext,
  HubSpotUsersContext,
  buildPipelineLookup,
  FilteredSection,
  formatDateTime,
} from '../../hubspot-common'
import {
  filterAgentProposals,
  groupProposals,
  GROUP_META,
  computeMetrics,
} from '../../hubspot-shared.jsx'
import ProposalCardMaestro from './ProposalCardMaestro'
import ListRowMaestro from './ListRowMaestro'

// Daily Admin · Maestro main desktop view — mockup-native JSX (Administratie.html).
// Spiegelt HubSpotInboxAView qua functionaliteit (filter-chips, split lijst/detail,
// bottom blocks). Classes komen rechtstreeks uit de mockup (`.adm`, `.adm-filters`,
// `.adm-split`, `.adm-list`, `.adm-detail`, `.adm-bottom`, `.va-block`, `.log-row`,
// `.kpi-grid`, `.kpi`). Geen overlay op V1 `.va-row` / `.pcv7__` classes meer.

const GROUP_ACCENT = {
  is_new:     'new',
  to_review:  'review',
  need_input: 'need',
}

export default function HubSpotInboxAMaestroView({
  proposals,
  pipelines,
  hubspotUsers,
  filtered,
  weekStart,
  onRefresh,
}) {
  const pipelineLookup = useMemo(() => buildPipelineLookup(pipelines || []), [pipelines])
  const all = useMemo(() => filterAgentProposals(proposals), [proposals])

  const [statusFilter, setStatusFilter] = useState({ need_input: true, is_new: true, to_review: true })

  const buckets = useMemo(() => groupProposals(all), [all])

  const inboxList = useMemo(() => {
    const out = []
    if (statusFilter.is_new)     out.push(...buckets.is_new)
    if (statusFilter.to_review)  out.push(...buckets.to_review)
    if (statusFilter.need_input) out.push(...buckets.need_input)
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
    const ws = weekStart || (() => {
      const d = new Date(now)
      d.setDate(now.getDate() - ((now.getDay() + 6) % 7))
      d.setHours(0, 0, 0, 0)
      return d
    })()
    const lastWeekStart = new Date(ws.getTime() - 7 * 86400000)
    return computeMetrics(all, todayStart, ws, lastWeekStart)
  }, [all, weekStart])

  const hubspotUsersList = hubspotUsers || []

  return (
    <PipelineLookupContext.Provider value={pipelineLookup}>
    <HubSpotUsersContext.Provider value={hubspotUsersList}>
    <div className="adm">

      {/* Filter chips — mockup-native (count VOOR label) */}
      <div className="adm-filters">
        {['is_new', 'to_review', 'need_input'].map(g => {
          const active = statusFilter[g] !== false
          const accent = GROUP_ACCENT[g]
          const cls = [
            'filter-chip',
            active ? 'active' : '',
            active ? `accent-${accent}` : '',
          ].filter(Boolean).join(' ')
          return (
            <button
              key={g}
              type="button"
              className={cls}
              onClick={() => setStatusFilter(prev => ({ ...prev, [g]: !prev[g] }))}
              title={GROUP_META[g].hint}
            >
              <span className="filter-chip-count">{buckets[g].length}</span>
              {GROUP_META[g].label}
            </button>
          )
        })}
      </div>

      {/* Split: lijst + detail */}
      <div className="adm-split">
        <aside className="adm-list">
          <div className="adm-list-scroll">
            {['is_new', 'to_review', 'need_input'].map(g => (
              buckets[g].length > 0 && statusFilter[g] !== false && (
                <div key={g} className="adm-list-group">
                  <div className={`adm-list-group-head adm-list-group-head--${GROUP_ACCENT[g]}`}>
                    {GROUP_META[g].label} <span>{buckets[g].length}</span>
                  </div>
                  {buckets[g].map(p => (
                    <ListRowMaestro
                      key={p.id}
                      proposal={p}
                      selected={p.id === selectedId}
                      onSelect={() => setSelectedId(p.id)}
                      pipelineLookup={pipelineLookup}
                    />
                  ))}
                </div>
              )
            ))}
            {inboxList.length === 0 && (
              <div className="adm-list-empty">
                Postvak leeg — alle voorstellen zijn verwerkt.
                <span>Zie Verwerkt-blok hieronder.</span>
              </div>
            )}
          </div>
        </aside>

        <main className="adm-detail">
          {selected ? (
            <ProposalCardMaestro key={selected.id} proposal={selected} onRefresh={onRefresh} />
          ) : (
            <div className="adm-detail-empty">
              {inboxList.length === 0 ? 'Geen actieve voorstellen.' : 'Selecteer een item links.'}
            </div>
          )}
        </main>
      </div>

      {/* Bottom blocks: Verwerkt / Andere contactmomenten / Cijfers */}
      <div className="adm-bottom">
        <LogBlockMaestro proposals={buckets.processed} />
        <FilteredBlockMaestro filtered={filtered || []} />
        <MetricsBlockMaestro metrics={metrics} />
      </div>

    </div>
    </HubSpotUsersContext.Provider>
    </PipelineLookupContext.Provider>
  )
}

// ─────────────────────────── Verwerkt vandaag ───────────────────────────
const STATUS_META = {
  amended:  { label: 'Wacht op volgende run',      hint: 'agent pakt dit op bij eerstvolgende sync en schrijft nieuw voorstel', verdict: 'pending' },
  accepted: { label: 'Goedgekeurd — wacht op run', hint: 'agent heeft nog niet uitgevoerd; gebeurt bij eerstvolgende sync',   verdict: 'pending' },
  executed: { label: '✓ uitgevoerd',               hint: 'door agent afgehandeld — check HubSpot/Jira/Kanban',                  verdict: 'ok' },
  rejected: { label: '✗ afgewezen',                hint: 'jij hebt dit voorstel weggeklikt',                                    verdict: 'no' },
  failed:   { label: '⚠ gefaald',                  hint: 'agent kon de actie niet uitvoeren — zie foutregel',                  verdict: 'no' },
}

function LogBlockMaestro({ proposals }) {
  const [open, setOpen] = useState(true)
  const [showAll, setShowAll] = useState(false)
  const counts = useMemo(() => proposals.reduce((acc, p) => { acc[p.status] = (acc[p.status] || 0) + 1; return acc }, {}), [proposals])
  const visible = showAll ? proposals : proposals.slice(0, 3)
  const accepted = (counts.accepted || 0) + (counts.executed || 0)
  const rejected = (counts.rejected || 0) + (counts.failed || 0)
  const amended  = counts.amended || 0

  return (
    <section className="va-block">
      <button type="button" className="va-block__head" onClick={() => setOpen(v => !v)}>
        <span className="va-block__caret">{open ? '▾' : '▸'}</span>
        <span className="va-block__title">Verwerkt vandaag</span>
        <span className="va-block__count">{proposals.length}</span>
        <span className="va-block__hint">
          {accepted} akkoord · {rejected} afgewezen{amended ? ` · ${amended} amended` : ''}
        </span>
      </button>
      {open && (
        <div className="va-block__body">
          {proposals.length === 0 ? (
            <div className="va-block__body--empty">Nog niks verwerkt vandaag.</div>
          ) : (
            <>
              {visible.map(p => {
                const meta = STATUS_META[p.status] || { label: p.status, verdict: 'pending' }
                const when = p.executed_at || p.reviewed_at || p.created_at
                return (
                  <div key={p.id} className="log-row">
                    <span className="log-row__when">{shortTime(when)}</span>
                    <span className="log-row__what" title={p.subject}>
                      <strong>{p.subject}</strong>
                    </span>
                    <span className={`log-row__verdict ${meta.verdict}`}>{meta.label}</span>
                  </div>
                )
              })}
              {proposals.length > 3 && (
                <button
                  type="button"
                  className="log-toggle-more"
                  onClick={() => setShowAll(v => !v)}
                >
                  {showAll ? 'Minder tonen ▴' : `Toon meer (${proposals.length - 3}) ▾`}
                </button>
              )}
            </>
          )}
        </div>
      )}
    </section>
  )
}

function shortTime(iso) {
  if (!iso) return ''
  const d = new Date(iso)
  if (isNaN(d.getTime())) return ''
  return d.toLocaleTimeString('nl-NL', { hour: '2-digit', minute: '2-digit' })
}

// ─────────────────────────── Andere contactmomenten ───────────────────────────
function FilteredBlockMaestro({ filtered }) {
  const [open, setOpen] = useState(false)
  return (
    <section className="va-block">
      <button type="button" className="va-block__head" onClick={() => setOpen(v => !v)}>
        <span className="va-block__caret">{open ? '▾' : '▸'}</span>
        <span className="va-block__title">Andere contactmomenten</span>
        <span className="va-block__count">{filtered.length}</span>
        <span className="va-block__hint">gezien, niet opgepakt</span>
      </button>
      {open ? (
        <div className="va-block__body">
          <FilteredSection filtered={filtered} />
        </div>
      ) : (
        <div className="va-block__body va-block__body--empty">
          Klik om uit te klappen — {filtered.length} {filtered.length === 1 ? 'mail/event' : 'mails & events'} met te lage score voor automatisch voorstel.
        </div>
      )}
    </section>
  )
}

// ─────────────────────────── Cijfers (KPIs) ───────────────────────────
function MetricsBlockMaestro({ metrics }) {
  const [open, setOpen] = useState(true)
  return (
    <section className="va-block">
      <button type="button" className="va-block__head" onClick={() => setOpen(v => !v)}>
        <span className="va-block__caret">{open ? '▾' : '▸'}</span>
        <span className="va-block__title">Cijfers</span>
        <span className="va-block__count">{metrics.open}</span>
        <span className="va-block__hint">open · vandaag · deze week</span>
      </button>
      {open && (
        <div className="kpi-grid">
          <Kpi tone="accent"  label="Open"          value={metrics.open}           sub={`${metrics.needs_input} wacht op input`} />
          <Kpi tone="success" label="Akkoord"       value={metrics.week_accepted}  sub={<Trend pct={metrics.week_trend} />} />
          <Kpi                label="Vandaag"       value={metrics.today_created}  sub={`${metrics.today_accepted} akkoord · ${metrics.today_rejected} afgew.`} />
          <Kpi                label="Afgewezen"     value={metrics.week_rejected}  sub="deze week" />
        </div>
      )}
    </section>
  )
}

function Kpi({ tone = 'neutral', label, value, sub }) {
  const cls = tone === 'accent' ? 'kpi accent' : tone === 'success' ? 'kpi success' : 'kpi'
  return (
    <div className={cls}>
      <div className="kpi__label">{label}</div>
      <div className="kpi__value">{value}</div>
      <div className="kpi__sub">{sub || ' '}</div>
    </div>
  )
}

function Trend({ pct }) {
  if (pct == null || isNaN(pct)) return '—'
  const arrow = pct > 0 ? '↗' : pct < 0 ? '↘' : '→'
  return <span>{arrow} {pct > 0 ? '+' : ''}{pct}% vs vorige</span>
}

// formatDateTime ongebruikt hier — sub-componenten gebruiken hun eigen formatters
void formatDateTime
