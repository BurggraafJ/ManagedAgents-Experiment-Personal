import { useMemo, useState } from 'react'
import {
  filterAgentProposals,
  groupProposals,
  computeMetrics,
} from '../../hubspot-shared.jsx'
import { FilteredSection } from '../../hubspot-common'

// AdminInfoPanel — drie tabs in een Modal achter de "Informatie"-knop in de
// topbar. Tabs: Laatst verwerkt · Andere contactmomenten · Cijfers.
// Default-tab is "Laatst verwerkt" zodat je direct ziet wat de heartbeat nog
// moet oppakken (accepted / amended bovenaan).

const TABS = [
  { key: 'log',      label: 'Akkoord verwerkt' },
  { key: 'filtered', label: 'Andere contactmomenten' },
  { key: 'metrics',  label: 'Cijfers' },
]

export default function AdminInfoPanel({ proposals, filtered, weekStart }) {
  const [tab, setTab] = useState('log')

  const all = useMemo(() => filterAgentProposals(proposals), [proposals])
  const buckets = useMemo(() => groupProposals(all), [all])

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

  // Counts per tab voor de badge in de tab-knop.
  const filteredCount = (filtered || []).length
  const logCount = buckets.processed.length
  const waitingCount = buckets.processed.filter(p => p.status === 'accepted' || p.status === 'amended').length

  return (
    <div className="adm-info-panel">
      <div className="adm-info-tabs" role="tablist">
        {TABS.map(t => {
          const isActive = tab === t.key
          let badge = null
          if (t.key === 'log' && waitingCount > 0) badge = waitingCount
          else if (t.key === 'log') badge = logCount
          else if (t.key === 'filtered') badge = filteredCount
          else if (t.key === 'metrics') badge = metrics.open
          return (
            <button
              key={t.key}
              type="button"
              role="tab"
              aria-selected={isActive}
              className={`adm-info-tabs__btn ${isActive ? 'is-active' : ''}`}
              onClick={() => setTab(t.key)}
            >
              <span>{t.label}</span>
              {badge != null && badge > 0 && (
                <span className={`adm-info-tabs__badge ${t.key === 'log' && waitingCount > 0 ? 'is-warn' : ''}`}>
                  {badge}
                </span>
              )}
            </button>
          )
        })}
      </div>

      <div className="adm-info-panel__body" role="tabpanel">
        {tab === 'log' && <LogTab proposals={buckets.processed} />}
        {tab === 'filtered' && <FilteredTab filtered={filtered || []} />}
        {tab === 'metrics' && <MetricsTab metrics={metrics} processed={buckets.processed} />}
      </div>
    </div>
  )
}

// ─────────────────────────── Laatst verwerkt ───────────────────────────
const STATUS_META = {
  executed: { label: '✓ akkoord',     verdict: 'ok',       waiting: false, hint: 'Door agent uitgevoerd in HubSpot/Jira' },
  accepted: { label: 'geaccepteerd',  verdict: 'accepted', waiting: true,  hint: 'Wacht op daily-admin-execute (max 15 min)' },
  amended:  { label: 'wacht op run',  verdict: 'amended',  waiting: true,  hint: 'Wacht op daily-admin Sonnet-rewrite (12:30/17:30)' },
  rejected: { label: '✗ afgewezen',   verdict: 'no',       waiting: false, hint: 'Door jou weggeklikt' },
  failed:   { label: '⚠ gefaald',     verdict: 'no',       waiting: false, hint: 'Uitvoering faalde — check execution_result' },
}

function splitSubject(subject) {
  if (!subject) return { head: '', tail: '' }
  const seps = [' — ', ' → ', ' · ']
  for (const s of seps) {
    const idx = subject.indexOf(s)
    if (idx > 0) return { head: subject.slice(0, idx), tail: subject.slice(idx) }
  }
  return { head: subject, tail: '' }
}

function shortWhen(iso) {
  if (!iso) return ''
  const d = new Date(iso)
  if (isNaN(d.getTime())) return ''
  const now = new Date()
  const sameDay = d.getFullYear() === now.getFullYear()
    && d.getMonth() === now.getMonth()
    && d.getDate() === now.getDate()
  if (sameDay) return d.toLocaleTimeString('nl-NL', { hour: '2-digit', minute: '2-digit' })
  return d.toLocaleDateString('nl-NL', { weekday: 'short', day: '2-digit', month: 'short' })
}

