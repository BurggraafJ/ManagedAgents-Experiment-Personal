import { useParams, useNavigate } from 'react-router-dom'
import { useMeetingBriefing } from '../../../hooks/useMeetingBriefing'
import './briefing.css'

// BriefingView — pre-meeting briefing voor één calendar-event, wired op
// meeting_briefings (zie useMeetingBriefing). Layout volgt de Claude Design
// mockup "Briefing.html"; secties komen uit briefing.sections (LLM-output).
// Route: /agenda/briefing/:eventId.

// ── helpers ──────────────────────────────────────────────────────────
function asList(v) {
  if (Array.isArray(v)) return v.map(x => String(x).trim()).filter(Boolean)
  if (typeof v === 'string' && v.trim()) return v.split(/\n+/).map(s => s.replace(/^[-•]\s*/, '').trim()).filter(Boolean)
  return []
}
function asText(v) {
  if (typeof v === 'string') return v.trim()
  if (Array.isArray(v)) return v.map(x => String(x).trim()).filter(Boolean).join(' ')
  return ''
}
function initials(name, email) {
  const base = (name || email || '').replace(/[<>"]/g, '').trim()
  if (!base) return '?'
  const parts = base.split(/[\s@.]+/).filter(Boolean)
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase()
  return (parts[0][0] + parts[1][0]).toUpperCase()
}
function hm(iso) {
  return new Date(iso).toLocaleTimeString('nl-NL', { hour: '2-digit', minute: '2-digit' })
}
function durLabel(start, end) {
  if (!start || !end) return ''
  const min = Math.round((new Date(end) - new Date(start)) / 60000)
  if (min <= 0) return ''
  return min >= 60 ? `${Math.round(min / 60)} uur` : `${min} min`
}
function whenLabel(start, end) {
  const s = new Date(start).getTime()
  const e = end ? new Date(end).getTime() : s + 30 * 60000
  const now = Date.now()
  const diffMin = Math.round((s - now) / 60000)
  if (now >= s && now <= e) return `${hm(start)} — bezig nu`
  if (now > e) return `${hm(start)} — geweest`
  if (diffMin <= 90) return `${hm(start)} — over ${diffMin} min`
  const sameDay = new Date(start).toDateString() === new Date().toDateString()
  if (sameDay) return `${hm(start)} — vandaag`
  return new Date(start).toLocaleString('nl-NL', { weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })
}

// ── icons ────────────────────────────────────────────────────────────
const ChevronLeft = () => <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="m15 18-6-6 6-6" /></svg>
const Play = () => <svg viewBox="0 0 24 24"><path d="M5 3l14 9-14 9V3z" fill="currentColor" /></svg>
const Spark = () => <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M12 3v4M12 17v4M3 12h4M17 12h4M5.6 5.6l2.8 2.8M15.6 15.6l2.8 2.8M18.4 5.6l-2.8 2.8M8.4 15.6l-2.8 2.8" /></svg>

// ── sections ─────────────────────────────────────────────────────────
function Who({ counterparties, attendees, companyName, meetingType, intro }) {
  const people = (counterparties && counterparties.length)
    ? counterparties
    : (attendees || []).filter(a => a.email).map(a => ({ name: a.name, email: a.email, is_organizer: a.is_organizer, domain: (a.email.split('@')[1] || '') }))
  if (!people.length) return null
  return (
    <div className="sec">
      <h2>Met wie</h2>
      {intro && <p className="sec__intro">{intro}</p>}
      {people.map((p, i) => {
        const role = [p.is_organizer ? 'Organisator' : null, companyName || p.domain, meetingType && meetingType !== 'onbekend' ? meetingType : null].filter(Boolean).join(' · ')
        return (
          <div className="who" key={i}>
            <div className="who__av">{initials(p.name, p.email)}</div>
            <div className="who__main">
              <div className="who__name">{p.name || p.email}</div>
              {role && <div className="who__role">{role}</div>}
              {p.email && <div className="who__mail">{p.email}</div>}
            </div>
          </div>
        )
      })}
    </div>
  )
}

function ReadyBriefing({ briefing, attendees, onRegenerate }) {
  const s = briefing.sections || {}
  const summary = asText(s.summary)
  const talking = asList(s.talking_points)
  const openItems = asList(s.open_items)
  const recent = asList(s.recent_history)
  const relation = asText(s.relation_status)
  const typeWho = asText(s.type_who)
  const generatedAt = briefing.generated_at ? new Date(briefing.generated_at).toLocaleString('nl-NL', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }) : null

  return (
    <>
      {summary
        ? <div className="brief"><div className="brief__eyebrow">De korte versie</div><p className="brief__text">{summary}</p></div>
        : (briefing.briefing_md && <div className="brief"><div className="brief__eyebrow">Briefing</div><p className="brief__text">{briefing.briefing_md}</p></div>)}

      {talking.length > 0 && (
        <div className="sec">
          <h2>Bespreken</h2>
          <ol className="tp">
            {talking.map((t, i) => (
              <li key={i}><span className="tp__num">{i + 1}</span><span className="tp__main">{t}</span></li>
            ))}
          </ol>
        </div>
      )}

      <Who
        counterparties={briefing.counterparties}
        attendees={attendees}
        companyName={briefing.company_name}
        meetingType={briefing.meeting_type}
        intro={typeWho}
      />

      {openItems.length > 0 && (
        <div className="sec">
          <h2>Open items</h2>
          <div className="oi">
            {openItems.map((t, i) => (
              <div className="oi__row" key={i}><span className="oi__dot" />{t}</div>
            ))}
          </div>
        </div>
      )}

      <details className="more">
        <summary>Meer context</summary>
        <div className="more__content">
          {relation && <p>{relation}</p>}
          {recent.map((r, i) => (
            <div className="more__row" key={i}><span className="more__bullet">›</span><div>{r}</div></div>
          ))}
          {recent.length === 0 && !relation && <p>Geen extra historie in de briefing.</p>}
          <div className="more__meta">
            {generatedAt && <span>gegenereerd {generatedAt}</span>}
            {briefing.model && <span>· {briefing.model}</span>}
            <button className="more__regen" onClick={onRegenerate}>genereer opnieuw</button>
          </div>
        </div>
      </details>
    </>
  )
}

function StateCard({ event, briefing, attendees, generating, reqError, requestGenerate }) {
  // Interne / uitgesloten meeting
  if (briefing && briefing.status === 'skipped' && briefing.meeting_type === 'intern') {
    return <div className="bf-state"><div className="bf-state__title">Interne meeting</div><div className="bf-state__sub">Voor interne meetings wordt geen externe briefing gegenereerd.</div></div>
  }
  if (generating) {
    return (
      <>
        <div className="bf-state">
          <div className="bf-state__title"><span className="bf-spin" />Briefing wordt voorbereid…</div>
          <div className="bf-state__sub">De meeting-briefing agent verzamelt historie en schrijft de samenvatting. Dit ververst vanzelf zodra 'ie klaar is.</div>
        </div>
        <Who counterparties={briefing?.counterparties} attendees={attendees} companyName={briefing?.company_name} meetingType={briefing?.meeting_type} />
      </>
    )
  }
  const isError = briefing && briefing.status === 'error'
  return (
    <>
      <div className={`bf-state ${isError ? 'bf-state--error' : ''}`}>
        <div className="bf-state__title">{isError ? 'Briefing mislukt' : 'Nog geen briefing'}</div>
        <div className="bf-state__sub">
          {isError
            ? (briefing.error_text || 'De vorige poging is mislukt.')
            : 'Er is nog geen voorbereidingsbriefing voor deze meeting. Genereer er één — de agent verzamelt context uit mail, deals en eerdere meetings.'}
        </div>
        <button className="bf-gen-btn" onClick={requestGenerate}>
          <Spark />{isError ? 'Opnieuw proberen' : 'Genereer briefing'}
        </button>
        {reqError && <div className="bf-gen-err">{reqError}</div>}
      </div>
      <Who counterparties={briefing?.counterparties} attendees={attendees} companyName={briefing?.company_name} meetingType={briefing?.meeting_type} />
    </>
  )
}

export default function BriefingView() {
  const { eventId } = useParams()
  const navigate = useNavigate()
  const { event, briefing, attendees, loading, error, reqError, generating, requestGenerate } = useMeetingBriefing(eventId)

  const ready = briefing && briefing.status === 'ready'

  return (
    <div className="bf-app">
      <div className="bf-scroll">
        <div className="bf-inner">
          <button className="bf-back" onClick={() => navigate(-1)}><ChevronLeft />Terug</button>

          {loading ? (
            <div className="bf-state"><div className="bf-state__title"><span className="bf-spin" />Laden…</div></div>
          ) : (!event || error === 'not_found') ? (
            <div className="bf-state"><div className="bf-state__title">Meeting niet gevonden</div><div className="bf-state__sub">Deze afspraak bestaat niet (meer) in de agenda.</div></div>
          ) : (
            <>
              <div className="bf-head">
                <div className="bf-head__left">
                  <div className="bf-head__when">{whenLabel(event.start_time, event.end_time)}</div>
                  <h1 className="bf-head__title">{event.subject || '(geen titel)'}</h1>
                  <div className="bf-head__sub">
                    {[durLabel(event.start_time, event.end_time), event.location_text || (event.online_meeting_url ? 'Online · Teams' : '')]
                      .filter(Boolean).join(' · ')}
                  </div>
                </div>
                {event.online_meeting_url && (
                  <a className="bf-head__start" href={event.online_meeting_url} target="_blank" rel="noreferrer"><Play />Start</a>
                )}
              </div>

              {ready
                ? <ReadyBriefing briefing={briefing} attendees={attendees} onRegenerate={requestGenerate} />
                : <StateCard event={event} briefing={briefing} attendees={attendees} generating={generating} reqError={reqError} requestGenerate={requestGenerate} />}
            </>
          )}
        </div>
      </div>
    </div>
  )
}
