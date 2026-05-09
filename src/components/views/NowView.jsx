import { useEffect, useMemo, useState } from 'react'
import { useAgents } from '../../hooks/useAgents'
import { useSales } from '../../hooks/useSales'
import { supabase } from '../../lib/supabase'
import Agents, { AgentsHelpersFunctions } from '../sections/agents'
import WeekProgress from '../sections/week-progress'
import TruthOfSourcesView from './truth-of-sources/TruthOfSourcesView'
import './now/now-maestro.css'

// NowView — Maestro design, restored sessie 14 (2026-05-09).
//
// HARD-RULE: oude code is leidend. Sessie 12 had alle functies verwijderd
// (WeekProgress / volledige Agents-grid / Run Now / status-detail /
// TruthOfSources / AgentsHelpersFunctions). Hier zijn die ALLEMAAL terug.
// Mockup-elementen (greeting, focus-tiles, now-strip, activity-feed) staan
// bovenaan ALS AANVULLING — niet als vervanging.
//
// Layout volgorde (boven naar beneden):
//   1. Greeting strook (mockup)
//   2. Focus-grid 2 cols (mockup, groter/ingezoomd per Jelle's feedback)
//   3. Row-2col: NowStrip horizontal timeline + ActivityFeed (mockup)
//   4. WeekProgress "Doel vs werkelijk" (oud — terug)
//   5. Agents (oud — terug, alle tiers, met Run Now + status-detail)
//   6. TruthOfSourcesView (oud — terug)
//   7. AgentsHelpersFunctions (oud — terug)
export default function NowView({ onNavigate, badges = {} }) {
  const { weekRuns, schedules, weekStart, latestRuns, history, questions } = useAgents()
  const { events: salesEvents, todos: salesTodos } = useSales()

  const goto = (path) => {
    if (typeof window !== 'undefined') window.location.assign(path)
  }

  return (
    <div className="theme-maestro now-app">
      <div className="now-scroll">
        <div className="now-inner">
          {/* ───── Mockup bovenstrook ───── */}
          <Greeting badges={badges} />
          <FocusGrid badges={badges} goto={goto} />
          <div className="now-row-2col">
            <NowStrip />
            <ActivityFeed history={history} latestRuns={latestRuns} />
          </div>

          {/* ───── Oude functionaliteit (terug) ───── */}
          <WeekProgress
            runs={weekRuns}
            schedules={schedules}
            weekStart={weekStart}
          />
          <Agents
            schedules={schedules}
            latestRuns={latestRuns}
            history={history}
            questions={questions}
            salesEvents={salesEvents}
            salesTodos={salesTodos}
          />
          <TruthOfSourcesView />
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
// Focus tiles — 2 cols (groter per tile, per Jelle)
// =====================================================
function FocusGrid({ badges, goto }) {
  const adminPending = badges.adminPending || 0
  const inbox = badges.autodraftPropsCount || 0
  const taskNeedsReview = (badges.tasks || []).filter(t => t.is_newly_found).length

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
        <div className="now-focus__num now-focus__num--sm">vandaag</div>
        <div className="now-focus__sub">open agenda voor live week-overzicht</div>
        <span className="now-focus__cta">Open agenda →</span>
      </button>

      <button type="button" className="now-focus" onClick={() => goto('/postvak')}>
        <div className="now-focus__head">
          <div className="now-focus__icon">
            <Icon><path d="M3 7h18v12H3z"/><path d="M3 7l9 7 9-7"/></Icon>
          </div>
          Postvak
        </div>
        <div className="now-focus__num">{inbox}</div>
        <div className="now-focus__sub">
          {inbox === 0 ? 'geen drafts klaar' : 'drafts klaar voor review'}
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
    <div className="now-strip">
      <div className="now-strip__head">
        <h3>Vandaag · 09:00 → 18:00</h3>
        <span className="now-pill now-pill--info">{events.length} event{events.length === 1 ? '' : 's'}</span>
      </div>
      <div className="now-strip__rail">
        {[0, 11, 22, 33, 44, 55, 66, 77, 88, 100].map((pct, i) => (
          <span key={i} className="now-strip__hour" style={{ left: pct + '%' }}>
            {String(9 + i).padStart(2, '0')}
          </span>
        ))}
        {positioned.length === 0 ? (
          <div className="now-strip__empty">geen events vandaag tussen 09:00 en 18:00</div>
        ) : (
          positioned.map(({ ev, left, width, tone, hm }) => (
            <div
              key={ev.id}
              className={`now-strip__ev now-strip__ev--${tone}`}
              style={{ left: clamp(left, 0, 95) + '%', width: clamp(width, 3, 100 - left) + '%' }}
              title={`${ev.subject} · ${hm}`}
            >
              {truncate(ev.subject || '(geen titel)', 24)}<small>{hm}</small>
            </div>
          ))
        )}
        {nowVisible && <div className="now-strip__now" style={{ left: nowPct + '%' }} />}
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
// Activity feed — recente runs (laatste 6)
// =====================================================
function ActivityFeed({ history, latestRuns }) {
  const items = useMemo(() => {
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
    return unique.slice(0, 6)
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
        <div className="now-empty">nog geen runs vandaag</div>
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
          <strong>{prettyAgent(item.agent_name)}</strong>{item.message ? ' — ' + truncate(item.message, 64) : ''}
        </div>
        {isErr && <div className="now-feed__sub">fout — {truncate(item.error_message || 'onbekend', 60)}</div>}
      </div>
      <span className="now-feed__when">{hm}</span>
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

function prettyAgent(agent) {
  return String(agent || '')
    .replace(/[-_]/g, ' ')
    .replace(/\b\w/g, c => c.toUpperCase())
}

function agentTone(agent) {
  const a = String(agent || '').toLowerCase()
  if (a.includes('admin'))    return 'adm'
  if (a.includes('mail') || a.includes('autodraft')) return 'mail'
  if (a.includes('agenda') || a.includes('plan'))    return 'cal'
  return 'def'
}

function agentIconPath(agent) {
  const a = String(agent || '').toLowerCase()
  if (a.includes('admin'))    return <><path d="M12 2v20M2 12h20"/></>
  if (a.includes('mail') || a.includes('autodraft')) return <><path d="M3 7h18v12H3z"/><path d="M3 7l9 7 9-7"/></>
  if (a.includes('agenda') || a.includes('plan'))    return <><rect x="3" y="5" width="18" height="16" rx="2"/><path d="M3 9h18"/></>
  return <><circle cx="12" cy="12" r="9"/><path d="M9 12h6"/></>
}
