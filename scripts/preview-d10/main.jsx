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
    <Klik stappen={[['.bs-snede__knop', '13 maanden'], ['.c7__rij', 'jul 26']]}>
      <Desktop />
    </Klik>
  ),

  // Snede wanneer met B gekozen: C9 (puntenrij, mediaan, B/C-grens) boven de
  // records in zone 4 — de grootste inhoudelijke winst van v1.187.
  wanneer: (
    <Klik stappen={[['.bs-snede__knop', 'wanneer'], ['.d10-rij', 'B · Proef']]}>
      <Desktop />
    </Klik>
  ),

  // Snede wanneer met A gekozen: 57 records → histogram, geen norm (andere grondslag).
  wanneerA: (
    <Klik stappen={[['.bs-snede__knop', 'wanneer'], ['.d10-rij', 'A · Prospect']]}>
      <Desktop />
    </Klik>
  ),

  // Het paginafilter op "deze maand": één stand voor het hele bord; waarom en
  // wanneer staan zichtbaar uit (F7), de trend toont alleen de lopende maand.
  maand: (
    <Klik stappen={[['.bs-filter__knop', 'deze maand'], ['.bs-snede__knop', 'per maand']]}>
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

// ?meet=1 — de budgetten uit bouwproces.md stap 8 gemeten in plaats van
// geschat (zelfde harnas als preview-d9 en preview-d1). Schrijft JSON in
// <pre id="meet"> zodat `chrome --dump-dom` het meeneemt. Alleen harnas.
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
        filterBottom: Math.round((rect('.bs__filter')?.bottom ?? 0) - top),
        antwoordBottom: Math.round((rect('.bs__antwoord')?.bottom ?? 0) - top),
        kernzinBottom: Math.round((rect('.d10-subregel')?.bottom ?? 0) - top),
        werkTop: Math.round((rect('.bs__werk')?.top ?? 0) - top),
        kaartHoogtes: Array.from(document.querySelectorAll('.bs__antwoord > .mc')).map(k => Math.round(k.getBoundingClientRect().height)),
        rijHoogtes: [...new Set(Array.from(document.querySelectorAll('.bs-rij, .c7__rij, .c4__rij')).map(r => Math.round(r.getBoundingClientRect().height)))],
        c9Hoogte: Math.round(rect('.c9')?.height ?? 0),
        woordenPerZone: Array.from(document.querySelectorAll('[data-zone]')).map(z => [z.dataset.zone, woorden(z)]),
        zone2Tekst: (document.querySelector('.bs__antwoord')?.innerText || '').replace(/\n+/g, ' | '),
        kernzin: document.querySelector('.bs__kernzin')?.innerText || '',
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

const meet = new URLSearchParams(location.search).get('meet') === '1'
const boom = views[view] || views.desktop
createRoot(document.getElementById('root')).render(
  <MemoryRouter initialEntries={['/klantverlies']}>
    {meet ? <Meet>{boom}</Meet> : boom}
  </MemoryRouter>
)
