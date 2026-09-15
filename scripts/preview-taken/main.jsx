import { useEffect, useState } from 'react'
import { MemoryRouter } from 'react-router-dom'
import { createRoot } from 'react-dom/client'
import '../../src/index.css'
import '../../src/mobile/mobile.css'
import './proof.css'
import TakenV2View from '../../src/components/views/taken-v2/TakenV2View'
import MobileTaken from '../../src/mobile/screens/MobileTaken'
import { writes } from './mock-supabase.js'

// Preview-harnas Taken (v1.205, spoor "slepen + detail").
//
// Desktop en mobiel lopen door hun éígen code; alleen de supabase-client is
// gestubt — en die stub is schrijfbaar, zodat een sleep écht een update
// oplevert die je in beeld kunt laten zien (?log=1).
//
// ?view=desktop|mobile
// ?act=drag|drop|detail   — een échte reeks events op de echte componenten:
//     drag   = midden in de sleep (bron vervaagd, doelgroep opgelicht)
//     drop   = idem, maar losgelaten: de taak staat in de andere groep
//     detail = het detail open (zijpaneel op desktop, sheet op mobiel)
// ?log=1                  — toon wat er is weggeschreven, als bewijs.
const qs = new URLSearchParams(location.search)
const view = qs.get('view') || 'desktop'
const act = qs.get('act') || null
const showLog = qs.get('log') === '1'
document.documentElement.classList.add('theme-light')

// Headless shots vallen makkelijk midden in een animatie.
const st = document.createElement('style')
st.textContent = `
  *, *::before, *::after { animation-duration: 0s !important; animation-delay: 0s !important; transition: none !important; }
`
document.head.appendChild(st)

const sleep = (ms) => new Promise(r => setTimeout(r, ms))
const rect = (el) => el.getBoundingClientRect()

/* ── Desktop: HTML5 drag-and-drop ──────────────────────────────────────── */
async function desktopDrag({ drop, zone: zoneId = 'laag', task = 't-01' }) {
  const row = document.querySelector(`[data-task-id="${task}"]`)
  const zone = document.querySelector(`[data-dropzone="${zoneId}"]`)
  if (!row || !zone) return
  const dt = new DataTransfer()
  row.dispatchEvent(new DragEvent('dragstart', { bubbles: true, dataTransfer: dt }))
  await sleep(40)
  const r = rect(zone)
  const at = { clientX: Math.round(r.left + r.width / 2), clientY: Math.round(r.top + 30) }
  zone.dispatchEvent(new DragEvent('dragover', { bubbles: true, dataTransfer: dt, ...at }))
  await sleep(40)
  zone.dispatchEvent(new DragEvent('dragover', { bubbles: true, dataTransfer: dt, ...at }))
  if (!drop) return
  await sleep(40)
  zone.dispatchEvent(new DragEvent('drop', { bubbles: true, dataTransfer: dt, ...at }))
  row.dispatchEvent(new DragEvent('dragend', { bubbles: true, dataTransfer: dt }))
  await sleep(200)
}

/* ── Mobiel: ingedrukt houden en slepen ────────────────────────────────── */
function pointer(target, type, x, y) {
  target.dispatchEvent(new PointerEvent(type, {
    bubbles: true, cancelable: true, composed: true,
    pointerId: 1, isPrimary: true, pointerType: 'touch',
    button: type === 'pointermove' ? -1 : 0, buttons: type === 'pointerup' ? 0 : 1,
    clientX: Math.round(x), clientY: Math.round(y),
  }))
}

async function mobileDrag({ drop, zone: zoneId = 'laag' }) {
  const row = document.querySelector('.m-tkrow')
  if (!row) return
  const r = rect(row)
  const from = { x: r.left + 140, y: r.top + r.height / 2 }
  pointer(row, 'pointerdown', from.x, from.y)
  await sleep(500)                       // > de druk-drempel van 340 ms
  const zone = document.querySelector(`[data-dropzone="${zoneId}"]`)
  if (!zone) return
  const z = rect(zone)
  const to = { x: z.left + z.width / 2, y: z.top + 26 }
  for (let i = 1; i <= 6; i++) {
    pointer(window, 'pointermove', from.x + (to.x - from.x) * i / 6, from.y + (to.y - from.y) * i / 6)
    await sleep(25)
  }
  if (!drop) return
  pointer(window, 'pointerup', to.x, to.y)
  await sleep(250)
}

async function openDetail() {
  if (view === 'mobile') {
    document.querySelectorAll('.m-tkrow__main')[0]?.click()
  } else {
    // Eén klik op de titel; het paneel komt na de dubbelklik-drempel (220 ms).
    document.querySelector('[data-task-id="t-01"] [class*="title"]')?.click()
  }
  await sleep(500)
}

async function run() {
  await sleep(600)                       // eerste fetch + render
  if (act === 'drag') await (view === 'mobile' ? mobileDrag({ drop: false }) : desktopDrag({ drop: false }))
  if (act === 'drop') await (view === 'mobile' ? mobileDrag({ drop: true }) : desktopDrag({ drop: true }))
  if (act === 'backlog') {
    await (view === 'mobile'
      ? mobileDrag({ drop: true, zone: 'backlog' })
      : desktopDrag({ drop: true, zone: 'backlog', task: 't-03' }))
    // De backlog staat ingeklapt; open hem zodat de geparkeerde taak zichtbaar
    // is. Even wachten: de app dempt bewust de click die ná een sleep komt
    // (CLICK_SWALLOW_MS), anders opent het loslaten zelf al iets.
    await sleep(500)
    document.querySelector('.m-tk__backlog, [class*="backlogToggle"]')?.click()
    await sleep(300)
  }
  if (act === 'detail') await openDetail()
  document.documentElement.setAttribute('data-klaar', '1')
}

/* ── Bewijsregel: wat is er weggeschreven ──────────────────────────────── */
function WriteLog() {
  const [n, setN] = useState(0)
  useEffect(() => {
    const bump = () => setN(x => x + 1)
    window.addEventListener('preview-write', bump)
    return () => window.removeEventListener('preview-write', bump)
  }, [])
  const rows = writes.filter(w => w.table === 'tasks')
  return (
    <div className="proof" data-n={n}>
      <b>weggeschreven naar supabase</b>
      {rows.length === 0
        ? <span>— nog niets —</span>
        : rows.map((w, i) => <span key={i}>update tasks {w.ids.join(', ')} → {JSON.stringify(w.patch)}</span>)}
    </div>
  )
}

function Mobile() {
  return (
    <div className="shell shell--m theme-maestro" style={{ height: '100vh', background: '#f5f4f0' }}>
      <main className="m-main" style={{ display: 'flex', flexDirection: 'column', overflow: 'auto' }}>
        <MobileTaken />
      </main>
    </div>
  )
}

createRoot(document.getElementById('root')).render(
  <MemoryRouter initialEntries={['/taken']}>
    {view === 'mobile' ? <Mobile /> : <TakenV2View />}
    {showLog && <WriteLog />}
  </MemoryRouter>,
)

run()
