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

      {/* Bottom blocks: Verwerkt vandaag / Andere contactmomenten / Cijfers */}
      <div className="adm-bottom">
        <LogBlockMaestro proposals={buckets.processed} />
        <FilteredBlockMaestro filtered={filtered || []} />
        <MetricsBlockMaestro metrics={metrics} processed={buckets.processed} />
      </div>

    </div>
    </HubSpotUsersContext.Provider>
    </PipelineLookupContext.Provider>
  )
}

// ─────────────────────────── Verwerkt vandaag ───────────────────────────
// Mapping naar mockup-verdict labels (Administratie.html, sectie .adm-bottom):
//   executed → "✓ akkoord"     (groen)
//   accepted → "geaccepteerd"  (blauw mono — wacht op uitvoering door daily-admin-execute)
//   amended  → "wacht op run"  (warning mono — wacht op Sonnet-rewrite door daily-admin)
//   rejected → "✗ afgewezen"   (rood)
//   failed   → "⚠ gefaald"     (rood)
const STATUS_META = {
  executed: { label: '✓ akkoord',     verdict: 'ok' },
  accepted: { label: 'geaccepteerd',  verdict: 'accepted' },
  amended:  { label: 'wacht op run',  verdict: 'amended' },
  rejected: { label: '✗ afgewezen',   verdict: 'no' },
  failed:   { label: '⚠ gefaald',     verdict: 'no' },
}

// Probeer "Company → rest" / "Company — rest" / "Company · rest" te splitsen.
// Eerste deel = company (bold), rest = plain. Geen match → hele subject bold.
function splitSubject(subject) {
  if (!subject) return { head: '', tail: '' }
  const seps = [' — ', ' → ', ' · ']
  for (const s of seps) {
    const idx = subject.indexOf(s)
    if (idx > 0) return { head: subject.slice(0, idx), tail: subject.slice(idx) }
  }
  return { head: subject, tail: '' }
}

function LogBlockMaestro({ proposals }) {
  const [open, setOpen] = useState(true)
  const [showAll, setShowAll] = useState(false)

  // Mockup zegt "Verwerkt vandaag" → filter op vandaag (reviewed_at/executed_at).
  const todayStart = useMemo(() => {
    const d = new Date(); d.setHours(0, 0, 0, 0); return d.getTime()
  }, [])
  const today = useMemo(() =>
    proposals.filter(p => {
      const when = p.executed_at || p.reviewed_at || p.created_at
      return when && new Date(when).getTime() >= todayStart
    }),
    [proposals, todayStart]
  )

  const counts = useMemo(() => today.reduce((acc, p) => { acc[p.status] = (acc[p.status] || 0) + 1; return acc }, {}), [today])
  const akkoord = (counts.accepted || 0) + (counts.executed || 0)
  const afgewezen = (counts.rejected || 0) + (counts.failed || 0)
  const amended = counts.amended || 0
  const hintParts = []
  if (akkoord)   hintParts.push(`${akkoord} akkoord`)
  if (afgewezen) hintParts.push(`${afgewezen} afgewezen`)
  if (amended)   hintParts.push(`${amended} amended`)
  const visible = showAll ? today : today.slice(0, 3)
  const hidden = today.length - 3

  return (
    <section className="va-block">
      <button type="button" className="va-block__head" onClick={() => setOpen(v => !v)}>
        <span className="va-block__caret">{open ? '▾' : '▸'}</span>
        <span className="va-block__title">Verwerkt vandaag</span>
        <span className="va-block__count">{today.length}</span>
        <span className="va-block__hint">{hintParts.join(' · ') || 'nog niets'}</span>
      </button>
      {open && (
        <div className="va-block__body">
          {today.length === 0 ? (
            <div className="va-block__body--empty">Nog niks verwerkt vandaag.</div>
          ) : (
            <>
              {visible.map(p => {
                const meta = STATUS_META[p.status] || { label: p.status, verdict: 'pending' }
                const when = p.executed_at || p.reviewed_at || p.created_at
                const { head, tail } = splitSubject(p.subject)
                return (
                  <div key={p.id} className="log-row">
                    <span className="log-row__when">{shortTime(when)}</span>
                    <span className="log-row__what" title={p.subject}>
                      <strong>{head}</strong>{tail}
                    </span>
                    <span className={`log-row__verdict ${meta.verdict}`}>{meta.label}</span>
                  </div>
                )
              })}
              {hidden > 0 && (
                <button type="button" className="log-toggle-more" onClick={() => setShowAll(v => !v)}>
                  {showAll ? 'Minder tonen ▴' : `Toon meer (${hidden}) ▾`}
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

// Median doorlooptijd in minuten van reviewed_at → executed_at (alleen executed rijen).
function computeMedianTurnaround(processed) {
  const deltas = (processed || [])
    .filter(p => p.executed_at && p.reviewed_at)
    .map(p => (new Date(p.executed_at).getTime() - new Date(p.reviewed_at).getTime()) / 60000)
    .filter(d => d >= 0)
    .sort((a, b) => a - b)
  if (deltas.length === 0) return null
  const mid = Math.floor(deltas.length / 2)
  return deltas.length % 2 === 0 ? (deltas[mid - 1] + deltas[mid]) / 2 : deltas[mid]
}

function formatTurnaround(min) {
  if (min == null) return '—'
  if (min < 60) return `${Math.round(min)}m`
  const h = Math.floor(min / 60)
  const m = Math.round(min % 60)
  return m ? `${h}u ${m}m` : `${h}u`
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
// Mockup heeft 4 KPIs: Open (accent) · Akkoord (success) · Vandaag · Doorlooptijd
// Doorlooptijd = median(executed_at - reviewed_at) van recent verwerkte rijen.
function MetricsBlockMaestro({ metrics, processed }) {
  const [open, setOpen] = useState(true)
  const turnaround = useMemo(() => computeMedianTurnaround(processed), [processed])
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
          <Kpi tone="accent"  label="Open"         value={metrics.open}           sub={`${metrics.needs_input} wacht op input`} />
          <Kpi tone="success" label="Akkoord"     value={metrics.week_accepted}  sub={<Trend pct={metrics.week_trend} />} />
          <Kpi                label="Vandaag"     value={metrics.today_created}  sub={`${metrics.today_accepted} akkoord · ${metrics.today_rejected} afgew.`} />
          <Kpi                label="Doorlooptijd" value={formatTurnaround(turnaround)} sub="mediaan" />
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
