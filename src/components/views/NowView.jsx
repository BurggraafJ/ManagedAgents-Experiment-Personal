import { useEffect, useMemo, useState } from 'react'
import { useAgents } from '../../hooks/useAgents'
import { useSales } from '../../hooks/useSales'
import { supabase } from '../../lib/supabase'
import { NEVER_SHOW } from '../../lib/agentFunctions'
import AgentSettingsPopup from '../AgentSettingsPopup'
import WeekProgress from '../sections/week-progress'
import { AgentsHelpersFunctions } from '../sections/agents'
import TruthOfSourcesView from './truth-of-sources/TruthOfSourcesView'
import './now/now-maestro.css'

// NowView — Maestro design (sessie 15, 2026-05-10).
//
// HARD-RULE: oude code is leidend. Functioneel niets weggehaald.
// Sessie 15 fixes na Jelle's review op sessie 14:
//   • Topbar bovenaan (refresh + sync-pill + nieuwe actie)
//   • Container breder (geen max-width cap)
//   • Postvak focus-tile telt nu autodraft_mails met decision IS NULL
//   • Agenda-strook full-width met events + spelregels + voorstellen
//     (uit calendar_events, agenda_planner_rules, agenda_appointment_proposals)
//   • Activity-feed filtert orchestrator/dashboard-refresh/agent-manager + helpers
//     via NEVER_SHOW set
//   • Nieuwe AgentsGrid in mockup-stijl met ALLE agents (geen .slice(0,6)) +
//     Run Now-knop, status-cycle live/onderhoud/off, cog-popup voor settings
//   • Database-sectie (TruthOfSourcesView) krijgt CSS-overlay restyle
//
// Hooks/state ongewijzigd — pure render-laag-aanpassing.

const STATUS_LABEL = { live: 'Live', maintenance: 'Onderhoud', off: 'Uit' }
const NEXT_STATUS  = { live: 'maintenance', maintenance: 'off', off: 'live' }
const NO_STATUS_TOGGLE = new Set(['orchestrator'])
const NO_RUN_NOW = new Set(['orchestrator', 'dashboard-refresh', 'agent-manager'])
function statusOf(s) { return !s?.enabled ? 'off' : s?.is_maintenance ? 'maintenance' : 'live' }

export default function NowView({ onNavigate, badges = {}, shell = null }) {
  const agentsHook = useAgents()
  const { weekRuns, schedules, weekStart, latestRuns, history, questions } = agentsHook
  const { events: salesEvents, todos: salesTodos } = useSales()
  // shell wordt via prop doorgegeven (App.jsx mounting useDashboardShell —
  // niet 2x mounten want dat triggert Supabase channel-conflict in productie).

  const goto = (path) => {
    if (typeof window !== 'undefined') window.location.assign(path)
  }

  return (
    <div className="theme-maestro now-app">
      <NowTopbar shell={shell} />
      <div className="now-scroll">
        <div className="now-inner">
          {/* ───── Mockup bovenstrook ───── */}
          <Greeting badges={badges} />
          <FocusGrid badges={badges} goto={goto} />
          <NowAgendaStrip />

          {/* ───── Activity feed (filtered) ───── */}
          <ActivityFeed history={history} latestRuns={latestRuns} />

          {/* ───── Doel vs werkelijk (oud, restyled via CSS) ───── */}
          <WeekProgress
            runs={weekRuns}
            schedules={schedules}
            weekStart={weekStart}
          />

          {/* ───── Agents (NIEUW design + alle agents + functies) ───── */}
          <AgentsGrid
            schedules={schedules}
            latestRuns={latestRuns}
            history={history}
          />

          {/* ───── Database sources (CSS-overlay restyle) ───── */}
          <TruthOfSourcesView />

          {/* ───── Helper-agents + functies (oud, blijft) ───── */}
          <AgentsHelpersFunctions
            schedules={schedules}
            latestRuns={latestRuns}
            history={history}
            questions={questions}
            salesEvents={salesEvents}
            salesTodos={salesTodos}
          />
        </div>
      </div>
    </div>
  )
}

