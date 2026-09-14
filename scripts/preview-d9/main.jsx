import { useEffect } from 'react'
import { MemoryRouter } from 'react-router-dom'
import { createRoot } from 'react-dom/client'
import '../../src/index.css'
import '../../src/mobile/mobile.css'
import D9View from '../../src/components/views/stuurinformatie/d9/D9View'
import InShell from '../preview-shared/InShell'

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
const ONTBREEKT = { selector: '.dsb__sync' }

// ?meet=1 — de budgetten uit bouwproces.md stap 8 gemeten in plaats van
// geschat: hoogte kop + antwoord, documenthoogte, woorden per zone. Schrijft
// JSON in <pre id="meet"> zodat `chrome --dump-dom` het meeneemt. Alleen
// harnas, geen productcode.
function Meet({ children }) {
  useEffect(() => {
    const t = setTimeout(() => {
      const bs = document.querySelector('.bs')
      const rect = sel => document.querySelector(sel)?.getBoundingClientRect()
      const top = bs ? bs.getBoundingClientRect().top : 0
      const woorden = z => (z.innerText || '').split(/\s+/).filter(w => /[a-z]{2}/i.test(w)).length
      const uit = {
        viewport: [window.innerWidth, window.innerHeight],
        scrollHeight: document.documentElement.scrollHeight,
        paginaScrollt: document.documentElement.scrollHeight > window.innerHeight,
        kopBottom: Math.round((rect('.bs__kop')?.bottom ?? 0) - top),
        // De twee kopregels apart: sinds v1.188 draagt de kop terug, filters en
        // vertrouwen, en dan wil je bij een overschrijding weten wélke regel
        // groeide in plaats van alleen dát de eerste blik te hoog is.
        kopBoven: Math.round(rect('.bs__kop-boven')?.height ?? 0),
        kopOnder: Math.round(rect('.bs__kop-onder')?.height ?? 0),
        antwoordBottom: Math.round((rect('.bs__antwoord')?.bottom ?? 0) - top),
        kernzinBottom: Math.round((rect('.bs__kernzin')?.bottom ?? 0) - top),
        werkTop: Math.round((rect('.bs__werk')?.top ?? 0) - top),
        heroHoogte: Math.round(rect('.mc')?.height ?? 0),
        rijHoogtes: [...new Set(Array.from(document.querySelectorAll('.bs-rij--check')).map(r => Math.round(r.getBoundingClientRect().height)))],
        woordenPerZone: Array.from(document.querySelectorAll('[data-zone]')).map(z => [z.dataset.zone, woorden(z)]),
        persoonsvormZinnenZone2: (document.querySelector('.bs__antwoord')?.innerText || '') + ' || ' + (document.querySelector('.bs__kernzin')?.innerText || ''),
      }
      const pre = document.createElement('pre')
      pre.id = 'meet'
      pre.textContent = JSON.stringify(uit, null, 2)
      document.body.appendChild(pre)
    }, 600)
    return () => clearTimeout(t)
  }, [])
  return children
}

const views = {
  desktop:           <Desktop />,
  'desktop-drill':   <Klik kies={H5}><Desktop /></Klik>,
  'desktop-ontbreekt': <Klik kies={ONTBREEKT}><Desktop /></Klik>,
  // Door de echte desktop-chrome (v1.189): review-shot, geen meetbasis.
  shell:             <InShell title="Datakwaliteit & hygiëne" activeView="datakwaliteit"><D9View /></InShell>,
  mobile:            <Mobile />,
  'mobile-drill':    <Klik kies={H5}><Mobile /></Klik>,
}

const meet = new URLSearchParams(location.search).get('meet') === '1'
const boom = views[view] || views.desktop
// MemoryRouter sinds v1.188: de kop draagt een terugknop en een zusterpagina,
// en dus gebruikt de view `useNavigate`. Zonder router gooit die hook en blijft
// het harnas een leeg vlak — een blanco PNG zonder foutmelding, precies het
// soort stilte waar dit harnas voor bedoeld is om hem te vermijden.
createRoot(document.getElementById('root')).render(
  <MemoryRouter initialEntries={['/pipeline/hygiene']}>
    {meet ? <Meet>{boom}</Meet> : boom}
  </MemoryRouter>
)
