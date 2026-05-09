import { useEffect, useMemo, useState } from 'react'
import { useAgents } from '../../hooks/useAgents'
import { supabase } from '../../lib/supabase'
import s from './now/now.module.css'

// NowView — Maestro design (Project Design integratie 2026, sessie 12).
// Layout: greeting → focus-grid (4 tiles) → row-2col(now-strip + activity-feed)
//          → agents-grid (6 cards) → runs-tabel.
//
// Belangrijke regel: useNavBadges WORDT VIA PROP doorgegeven door App.jsx;
// niet 2x mounten — Supabase realtime weigert callbacks 2x op hetzelfde
// channel ("realtime:nav-badges-live"). useAgents is hier wel exclusief.
export default function NowView({ onNavigate, badges = {} }) {
  const { schedules, latestRuns, history } = useAgents()

  const goto = (path) => {
    if (typeof window !== 'undefined') window.location.assign(path)
  }

  return (
    <div className={`theme-maestro ${s.wrapper}`}>
      <div className={s.scroll}>
        <div className={s.surfaceInner}>
          <div className={s.dashA}>
            <Greeting badges={badges} />
            <FocusGrid badges={badges} goto={goto} />
            <div className={s.row2col}>
              <NowStrip />
              <ActivityFeed history={history} latestRuns={latestRuns} />
            </div>
            <AgentsSection schedules={schedules} latestRuns={latestRuns} history={history} onNavigate={onNavigate} />
            <RunsTable history={history} latestRuns={latestRuns} schedules={schedules} />
          </div>
        </div>
      </div>
    </div>
  )
}