// =====================================================
// Topbar — refresh + sync-pill (live + clock) + nieuwe actie
// =====================================================
function NowTopbar({ shell }) {
  const [now, setNow] = useState(() => new Date())
  useEffect(() => {
    const id = setInterval(() => setNow(new Date()), 30000)
    return () => clearInterval(id)
  }, [])
  const hm = String(now.getHours()).padStart(2, '0') + ':' + String(now.getMinutes()).padStart(2, '0')
  const ageMin = shell?.orchestratorAgeMin
  const tone =
    ageMin == null ? 'idle' :
    ageMin < 20 ? 'live' :
    ageMin < 60 ? 'warn' : 'err'
  const label = ageMin == null ? 'geen signaal' :
    ageMin < 1 ? 'Live' :
    ageMin < 60 ? `${ageMin}m geleden` :
    ageMin < 1440 ? `${Math.round(ageMin / 60)}u geleden` : `${Math.round(ageMin / 1440)}d geleden`

  return (
    <header className="now-topbar">
      <div className="now-topbar__crumbs">
        <span className="now-crumb-current">Dashboard</span>
      </div>
      <div className="now-topbar__right">
        <div className={`now-sync-pill now-sync-pill--${tone}`}>
          <span className="now-sync-dot" />
          <span>{label}</span>
          <span className="now-sync-meta">{hm}</span>
        </div>
        <button
          type="button"
          className="now-btn now-btn--ghost"
          onClick={() => { if (shell?.refresh) shell.refresh(); else window.location.reload() }}
          title="Vernieuw alle data"
        >
          <Icon size={13}><path d="M3 12a9 9 0 0 1 9-9 9.75 9.75 0 0 1 6.74 2.74L21 8"/><path d="M21 3v5h-5"/></Icon>
          Refresh
        </button>
      </div>
    </header>
  )
}

// =====================================================
// Greeting + live clock
// =====================================================
function Greeting({ badges }) {
  const [now, setNow] = useState(() => new Date())
  useEffect(() => {
    const id = setInterval(() => setNow(new Date()), 30000)
    return () => clearInterval(id)
  }, [])
  const greet = (() => {
    const h = now.getHours()
    if (h < 12) return 'Goedemorgen'
    if (h < 18) return 'Goedemiddag'
    return 'Goedenavond'
  })()
  const days = ['zo', 'ma', 'di', 'wo', 'do', 'vr', 'za']
  const months = ['jan', 'feb', 'mrt', 'apr', 'mei', 'jun', 'jul', 'aug', 'sep', 'okt', 'nov', 'dec']
  const hm = String(now.getHours()).padStart(2, '0') + ':' + String(now.getMinutes()).padStart(2, '0')
  const dateLabel = `${days[now.getDay()]} ${now.getDate()} ${months[now.getMonth()]}`

  const attention =
    (badges.adminPending || 0) +
    (badges.autodraftPropsCount || 0) +
    ((badges.tasks || []).filter(t => t.is_newly_found).length)

  return (
    <div className="now-greet">
      <h1>
        {greet} Jelle.{' '}
        <span>
          {attention > 0
            ? `${attention} ding${attention === 1 ? '' : 'en'} ${attention === 1 ? 'kan' : 'kunnen'} vandaag jouw aandacht gebruiken.`
            : 'niets vraagt urgent jouw aandacht.'}
        </span>
      </h1>
      <div className="now-greet-meta">
        {dateLabel} · <span>{hm}</span>
      </div>
    </div>
  )
}

