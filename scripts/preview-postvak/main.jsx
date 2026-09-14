import { useEffect, useState } from 'react'
import { MemoryRouter } from 'react-router-dom'
import { createRoot } from 'react-dom/client'
import '../../src/index.css'
import '../../src/mobile/mobile.css'
import './chrome-opties.css'
import Postvak2View from '../../src/components/views/postvak2/Postvak2View'
import MobilePostvak from '../../src/mobile/screens/MobilePostvak'
import MobilePostvakRow from '../../src/mobile/screens/MobilePostvakRow'
import MobilePostvakMenu from '../../src/mobile/screens/MobilePostvakMenu'
import { buildInboxRows, bucketOf } from '../../src/lib/postvakContract'
import { inferPseudoAudience } from '../../src/lib/autodraft'
import { MAIL_MESSAGES, AUTODRAFT_MAILS } from './mock-data.js'

// Preview-harnas Postvak. Desktop en mobiel lopen door hun éígen code; alleen
// `useAutoDraft` en de supabase-client zijn gestubt. De data is verzonnen — zie
// mock-data.js — maar heeft de verdeling van de echte mailbox: 16 Inbox-mails,
// 7 daarvan door Outlook op Overige gezet, 1 met een openstaand voorstel.
//
// ?view=desktop|mobile|swipe  ?opt=a|b|c  ?rule=oud
//   opt  = designoptie voor de kop (v1.202). a = wat er in de code staat,
//          b en c zijn CSS-overlays over dezelfde DOM (chrome-opties.css).
//   swipe= de veegstrook open, met de échte rij-component.
const qs = new URLSearchParams(location.search)
const view = qs.get('view') || 'desktop'
const opt = (qs.get('opt') || 'a').toLowerCase()
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

// De veegstrook is een gebaar; in een headless shot is er geen vinger. Daarom
// rendert deze weergave de échte rij-component (MobilePostvakRow) met één rij
// in de open stand — geen nagebouwde markup, alleen een andere begintoestand.
function Swipe() {
  const rows = buildInboxRows(MAIL_MESSAGES, AUTODRAFT_MAILS, { inferAudience: inferPseudoAudience }).slice(0, 5)
  const openId = rows[1]?.mail_id
  return (
    <div className="shell shell--m theme-maestro" style={{ height: '100vh', background: '#f5f4f0' }}>
      <main className="m-main" style={{ display: 'flex', flexDirection: 'column', overflow: 'auto' }}>
        <div className="m-dash">
          <header className="m-pv__head">
            <div className="m-tk__head-top">
              <div className="m-tk__eyebrow">WERKRUIMTE<span>Postvak</span></div>
            </div>
            <div className="m-pvseg m-tk__seg" role="tablist">
              <button type="button" className="m-pvseg__btn is-active">Prioriteit<span className="m-tk__segcnt">9</span></button>
              <button type="button" className="m-pvseg__btn">Overige<span className="m-tk__segcnt">7</span></button>
            </div>
          </header>
          <div className="m-pv__body">
            {rows.map(m => (
              <MobilePostvakRow key={m.mail_id} mail={m} bucket={bucketOf(m)}
                                open={m.mail_id === openId} onSwipe={() => {}} onOpen={() => {}} />
            ))}
          </div>
        </div>
      </main>
    </div>
  )
}

// Het overloopmenu waar Verzonden en zoeken in zitten. Echte component, open
// gerenderd — in een shot is er geen tik op de ⋯.
//
// Pas ná de eerste render openen: de sheet portaleert naar `.shell--m`, en bij
// de allereerste render staat die nog niet in het document. Dan valt hij terug
// op <body>, waar geen enkele --m-token bestaat en de sheet dus zonder
// achtergrond schildert (eerste poging aan deze shot, zichtbaar gemaakt).
function Menu() {
  const [open, setOpen] = useState(false)
  useEffect(() => { setOpen(true) }, [])
  return (
    <div className="shell shell--m theme-maestro" style={{ height: '100vh', background: '#f5f4f0' }}>
      <main className="m-main" style={{ display: 'flex', flexDirection: 'column', overflow: 'auto' }}>
        <MobilePostvak />
      </main>
      <MobilePostvakMenu open={open} mode="inbox" query="" sentCount={2}
                         onQuery={() => {}} onMode={() => {}} onClose={() => {}} />
    </div>
  )
}

const views = { desktop: <Desktop />, mobile: <Mobile />, swipe: <Swipe />, menu: <Menu /> }

createRoot(document.getElementById('root')).render(
  <MemoryRouter initialEntries={['/postvak']}>
    <div className={`opt-${opt}`} style={{ display: 'contents' }}>
      {views[view] || views.desktop}
    </div>
  </MemoryRouter>,
)

// ?meet=1 — de kop gemeten in plaats van geschat (zelfde afspraak als
// scripts/meet-eerste-blik.sh). Wat een kop-optie kost, staat in px en in
// hele mailrijen; daar gaat de keuze tussen A, B en C over.
if (qs.get('meet') === '1') {
  setTimeout(() => {
    const head = document.querySelector('.m-pv__head') || document.querySelector('.list-head')
    const rows = [...document.querySelectorAll('.m-swipe, .list-scroll .row')]
    const vh = window.innerHeight
    const heel = rows.filter(r => r.getBoundingClientRect().bottom <= vh).length
    const pre = document.createElement('pre')
    pre.id = 'meet'
    pre.textContent = JSON.stringify({
      optie: opt,
      weergave: view,
      kop_px: head ? Math.round(head.getBoundingClientRect().height) : null,
      eerste_rij_op_px: rows[0] ? Math.round(rows[0].getBoundingClientRect().top) : null,
      hele_rijen_in_beeld: heel,
      viewport: `${window.innerWidth}×${vh}`,
    }, null, 1)
    document.body.appendChild(pre)
  }, 1200)
}
