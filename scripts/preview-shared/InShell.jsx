import AppShell from '../../src/components/shell/AppShell'
import { VIEWS, NAV_GROUPS } from '../../src/routes/viewRegistry'

// Een bord door de échte desktop-chrome (espresso-sidebar + topbalk), zoals
// prod het toont — alleen voor de review-shot `?view=shell` van de
// preview-harnassen (v1.189). De losse `desktop`-view blijft de meetbasis van
// `npm run meet`: zonder sidebar is het bord 1440 breed en zijn de metingen
// vergelijkbaar met de eerdere versies.
//
// `title`/`topBack`/`crumb` zijn hier hard: de harnas heeft geen router-
// locatie waar Dashboard.jsx ze uit afleidt (parentFor). Wat je ziet is dus
// wél de echte TopBar en de echte AppShell, met dezelfde props als
// Dashboard.jsx op die route geeft — `back` is de ouder van de pagina
// (Dashboard voor een bord, Pipeline voor de kwartaaldiagnose, v1.191).
const profile = { display_name: 'Jelle Burggraaf', role: 'owner' }

export default function InShell({ title, activeView, back = 'Dashboard', crumb = null, children }) {
  return (
    <div className="theme-maestro" style={{ height: '100vh' }}>
      <AppShell
        views={VIEWS}
        groups={NAV_GROUPS}
        activeView={activeView}
        onSelect={() => {}}
        title={title}
        crumb={crumb}
        topBack={{ label: back, onClick: () => {} }}
        profile={profile}
        onLogout={() => {}}
        mainClassName="main--full"
      >
        {children}
      </AppShell>
    </div>
  )
}