// =====================================================
// Focus tiles — 2 cols, met fix voor Postvak-count
// =====================================================
function FocusGrid({ badges, goto }) {
  const adminPending = badges.adminPending || 0
  const taskNeedsReview = (badges.tasks || []).filter(t => t.is_newly_found).length

  // Postvak: tel autodraft_mails waar nog geen beslissing is genomen.
  const [postvakCount, setPostvakCount] = useState(null)
  useEffect(() => {
    let cancelled = false
    supabase
      .from('autodraft_mails')
      .select('id', { count: 'exact', head: true })
      .is('decision', null)
      .then(({ count }) => { if (!cancelled) setPostvakCount(count ?? 0) })
      .catch(() => { if (!cancelled) setPostvakCount(0) })
    return () => { cancelled = true }
  }, [])
  const postvakDisplay = postvakCount === null ? '—' : postvakCount

  // Volgende meeting: eerste event vandaag uit calendar_events.
  const [nextMeeting, setNextMeeting] = useState(null)
  useEffect(() => {
    let cancelled = false
    const start = new Date(); start.setHours(0, 0, 0, 0)
    const end = new Date(); end.setHours(23, 59, 59, 999)
    supabase
      .from('calendar_events')
      .select('id, subject, start_time')
      .eq('is_cancelled', false)
      .gte('start_time', start.toISOString())
      .lte('start_time', end.toISOString())
      .order('start_time', { ascending: true })
      .limit(5)
      .then(({ data }) => {
        if (cancelled) return
        const nowMs = Date.now()
        const upcoming = (data || []).find(e => new Date(e.start_time).getTime() >= nowMs - 5 * 60000)
        setNextMeeting(upcoming || (data || [])[0] || null)
      })
    return () => { cancelled = true }
  }, [])
  const nextLabel = nextMeeting
    ? new Date(nextMeeting.start_time).toLocaleTimeString('nl-NL', { hour: '2-digit', minute: '2-digit' })
    : 'geen'
  const nextSub = nextMeeting
    ? truncate(nextMeeting.subject || '(geen titel)', 48)
    : 'geen meeting vandaag'

  return (
    <div className="now-focus-grid">
      <button type="button" className="now-focus now-focus--accent" onClick={() => goto('/administratie')}>
        <div className="now-focus__head">
          <div className="now-focus__icon">
            <Icon><path d="M9 12l2 2 4-4"/><rect x="3" y="3" width="18" height="18" rx="3"/></Icon>
          </div>
          Open voorstellen
        </div>
        <div className="now-focus__num">{adminPending}</div>
        <div className="now-focus__sub">
          {adminPending === 0 ? 'geen openstaande voorstellen' : 'in administratie wachten op review'}
        </div>
        <span className="now-focus__cta">Open admin →</span>
      </button>

      <button type="button" className="now-focus" onClick={() => goto('/agenda')}>
        <div className="now-focus__head">
          <div className="now-focus__icon">
            <Icon><circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/></Icon>
          </div>
          Volgende meeting
        </div>
        <div className="now-focus__num now-focus__num--sm">{nextLabel}</div>
        <div className="now-focus__sub">{nextSub}</div>
        <span className="now-focus__cta">Open agenda →</span>
      </button>

      <button type="button" className="now-focus" onClick={() => goto('/postvak')}>
        <div className="now-focus__head">
          <div className="now-focus__icon">
            <Icon><path d="M3 7h18v12H3z"/><path d="M3 7l9 7 9-7"/></Icon>
          </div>
          Postvak
        </div>
        <div className="now-focus__num">{postvakDisplay}</div>
        <div className="now-focus__sub">
          {postvakCount === 0 ? 'geen open mails' : 'mails wachten op beslissing'}
        </div>
        <span className="now-focus__cta">Open postvak →</span>
      </button>

      <button type="button" className="now-focus" onClick={() => goto('/taken')}>
        <div className="now-focus__head">
          <div className="now-focus__icon">
            <Icon><rect x="4" y="4" width="16" height="18" rx="2"/><path d="M9 2h6v4H9z"/><path d="m9 14 2 2 4-4"/></Icon>
          </div>
          Taken
        </div>
        <div className="now-focus__num now-focus__num--sm">{taskNeedsReview}</div>
        <div className="now-focus__sub">
          {taskNeedsReview === 0 ? 'geen nieuwe action items' : 'nieuwe items uit Fireflies/Jira'}
        </div>
        <span className="now-focus__cta">Open taken →</span>
      </button>
    </div>
  )
}

