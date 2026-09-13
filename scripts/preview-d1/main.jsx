import { useEffect } from 'react'
import { MemoryRouter } from 'react-router-dom'
import { createRoot } from 'react-dom/client'
import '../../src/index.css'
import '../../src/mobile/mobile.css'
import D1View from '../../src/components/views/stuurinformatie/d1/D1View'

// Preview-harnas voor docs/previews/d1-*.png.
//
// Dit rendert de ECHTE view én de echte hook (useD1Pipeline); alleen de
// netwerklaag is gestubt (vite.preview.config.js aliast lib/supabase naar
// ./mock-supabase.js). Een preview kan dus niet naast de code komen te staan:
// verandert de hook van view-naam of kolom, dan valt de screenshot om.
//
// MemoryRouter omdat D1View `useNavigate` gebruikt voor de sprong naar D9;
// zonder router-context klapt de render eruit.
//
// Draaien:  npm run preview:d1   →  scripts/preview-d1/capture.sh
const view = new URLSearchParams(location.search).get('view') || 'desktop'
document.documentElement.classList.add('theme-light')

function Desktop() {
  return (
    <div className="theme-maestro" style={{ height: '100vh', display: 'flex', flexDirection: 'column' }}>
      <D1View />
    </div>
  )
}

function Mobile() {
  return (
    <div className="shell shell--m theme-maestro">
      <main className="m-main" style={{ display: 'flex', flexDirection: 'column' }}>
        <D1View />
      </main>
    </div>
  )
}

// Eén variant opent de lege werkbordlijst ("Verlopen beslisdatum · 0"), zodat
// op de screenshot te zien is dat een lege lijst een gemeten nul is en geen
// verdwenen tab.
function LegeLijst({ children }) {
  useEffect(() => {
    // Blijven proberen tot de tab er is. Met --virtual-time-budget loopt de
    // klok sneller dan de (echte) microtasks van de hook, dus één setTimeout
    // vuurt soms vóór de eerste render met data — en dan mist de shot stil zijn
    // hele punt.
    const id = setInterval(() => {
      const knop = Array.from(document.querySelectorAll('.d1-wb__tabs .d1-tab'))
        .find(el => el.textContent.includes('Verlopen beslisdatum'))
      if (knop) { knop.click(); clearInterval(id) }
    }, 60)
    return () => clearInterval(id)
  }, [])
  return children
}

const views = {
  desktop:      <Desktop />,
  'desktop-werkbord': <LegeLijst><Desktop /></LegeLijst>,
  mobile:       <Mobile />,
}

createRoot(document.getElementById('root')).render(
  <MemoryRouter initialEntries={['/pipeline']}>
    {views[view] || views.desktop}
  </MemoryRouter>
)
