import { useState, useMemo } from 'react'

// Rolling range-selector i.p.v. harde kalender-week. Met "Afgelopen X dagen"
// is de vergelijking altijd zinvol (geen cliff op zondag/maandag).
const RANGES = [
  { id: '7d',  label: 'Afgelopen 7 dagen',  days: 7  },
  { id: '30d', label: 'Afgelopen 30 dagen', days: 30 },
  { id: '90d', label: 'Afgelopen 90 dagen', days: 90 },
]

// Twee logische groepen — eerste rij wat agents leverden, tweede rij wat
// jij ermee deed (follow-through + activiteit).
const KPI_GROUPS = [
  {
    title: 'Output van agents',
    keys: [
      { key: 'runs',           label: 'Runs',                     hint: 'aantal succesvolle agent-runs (orchestrator niet meegeteld)' },
      { key: 'drafts',         label: 'Drafts geschreven',        hint: 'mail-drafts + sales-drafts klaargezet' },
      { key: 'connects',       label: 'LinkedIn connects',        hint: 'verstuurde verbindingsverzoeken' },
      { key: 'deals',          label: 'HubSpot deal-updates',     hint: 'door Administratie-agent verwerkt' },
      { key: 'salesTodosReady',label: 'Sales-tasks klaar',        hint: 'sales-todos draft_ready in deze periode' },
    ],
  },
  {
    title: 'Wat jij ermee deed',
    keys: [
      { key: 'accepted',       label: 'Voorstellen geaccepteerd', hint: 'agent_proposals waar jij ja zei' },
      { key: 'amended',        label: 'Voorstellen aangepast',    hint: 'amendments — agents leren van jouw correcties' },
      { key: 'rejected',       label: 'Voorstellen afgewezen',    hint: 'agent_proposals.status=rejected' },
      { key: 'mailsSent',      label: 'Mails verzonden',          hint: 'auto-draft action=send (uit autodraft_decisions)' },
      { key: 'mailsIgnored',   label: 'Mails genegeerd',          hint: 'naar map verplaatst zonder draft (action=ignore)' },
      { key: 'tasksDone',      label: 'Taken afgerond',           hint: 'tasks.status=done in deze periode' },
      { key: 'activeDays',     label: 'Actieve dagen',            hint: 'unieke dagen met ≥1 succesvolle run' },
    ],
  },
]

const DAY_MS = 86400000

// Ruwe data uit `runs` aggregeren over een arbitrair venster.
// We tellen alleen success/warning runs van PRIMARY agents — secondary
// (mail-sync, autodraft-execute, task-organizer) zijn plumbing die elke 5
// min draait en zou de KPI's overspoelen.
function statsForRange(runs, proposals, decisions, salesTodos, tasks, fromTs, toTs, primarySet) {
  const out = {
    runs: 0, drafts: 0, connects: 0, deals: 0, salesTodosReady: 0,
    accepted: 0, amended: 0, rejected: 0,
    mailsSent: 0, mailsIgnored: 0, tasksDone: 0, activeDays: 0,
  }
  const activeDaySet = new Set()
  for (const r of runs || []) {
    if (!primarySet.has(r.agent_name)) continue
    if (r.status !== 'success' && r.status !== 'warning') continue
    const t = new Date(r.started_at).getTime()
    if (t < fromTs || t >= toTs) continue
    out.runs += 1
    activeDaySet.add(new Date(r.started_at).toISOString().slice(0, 10))
    const stats = r.stats || {}
    out.drafts   += Number(stats.drafts_created   || 0)
    out.drafts   += Number(stats.drafts_prepared  || 0)
    out.connects += Number(stats.connects_sent    || 0)
    out.deals    += Number(stats.deals_updated    || 0)
  }
  out.activeDays = activeDaySet.size

  // Proposals — gebruiken updated_at als beslissings-tijdstip
  for (const p of proposals || []) {
    const decidedAt = p.updated_at || p.created_at
    if (!decidedAt) continue
    const t = new Date(decidedAt).getTime()
    if (t < fromTs || t >= toTs) continue
    if (p.status === 'accepted') out.accepted += 1
    if (p.status === 'amended')  out.amended  += 1
    if (p.status === 'rejected') out.rejected += 1
  }
  // AutoDraft-decisions — opsplitsen send vs ignore
  for (const d of decisions || []) {
    const t = new Date(d.decided_at || d.created_at || 0).getTime()
    if (t < fromTs || t >= toTs) continue
    if (d.action === 'send')   out.mailsSent    += 1
    if (d.action === 'ignore') out.mailsIgnored += 1
  }
  // Sales-todos die in deze periode draft_ready werden
  for (const s of salesTodos || []) {
    if (s.status !== 'draft_ready') continue
    const t = new Date(s.updated_at || s.created_at || 0).getTime()
    if (t < fromTs || t >= toTs) continue
    out.salesTodosReady += 1
  }
  // Tasks afgerond — completed_at of updated_at als status='done'
  for (const tk of tasks || []) {
    if (tk.status !== 'done') continue
    const completedAt = tk.completed_at || tk.updated_at
    if (!completedAt) continue
    const t = new Date(completedAt).getTime()
    if (t < fromTs || t >= toTs) continue
    out.tasksDone += 1
  }
  return out
}

