import { useEffect } from 'react'
import { MemoryRouter } from 'react-router-dom'
import { createRoot } from 'react-dom/client'
import '../../src/index.css'
import '../../src/mobile/mobile.css'
import D1View from '../../src/components/views/stuurinformatie/d1/D1View'
import D1Kwartaal from '../../src/components/views/stuurinformatie/d1/D1Kwartaal'
import InShell from '../preview-shared/InShell'

// Preview-harnas voor docs/previews/d1-*.png (Live-bord, Design ronde 5).
//
// Dit rendert de ECHTE view én de echte hook (useD1Pipeline); alleen de
// netwerklaag is gestubt (vite.preview.config.js aliast lib/supabase naar
// ./mock-supabase.js, gevoed met de prod-rijen van 15-09-2026). Verandert de
// hook van view-naam of kolom, dan valt de screenshot om — en dat is de
// bedoeling.
//
// Draaien:  npm run preview:d1   →  scripts/preview-d1/capture.sh
const params = new URLSearchParams(location.search)
const view = params.get('view') || 'desktop'
document.documentElement.classList.add('theme-light')

function Desktop({ children }) {
  return (
    <div className="theme-maestro" style={{ height: '100vh', display: 'flex', flexDirection: 'column' }}>
      {children || <D1View />}
    </div>
  )
}

function Mobile({ children }) {
  return (
    <div className="shell shell--m theme-maestro">
      <main className="m-main" style={{ display: 'flex', flexDirection: 'column' }}>
        {children || <D1View />}
      </main>
    </div>
  )
}

/**
 * Klik (of focus) achtereenvolgens de elementen die `stappen` opleveren, zodra
 * ze bestaan. Blijven proberen en niet één setTimeout: met
 * --virtual-time-budget loopt de klok sneller dan de microtasks van de hook.
 */
function Doe({ stappen, children }) {
  useEffect(() => {
    let i = 0
    const id = setInterval(() => {
      const stap = stappen[i]
      if (!stap) { clearInterval(id); return }
      const el = stap.vind()
      // SVG-elementen hebben geen .click(): een echte MouseEvent bubbelt naar
      // React's delegatie, voor <rect> en <path> net zo goed als voor <button>.
      if (el) {
        if ((stap.actie || 'click') === 'focus') el.focus()
        else el.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, view: window }))
        i += 1
      }
    }, 80)
    return () => clearInterval(id)
  }, [stappen])
  return children
}

const knop = tekst => () => Array.from(document.querySelectorAll('button')).find(b => b.textContent.trim() === tekst)
const aria = prefix => () => Array.from(document.querySelectorAll('[aria-label]')).find(el => el.getAttribute('aria-label').startsWith(prefix))
const legenda = tekst => () => Array.from(document.querySelectorAll('.dl-klegenda__rij')).find(el => el.textContent.includes(tekst))
const sync = () => document.querySelector('.dsb__sync')

const views = {
  // Zoals je het bord binnenkomt: Deals, lege sink.
  desktop: <Desktop />,
  // Toggle Licenties: units wisselen, Waarde-kaart erbij.
  licenties: <Doe stappen={[{ vind: knop('Licenties') }]}><Desktop /></Doe>,
  // Fase 3 in Tijd in fase geklikt → sink `Fase 3 · aging` (Design detail-fase3).
  'detail-fase3': <Doe stappen={[{ vind: aria('Fase 3') }]}><Desktop /></Doe>,
  // Legenda-rij Onbekend van de donut → hygiënelijst.
  kanaal: <Doe stappen={[{ vind: legenda('Onbekend') }]}><Desktop /></Doe>,
  // Week 36 in Kennismakingen (3 gehouden) → sink met de kennismakingen.
  week: <Doe stappen={[{ vind: aria('36 ·') }]}><Desktop /></Doe>,
  // Hover-tooltip: focus op de W36-staaf toont dezelfde tip als de muis.
  hover: <Doe stappen={[{ vind: aria('36 ·'), actie: 'focus' }]}><Desktop /></Doe>,
  // Door de echte desktop-chrome (sidebar + topbalk), Deals en Licenties.
  shell: <InShell title="Pipeline & forecast" activeView="pipeline"><D1View /></InShell>,
  'shell-licenties': <InShell title="Pipeline & forecast" activeView="pipeline"><Doe stappen={[{ vind: knop('Licenties') }]}><D1View /></Doe></InShell>,
  'shell-detail': <InShell title="Pipeline & forecast" activeView="pipeline"><Doe stappen={[{ vind: aria('Fase 3') }]}><D1View /></Doe></InShell>,
  'shell-sync': <InShell title="Pipeline & forecast" activeView="pipeline"><Doe stappen={[{ vind: sync }]}><D1View /></Doe></InShell>,
  'shell-monthly': <InShell title="Pipeline · Monthly" activeView="pipeline_kwartaal" back="Pipeline" crumb="Pipeline / Monthly"><D1Kwartaal /></InShell>,
  mobile: <Mobile />,
  'mobile-detail': <Mobile><Doe stappen={[{ vind: aria('Fase 3') }]}><D1View /></Doe></Mobile>,
}

// ?meet=1 — budgetten gemeten in plaats van geschat (bouwproces.md stap 8).
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
        werkTop: Math.round((rect('.bs__werk')?.top ?? 0) - top),
        kaarten: Array.from(document.querySelectorAll('.dl-kaart')).map(k => [k.className.replace('dl-kaart ', ''), Math.round(k.getBoundingClientRect().width), Math.round(k.getBoundingClientRect().height), k.scrollHeight > k.clientHeight + 1]),
        lijven: Array.from(document.querySelectorAll(".dl-kaart__lijf")).map(l => [Math.round(l.getBoundingClientRect().height), l.querySelector("svg")?.getAttribute("height") ?? null]),
        woordenPerZone: Array.from(document.querySelectorAll('[data-zone]')).map(z => [z.dataset.zone, woorden(z)]),
      }
      const pre = document.createElement('pre')
      pre.id = 'meet'
      pre.textContent = JSON.stringify(uit, null, 2)
      document.body.appendChild(pre)
    }, 900)
    return () => clearTimeout(t)
  }, [])
  return children
}

const meet = params.get('meet') === '1'
const boom = views[view] || views.desktop
createRoot(document.getElementById('root')).render(
  <MemoryRouter initialEntries={['/pipeline']}>
    {meet ? <Meet>{boom}</Meet> : boom}
  </MemoryRouter>
)
