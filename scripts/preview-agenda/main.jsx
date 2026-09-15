import { Profiler } from 'react'
import { MemoryRouter } from 'react-router-dom'
import { createRoot } from 'react-dom/client'
import '../../src/index.css'
import '../../src/mobile/mobile.css'
import AgendaView from '../../src/components/views/agenda/AgendaView'
import AgendaEventPopover from '../../src/components/views/agenda/AgendaEventPopover'
import MobileAgenda from '../../src/mobile/screens/MobileAgenda'
import MobileAgendaSheet from '../../src/mobile/screens/MobileAgendaSheet'
import AppShell from '../../src/components/shell/AppShell'
import { VIEWS, NAV_GROUPS } from '../../src/routes/viewRegistry'
import { useAgenda } from './mock-hooks'

// Preview-harnas Agenda (v1.183): desktop-week in de echte AppShell en de
// mobiele dag-grid, beide op de fixture uit mock-hooks.js (vijf gelijktijdige
// events rond 10:00 = de banen-situatie).
//
// v1.200 — de schrijfbaan. De week-grid laat niet zien wat er nieuw is; dat
// zit in de popover en de sheet. Vandaar de extra standen hieronder, die de
// echte componenten met een vaste anker-rect over de agenda heen zetten:
//
//   nieuw        het create-formulier met een werkende Opslaan-knop
//   wijzig       wijzigen van een afspraak MÉT genodigden → de eerlijke regel
//                dat Outlook een wijzigingsmail stuurt
//   verwijder    de bevestiging bij een afspraak zonder genodigden
//   geblokkeerd  een terugkerende afspraak: géén knoppen, wél de reden en de
//                Outlook-deeplink
const view = new URLSearchParams(location.search).get('view') || 'desktop'
const profile = { display_name: 'Jelle Burggraaf', role: 'owner' }

const { events, attendees } = useAgenda()
const find = (s) => events.find((e) => e.subject === s)
const attendeesOf = (ev) => attendees.filter((a) => a.calendar_event_id === ev?.id)

// De popover wordt normaal aan het aangeklikte blok gehangen. In een statische
// shot is er geen klik, dus geven we de rect van dat blok mee.
const ANCHOR = { top: 210, left: 470, right: 700, bottom: 264, width: 230, height: 54 }

// Een schrijf-stub: de knoppen moeten er actief uitzien, maar een preview mag
// nooit een echte agenda raken.
const write = {
  busy: false,
  createEvent: async () => ({ ok: true }),
  updateEvent: async () => ({ ok: true }),
  deleteEvent: async () => ({ ok: true }),
}

const CASES = {
  nieuw: { mode: 'create', subject: null },
  wijzig: { mode: 'edit', subject: 'Demo Van Dijk Advocaten' },
  verwijder: { mode: 'delete', subject: 'Intern: sprintplanning' },
  geblokkeerd: { mode: 'detail', subject: 'Partneroverleg Jira' },
  // v1.216 — de annuleer-kaart mét genodigden: de Outlook-keuze "Zonder
  // bericht" / "Met bericht". `verwijder` hierboven blijft de kaart zónder
  // genodigden (één knop). En `detail`: de detail-stand met de nieuwe
  // Annuleren-snelknop naast Wijzigen.
  annuleer: { mode: 'delete', subject: 'Demo Van Dijk Advocaten' },
  detail: { mode: 'detail', subject: 'Demo Van Dijk Advocaten' },
  // De Teams-schakelaar AAN, zodat de shot ook de "aan"-tekst toont; `nieuw`
  // toont de standaard (uit).
  teams: { mode: 'create', subject: null, toggleTeams: true },
  // v1.203 — het genodigden-veld met het suggestie-menu open. Zie `typeahead()`
  // onderaan: een statische shot heeft geen toetsaanslagen, dus die zet de
  // zoekterm er na het renderen zelf in.
  genodigden: { mode: 'create', subject: null, typeahead: 'ru' },
}

function popoverProps(kind) {
  const c = CASES[kind]
  if (!c) return null
  const ev = c.subject ? find(c.subject) : null
  const start = new Date(); start.setHours(11, 0, 0, 0)
  return {
    mode: c.mode,
    event: ev,
    classified: { meeting_type: 'client', color_key: 'client', is_physical: false },
    attendees: attendeesOf(ev),
    anchor: ANCHOR,
    draft: c.mode === 'create' ? { start, end: new Date(start.getTime() + 30 * 60000) } : undefined,
    write,
    onClose: () => {},
  }
}