export default function KpiStrip({ runs, schedules, proposals, autodraftDecisions, salesTodos, tasks }) {
  const [rangeId, setRangeId] = useState('7d')
  const range = RANGES.find(r => r.id === rangeId) || RANGES[0]

  // Bouw een set van primary-agent-namen op basis van de schedules.
  // Fallback: als schedules ontbreekt, tel alle non-orchestrator (oud gedrag).
  const primarySet = useMemo(() => {
    const s = new Set()
    if (Array.isArray(schedules) && schedules.length > 0) {
      for (const sch of schedules) {
        if ((sch.tier || 'primary') === 'primary' && sch.agent_name !== 'orchestrator') {
          s.add(sch.agent_name)
        }
      }
    } else {
      // Geen schedules-prop: minimale fallback (oude gedrag — exclude orchestrator)
      for (const r of runs || []) {
        if (r.agent_name !== 'orchestrator') s.add(r.agent_name)
      }
    }
    return s
  }, [schedules, runs])

  const { current, previous } = useMemo(() => {
    const now      = Date.now()
    const fromCur  = now - range.days * DAY_MS
    const fromPrev = fromCur - range.days * DAY_MS
    return {
      current:  statsForRange(runs, proposals, autodraftDecisions, salesTodos, tasks, fromCur, now,      primarySet),
      previous: statsForRange(runs, proposals, autodraftDecisions, salesTodos, tasks, fromPrev, fromCur, primarySet),
    }
  }, [runs, proposals, autodraftDecisions, salesTodos, tasks, range.days, primarySet])

  // Filter per groep — alleen tonen wat data heeft (huidige of vorige periode)
  const visibleGroups = KPI_GROUPS.map(g => ({
    ...g,
    keys: g.keys.filter(k => (current[k.key] || 0) > 0 || (previous[k.key] || 0) > 0),
  })).filter(g => g.keys.length > 0)

  return (
    <section id="week">
      <div className="section__head" style={{ alignItems: 'center', flexWrap: 'wrap', gap: 'var(--s-3)' }}>
        <h2 className="section__title">{range.label}</h2>
        <div style={{ display: 'flex', gap: 4 }}>
          {RANGES.map(r => (
            <button
              key={r.id}
              type="button"
              onClick={() => setRangeId(r.id)}
              className={`btn btn--ghost ${rangeId === r.id ? 'is-active' : ''}`}
              style={{
                fontSize: 11,
                padding: '4px 10px',
                background: rangeId === r.id ? 'var(--accent)' : 'transparent',
                color: rangeId === r.id ? 'white' : 'var(--text-muted)',
                borderRadius: 6,
                border: '1px solid var(--border)',
              }}
            >
              {r.id}
            </button>
          ))}
        </div>
        <span className="section__hint" style={{ marginLeft: 'auto' }}>
          vs. vorige {range.days}d · orchestrator-polls niet meegeteld
        </span>
      </div>

      {visibleGroups.length === 0 ? (
        <div className="empty">Nog geen resultaten in deze periode.</div>
      ) : (
        <div className="stack" style={{ gap: 'var(--s-4)' }}>
          {visibleGroups.map((g, gi) => (
            <div key={g.title}>
              <div
                className="kpi__label"
                style={{
                  marginBottom: 8,
                  fontSize: 10,
                  letterSpacing: 0.6,
                  textTransform: 'uppercase',
                  color: 'var(--text-muted)',
                  fontWeight: 600,
                }}
              >
                {g.title}
              </div>
              <div className="grid grid--kpi">
                {g.keys.map(k => (
                  <KpiCell
                    key={k.key}
                    label={k.label}
                    hint={k.hint}
                    value={current[k.key]}
                    prev={previous[k.key]}
                  />
                ))}
              </div>
            </div>
          ))}
        </div>
      )}
    </section>
  )
}

function KpiCell({ label, hint, value, prev }) {
  const delta = value - prev
  let trendClass = 'kpi__trend--flat'
  let trendText = '±0'
  if (delta > 0) { trendClass = 'kpi__trend--up';   trendText = `▲ +${delta}` }
  if (delta < 0) { trendClass = 'kpi__trend--down'; trendText = `▼ ${delta}` }

  return (
    <div className="kpi" title={hint}>
      <div className="kpi__value" style={{ fontVariantNumeric: 'tabular-nums' }}>{value}</div>
      <div className="kpi__label">{label}</div>
      <div className={`kpi__trend ${trendClass}`}>
        {trendText} <span className="muted">vorige {prev}</span>
      </div>
    </div>
  )
}
