import { useState, useMemo } from 'react'
import { useNavigate } from 'react-router-dom'
import { supabase } from '../../lib/supabase'
import { useAgenda } from '../../hooks/useAgenda'
import MIcon from '../MIcon'

// MobileAgenda — dag-view met week-strip + time-blok + DayHead-secties.
// Geport uit app/mobile-agenda.jsx (vernieuwde versie). Hergebruikt useAgenda;
// tap op event → /agenda/briefing/:id.
const DAYS = ['zo', 'ma', 'di', 'wo', 'do', 'vr', 'za']
const DAYS_FULL = ['zondag', 'maandag', 'dinsdag', 'woensdag', 'donderdag', 'vrijdag', 'zaterdag']
const MONTHS = ['januari', 'februari', 'maart', 'april', 'mei', 'juni', 'juli', 'augustus', 'september', 'oktober', 'november', 'december']
const MONTHS_SHORT = ['jan', 'feb', 'mrt', 'apr', 'mei', 'jun', 'jul', 'aug', 'sep', 'okt', 'nov', 'dec']

function startOfWeek(d) {
  const x = new Date(d); x.setHours(0, 0, 0, 0)
  const dow = (x.getDay() + 6) % 7  // ma=0
  x.setDate(x.getDate() - dow)
  return x
}
function isSameDay(a, b) { return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate() }
function fmtHM(iso) { return new Date(iso).toLocaleTimeString('nl-NL', { hour: '2-digit', minute: '2-digit' }) }
function dayKey(d) { const x = new Date(d); x.setHours(0, 0, 0, 0); return `${x.getFullYear()}-${String(x.getMonth() + 1).padStart(2, '0')}-${String(x.getDate()).padStart(2, '0')}` }
function periodOf(e) {
  const h = new Date(e.start_time).getHours()
  if (h < 12) return 'ochtend'
  if (h < 18) return 'middag'
  return 'avond'
}

function formatSyncTime(iso) {
  if (!iso) return 'geen sync'
  const now = new Date()
  const syncDate = new Date(iso)
  const diffMs = now - syncDate
  const diffMin = Math.floor(diffMs / 60000)
  if (diffMin < 1) return 'nu'
  if (diffMin < 60) return `${diffMin} min geleden`
  const diffHours = Math.floor(diffMin / 60)
  if (diffHours < 24) return `${diffHours}u geleden`
  return syncDate.toLocaleDateString('nl-NL', { day: 'numeric', month: 'short' })
}

