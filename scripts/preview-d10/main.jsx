import { useEffect } from 'react'
import { MemoryRouter } from 'react-router-dom'
import { createRoot } from 'react-dom/client'
import '../../src/index.css'
import '../../src/mobile/mobile.css'
import D10View from '../../src/components/views/stuurinformatie/d10/D10View'

// Preview-harnas voor docs/previews/d10-*.png.
//
// Dit rendert de ECHTE D10View (pure stuurbord sinds v1.178) en de echte
// useD10Verlies-hook. Alleen de netwerklaag is gestubt
// (vite.preview.config.js aliast lib/supabase naar ./mock-supabase.js). Een
// preview kan dus niet naast de code komen te staan: verandert een hook van
// view-naam of kolom, dan valt de screenshot om.
//
// MemoryRouter omdat de view `useNavigate` gebruikt (dossier openen, en de
// sprong van de datastatus-regel naar D9); zonder router-context klapt de
// render eruit.
//
// Draaien:  npm run preview:d10   →  scripts/preview-d10/capture.sh
const view = new URLSearchParams(location.search).get('view') || 'desktop'
document.documentElement.classList.add('theme-light')

function Desktop() {
  return (
    <div className="theme-maestro" style={{ height: '100vh', display: 'flex', flexDirection: 'column' }}>
      <D10View />
    </div>
  )
}

function Mobile() {
  return (
    <div className="shell shell--m theme-maestro">
      <main className="m-main" style={{ display: 'flex', flexDirection: 'column' }}>
        <D10View />
      </main>
    </div>
  )
}

// Eén variant opent de lijst "Verlengmoment verstreken", zodat op de screenshot
// te zien is dat de tabteller ook op een lijst zonder werk blijft staan en dat
// de uitleg per lijst meeschuift.
function Tab({ label, children }) {
  useEffect(() => {
    // Blijven proberen tot de tab er is. Met --virtual-time-budget loopt de klok
    // sneller dan de (echte) microtasks van de hook, dus één setTimeout vuurt
    // soms vóór de eerste render met data — en dan mist de shot stil zijn punt.
    const id = setInterval(() => {
      const knop = Array.from(document.querySelectorAll('.d10-tab'))
        .find(el => el.textContent.includes(label))
      if (knop) { knop.click(); clearInterval(id) }
    }, 60)
    return () => clearInterval(id)
  }, [label])
  return children
}

const views = {
  desktop: <Desktop />,
  'desktop-verleng': <Tab label="Verlengmoment < 90 dagen"><Desktop /></Tab>,
  mobile: <Mobile />,
}

createRoot(document.getElementById('root')).render(
  <MemoryRouter initialEntries={['/klantverlies']}>
    {views[view] || views.desktop}
  </MemoryRouter>
)