// =====================================================
// Now agenda-strook — full width met events + rules + voorstellen
// =====================================================
function NowAgendaStrip() {
  const [events, setEvents] = useState([])
  const [proposals, setProposals] = useState([])
  const [rules, setRules] = useState([])
  const [now, setNow] = useState(() => new Date())

  useEffect(() => {
    const id = setInterval(() => setNow(new Date()), 60000)
    return () => clearInterval(id)
  }, [])

  useEffect(() => {
    let cancelled = false
    const start = new Date(); start.setHours(0, 0, 0, 0)
    const end = new Date(); end.setHours(23, 59, 59, 999)

    Promise.all([
      supabase.from('calendar_events')
        .select('id, subject, start_time, end_time, is_all_day, is_cancelled, location_text, categories, online_meeting_url')
        .eq('is_cancelled', false)
        .gte('start_time', start.toISOString())
        .lte('start_time', end.toISOString())
        .order('start_time'),
      supabase.from('agenda_appointment_proposals')
        .select('id, subject, proposed_start, proposed_end, status')
        .in('status', ['pending', 'sent'])
        .gte('proposed_start', start.toISOString())
        .lte('proposed_start', end.toISOString()),
      supabase.from('agenda_planner_rules').select('*').eq('enabled', true),
    ]).then(([evRes, propRes, ruleRes]) => {
      if (cancelled) return
      setEvents(evRes.data || [])
      setProposals(propRes.data || [])
      setRules(ruleRes.data || [])
    }).catch(() => {})
    return () => { cancelled = true }
  }, [])

  // Window: 08:00 → 20:00 (12h breed voor full-width)
  const dayStart = useMemo(() => { const d = new Date(); d.setHours(8, 0, 0, 0); return d.getTime() }, [])
  const dayEnd   = useMemo(() => { const d = new Date(); d.setHours(20, 0, 0, 0); return d.getTime() }, [])
  const span = dayEnd - dayStart
  const hours = Array.from({ length: 13 }, (_, i) => 8 + i)

  const positionedEvents = events
    .filter(ev => !ev.is_all_day)
    .map(ev => {
      const t = new Date(ev.start_time).getTime()
      const tEnd = ev.end_time ? new Date(ev.end_time).getTime() : t + 30 * 60000
      const left = ((t - dayStart) / span) * 100
      const width = Math.max(((tEnd - t) / span) * 100, 3)
      const tone = eventTone(ev)
      const hm = new Date(ev.start_time).toLocaleTimeString('nl-NL', { hour: '2-digit', minute: '2-digit' })
      return { ev, left, width, tone, hm }
    })
    .filter(x => x.left >= -5 && x.left <= 105)

  const positionedProposals = proposals.map(p => {
    const t = new Date(p.proposed_start).getTime()
    const tEnd = p.proposed_end ? new Date(p.proposed_end).getTime() : t + 30 * 60000
    const left = ((t - dayStart) / span) * 100
    const width = Math.max(((tEnd - t) / span) * 100, 3)
    const hm = new Date(p.proposed_start).toLocaleTimeString('nl-NL', { hour: '2-digit', minute: '2-digit' })
    return { p, left, width, hm }
  }).filter(x => x.left >= -5 && x.left <= 105)

  // Spelregels: render reistijd-buffers + traffic-windows + no-meetings-windows
  // als hatched shadows. Per regel kijk we naar applies_at_time + duration_min.
  const positionedRules = useMemo(() => {
    const out = []
    rules.forEach(r => {
      const type = r.rule_type || r.type
      if (!['traffic_window', 'no_meetings_window', 'travel_buffer', 'time_block'].includes(type)) return
      // Heel basaal: r.start_time + r.end_time of r.applies_at_hour als window vandaag
      const startHour = r.start_hour ?? r.applies_from_hour
      const endHour = r.end_hour ?? r.applies_to_hour
      if (startHour == null || endHour == null) return
      const t = new Date(); t.setHours(startHour, 0, 0, 0)
      const tEnd = new Date(); tEnd.setHours(endHour, 0, 0, 0)
      const left = ((t.getTime() - dayStart) / span) * 100
      const width = Math.max(((tEnd.getTime() - t.getTime()) / span) * 100, 2)
      out.push({ r, left, width, type })
    })
    return out.filter(x => x.left >= -5 && x.left <= 105)
  }, [rules, dayStart, span])

  const nowPct = ((now.getTime() - dayStart) / span) * 100
  const nowVisible = nowPct >= 0 && nowPct <= 100

  const totalCount = events.length + proposals.length

  return (
    <div className="now-agenda">
      <div className="now-agenda__head">
        <h3>Vandaag · 08:00 → 20:00</h3>
        <div className="now-agenda__meta">
          <span className="now-pill now-pill--info">{events.length} event{events.length === 1 ? '' : 's'}</span>
          {proposals.length > 0 && (
            <span className="now-pill now-pill--accent">{proposals.length} voorstel{proposals.length === 1 ? '' : 'len'}</span>
          )}
          {totalCount === 0 && (
            <span className="now-pill">geen agenda-items</span>
          )}
        </div>
      </div>
      <div className="now-agenda__rail">
        {hours.map((h, i) => {
          const pct = (i / 12) * 100
          return (
            <span key={h} className="now-agenda__hour" style={{ left: pct + '%' }}>
              {String(h).padStart(2, '0')}
            </span>
          )
        })}
        {positionedRules.map((x, i) => (
          <div
            key={'r' + i}
            className={`now-agenda__shadow now-agenda__shadow--${x.type}`}
            style={{ left: clamp(x.left, 0, 98) + '%', width: clamp(x.width, 2, 100 - x.left) + '%' }}
            title={x.r.label || x.type}
          />
        ))}
        {positionedEvents.map(({ ev, left, width, tone, hm }) => (
          <div
            key={ev.id}
            className={`now-agenda__ev now-agenda__ev--${tone}`}
            style={{ left: clamp(left, 0, 97) + '%', width: clamp(width, 3, 100 - left) + '%' }}
            title={`${ev.subject || '(geen titel)'} · ${hm}${ev.location_text ? ' · ' + ev.location_text : ''}`}
          >
            <span className="now-agenda__ev-title">{truncate(ev.subject || '(geen titel)', 38)}</span>
            <small>{hm}</small>
          </div>
        ))}
        {positionedProposals.map(({ p, left, width, hm }) => (
          <div
            key={'p' + p.id}
            className="now-agenda__proposal"
            style={{ left: clamp(left, 0, 97) + '%', width: clamp(width, 3, 100 - left) + '%' }}
            title={`Voorstel: ${p.subject || '(zonder onderwerp)'} · ${hm}`}
          >
            <span className="now-agenda__ev-title">⊕ {truncate(p.subject || 'Voorstel', 32)}</span>
            <small>{hm}</small>
          </div>
        ))}
        {nowVisible && <div className="now-agenda__now" style={{ left: nowPct + '%' }} />}
        {totalCount === 0 && positionedRules.length === 0 && (
          <div className="now-agenda__empty">geen events, voorstellen of spelregels vandaag</div>
        )}
      </div>
    </div>
  )
}