export default function MobileAgenda() {
  const navigate = useNavigate()
  const { events, syncState, loading, refresh } = useAgenda()
  const today = new Date(); today.setHours(0, 0, 0, 0)
  const [selected, setSelected] = useState(today)
  const [weekStart, setWeekStart] = useState(() => startOfWeek(today))
  const [syncing, setSyncing] = useState(false)

  const week = useMemo(() => [0, 1, 2, 3, 4, 5, 6].map(i => { const d = new Date(weekStart); d.setDate(weekStart.getDate() + i); return d }), [weekStart])

  const eventsByDay = useMemo(() => {
    const map = new Map()
    for (const e of (events || [])) {
      if (e.is_cancelled) continue
      const k = dayKey(e.start_time)
      if (!map.has(k)) map.set(k, [])
      map.get(k).push(e)
    }
    for (const arr of map.values()) arr.sort((a, b) => new Date(a.start_time) - new Date(b.start_time))
    return map
  }, [events])

  const selKey = dayKey(selected)
  const dayEvents = eventsByDay.get(selKey) || []
  const now = new Date()
  const isTodaySel = isSameDay(selected, today)
  const past = dayEvents.filter(e => new Date(e.end_time || e.start_time) < now).length
  const upcoming = dayEvents.length - past

  // Groepeer op dagdeel.
  const groups = useMemo(() => {
    const g = { ochtend: [], middag: [], avond: [] }
    for (const e of dayEvents) g[periodOf(e)].push(e)
    return g
  }, [dayEvents])

  // Tijd-tot-eerstvolgende "NU"-event op deze dag.
  const nextNow = useMemo(() => {
    for (const e of dayEvents) {
      const s = new Date(e.start_time)
      if (s > now) return Math.round((s - now) / 60000)
    }
    return null
  }, [dayEvents, now])

  const goPrev = () => { const w = new Date(weekStart); w.setDate(w.getDate() - 7); setWeekStart(w) }
  const goNext = () => { const w = new Date(weekStart); w.setDate(w.getDate() + 7); setWeekStart(w) }
  const goToday = () => { setSelected(today); setWeekStart(startOfWeek(today)) }
  
  const onForceSync = async () => {
    setSyncing(true)
    try {
      const { data, error } = await supabase.rpc('request_calendar_sync_now')
      if (error || (data && data.ok === false)) throw new Error(error?.message || data?.reason || 'Sync mislukt')
      setTimeout(() => refresh?.(), 2000)
    } catch (e) {
      console.error('Calendar sync error:', e)
    } finally {
      setTimeout(() => setSyncing(false), 2000)
    }
  }

  // Morgen-preview voor onderaan: vult de lege ruimte boven de tab bar met
  // iets nuttigs i.p.v. een leeg paper-vlak. Toont enkel op vandaag's dag-view.
  const tomorrow = useMemo(() => { const d = new Date(selected); d.setDate(selected.getDate() + 1); return d }, [selected])
  const tomorrowEvents = eventsByDay.get(dayKey(tomorrow)) || []
  const jumpToTomorrow = () => {
    setSelected(tomorrow)
    const ws = startOfWeek(tomorrow)
    if (ws.getTime() !== weekStart.getTime()) setWeekStart(ws)
  }

  const periodLabel = (key, count) => {
    const base = isTodaySel ? { ochtend: 'Vanochtend', middag: 'Vanmiddag', avond: 'Vanavond' }
                            : { ochtend: 'Ochtend', middag: 'Middag', avond: 'Avond' }
    const arr = groups[key]
    const allPast = arr.every(e => new Date(e.end_time || e.start_time) < now)
    const allFuture = arr.every(e => new Date(e.start_time) > now)
    let suffix = `${count} ${count === 1 ? 'event' : 'events'}`
    if (allPast) suffix = `${count} afgerond`
    else if (allFuture) suffix = `${count} te gaan`
    return `${base[key]} · ${suffix}`
  }

  return (
    <div className="m-ag">
      <header className="m-ag__head">
        <div className="m-ag__head-top">
          <div className="m-tk__eyebrow">
            {`${MONTHS[selected.getMonth()].toUpperCase()} ${selected.getFullYear()}`}
            <span>Agenda</span>
          </div>
          <div className="m-ag__head-actions">
            <button type="button" onClick={onForceSync} disabled={syncing} className="m-sync-btn" style={{ padding: '0 8px' }}>
              {syncing ? '...' : formatSyncTime(syncState?.last_sync_at)}
            </button>
            <button type="button" className="m-ag__navbtn" onClick={goPrev} aria-label="Vorige week">
              <span style={{ transform: 'rotate(180deg)', display: 'inline-flex' }}><MIcon name="chevron" size={16} /></span>
            </button>
            <button type="button" className="m-ag__navbtn" onClick={goNext} aria-label="Volgende week">
              <MIcon name="chevron" size={16} />
            </button>
            <button type="button" className="m-ag__navbtn" onClick={goToday} aria-label="Vandaag" title="Vandaag">
              <MIcon name="cal" size={16} />
            </button>
          </div>
        </div>

        <div className="m-ag__weekstrip">
          {week.map(d => {
            const k = dayKey(d)
            const has = (eventsByDay.get(k) || []).length > 0
            const isToday = isSameDay(d, today)
            const isSel = isSameDay(d, selected)
            return (
              <button
                key={k}
                type="button"
                className={`m-ag__day ${isSel ? 'is-sel' : ''} ${isToday ? 'is-today' : ''}`}
                onClick={() => setSelected(d)}
              >
                <span className="m-ag__day-lbl">{DAYS[d.getDay()]}</span>
                <span className="m-ag__day-num">{d.getDate()}</span>
                <span
                  className={`m-ag__day-dot ${isToday ? 'is-today' : (has ? 'has-events' : '')}`}
                  aria-hidden
                />
              </button>
            )
          })}
        </div>

        <div className="m-ag__title-row">
          <h1 className="m-ag__title">
            {DAYS_FULL[selected.getDay()].charAt(0).toUpperCase() + DAYS_FULL[selected.getDay()].slice(1)}{' '}
            <span>{selected.getDate()} {MONTHS_SHORT[selected.getMonth()]}</span>
          </h1>
          <span className="m-ag__count">{dayEvents.length} {dayEvents.length === 1 ? 'event' : 'events'}</span>
        </div>
        <div className="m-ag__sub">
          {dayEvents.length === 0
            ? 'Geen events'
            : <>
                {past > 0 && `${past} gehad`}
                {past > 0 && upcoming > 0 && ' · '}
                {upcoming > 0 && `${upcoming} te gaan`}
                {isTodaySel && nextNow != null && nextNow > 0 && nextNow < 90 && ` · 1 over ${nextNow} min`}
              </>}
        </div>
      </header>

      <div className="m-ag__body">
        {dayEvents.length === 0 ? (
          loading ? (
            <div className="m-skel-list">{[0, 1, 2].map(i => <div key={i} className="m-skel m-skel--event" />)}</div>
          ) : (
            <div className="m-tl__empty">Geen events op deze dag.</div>
          )
        ) : (
          <>
            {['ochtend', 'middag', 'avond'].map(p => {
              const arr = groups[p]
              if (arr.length === 0) return null
              return (
                <div key={p} className="m-ag__group">
                  <div className="m-ag__dayhead">{periodLabel(p, arr.length)}</div>
                  {arr.map(e => <EventRow key={e.id} e={e} now={now} onTap={() => navigate(`/agenda/briefing/${e.id}`)} />)}
                </div>
              )
            })}
            {isTodaySel && tomorrowEvents.length > 0 && (
              <button type="button" className="m-ag__morgen" onClick={jumpToTomorrow}>
                <div className="m-ag__morgen-head">
                  <span className="m-ag__morgen-lbl">Morgen</span>
                  <span className="m-ag__morgen-date">{DAYS_FULL[tomorrow.getDay()]} {tomorrow.getDate()} {MONTHS_SHORT[tomorrow.getMonth()]}</span>
                </div>
                <div className="m-ag__morgen-body">
                  <span className="m-ag__morgen-cnt">{tomorrowEvents.length} {tomorrowEvents.length === 1 ? 'event' : 'events'}</span>
                  {tomorrowEvents[0] && (
                    <span className="m-ag__morgen-first">
                      <span className="m-ag__morgen-time">{fmtHM(tomorrowEvents[0].start_time)}</span>
                      <span className="m-ag__morgen-subj">{tomorrowEvents[0].subject || '(geen titel)'}</span>
                    </span>
                  )}
                </div>
                <MIcon name="chevron" size={13} />
              </button>
            )}
            {isTodaySel && tomorrowEvents.length === 0 && dayEvents.length > 0 && (
              <div className="m-ag__endofday">— Einde van de dag —</div>
            )}
          </>
        )}
      </div>
    </div>
  )
}

