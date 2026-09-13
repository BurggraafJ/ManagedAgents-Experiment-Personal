import { useEffect } from 'react'
import { createRoot } from 'react-dom/client'
import '../../src/index.css'
import '../../src/mobile/mobile.css'
import D9View from '../../src/components/views/stuurinformatie/d9/D9View'

// Preview-harnas voor docs/previews/d9-*.png.
//
// Dit rendert de ECHTE view én de echte hook (useD9Hygiene); alleen de
// netwerklaag is gestubt (vite.preview.config.js aliast lib/supabase naar
// ./mock-supabase.js). Een preview kan dus niet naast de code komen te staan:
// verandert de hook van view-naam of kolom, dan valt de screenshot om.
//
// Draaien:  npm run preview:d9   →  scripts/preview-d9/capture.sh
const view = new URLSearchParams(location.search).get('view') || 'desktop'
document.documentElement.classList.add('theme-light')

function Desktop() {
  return (
    <div className="theme-maestro" style={{ height: '100vh', display: 'flex', flexDirection: 'column' }}>
      <D9View />
    </div>
  )
}

function Mobile() {
  return (
    <div className="shell shell--m theme-maestro">
      <main className="m-main" style={{ display: 'flex', flexDirection: 'column' }}>
        <D9View />
      </main>
    </div>
  )
}

// Eén variant kiest de H5-regel, zodat het drill-pad (hero → check → records
// in het detailpaneel) op de screenshot te zien is. Sinds v1.180 is dat geen
// accordeon meer: de lijst blijft staan, alleen het paneel ernaast wisselt.
function Klik({ kies, children }) {
  useEffect(() => {
    const t = setTimeout(() => {
      const knop = Array.from(document.querySelectorAll(kies.selector))
        .find(el => !kies.tekst || el.textContent.includes(kies.tekst))
      knop?.click()
    }, 250)
    return () => clearTimeout(t)
  }, [kies])
  return children
}

const H5 = { selector: '.bs-rij--check', tekst: 'H5' }
const ONTBREEKT = { selector: '.dsb__disclosure' }

const views = {
  desktop:           <Desktop />,
  'desktop-drill':   <Klik kies={H5}><Desktop /></Klik>,
  'desktop-ontbreekt': <Klik kies={ONTBREEKT}><Desktop /></Klik>,
  mobile:            <Mobile />,
  'mobile-drill':    <Klik kies={H5}><Mobile /></Klik>,
}

createRoot(document.getElementById('root')).render(views[view] || views.desktop)