function eventTone(ev) {
  const cats = (ev.categories || []).map(c => String(c).toLowerCase())
  const subj = String(ev.subject || '').toLowerCase()
  if (cats.some(c => c.includes('klant') || c.includes('customer'))) return 'c'
  if (cats.some(c => c.includes('prospect') || c.includes('lead'))) return 'p'
  if (cats.some(c => c.includes('intern')) || subj.includes('standup') || subj.includes('1:1')) return 'i'
  return 'd'
}

// =====================================================
// Activity feed — alleen user-facing agents (NEVER_SHOW filter)
// =====================================================
function ActivityFeed({ history, latestRuns }) {
  const items = useMemo(() => {
    const all = []
    Object.entries(history || {}).forEach(([agent, runs]) => {
      if (NEVER_SHOW.has(agent)) return
      (runs || []).forEach(r => all.push({ ...r, agent_name: agent }))
    })
    Object.entries(latestRuns || {}).forEach(([agent, run]) => {
      if (NEVER_SHOW.has(agent) || !run) return
      all.push({ ...run, agent_name: agent })
    })
    const seen = new Set()
    const unique = all.filter(r => {
      if (!r.id || seen.has(r.id)) return false
      seen.add(r.id)
      return true
    })
    unique.sort((a, b) => new Date(b.started_at).getTime() - new Date(a.started_at).getTime())
    return unique.slice(0, 8)
  }, [history, latestRuns])

  return (
    <div className="now-feed">
      <div className="now-feed__head">
        <h3>Recente activity</h3>
        <span className="now-pill now-pill--ok">
          <span className="now-pill__dot" />
          {items.filter(i => i.status === 'success').length} verwerkt
        </span>
      </div>
      {items.length === 0 ? (
        <div className="now-empty">nog geen agent-runs vandaag</div>
      ) : (
        items.map(item => <FeedRow key={item.id} item={item} />)
      )}
    </div>
  )
}

