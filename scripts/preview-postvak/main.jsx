import { MemoryRouter } from 'react-router-dom'
import { createRoot } from 'react-dom/client'
import '../../src/index.css'
import '../../src/mobile/mobile.css'
import Postvak2View from '../../src/components/views/postvak2/Postvak2View'
import MobilePostvak from '../../src/mobile/screens/MobilePostvak'

// Preview-harnas Postvak v1.197 (spoor 10, F0/F2). Desktop en mobiel door hun
// eigen code; alleen `useAutoDraft` en de supabase-client zijn gestubt. De
// data is verzonnen — zie mock-data.js — maar heeft de verdeling van de echte
// mailbox: 16 Inbox-mails, 7 daarvan door Outlook op Overige gezet, 1 met een
// openstaand AutoDraft-voorstel.
const view = new URLSearchParams(location.search).get('view') || 'desktop'
document.documentElement.classList.add('theme-light')

// Headless shots kunnen midden in een animatie vallen.
const st = document.createElement('style')
st.textContent = `
  .m-mailsheet, .m-scrim, .pvk2 .dd { animation: none !important; transform: none !important; }
  .pvk2 .pvk2-loader { display: none !important; }
`
document.head.appendChild(st)

function Desktop() {
  return <Postvak2View />
}

function Mobile() {
  return (
    <div className="shell shell--m theme-maestro" style={{ height: '100vh', background: '#f5f4f0' }}>
      <main className="m-main" style={{ display: 'flex', flexDirection: 'column', overflow: 'auto' }}>
        <MobilePostvak />
      </main>
    </div>
  )
}

const views = { desktop: <Desktop />, mobile: <Mobile /> }

createRoot(document.getElementById('root')).render(
  <MemoryRouter initialEntries={['/postvak']}>
    {views[view] || views.desktop}
  </MemoryRouter>
)
