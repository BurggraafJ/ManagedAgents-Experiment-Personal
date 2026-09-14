import { useState, useMemo } from 'react'
import { supabase } from '../../lib/supabase'
import { useAgenda } from '../../hooks/useAgenda'
import { useAgendaWrite } from '../../hooks/useAgendaWrite'
import { lastCalendarSyncAt } from '../../lib/agenda'
import MIcon from '../MIcon'
import MobileAgendaGrid from './MobileAgendaGrid'
import MobileAgendaSheet from './MobileAgendaSheet'
import '../mobile-agenda.css'

// MobileAgenda — dag-view met week-strip en dag-tijdgrid.
//
// Design A "Luchtlijn" (2026-09-12): de dagdeel-secties
// (Vanochtend/Vanmiddag/Vanavond) zijn vervangen door één tijdgrid met
// haarlijnen — dezelfde taal als de desktop-week. Tik op een event opent de
// detail-sheet (wijzig/verwijder/nieuw zitten daarin).
//
// v1.203 — twee wijzigingen uit Jelle's feedback op #120 (2026-09-15):
//   • het "Morgen"-blok onderaan is weg. Het toonde wat de weekstrip erboven
//     al toont, en het bezette juist de hoek waar nu de FAB staat;
//   • "Nieuw event" is van het vierde icoontje rechtsboven een zwarte FAB
//     rechtsonder geworden, zoals in Taken.
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
function dayKey(d) { const x = new Date(d); x.setHours(0, 0, 0, 0); return `${x.getFullYear()}-${String(x.getMonth() + 1).padStart(2, '0')}-${String(x.getDate()).padStart(2, '0')}` }

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
  const { events, attendees, syncState, loading, refresh } = useAgenda()
  const write = useAgendaWrite(refresh)
  const today = new Date(); today.setHours(0, 0, 0, 0)
  const [selected, setSelected] = useState(today)
  const [weekStart, setWeekStart] = useState(() => startOfWeek(today))
  const [syncing, setSyncing] = useState(false)
  // Sheet-stand: { mode, event, draft } — de mobiele popover.
  const [sheet, setSheet] = useState(null)

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

  // Genodigden per event. Tot v1.202 was dit een teller: de sheet had alleen
  // een aantal nodig voor het verwijder-hek en de waarschuwing. Sinds v1.203
  // kun je de lijst bewerken, dus de rijen zelf gaan mee — namen in de
  // detail-stand, chips in de wijzig-stand.
  const attendeesByEvent = useMemo(() => {
    const map = new Map()
    for (const a of (attendees || [])) {
      const list = map.get(a.calendar_event_id)
      if (list) list.push(a)
      else map.set(a.calendar_event_id, [a])
    }
    return map
  }, [attendees])

  const selKey = dayKey(selected)
  const dayEvents = eventsByDay.get(selKey) || []
  const now = new Date()
  const isTodaySel = isSameDay(selected, today)
  const past = dayEvents.filter(e => new Date(e.end_time || e.start_time) < now).length
  const upcoming = dayEvents.length - past

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
  
  // Tikken = opnieuw ophalen uit de spiegel. Dat is wat deze knop écht doet, en
  // sinds v1.195 is dat ook zinvol: de schrijfbaan werkt de spiegel in dezelfde
  // call bij, dus na een wijziging staat het verse beeld er meteen.
  //
  // ⚠ `request_calendar_sync_now()` blijft er als beste-poging staan, maar
  // forceert vandaag NIETS. De RPC zet `manual_run_requested_at` op de
  // `agent_schedules`-rij voor `outlook-calendar-sync`, en die rij staat
  // `enabled = false` met `last_run_at = NULL`; de echte sync draait via pg_cron
  // → Edge Function en kijkt daar niet naar. Er stond een aanvraag van
  // 2026-08-28 ongelezen te wachten. Niet hier op te lossen — dat is de
  // orchestrator-baan (RESEARCH-AGENDA-WRITE §8.1/§8.5). Daarom is de refresh
  // niet meer afhankelijk van die RPC: eerst verversen, dan pas de aanvraag.
  const onForceSync = async () => {
    setSyncing(true)
    try {
      await refresh?.()
      const { error } = await supabase.rpc('request_calendar_sync_now')
      if (error) console.warn('Calendar sync request:', error.message)
    } catch (e) {
      console.error('Calendar refresh error:', e)
    } finally {
      setSyncing(false)
    }
  }

  // Nieuw event vanaf de FAB: het eerstvolgende halve uur op de gekozen dag.
  const openNew = () => {
    const start = new Date(selected)
    const ref = isTodaySel ? now : new Date(selected.getFullYear(), selected.getMonth(), selected.getDate(), 9, 0)
    start.setHours(ref.getHours(), ref.getMinutes() > 30 ? 60 : 30, 0, 0)
    setSheet({ mode: 'create', draft: { start, end: new Date(start.getTime() + 30 * 60000) } })
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
              {syncing ? '...' : formatSyncTime(lastCalendarSyncAt(syncState))}
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
        {dayEvents.length === 0 && loading ? (
          <div className="m-skel-list">{[0, 1, 2].map(i => <div key={i} className="m-skel m-skel--event" />)}</div>
        ) : (
          <>
            {dayEvents.length === 0 && (
              <div className="m-tl__empty">Geen events op deze dag.</div>
            )}
            <MobileAgendaGrid
              day={selected}
              events={dayEvents}
              now={now}
              onPickEvent={e => setSheet({ mode: 'detail', event: e })}
              onPickSlot={draft => setSheet({ mode: 'create', draft })}
            />
            {/* v1.203 — het "Morgen"-blok is weg (Jelle, 2026-09-15): overbodig,
                want morgen staat één tik verderop in de weekstrip erboven. Het
                kostte onderaan het scherm precies de ruimte waar de FAB nu staat. */}
            {dayEvents.length > 0 && (
              <div className="m-ag__endofday">— Einde van de dag —</div>
            )}
          </>
        )}
      </div>

      {/* Nieuw event: rechtsonder en zwart, zoals de FAB in Taken en Postvak.
          Stond tot v1.202 als vierde icoontje rechtsboven, waar hij naast drie
          navigatieknoppen verdween en met een duim nauwelijks te raken was. */}
      <button type="button" className="m-fab" onClick={openNew} aria-label="Nieuw event">
        <MIcon name="plus" size={24} color="#fff" stroke={2.2} />
      </button>

      {sheet && (
        <MobileAgendaSheet
          mode={sheet.mode}
          event={sheet.event}
          draft={sheet.draft}
          attendees={sheet.event ? (attendeesByEvent.get(sheet.event.id) || []) : []}
          write={write}
          onClose={() => setSheet(null)}
        />
      )}
    </div>
  )
}