// =====================================================
// Greeting + live clock
// =====================================================
function Greeting({ badges }) {
  const [now, setNow] = useState(() => new Date())

  useEffect(() => {
    const tick = () => setNow(new Date())
    const id = setInterval(tick, 30000)
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

  // Optellen wat aandacht vraagt
  const attention =
    (badges.adminPending || 0) +
    (badges.autodraftPropsCount || 0) +
    ((badges.tasks || []).filter(t => t.is_newly_found).length)

  return (
    <div className={s.greet}>
      <h1>
        {greet} Jelle.{' '}
        <span>
          {attention > 0
            ? `${attention} ding${attention === 1 ? '' : 'en'} ${attention === 1 ? 'kan' : 'kunnen'} vandaag jouw aandacht gebruiken.`
            : 'niets vraagt urgent jouw aandacht.'}
        </span>
      </h1>
      <div className={s.greetMeta}>
        {dateLabel} · <span>{hm}</span>
      </div>
    </div>
  )
}

// =====================================================
// Focus tiles — 4 tegels
// =====================================================
function FocusGrid({ badges, goto }) {
  const adminPending = badges.adminPending || 0
  const inbox = badges.autodraftPropsCount || 0
  const taskNeedsReview = (badges.tasks || []).filter(t => t.is_newly_found).length

  return (
    <div className={s.focusGrid}>
      <button type="button" className={`${s.focus} ${s.focusAccent}`} onClick={() => goto('/administratie')}>
        <div className={s.focusHead}>
          <div className={s.focusIcon}>
            <Icon><path d="M9 12l2 2 4-4"/><rect x="3" y="3" width="18" height="18" rx="3"/></Icon>
          </div>
          Open voorstellen
        </div>
        <div className={s.focusNum}>{adminPending}</div>
        <div className={s.focusSub}>
          {adminPending === 0 ? 'geen openstaande voorstellen' : 'in administratie wachten op review'}
        </div>
        <span className={s.focusCta}>Open admin →</span>
      </button>

      <button type="button" className={s.focus} onClick={() => goto('/agenda')}>
        <div className={s.focusHead}>
          <div className={s.focusIcon}>
            <Icon><circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/></Icon>
          </div>
          Volgende meeting
        </div>
        <div className={`${s.focusNum} ${s.focusNumSm}`}>vandaag</div>
        <div className={s.focusSub}>open agenda voor live week-overzicht</div>
        <span className={s.focusCta}>Open agenda →</span>
      </button>

      <button type="button" className={s.focus} onClick={() => goto('/postvak')}>
        <div className={s.focusHead}>
          <div className={s.focusIcon}>
            <Icon><path d="M3 7h18v12H3z"/><path d="M3 7l9 7 9-7"/></Icon>
          </div>
          Postvak
        </div>
        <div className={s.focusNum}>{inbox}</div>
        <div className={s.focusSub}>
          {inbox === 0 ? 'geen drafts klaar' : 'drafts klaar voor review'}
        </div>
        <span className={s.focusCta}>Open postvak →</span>
      </button>

      <button type="button" className={s.focus} onClick={() => goto('/taken')}>
        <div className={s.focusHead}>
          <div className={s.focusIcon}>
            <Icon><rect x="4" y="4" width="16" height="18" rx="2"/><path d="M9 2h6v4H9z"/><path d="m9 14 2 2 4-4"/></Icon>
          </div>
          Taken
        </div>
        <div className={`${s.focusNum} ${s.focusNumSm}`}>{taskNeedsReview}</div>
        <div className={s.focusSub}>
          {taskNeedsReview === 0 ? 'geen nieuwe action items' : 'nieuwe items uit Fireflies/Jira'}
        </div>
        <span className={s.focusCta}>Open taken →</span>
      </button>
    </div>
  )
}

// =====================================================
// Now-strip — horizontaal day-timeline 09:00 → 18:00
// =====================================================
function NowStrip() {
  const [events, setEvents] = useState([])
  const [now, setNow] = useState(() => new Date())

  useEffect(() => {
    const id = setInterval(() => setNow(new Date()), 60000)
    return () => clearInterval(id)
  }, [])

  useEffect(() => {
    const start = new Date()
    start.setHours(0, 0, 0, 0)
    const end = new Date()
    end.setHours(23, 59, 59, 999)

    let cancelled = false
    supabase
      .from('outlook_events')
      .select('id, subject, start_time, end_time, location, categories')
      .gte('start_time', start.toISOString())
      .lte('start_time', end.toISOString())
      .order('start_time')
      .then(({ data }) => {
        if (!cancelled) setEvents(data || [])
      })
    return () => { cancelled = true }
  }, [])

  // Day-window: 09:00 → 18:00 (9 uur breed)
  const dayStart = useMemo(() => {
    const d = new Date()
    d.setHours(9, 0, 0, 0)
    return d.getTime()
  }, [])
  const dayEnd = useMemo(() => {
    const d = new Date()
    d.setHours(18, 0, 0, 0)
    return d.getTime()
  }, [])
  const span = dayEnd - dayStart

  const positioned = events
    .map(ev => {
      const t = new Date(ev.start_time).getTime()
      const tEnd = ev.end_time ? new Date(ev.end_time).getTime() : t + 30 * 60 * 1000
      const left = ((t - dayStart) / span) * 100
      const width = Math.max(((tEnd - t) / span) * 100, 4)
      const tone = eventTone(ev)
      const hm = new Date(ev.start_time).toLocaleTimeString('nl-NL', { hour: '2-digit', minute: '2-digit' })
      return { ev, left, width, tone, hm }
    })
    .filter(x => x.left >= -2 && x.left <= 102)

  const nowPct = ((now.getTime() - dayStart) / span) * 100
  const nowVisible = nowPct >= 0 && nowPct <= 100

  return (
    <div className={s.nowStrip}>
      <div className={s.nowStripHead}>
        <h3 className={s.nowStripTitle}>Vandaag · 09:00 → 18:00</h3>
        <div style={{ display: 'flex', gap: 6 }}>
          <span className={s.pillInfo + ' ' + s.pill}>{events.length} event{events.length === 1 ? '' : 's'}</span>
        </div>
      </div>
      <div className={s.nowStripRail}>
        {[0, 11, 22, 33, 44, 55, 66, 77, 88, 100].map((pct, i) => (
          <span key={i} className={s.nowStripHour} style={{ left: pct + '%' }}>
            {String(9 + i).padStart(2, '0')}
          </span>
        ))}
        {positioned.length === 0 ? (
          <div className={s.nowStripEmpty}>geen events vandaag tussen 09:00 en 18:00</div>
        ) : (
          positioned.map(({ ev, left, width, tone, hm }) => (
            <div
              key={ev.id}
              className={`${s.nowStripEv} ${tone}`}
              style={{ left: clamp(left, 0, 95) + '%', width: clamp(width, 3, 100 - left) + '%' }}
              title={`${ev.subject} · ${hm}`}
            >
              {truncate(ev.subject || '(geen titel)', 24)}<small>{hm}</small>
            </div>
          ))
        )}
        {nowVisible && <div className={s.nowStripNow} style={{ left: nowPct + '%' }} />}
      </div>
    </div>
  )
}

function eventTone(ev) {
  const cats = (ev.categories || []).map(c => String(c).toLowerCase())
  const subj = String(ev.subject || '').toLowerCase()
  if (cats.some(c => c.includes('klant') || c.includes('customer'))) return s.evC
  if (cats.some(c => c.includes('prospect') || c.includes('lead'))) return s.evP
  if (cats.some(c => c.includes('intern')) || subj.includes('standup') || subj.includes('1:1')) return s.evI
  return s.evD
}

// =====================================================
// Activity feed — recente runs
// =====================================================
function ActivityFeed({ history, latestRuns }) {
  // Bouw lijst van laatste 6 runs over alle agents
  const items = useMemo(() => {
    const all = []
    Object.entries(history || {}).forEach(([agent, runs]) => {
      (runs || []).forEach(r => all.push({ ...r, agent_name: agent }))
    })
    Object.entries(latestRuns || {}).forEach(([agent, run]) => {
      if (run) all.push({ ...run, agent_name: agent })
    })
    // Dedup op id, sort op started_at desc
    const seen = new Set()
    const unique = all.filter(r => {
      if (!r.id || seen.has(r.id)) return false
      seen.add(r.id)
      return true
    })
    unique.sort((a, b) => new Date(b.started_at).getTime() - new Date(a.started_at).getTime())
    return unique.slice(0, 6)
  }, [history, latestRuns])

  return (
    <div className={s.feed}>
      <div className={s.feedHead}>
        <h3>Recente activity</h3>
        <span className={`${s.pill} ${s.pillOk}`}>
          <span className={s.pillDot} style={{ background: 'var(--success)' }} />
          {items.filter(i => i.status === 'success').length} verwerkt
        </span>
      </div>
      {items.length === 0 ? (
        <div className={s.empty}>nog geen runs vandaag</div>
      ) : (
        items.map(item => <FeedRow key={item.id} item={item} />)
      )}
    </div>
  )
}

function FeedRow({ item }) {
  const tone = agentTone(item.agent_name)
  const icon = agentIcon(item.agent_name)
  const t = new Date(item.started_at)
  const hm = t.toLocaleTimeString('nl-NL', { hour: '2-digit', minute: '2-digit' })
  const isErr = item.status === 'error'
  return (
    <div className={s.feedRow}>
      <div className={`${s.feedRowIcon} ${isErr ? s.feedIconErr : tone}`}>{icon}</div>
      <div className={s.feedRowMain}>
        <div className={s.feedRowT}>
          <strong>{prettyAgent(item.agent_name)}</strong>{item.message ? ' — ' + truncate(item.message, 64) : ''}
        </div>
        {isErr && <div className={s.feedRowSub}>fout — {truncate(item.error_message || 'onbekend', 60)}</div>}
      </div>
      <span className={s.feedRowWhen}>{hm}</span>
    </div>
  )
}

// =====================================================
// Agents-grid — top 6 actieve agents
// =====================================================
function AgentsSection({ schedules, latestRuns, history, onNavigate }) {
  const cards = useMemo(() => {
    const visible = (schedules || [])
      .filter(s => s.tier !== 'infra' && s.enabled)
      .slice(0, 6)
    return visible.map(sc => {
      const runs = history?.[sc.agent_name] || []
      const last = latestRuns?.[sc.agent_name]
      const total = runs.length || (last ? 1 : 0)
      const errors = runs.filter(r => r.status === 'error').length
      const successPct = total === 0 ? 0 : Math.round(((total - errors) / total) * 100)
      const status = !sc.enabled ? 'paused' : errors > 0 && errors / Math.max(total, 1) >= 0.5 ? 'error' : 'live'
      return { schedule: sc, last, total, errors, successPct, status }
    })
  }, [schedules, latestRuns, history])

  if (cards.length === 0) {
    return (
      <div>
        <div className={s.sh}>
          <h2>Agents <span>· geen actief</span></h2>
        </div>
        <div className={s.empty}>Geen agents geregistreerd in agent_schedules.</div>
      </div>
    )
  }

  return (
    <div>
      <div className={s.sh}>
        <h2>Agents <span>· {cards.length} actief</span></h2>
        {onNavigate && (
          <button type="button" className={`${s.btn} ${s.btnSm}`} onClick={() => onNavigate('settings')}>
            Beheer agents
          </button>
        )}
      </div>
      <div className={s.agentsGrid}>
        {cards.map(c => <AgentCard key={c.schedule.agent_name} card={c} />)}
      </div>
    </div>
  )
}

function AgentCard({ card }) {
  const { schedule, last, total, errors, successPct, status } = card
  const tone = agentTone(schedule.agent_name)
  const initials = initialsOf(schedule.display_name || schedule.agent_name)
  const statusClass =
    status === 'live' ? s.statusLive :
    status === 'error' ? s.statusError :
    s.statusPaused
  const statusLabel = status === 'live' ? 'live' : status === 'error' ? 'fout' : 'gepauzeerd'

  const lastWhen = last?.started_at
    ? relTime(new Date(last.started_at))
    : 'geen run'

  return (
    <div className={s.agentCard}>
      <div className={s.agentCardTop}>
        <div className={`${s.agentCardIcon} ${tone}`}>{initials}</div>
        <div className={s.agentCardName}>{schedule.display_name || schedule.agent_name}</div>
        <span className={`${s.agentCardStatus} ${statusClass}`}>
          <span className="dot" />
          {statusLabel}
        </span>
      </div>
      {schedule.description && (
        <div className={s.agentCardSub}>{truncate(schedule.description, 120)}</div>
      )}
      <div className={s.agentCardBar}>
        <span style={{ width: successPct + '%', background: errors > 0 ? 'var(--warning)' : 'var(--success)' }} />
      </div>
      <div className={s.agentCardStats}>
        <span><strong>{successPct}%</strong> akkoord</span>
        <span><strong>{total}</strong> runs</span>
        <span>laatste: {lastWhen}</span>
      </div>
    </div>
  )
}

// =====================================================
// Runs-tabel — laatste 8 runs
// =====================================================
function RunsTable({ history, latestRuns, schedules }) {
  const rows = useMemo(() => {
    const all = []
    Object.entries(history || {}).forEach(([agent, runs]) => {
      (runs || []).forEach(r => all.push({ ...r, agent_name: agent }))
    })
    Object.entries(latestRuns || {}).forEach(([agent, run]) => {
      if (run) all.push({ ...run, agent_name: agent })
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

  const ok = rows.filter(r => r.status === 'success').length
  const err = rows.filter(r => r.status === 'error').length
  const running = rows.filter(r => r.status === 'running' || r.status === 'pending').length

  return (
    <div className={s.runs}>
      <div className={s.runsHead}>
        <h3>Runs vandaag</h3>
        <span className={`${s.pill} ${s.pillOk}`}>{ok} ✓</span>
        {err > 0 && <span className={`${s.pill} ${s.pillErr}`}>{err} fout</span>}
        {running > 0 && <span className={s.pill}>{running} in voortgang</span>}
      </div>
      {rows.length === 0 ? (
        <div className={s.empty}>geen recente runs</div>
      ) : (
        rows.map(r => <RunRow key={r.id} run={r} schedules={schedules} />)
      )}
    </div>
  )
}

function RunRow({ run, schedules }) {
  const sc = (schedules || []).find(x => x.agent_name === run.agent_name)
  const display = sc?.display_name || run.agent_name
  const initials = initialsOf(display)
  const t = new Date(run.started_at).toLocaleTimeString('nl-NL', { hour: '2-digit', minute: '2-digit' })
  const verdictClass =
    run.status === 'success' ? s.verdictOk :
    run.status === 'error'   ? s.verdictErr :
    s.verdictRun
  const verdictLabel =
    run.status === 'success' ? '✓ ok' :
    run.status === 'error'   ? '× fout' :
    'wacht op review'
  const barColor =
    run.status === 'success' ? 'var(--success)' :
    run.status === 'error'   ? 'var(--error)' :
    'var(--info)'
  const barWidth = run.status === 'error' ? 60 : 100
  const tone = agentTone(run.agent_name)

  return (
    <div className={s.runRow}>
      <span className={s.runRowName}>
        <span className={`ic ${tone}`}>{initials}</span>
        {display}
      </span>
      <span className={s.runRowWhen}>{t}</span>
      <span className={s.runRowMsg}>{run.message || run.error_message || '—'}</span>
      <div className={s.runRowBar}><span style={{ width: barWidth + '%', background: barColor }} /></div>
      <span className={`${s.runRowVerdict} ${verdictClass}`}>{verdictLabel}</span>
      <span className={s.runRowMore}>⋯</span>
    </div>
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
  return String(agent || '')
    .replace(/[-_]/g, ' ')
    .replace(/\b\w/g, c => c.toUpperCase())
}

function agentTone(agent) {
  const a = String(agent || '').toLowerCase()
  if (a.includes('admin'))    return s.toneAdm
  if (a.includes('mail') || a.includes('autodraft')) return s.toneMail
  if (a.includes('agenda') || a.includes('plan'))    return s.toneCal
  if (a.includes('jelle') || a.includes('mind'))     return s.toneQa
  if (a.includes('brief') || a.includes('research')) return s.toneBrief
  if (a.includes('legal'))                           return s.toneResearch
  return ''
}

function agentIcon(agent) {
  const a = String(agent || '').toLowerCase()
  if (a.includes('admin'))    return <Icon size={14}><path d="M12 2v20M2 12h20"/></Icon>
  if (a.includes('mail') || a.includes('autodraft')) return <Icon size={14}><path d="M3 7h18v12H3z"/><path d="M3 7l9 7 9-7"/></Icon>
  if (a.includes('agenda') || a.includes('plan'))    return <Icon size={14}><rect x="3" y="5" width="18" height="16" rx="2"/><path d="M3 9h18"/></Icon>
  return <Icon size={14}><circle cx="12" cy="12" r="9"/><path d="M9 12h6"/></Icon>
}

function relTime(d) {
  const ms = Date.now() - d.getTime()
  const min = Math.round(ms / 60000)
  if (min < 1)   return 'nu'
  if (min < 60)  return `${min}m`
  const hr = Math.round(min / 60)
  if (hr < 24)   return `${hr}u`
  const days = Math.round(hr / 24)
  return `${days}d`
}
