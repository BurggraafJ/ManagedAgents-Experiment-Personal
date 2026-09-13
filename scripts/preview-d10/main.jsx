import { useEffect } from 'react'
import { MemoryRouter } from 'react-router-dom'
import { createRoot } from 'react-dom/client'
import '../../src/index.css'
import '../../src/mobile/mobile.css'
import D10View from '../../src/components/views/stuurinformatie/d10/D10View'

// Preview-harnas voor docs/previews/d10-*.png.
//
// Dit rendert de ECHTE D10View op BordShell (v1.182) en de echte
// useD10Verlies-hook. Alleen de netwerklaag is gestubt
// (vite.preview.config.js aliast lib/supabase naar ./mock-supabase.js). Een
// preview kan dus niet naast de code komen te staan: verandert een hook van
// view-naam of kolom, dan valt de screenshot om.
//
// MemoryRouter omdat de view `useNavigate` gebruikt (dossier openen, de sprong
// naar D1 in de subregel en naar D9 in de kopregel); zonder router-context
// klapt de render eruit.
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

/**
 * Klikt een reeks knoppen aan zodra ze bestaan. Blijven proberen in plaats van
 * één setTimeout: met `--virtual-time-budget` loopt de klok sneller dan de
 * (echte) microtasks van de hook, dus één timer vuurt soms vóór de eerste
 * render met data — en dan mist de shot stil zijn punt.
 *
 * Elke stap wacht op de vórige, want de rij die de tweede stap zoekt bestaat
 * pas nadat de snede van de eerste gekozen is.
 */
function Klik({ stappen, children }) {
  useEffect(() => {
    let stap = 0
    const id = setInterval(() => {
      if (stap >= stappen.length) { clearInterval(id); return }
      const [selector, tekst] = stappen[stap]
      const el = Array.from(document.querySelectorAll(selector))
        .find(n => !tekst || n.textContent.includes(tekst))
      if (el) { el.click(); stap += 1 }
    }, 60)
    return () => clearInterval(id)
  }, [stappen])
  return children
}

const views = {
  // Zoals je binnenkomt: snede "wie staat op het punt", leeg detailpaneel.
  desktop: <Desktop />,

  // Het drill-pad: een CS-lijst gekozen, de kantoren in het paneel ernaast.
  drill: (
    <Klik stappen={[['.d10-rij', 'Proef voorbij']]}><Desktop /></Klik>
  ),

  // De snede waarom, met de gatregel gekozen — de plek waar dit bord gedrag
  // afdwingt dat de data vandaag niet levert.
  waarom: (
    <Klik stappen={[['.bs-snede__knop', 'waarom'], ['.d10-rij', 'Concurrent gekozen']]}>
      <Desktop />
    </Klik>
  ),

  // Dertien maanden, drie reeksen náást elkaar; één maand opengeklikt.
  trend: (
    <Klik stappen={[['.bs-snede__knop', '13 maanden'], ['.d10-rij', 'jul 26']]}>
      <Desktop />
    </Klik>
  ),

  // De twee vragen die vandaag niet te beantwoorden zijn, in het paneel.
  leeg: (
    <Klik stappen={[['.bs-rij--blok', 'Niet te maken']]}><Desktop /></Klik>
  ),

  // De disclosure van de vertrouwensregel: precies zoveel regels als de teller
  // belooft.
  ontbreekt: (
    <Klik stappen={[['.dsb__disclosure', 'Wat ontbreekt']]}><Desktop /></Klik>
  ),

  mobile: <Mobile />,
}

createRoot(document.getElementById('root')).render(
  <MemoryRouter initialEntries={['/klantverlies']}>
    {views[view] || views.desktop}
  </MemoryRouter>
)
