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
import MobilePostvakCompose from '../../src/mobile/screens/MobilePostvakCompose'
import MobilePostvakFolders from '../../src/mobile/screens/MobilePostvakFolders'
import MobileMailSheet from '../../src/mobile/screens/MobileMailSheet'
import { buildInboxRows, bucketOf } from '../../src/lib/postvakContract'
import { inferPseudoAudience } from '../../src/lib/autodraft'
import { MAIL_MESSAGES, AUTODRAFT_MAILS, FOLDERS } from './mock-data.js'

// Preview-harnas Postvak. Desktop en mobiel lopen door hun éígen code; alleen
// `useAutoDraft` en de supabase-client zijn gestubt. De data is verzonnen — zie
// mock-data.js — maar heeft de verdeling van de echte mailbox: 16 Inbox-mails,
// 7 daarvan door Outlook op Overige gezet, 1 met een openstaand voorstel.
//
// ?view=desktop|mobile|swipe|menu|compose|taalcheck|verstuur|extern|fabmenu|mappen|mail
//        |mappen-open|mappen-top3|mail-headers|swipeup            (v1.217)
//        ?opt=a|b|c
//   opt  = designoptie voor de kop (v1.202). a = wat er in de code staat,
//          b en c zijn CSS-overlays over dezelfde DOM (chrome-opties.css).
//   swipe= de veegstrook open, met de échte rij-component.
//        ?swr=warm|koud                                                (v1.223)
//   swr  = de open-ervaring bevroren: warm = cache in beeld + "Bijwerken…",
//          koud = nog niets (skeleton; desktop mét boot-overlay, die pas op
//          data weggaat). Wordt in mock-useautodraft.js gelezen; desktop en
//          mobiel lopen door hun eigen code.
const qs = new URLSearchParams(location.search)
const view = qs.get('view') || 'desktop'
const opt = (qs.get('opt') || 'a').toLowerCase()
document.documentElement.classList.add('theme-light')

