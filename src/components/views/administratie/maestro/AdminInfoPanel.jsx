import { useMemo, useState } from 'react'
import {
  filterAgentProposals,
  groupProposals,
  computeMetrics,
} from '../../hubspot-shared.jsx'
import { FilteredSection } from '../../hubspot-common'

// AdminInfoPanel — drie va-blocks die voorheen onderaan de inbox stonden.
// Sinds 2026-05-13 wonen ze in een Modal achter de "Informatie"-knop in de
// topbar. Niet langer permanent zichtbaar omdat ze in de weg stonden als ze
// niet nodig waren.
//
// Bevat: Laatst verwerkt · Andere contactmomenten · Cijfers
//
// Props: proposals (raw uit useAdmin), filtered, weekStart.

export default function AdminInfoPanel({ proposals, filtered, weekStart }) {
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

  return (
    <div className="adm-info-panel">
      <LogBlock proposals={buckets.processed} />
      <FilteredBlock filtered={filtered || []} />
      <MetricsBlock metrics={metrics} processed={buckets.processed} />
    </div>
  )
}

// ─────────────────────────── Laatst verwerkt ───────────────────────────
const STATUS_META = {
  executed: { label: '✓ akkoord',     verdict: 'ok' },
  accepted: { label: 'geaccepteerd',  verdict: 'accepted' },
  amended:  { label: 'wacht op run',  verdict: 'amended' },
  rejected: { label: '✗ afgewezen',   verdict: 'no' },
  failed:   { label: '⚠ gefaald',     verdict: 'no' },
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

function LogBlock({ proposals }) {
  const [open, setOpen] = useState(true)
  const [showAll, setShowAll] = useState(false)
  const recent = useMemo(() => proposals.slice(0, 25), [proposals])
  const counts = useMemo(() => recent.reduce((acc, p) => { acc[p.status] = (acc[p.status] || 0) + 1; return acc }, {}), [recent])
  const akkoord = (counts.accepted || 0) + (counts.executed || 0)
  const afgewezen = (counts.rejected || 0) + (counts.failed || 0)
  const amended = counts.amended || 0
  const hintParts = []
  if (akkoord)   hintParts.push(`${akkoord} akkoord`)
  if (afgewezen) hintParts.push(`${afgewezen} afgewezen`)
  if (amended)   hintParts.push(`${amended} amended`)
  const visible = showAll ? recent : recent.slice(0, 5)
  const hidden = recent.length - 5

  return (
    <section className="va-block">
      <button type="button" className="va-block__head" onClick={() => setOpen(v => !v)}>
        <span className="va-block__caret">{open ? '▾' : '▸'}</span>
        <span className="va-block__title">Laatst verwerkt</span>
        <span className="va-block__count">{recent.length}</span>
        <span className="va-block__hint">{hintParts.join(' · ') || 'nog niets'}</span>
      </button>
      {open && (
        <div className="va-block__body">
          {recent.length === 0 ? (
            <div className="va-block__body--empty">Nog niks verwerkt — zodra je iets goedkeurt of afwijst verschijnt het hier.</div>
          ) : (
            <>
              {visible.map(p => {
                const meta = STATUS_META[p.status] || { label: p.status, verdict: 'pending' }
                const when = p.executed_at || p.reviewed_at || p.created_at
                const { head, tail } = splitSubject(p.subject)
                return (
                  <div key={p.id} className="log-row">
                    <span className="log-row__when">{shortWhen(when)}</span>
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

// ─────────────────────────── Andere contactmomenten ───────────────────
function FilteredBlock({ filtered }) {
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

function MetricsBlock({ metrics, processed }) {
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
          <Kpi tone="accent"  label="Open"         value={metrics.open}          sub={`${metrics.needs_input} wacht op input`} />
          <Kpi tone="success" label="Akkoord"      value={metrics.week_accepted} sub={<Trend pct={metrics.week_trend} />} />
          <Kpi                label="Vandaag"      value={metrics.today_created} sub={`${metrics.today_accepted} akkoord · ${metrics.today_rejected} afgew.`} />
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
      <div className="kpi__sub">{sub || ' '}</div>
    </div>
  )
}

function Trend({ pct }) {
  if (pct == null || isNaN(pct)) return '—'
  const arrow = pct > 0 ? '↗' : pct < 0 ? '↘' : '→'
  return <span>{arrow} {pct > 0 ? '+' : ''}{pct}% vs vorige</span>
}