function Desktop({ pop }) {
  const props = pop ? popoverProps(pop) : null
  return (
    <div className="theme-maestro" style={{ height: '100vh' }}>
      <AppShell
        views={VIEWS} groups={NAV_GROUPS} activeView="agenda" onSelect={() => {}}
        title="Agenda" crumb="Operations / Agenda" profile={profile} onLogout={() => {}}
      >
        <AgendaView onNavigate={() => {}} />
      </AppShell>
      {/* ⚠ Deze wrapper is niet cosmetisch. Álle knop-styling staat in
          agenda.css onder `.ag-app .ag-btn`, en in de echte app hangt de
          popover BINNEN `<div className="ag-app">` (AgendaView.jsx). Stond hij
          hier los, dan verloor hij die regels en toonde elke shot een Opslaan
          die grijs is terwijl hij in productie zwart is — een preview die de
          knop-hiërarchie verkeerd weergeeft. Gevonden bij het nalopen van de
          v1.202-shots (2026-09-15). */}
      {props && (
        // `display: contents` — de wrapper doet mee in de selector-keten maar
        // niet in de layout, zodat `.ag-app`'s eigen flex/padding de popover
        // niet verschuift.
        <div className="ag-app ag-app--lucht" style={{ display: 'contents' }}>
          <AgendaEventPopover {...props} />
        </div>
      )}
    </div>
  )
}

function Mobile({ pop }) {
  const props = pop ? popoverProps(pop) : null
  return (
    <div className="shell shell--m theme-maestro" style={{ height: '100vh', background: '#f5f4f0' }}>
      <main className="m-main" style={{ display: 'flex', flexDirection: 'column', overflow: 'auto' }}>
        <MobileAgenda />
      </main>
      {props && (
        <MobileAgendaSheet
          mode={props.mode} event={props.event} draft={props.draft}
          attendees={props.attendees} write={write} onClose={() => {}}
        />
      )}
    </div>
  )
}

const [platform, pop] = view.split('-')

// v1.216 — meetstand (`&perf=1`, zie perf.sh). Een React-Profiler om de hele
// agenda telt commits en de tijd die React erin doorbrengt, en schrijft de
// stand elke seconde in <title>, zodat `--dump-dom` na een virtuele-tijd-budget
// het getal kan lezen zonder CDP. Meet de re-renders die de klok (30 s) en de
// "nu"-tikken veroorzaken — precies wat de memo's in v1.216 moeten wegnemen.
const PERF = new URLSearchParams(location.search).get('perf') === '1'
// mountMs = de eerste paint (React-tijd); updateMs = alle commits daarna bij
// elkaar, met `updates` als aantal. Apart, want de mount is in dit fixture
// (25 events) veruit het grootste getal en zou de tik-kosten anders verbergen.
const perf = { mounts: 0, mountMs: 0, updates: 0, updateMs: 0 }
function onRender(_id, phase, actualDuration) {
  if (phase === 'mount') { perf.mounts += 1; perf.mountMs += actualDuration }
  else { perf.updates += 1; perf.updateMs += actualDuration }
}
if (PERF) {
  const r2 = (x) => Math.round(x * 100) / 100
  const write = () => { document.title = `PERF ${JSON.stringify({ ...perf, mountMs: r2(perf.mountMs), updateMs: r2(perf.updateMs), t: Math.round(performance.now()) })}` }
  setInterval(write, 1000)
}
const tree = platform === 'mobile' ? <Mobile pop={pop} /> : <Desktop pop={pop} />
createRoot(document.getElementById('root')).render(
  <MemoryRouter initialEntries={['/agenda']}>
    {PERF ? <Profiler id="agenda" onRender={onRender}>{tree}</Profiler> : tree}
  </MemoryRouter>
)

/**
 * Een statische shot heeft geen toetsaanslagen, en het suggestie-menu van het
 * genodigden-veld opent pas ná twee getypte tekens. Deze functie doet dat
 * na-het-renderen: de waarde via de native setter (anders ziet React de
 * wijziging niet) plus een `input`-event, en daarna focus zodat het menu
 * openklapt.
 *
 * Bewust hier en niet in het component: productiecode krijgt geen preview-haak.
 */
function typeahead(term) {
  const tick = (tries) => {
    const el = document.querySelector('.ag-att__input')
    if (!el) { if (tries > 0) setTimeout(() => tick(tries - 1), 60); return }
    const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set
    setter.call(el, term)
    el.dispatchEvent(new Event('input', { bubbles: true }))
    el.focus()
  }
  tick(20)
}
/** v1.216 — de Teams-schakelaar omzetten ná het renderen (zelfde reden als typeahead). */
function toggleTeams() {
  const tick = (tries) => {
    const el = document.querySelector('.ag-pop__toggle input, .m-agsheet__toggle input')
    if (!el) { if (tries > 0) setTimeout(() => tick(tries - 1), 60); return }
    el.click()
  }
  tick(20)
}
const CASE = CASES[pop]
if (CASE?.typeahead) typeahead(CASE.typeahead)
if (CASE?.toggleTeams) toggleTeams()