// Headless shots kunnen midden in een animatie vallen.
const st = document.createElement('style')
st.textContent = `
  .m-mailsheet, .m-compose, .m-sheet, .m-scrim, .pvk2 .dd { animation: none !important; transform: none !important; }
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
                         syncLabel="3 min geleden" syncing={false} onSync={() => {}}
                         onQuery={() => {}} onMode={() => {}} onClose={() => {}} />
    </div>
  )
}

// ── Compose-shots (v1.203) ──────────────────────────────────────────────────
// De sheet is de échte component; alleen de vingers zijn nagebootst. Een React-
// gestuurde <input> negeert een directe `.value =`, dus gaat het via de native
// setter + een 'input'-event — precies wat een toetsaanslag ook doet. Zo loopt
// de shot door dezelfde state-machine als een gebruiker, inclusief de taalcheck
// (mock-supabase levert de gecorrigeerde tekst) en de verstuur-blokkade.
function type(el, value) {
  if (!el) return
  const proto = el.tagName === 'TEXTAREA' ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype
  Object.getOwnPropertyDescriptor(proto, 'value').set.call(el, value)
  el.dispatchEvent(new Event('input', { bubbles: true }))
}

const DEMO_BODY = 'Hoi Marieke,\n\nDank voor je bericht. Ik kan ff kijken naar de '
  + 'licentie-opzet; mischien kan je me laten weten welke modules jullie nu '
  + 'gebruiken?\n\nlaat maar weten wat schikt.'

function Compose({ step }) {
  const [open, setOpen] = useState(false)
  useEffect(() => { setOpen(true) }, [])
  useEffect(() => {
    if (!open) return undefined
    const timers = []
    timers.push(setTimeout(() => {
      const ins = document.querySelectorAll('.m-compose__in')
      // Intern vs. extern is sinds v1.205 een zichtbaar verschil: bij een adres
      // buiten @legal-mind.nl verdwijnt de Verstuur-knop en komt de reden
      // eronder te staan. `?view=extern` schiet precies dat.
      type(ins[0], step === 'extern' ? 'marieke@voorbeeldadvocaten.nl' : 'jay@legal-mind.nl')
      type(ins[1], 'Licentie-opzet 2027')
      type(document.querySelector('.m-compose__ta'), DEMO_BODY)
    }, 120))
    if (step === 'taalcheck' || step === 'verstuur') {
      timers.push(setTimeout(() => {
        const sel = step === 'taalcheck' ? '.m-compose__chip--tc' : '.m-compose__send'
        document.querySelector(sel)?.click()
      }, 400))
    }
    return () => timers.forEach(clearTimeout)
  }, [open, step])
  return (
    <div className="shell shell--m theme-maestro" style={{ height: '100vh', background: '#f5f4f0' }}>
      <main className="m-main" style={{ display: 'flex', flexDirection: 'column', overflow: 'auto' }}>
        <MobilePostvak />
      </main>
      <MobilePostvakCompose open={open} onClose={() => {}} onSent={() => {}} />
    </div>
  )
}

// ── v1.205-shots ───────────────────────────────────────────────────────────
// De FAB-keuze en de mapkiezer zijn allebei een tik ver; in een headless shot
// is er geen vinger, dus de tik wordt geprogrammeerd op de échte knop. Niets
// nagebouwd: wat je ziet is wat de component rendert.
function FabMenu() {
  useEffect(() => {
    const t = setTimeout(() => document.querySelector('.m-fab')?.click(), 250)
    return () => clearTimeout(t)
  }, [])
  return <Mobile />
}

// v1.217: de mapkiezer onthoudt per gebruiker (localStorage-sleutel
// `postvak.mappen.v1:<uid>`; de stub-uid staat in mock-supabase). Drie standen:
//   mappen        koud — boom dicht, snelkeuze Archief + Verwijderde items
//   mappen-open   één groep uitgevouwen (de tik op de chevron van Inbox)
//   mappen-top3   met geleerde tellers → "Meest gebruikt", drie tegels
const PREFS_KEY = 'postvak.mappen.v1:00000000-0000-4000-8000-000000000001'
function Mappen({ stand }) {
  const [mail, setMail] = useState(null)
  useEffect(() => {
    try {
      localStorage.removeItem(PREFS_KEY)
      if (stand === 'top3') {
        localStorage.setItem(PREFS_KEY, JSON.stringify({
          open: [], gebruik: { 'Inbox/Klanten': 7, Archive: 4, "Inbox/Todo's": 2 },
        }))
      }
    } catch { /* headless zonder storage — dan de koude stand */ }
    const rows = buildInboxRows(MAIL_MESSAGES, AUTODRAFT_MAILS, { inferAudience: inferPseudoAudience })
    setMail(rows[1] || null)
    if (stand !== 'open') return undefined
    // Ná de eerste render, als de prefs (async uid) geladen zijn: de chevron
    // van Inbox — de eerste map met submappen — openklappen.
    const t = setTimeout(() => document.querySelector('.m-folders__tgl[aria-expanded]')?.click(), 300)
    return () => clearTimeout(t)
  }, [stand])
  return (
    <div className="shell shell--m theme-maestro" style={{ height: '100vh', background: '#f5f4f0' }}>
      <main className="m-main" style={{ display: 'flex', flexDirection: 'column', overflow: 'auto' }}>
        <MobilePostvak />
      </main>
      <MobilePostvakFolders open={!!mail} folders={FOLDERS} mail={mail} busy={false}
                            onPick={() => {}} onClose={() => {}} />
    </div>
  )
}

// Een echte veeg, geen nagebouwde: Chrome kent `Touch`/`TouchEvent`, en React
// luistert op de root, dus een gedispatchte reeks loopt door dezelfde handler
// als een vinger (zie geheugen: preview-harnas, echte gebaren).
function touch(el, type, x, y) {
  const t = new Touch({ identifier: 1, target: el, clientX: x, clientY: y })
  el.dispatchEvent(new TouchEvent(type, {
    bubbles: true, cancelable: true, touches: type === 'touchend' ? [] : [t], changedTouches: [t],
  }))
}

// De mail zelf, met vastmaken + verplaatsen in de kop. v1.217:
//   mail          zoals hij opent — alleen de afzender, headers dicht
//   mail-headers  na een tik op de afzender: Van / Aan / Cc / Datum open
//   swipeup       een worp van onder naar boven → onClose → de lijst is terug
function MailSheet({ stand }) {
  const [mail, setMail] = useState(null)
  useEffect(() => {
    const rows = buildInboxRows(MAIL_MESSAGES, AUTODRAFT_MAILS, { inferAudience: inferPseudoAudience })
    setMail(rows[0] || null)
    if (stand === 'headers') {
      const t = setTimeout(() => document.querySelector('.m-mailsheet__from--btn')?.click(), 250)
      return () => clearTimeout(t)
    }
    if (stand === 'swipeup') {
      // 900 → 120 px in ~60 ms: ruim boven de helft van het scherm, eindigend
      // in de bovenste strook, met een snelheid die geen leesveeg haalt.
      const timers = [
        setTimeout(() => { const el = document.querySelector('.m-mailsheet__body'); el && touch(el, 'touchstart', 200, 900) }, 250),
        setTimeout(() => { const el = document.querySelector('.m-mailsheet__body'); el && touch(el, 'touchmove', 200, 500) }, 280),
        setTimeout(() => { const el = document.querySelector('.m-mailsheet__body'); el && touch(el, 'touchend', 200, 120) }, 310),
      ]
      return () => timers.forEach(clearTimeout)
    }
    return undefined
  }, [stand])
  return (
    <div className="shell shell--m theme-maestro" style={{ height: '100vh', background: '#f5f4f0' }}>
      <main className="m-main" style={{ display: 'flex', flexDirection: 'column', overflow: 'auto' }}>
        <MobilePostvak />
      </main>
      {mail && (
        <MobileMailSheet mail={mail} catLabel={new Map()} pinned
                         onTogglePin={() => {}} onMove={() => {}} onClose={() => setMail(null)} />
      )}
    </div>
  )
}

const views = {
  desktop: <Desktop />, mobile: <Mobile />, swipe: <Swipe />, menu: <Menu />,
  compose: <Compose step="leeg" />,
  taalcheck: <Compose step="taalcheck" />,
  verstuur: <Compose step="verstuur" />,
  extern: <Compose step="extern" />,
  fabmenu: <FabMenu />,
  mappen: <Mappen stand="koud" />,
  'mappen-open': <Mappen stand="open" />,
  'mappen-top3': <Mappen stand="top3" />,
  mail: <MailSheet stand="dicht" />,
  'mail-headers': <MailSheet stand="headers" />,
  swipeup: <MailSheet stand="swipeup" />,
}

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