function FeedRow({ item }) {
  const tone = agentTone(item.agent_name)
  const t = new Date(item.started_at)
  const hm = t.toLocaleTimeString('nl-NL', { hour: '2-digit', minute: '2-digit' })
  const isErr = item.status === 'error'
  return (
    <div className="now-feed__row">
      <div className={`now-feed__icon ${isErr ? 'now-feed__icon--err' : 'now-feed__icon--' + tone}`}>
        <Icon size={14}>{agentIconPath(item.agent_name)}</Icon>
      </div>
      <div className="now-feed__main">
        <div className="now-feed__t">
          <strong>{prettyAgent(item.agent_name)}</strong>{item.message ? ' — ' + truncate(item.message, 90) : ''}
        </div>
        {isErr && <div className="now-feed__sub">fout — {truncate(item.error_message || 'onbekend', 80)}</div>}
      </div>
      <span className="now-feed__when">{hm}</span>
    </div>
  )
}

// =====================================================
// AgentsGrid — alle agents in mockup-stijl met functies
// =====================================================
function AgentsGrid({ schedules, latestRuns, history }) {
  const visible = useMemo(() => {
    return (schedules || [])
      .filter(s => !NEVER_SHOW.has(s.agent_name))
      .filter(s => s.tier !== 'source')
  }, [schedules])

  if (visible.length === 0) {
    return (
      <section className="now-section">
        <div className="now-section__head">
          <h2>Agents</h2>
        </div>
        <div className="now-empty">geen agents geregistreerd</div>
      </section>
    )
  }

  return (
    <section className="now-section">
      <div className="now-section__head">
        <h2>Agents <span>· {visible.length} totaal</span></h2>
        <span className="now-section__hint">klik status om te wisselen · ▶ = run nu · ⚙ = instellingen</span>
      </div>
      <div className="now-agents-grid">
        {visible.map(s => (
          <MaestroAgentCard
            key={s.agent_name}
            schedule={s}
            latestRun={latestRuns?.[s.agent_name]}
            history={history?.[s.agent_name] || []}
          />
        ))}
      </div>
    </section>
  )
}

