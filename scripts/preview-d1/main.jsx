import { useEffect } from 'react'
import { MemoryRouter } from 'react-router-dom'
import { createRoot } from 'react-dom/client'
import '../../src/index.css'
import '../../src/mobile/mobile.css'
import D1View from '../../src/components/views/stuurinformatie/d1/D1View'
import D1Kwartaal from '../../src/components/views/stuurinformatie/d1/D1Kwartaal'

// Preview-harnas voor docs/previews/d1-*.png.
//
// Dit rendert de ECHTE view én de echte hook (useD1Pipeline); alleen de
// netwerklaag is gestubt (vite.preview.config.js aliast lib/supabase naar
// ./mock-supabase.js). Een preview kan dus niet naast de code komen te staan:
// verandert de hook van view-naam of kolom, dan valt de screenshot om.
//
// MemoryRouter omdat D1View `useNavigate` gebruikt voor de sprong naar D9 en
// naar de kwartaaldiagnose; zonder router-context klapt de render eruit.
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

/**
 * Klik op het eerste element dat aan `vind` voldoet, zodra het bestaat.
 *
 * Blijven proberen en niet één setTimeout: met --virtual-time-budget loopt de
 * klok sneller dan de (echte) microtasks van de hook, dus een enkele timer
 * vuurt soms vóór de eerste render met data — en dan mist de shot stil zijn
 * hele punt.
 */
function Klik({ vind, children }) {
  useEffect(() => {
    const id = setInterval(() => {
      const el = vind()
      if (el) { el.click(); clearInterval(id) }
    }, 60)
    return () => clearInterval(id)
  }, [vind])
  return children
}

const maandrij = () => Array.from(document.querySelectorAll('.d1-rij'))
  .find(el => el.textContent.includes('nov'))

const legeTeller = () => Array.from(document.querySelectorAll('.d1-teller'))
  .find(el => el.textContent.includes('Verlopen beslisdatum'))

const ontbreekt = () => document.querySelector('.dsb__disclosure')

/**
 * Zet focus op één slot van de C1-periodestrip: focus is het toetsenbord-
 * equivalent van hover en toont dezelfde tooltip (onder de tijdas). Zo staat
 * de hover-staat van de strip op de shot zonder muis.
 */
function Focus({ vind, children }) {
  useEffect(() => {
    const id = setInterval(() => {
      const el = vind()
      if (el) { el.focus(); clearInterval(id) }
    }, 60)
    return () => clearInterval(id)
  }, [vind])
  return children
}
const stripSlot = () => document.querySelectorAll('.c1__slot')[9] || null

const views = {
  // Zoals je het bord binnenkomt: leeg detailpaneel, want het detail is een
  // vervolgvraag en er wordt nooit automatisch een regel gekozen.
  desktop: <Desktop />,
  // Gedrilld: november gekozen, de deals staan in het paneel ernaast en de
  // lijst links is niet uit elkaar geduwd.
  'desktop-drill': <Klik vind={maandrij}><Desktop /></Klik>,
  // De lege werklijst ("Verlopen beslisdatum · 0"), zodat op de shot te zien is
  // dat een lege lijst een gemeten nul is en geen verdwenen teller.
  'desktop-werk': <Klik vind={legeTeller}><Desktop /></Klik>,
  // De vertrouwensregel opengeklapt: wat ontbreekt er, en hoeveel.
  'desktop-ontbreekt': <Klik vind={ontbreekt}><Desktop /></Klik>,
  // De C1-strip met een week in focus: de tooltip valt onder de tijdas, het
  // cijfer op de waarderij kleurt mee met de staaf.
  'desktop-strip': <Focus vind={stripSlot}><Desktop /></Focus>,
  // De kwartaaldiagnose op /pipeline/kwartaal: de bestemming van de win-rate-
  // hoeken, de dekking, de stage-ontleding en de salescyclus.
  kwartaal: (
    <div className="theme-maestro" style={{ height: '100vh', display: 'flex', flexDirection: 'column' }}>
      <D1Kwartaal />
    </div>
  ),
  mobile: <Mobile />,
}

createRoot(document.getElementById('root')).render(
  <MemoryRouter initialEntries={['/pipeline']}>
    {views[view] || views.desktop}
  </MemoryRouter>
)