function LogTab({ proposals }) {
  const [showAll, setShowAll] = useState(false)

  // Sorteer: waiting (accepted/amended) eerst, dan op tijd descending.
  const sorted = useMemo(() => {
    const score = (p) => (STATUS_META[p.status]?.waiting ? 0 : 1)
    const when = (p) => new Date(p.executed_at || p.reviewed_at || p.created_at).getTime()
    return [...proposals].sort((a, b) => {
      const d = score(a) - score(b)
      if (d !== 0) return d
      return when(b) - when(a)
    })
  }, [proposals])

  const recent = sorted.slice(0, 25)
  const visible = showAll ? recent : recent.slice(0, 8)
  const hidden = recent.length - 8

  const waitingItems = sorted.filter(p => STATUS_META[p.status]?.waiting)
  const hasWaiting = waitingItems.length > 0

  if (proposals.length === 0) {
    return (
      <div className="adm-info-empty">
        <div className="adm-info-empty__title">Nog niks verwerkt</div>
        <div className="adm-info-empty__hint">Zodra je iets goedkeurt of afwijst verschijnt het hier.</div>
      </div>
    )
  }

  return (
    <div className="adm-info-section">
      {hasWaiting && (
        <div className="adm-info-callout">
          <strong>{waitingItems.length}</strong> {waitingItems.length === 1 ? 'voorstel staat' : 'voorstellen staan'} klaar voor de heartbeat — bovenaan in deze lijst.
        </div>
      )}
      <div className="adm-info-log">
        {visible.map(p => {
          const meta = STATUS_META[p.status] || { label: p.status, verdict: 'pending', waiting: false }
          const when = p.executed_at || p.reviewed_at || p.created_at
          const { head, tail } = splitSubject(p.subject)
          return (
            <div key={p.id} className={`log-row ${meta.waiting ? 'is-waiting' : ''}`}>
              <span className="log-row__when">{shortWhen(when)}</span>
              <span className="log-row__what" title={p.subject}>
                <strong>{head}</strong>{tail}
              </span>
              <span className={`log-row__verdict ${meta.verdict}`} title={meta.hint}>{meta.label}</span>
            </div>
          )
        })}
        {hidden > 0 && (
          <button type="button" className="log-toggle-more" onClick={() => setShowAll(v => !v)}>
            {showAll ? 'Minder tonen ▴' : `Toon meer (${hidden}) ▾`}
          </button>
        )}
      </div>
    </div>
  )
}

// ─────────────────────────── Andere contactmomenten ─────────────────────
function FilteredTab({ filtered }) {
  if (filtered.length === 0) {
    return (
      <div className="adm-info-empty">
        <div className="adm-info-empty__title">Geen records weggefilterd</div>
        <div className="adm-info-empty__hint">Hier verschijnen mails/events die de agent zag maar niet als voorstel oppakte (te lage score).</div>
      </div>
    )
  }
  return (
    <div className="adm-info-section">
      <FilteredSection filtered={filtered} />
    </div>
  )
}

// ─────────────────────────── Cijfers (KPIs) ─────────────────────────────
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

function MetricsTab({ metrics, processed }) {
  const turnaround = useMemo(() => computeMedianTurnaround(processed), [processed])
  return (
    <div className="adm-info-section">
      <div className="kpi-grid">
        <Kpi tone="accent"  label="Open"         value={metrics.open}          sub={`${metrics.needs_input} wacht op input`} />
        <Kpi tone="success" label="Akkoord"      value={metrics.week_accepted} sub={<Trend pct={metrics.week_trend} />} />
        <Kpi                label="Vandaag"      value={metrics.today_created} sub={`${metrics.today_accepted} akkoord · ${metrics.today_rejected} afgew.`} />
        <Kpi                label="Doorlooptijd" value={formatTurnaround(turnaround)} sub="mediaan" />
      </div>
    </div>
  )
}

function Kpi({ tone = 'neutral', label, value, sub }) {
  const cls = tone === 'accent' ? 'kpi accent' : tone === 'success' ? 'kpi success' : 'kpi'
  return (
    <div className={cls}>
      <div className="kpi__label">{label}</div>
      <div className="kpi__value">{value}</div>
      <div className="kpi__sub">{sub || ' '}</div>
    </div>
  )
}

function Trend({ pct }) {
  if (pct == null || isNaN(pct)) return '—'
  const arrow = pct > 0 ? '↗' : pct < 0 ? '↘' : '→'
  return <span>{arrow} {pct > 0 ? '+' : ''}{pct}% vs vorige</span>
}