function MaestroAgentCard({ schedule, latestRun, history }) {
  const [popupOpen, setPopupOpen] = useState(false)
  const agent = schedule.agent_name
  const tone = agentTone(agent)
  const initials = initialsOf(schedule.display_name || agent)

  const total = history.length || (latestRun ? 1 : 0)
  const errors = history.filter(r => r.status === 'error').length
  const successPct = total === 0 ? 0 : Math.round(((total - errors) / total) * 100)

  return (
    <div className="now-agent">
      <div className="now-agent__top">
        <div className={`now-agent__icon now-agent__icon--${tone}`}>{initials}</div>
        <div className="now-agent__name">{schedule.display_name || agent}</div>
        <MaestroStatusPill agent={agent} schedule={schedule} />
      </div>
      {schedule.description && (
        <div className="now-agent__sub">{truncate(schedule.description, 140)}</div>
      )}
      <div className="now-agent__bar">
        <span style={{
          width: successPct + '%',
          background: errors > 0 ? 'var(--warning)' : 'var(--success)',
        }} />
      </div>
      <div className="now-agent__foot">
        <div className="now-agent__stats">
          <span><strong>{successPct}%</strong> akkoord</span>
          <span><strong>{total}</strong> runs</span>
          <span>{relTime(latestRun?.started_at)}</span>
        </div>
        <div className="now-agent__actions">
          <MaestroRunNow agent={agent} schedule={schedule} />
          <button
            type="button"
            className="now-agent__cog"
            onClick={() => setPopupOpen(true)}
            aria-label="Instellingen"
            title="Instellingen — cadence, timeout, logboek"
          >
            <Icon size={14}><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09a1.65 1.65 0 0 0-1-1.51 1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09a1.65 1.65 0 0 0 1.51-1 1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33h.01a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51h.01a1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82v.01a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/></Icon>
          </button>
        </div>
      </div>
      {popupOpen && (
        <AgentSettingsPopup
          agent={agent}
          schedule={schedule}
          onClose={() => setPopupOpen(false)}
        />
      )}
    </div>
  )
}

function MaestroStatusPill({ agent, schedule }) {
  const dbStatus = statusOf(schedule)
  const [optimistic, setOptimistic] = useState(null)
  const current = optimistic || dbStatus
  const [busy, setBusy] = useState(false)
  const disabled = NO_STATUS_TOGGLE.has(agent)

  useEffect(() => { if (optimistic && optimistic === dbStatus) setOptimistic(null) }, [dbStatus, optimistic])

  async function onClick(e) {
    e.stopPropagation(); e.preventDefault()
    if (busy || disabled) return
    const next = NEXT_STATUS[current] || 'live'
    setOptimistic(next); setBusy(true)
    try {
      const { data, error } = await supabase.rpc('set_agent_status', { p_agent_name: agent, p_status: next })
      if (error || data?.ok === false) { setOptimistic(null); console.error('set_agent_status', error || data) }
    } catch (ex) { setOptimistic(null); console.error(ex) }
    setBusy(false)
  }
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={busy || disabled}
      className={`now-agent__pill now-agent__pill--${current}`}
      title={disabled ? 'Niet via dashboard te wisselen' : `Klik = volgende status (nu: ${STATUS_LABEL[current]})`}
    >
      <span className="now-agent__pill-dot" />
      <span>{STATUS_LABEL[current]}</span>
    </button>
  )
}

