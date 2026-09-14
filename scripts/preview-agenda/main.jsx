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
      {props && <AgendaEventPopover {...props} />}
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
          attendeeCount={props.attendees.length} write={write} onClose={() => {}}
        />
      )}
    </div>
  )
}

const [platform, pop] = view.split('-')
createRoot(document.getElementById('root')).render(
  <MemoryRouter initialEntries={['/agenda']}>
    {platform === 'mobile' ? <Mobile pop={pop} /> : <Desktop pop={pop} />}
  </MemoryRouter>
)