function EventRow({ e, now, onTap }) {
  const start = new Date(e.start_time)
  const end = e.end_time ? new Date(e.end_time) : new Date(start.getTime() + 30 * 60000)
  const isPast = end < now
  const isNow = start <= now && now <= end
  const dur = Math.max(0, Math.round((end - start) / 60000))
  const durLbl = dur >= 60 ? `${Math.round(dur / 60)} uur` : `${dur} min`
  const loc = e.online_meeting_url ? 'Online meeting' : (e.location_text || '—')

  return (
    <div className="m-ag__event">
      <div className="m-ag__event-time">
        <div className="m-ag__event-time-hm">{fmtHM(e.start_time)}</div>
        <div className="m-ag__event-time-sub">{durLbl}</div>
      </div>
      <button
        type="button"
        className={`m-ag__event-card ${isPast ? 'is-past' : ''} ${isNow ? 'is-now' : ''}`}
        onClick={onTap}
      >
        {isNow && (
          <span className="m-ag__event-now-badge">
            <span className="m-ag__event-now-dot" /> NU
          </span>
        )}
        <div className="m-ag__event-title">{e.subject || '(geen titel)'}</div>
        <div className="m-ag__event-loc">
          <MIcon name="pin" size={10} /> <span>{loc}</span>
        </div>
        {!isPast && (
          <div className="m-ag__event-foot">
            <span className={`m-ag__event-chip ${e.online_meeting_url ? 'is-online' : ''}`}>
              {e.online_meeting_url ? 'Online' : 'In persoon'}
            </span>
            <span className="m-ag__event-cta">Briefing <MIcon name="chevron" size={10} stroke={2.2} /></span>
          </div>
        )}
      </button>
    </div>
  )
}