function MaestroRunNow({ agent, schedule }) {
  const disabled = !schedule?.enabled || schedule?.is_running || NO_RUN_NOW.has(agent)
  const [state, setState] = useState('idle') // idle | submitting | ok | err
  const [pendingRequested, setPendingRequested] = useState(false)
  const dbPending = schedule?.manual_run_requested_at
    && (!schedule?.last_run_at || new Date(schedule.last_run_at) < new Date(schedule.manual_run_requested_at))
  const isPending = dbPending || pendingRequested

  useEffect(() => { if (dbPending) setPendingRequested(false) }, [dbPending])

  async function onClick(e) {
    e.stopPropagation(); e.preventDefault()
    if (state === 'submitting' || disabled || isPending) return
    setState('submitting')
    try {
      const { data, error } = await supabase.rpc('request_run_now', { agent })
      if (error) { setState('err'); setTimeout(() => setState('idle'), 3000); console.error(error) }
      else if (data?.ok) { setState('ok'); setPendingRequested(true); setTimeout(() => setState('idle'), 2500) }
      else { setState('err'); setTimeout(() => setState('idle'), 3000) }
    } catch (ex) { setState('err'); setTimeout(() => setState('idle'), 3000); console.error(ex) }
  }

  const title = disabled
    ? (NO_RUN_NOW.has(agent) ? 'Niet handmatig te triggeren' : !schedule?.enabled ? 'Agent staat uit' : 'Draait al')
    : isPending ? 'Aangevraagd — orchestrator pakt hem bij volgende poll'
    : 'Run nu'

  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled || state === 'submitting' || isPending}
      className={`now-agent__run ${state === 'ok' || isPending ? 'is-pending' : ''} ${state === 'err' ? 'is-err' : ''}`}
      aria-label="Run nu"
      title={title}
    >
      {state === 'submitting' ? (
        <span className="now-spin">⟳</span>
      ) : state === 'err' ? (
        <span>!</span>
      ) : isPending ? (
        <Icon size={13}><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></Icon>
      ) : (
        <Icon size={13}><polygon points="6 4 20 12 6 20 6 4"/></Icon>
      )}
    </button>
  )
}

// =====================================================
// Helpers
// =====================================================
function Icon({ children, size = 13 }) {
  return (
    <svg viewBox="0 0 24 24" width={size} height={size} stroke="currentColor" strokeWidth="1.6" fill="none" strokeLinecap="round" strokeLinejoin="round">
      {children}
    </svg>
  )
}
function clamp(v, lo, hi) { return Math.min(Math.max(v, lo), hi) }
function truncate(str, n) { return str && str.length > n ? str.slice(0, n - 1) + '…' : (str || '') }
function initialsOf(name) {
  if (!name) return '?'
  const parts = String(name).replace(/[-_]/g, ' ').split(' ').filter(Boolean)
  if (parts.length === 0) return '?'
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase()
  return (parts[0][0] + parts[1][0]).toUpperCase()
}
function prettyAgent(agent) {
  return String(agent || '').replace(/[-_]/g, ' ').replace(/\b\w/g, c => c.toUpperCase())
}
function agentTone(agent) {
  const a = String(agent || '').toLowerCase()
  if (a.includes('admin'))    return 'adm'
  if (a.includes('mail') || a.includes('autodraft')) return 'mail'
  if (a.includes('agenda') || a.includes('plan'))    return 'cal'
  if (a.includes('jelle') || a.includes('mind'))     return 'qa'
  if (a.includes('brief') || a.includes('research') || a.includes('legal')) return 'brief'
  if (a.includes('sales') || a.includes('linkedin')) return 'mail'
  if (a.includes('task') || a.includes('todo'))      return 'cal'
  return 'def'
}
function agentIconPath(agent) {
  const a = String(agent || '').toLowerCase()
  if (a.includes('admin'))    return <><path d="M12 2v20M2 12h20"/></>
  if (a.includes('mail') || a.includes('autodraft')) return <><path d="M3 7h18v12H3z"/><path d="M3 7l9 7 9-7"/></>
  if (a.includes('agenda') || a.includes('plan'))    return <><rect x="3" y="5" width="18" height="16" rx="2"/><path d="M3 9h18"/></>
  return <><circle cx="12" cy="12" r="9"/><path d="M9 12h6"/></>
}
function relTime(iso) {
  if (!iso) return 'geen run'
  const ms = Date.now() - new Date(iso).getTime()
  const min = Math.round(ms / 60000)
  if (min < 1)   return 'nu'
  if (min < 60)  return `${min}m`
  const hr = Math.round(min / 60)
  if (hr < 24)   return `${hr}u`
  return `${Math.round(hr / 24)}d`
}
