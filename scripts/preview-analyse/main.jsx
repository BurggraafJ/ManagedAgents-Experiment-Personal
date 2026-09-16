import { useEffect, useState } from 'react'
import { MemoryRouter } from 'react-router-dom'
import { createRoot } from 'react-dom/client'
import '../../src/index.css'
import '../../src/mobile/mobile.css'
import RagSearchView from '../../src/components/views/zoeken/RagSearchView'
import MobileZoeken from '../../src/mobile/screens/MobileZoeken'
import InShell from '../preview-shared/InShell'
import { PREVIEW_SESSION_ID } from './mock-supabase'

// Preview-harnas Analyse (v1.226) — vier scènes:
//   desktop-restore / mobile-restore : de tab-wijzer staat op het bewaarde
//       gesprek; het harnas mount Analyse, wisselt ná 700 ms écht naar een
//       Postvak-placeholder (RagSearchView/MobileZoeken unmounten), en komt
//       na 1400 ms terug. Wat je ziet is dus de ECHTE herstel-route: bare
//       /zoeken → readLastSessionId() → loadSession(). Geen nagebouwde markup.
//   desktop-library / mobile-library : lege chat, harnas klikt na 800 ms de
//       Voorbeelden-tag (desktop) / het boek-icoon (mobiel) met een echte klik.
const params = new URLSearchParams(location.search)
const view = params.get('view') || 'desktop-restore'
const isRestore = view.endsWith('-restore')
const isMobile = view.startsWith('mobile')

document.documentElement.classList.add('theme-light')
const _st = document.createElement('style')
_st.textContent = '*,*::before,*::after{animation-duration:0s!important;transition:none!important}.m-sheet,.m-scrim,.m-drawer{animation:none!important;transform:none!important}'
document.head.appendChild(_st)

// De wijzer zoals de app hem zelf zou hebben achtergelaten na een vraag.
try {
  if (isRestore) sessionStorage.setItem('lm_analyse_last_session', PREVIEW_SESSION_ID)
  else sessionStorage.removeItem('lm_analyse_last_session')
} catch { /* ignore */ }

function realClick(el) {
  if (!el) return false
  el.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }))
  el.dispatchEvent(new MouseEvent('mouseup', { bubbles: true }))
  el.dispatchEvent(new MouseEvent('click', { bubbles: true }))
  return true
}

// Analyse → Postvak → Analyse. `page` wisselt het route-element net zoals
// React Router dat doet: het oude element unmount, het nieuwe mount.
function Roundtrip({ analyse, postvak }) {
  const [page, setPage] = useState('analyse')
  const [trail, setTrail] = useState(['Analyse'])
  useEffect(() => {
    if (!isRestore) return
    const a = setTimeout(() => { setPage('postvak'); setTrail(t => [...t, 'Postvak']) }, 700)
    const b = setTimeout(() => { setPage('analyse'); setTrail(t => [...t, 'Analyse']) }, 1400)
    return () => { clearTimeout(a); clearTimeout(b) }
  }, [])
  return (
    <>
      {page === 'analyse' ? analyse : postvak}
      {isRestore && <Caption trail={trail} />}
    </>
  )
}

// Bewijsregel buiten de app-chrome: de gelopen route en de wijzer zoals hij
// NU in sessionStorage staat (live gelezen, niet de constante).
function Caption({ trail }) {
  const [ptr, setPtr] = useState('')
  useEffect(() => {
    const t = setInterval(() => { try { setPtr(sessionStorage.getItem('lm_analyse_last_session') || '—') } catch { setPtr('?') } }, 100)
    return () => clearInterval(t)
  }, [])
  return (
    <div style={{ position: 'fixed', left: 0, right: 0, bottom: 0, zIndex: 9999, background: '#1d1b18', color: '#f5f4f0', font: '500 11px/1.5 ui-monospace, Menlo, monospace', padding: '6px 12px', display: 'flex', gap: 16, justifyContent: 'space-between', flexWrap: 'wrap' }}>
      <span>harnas · route: {trail.join(' → ')} · {trail.length >= 3 ? 'Analyse opnieuw gemount' : 'onderweg…'}</span>
      <span>sessionStorage.lm_analyse_last_session = {ptr}</span>
    </div>
  )
}

function PostvakPlaceholder({ mobile }) {
  const box = (
    <div style={{ padding: 24, font: '500 14px system-ui', color: '#5a564f' }}>Postvak (placeholder — Analyse is hier unmounted)</div>
  )
  return mobile ? box : <InShell title="Postvak" activeView="postvak">{box}</InShell>
}

function DesktopAnalyse() {
  useEffect(() => {
    if (view !== 'desktop-library') return
    const t = setTimeout(() => {
      const btn = [...document.querySelectorAll('button')].find(b => b.textContent.trim() === 'Voorbeelden')
      realClick(btn)
    }, 800)
    return () => clearTimeout(t)
  }, [])
  return (
    <InShell title="Analyse" activeView="vragenbak">
      <RagSearchView isOwner />
    </InShell>
  )
}

function MobileAnalyse() {
  useEffect(() => {
    if (view !== 'mobile-library') return
    const t = setTimeout(() => realClick(document.querySelector('.m-vb__lib')), 800)
    return () => clearTimeout(t)
  }, [])
  return <MobileZoeken />
}

function MobileFrame({ children }) {
  return (
    <div className="shell shell--m theme-maestro" style={{ height: '100vh', background: '#f5f4f0', position: 'relative' }}>
      <main className="m-main" style={{ height: '100%', display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
        {children}
      </main>
    </div>
  )
}

const tree = isMobile
  ? <MobileFrame><Roundtrip analyse={<MobileAnalyse />} postvak={<PostvakPlaceholder mobile />} /></MobileFrame>
  : <Roundtrip analyse={<DesktopAnalyse />} postvak={<PostvakPlaceholder />} />

createRoot(document.getElementById('root')).render(
  <MemoryRouter initialEntries={['/zoeken']}>
    {tree}
  </MemoryRouter>
)
