import { useState, useEffect, useRef } from 'react'
import { supabase } from '../../lib/supabase'
import MIcon from '../MIcon'

// Map mockup prio → DB priority (zelfde als desktop v2-helpers).
function mockupPrioToDb(p) {
  if (p === 'hoog')   return 'high'
  if (p === 'middel') return 'normal'
  if (p === 'laag')   return 'low'
  return 'normal'
}

// MobileNewTask — bottom-sheet om een taak aan te maken. Geport uit
// app/mobile-newtask.jsx. Zelfde insert-payload als de desktop quick-capture
// (DashSide): source 'manual' + ai_processed false → de taken-skill kent later
// project/deadline/prio toe als Jelle niets invult. Verstuurt nooit mail.
// De "smart suggestion" + mic uit de mockup zijn bewust weggelaten (nog geen
// echte backing) — wordt een aparte feature als Jelle dat wil.
const PRIOS = [
  { key: 'hoog', label: 'Hoog' },
  { key: 'middel', label: 'Middel' },
  { key: 'laag', label: 'Laag' },
]

function isoPlusDays(days) {
  const d = new Date(); d.setHours(0, 0, 0, 0); d.setDate(d.getDate() + days)
  const mm = String(d.getMonth() + 1).padStart(2, '0')
  const dd = String(d.getDate()).padStart(2, '0')
  return `${d.getFullYear()}-${mm}-${dd}`
}

export default function MobileNewTask({ open, onClose, projects = [], onCreated }) {
  const [title, setTitle] = useState('')
  const [prio, setPrio] = useState('middel')
  const [deadline, setDeadline] = useState('')   // '' | YYYY-MM-DD
  const [projectId, setProjectId] = useState('')
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState(false)
  const textareaRef = useRef(null)

  // iOS-toetsenbord: til de sheet boven het toetsenbord via de visualViewport-
  // API. Voorkomt het "verspringen" / onder-het-toetsenbord-verdwijnen op
  // iPhone (fallback voor browsers zonder interactive-widget=resizes-content).
  useEffect(() => {
    if (!open) return
    const root = document.documentElement
    // Verberg de bottom tab bar + FAB en lock de achtergrond-scroll zolang de
    // sheet open is — geen nav zichtbaar, geen "gekke scroll" eronder.
    root.classList.add('m-modal-open')
    
    const vv = window.visualViewport
    if (!vv) {
      // Fallback voor browsers zonder visualViewport API
      const focusTimer = setTimeout(() => textareaRef.current?.focus(), 250)
      return () => {
        clearTimeout(focusTimer)
        root.classList.remove('m-modal-open')
      }
    }
    
    // visualViewport: bereken keyboard-hoogte en lift sheet erboven.
    // Wacht op de viewport stabilisatie voor focus — iOS Safari heeft tijd
    // nodig om de sheet + viewport te renderen voor keyboard-trigger stabiel is.
    let focusTimer = null
    let viewportStable = false
    
    const applyViewport = () => {
      // Keyboard hoogte = verschil tussen window en zichtbare viewport
      const kbHeight = Math.max(0, window.innerHeight - vv.height)
      root.style.setProperty('--m-kb', `${kbHeight}px`)
      
      // Na eerste viewport-adjust (sheet gerenderd), wacht 300ms en focus dan.
      // Dit voorkomt race: sheet-animatie (260ms) + viewport-settle + keyboard-open.
      if (!viewportStable) {
        viewportStable = true
        focusTimer = setTimeout(() => {
          textareaRef.current?.focus({ preventScroll: true })
        }, 300)
      }
    }
    
    applyViewport()
    vv.addEventListener('resize', applyViewport)
    vv.addEventListener('scroll', applyViewport)
    
    return () => {
      if (focusTimer) clearTimeout(focusTimer)
      vv.removeEventListener('resize', applyViewport)
      vv.removeEventListener('scroll', applyViewport)
      root.style.setProperty('--m-kb', '0px')
      root.classList.remove('m-modal-open')
    }
  }, [open])

  if (!open) return null

  const deadPresets = [
    { key: isoPlusDays(0), label: 'Vandaag' },
    { key: isoPlusDays(1), label: 'Morgen' },
    { key: isoPlusDays(7), label: 'Deze week' },
  ]

  const reset = () => { setTitle(''); setPrio('middel'); setDeadline(''); setProjectId('') }

  const submit = async () => {
    const t = title.trim()
    if (!t || busy) return
    setBusy(true); setErr(false)
    const row = { 
      title: t, 
      source: 'manual', 
      ai_processed: false, 
      priority: mockupPrioToDb(prio)
    }
    if (deadline) row.deadline = deadline
    if (projectId) row.project_id = projectId
    const { error } = await supabase.from('tasks').insert(row)
    setBusy(false)
    if (error) { 
      console.error('[MobileNewTask] Insert failed:', error)
      setErr(true)
      return
    }
    reset()
    onCreated?.()
    onClose?.()
  }

  return (
    <>
      <div className="m-scrim" onClick={onClose} />
      <div className="m-sheet" role="dialog" aria-modal="true" aria-label="Nieuwe taak">
        <div className="m-drawer__grab" />
        <div className="m-sheet__head">
          <span className="m-drawer__title">Nieuwe taak</span>
          <button type="button" className="m-drawer__close" onClick={onClose} aria-label="Sluiten">
            <MIcon name="close" size={16} />
          </button>
        </div>

        <div className="m-sheet__body">
          <div className="m-titlefield">
            <textarea
              ref={textareaRef}
              className="m-titlefield__input"
              placeholder="Bv. Pels Rijcken — voorstel opstellen"
              rows={2}
              value={title}
              onChange={(e) => setTitle(e.target.value)}
            />
            <div className="m-titlefield__hint">Tip: begin met een werkwoord</div>
          </div>

          <div className="m-field">
            <div className="m-field__label">Prioriteit</div>
            <div className="m-seg">
              {PRIOS.map(p => (
                <button
                  key={p.key}
                  type="button"
                  className={`m-segbtn m-segbtn--${p.key} ${prio === p.key ? 'is-active' : ''}`}
                  onClick={() => setPrio(p.key)}
                >
                  <span className="m-segbtn__dot" />{p.label}
                </button>
              ))}
            </div>
          </div>

          <div className="m-field">
            <div className="m-field__label">Deadline</div>
            <div className="m-deadchips">
              {deadPresets.map(d => (
                <button
                  key={d.key}
                  type="button"
                  className={`m-deadchip ${deadline === d.key ? 'is-active' : ''}`}
                  onClick={() => setDeadline(deadline === d.key ? '' : d.key)}
                >{d.label}</button>
              ))}
              <label className={`m-deadchip m-deadchip--date ${deadline && !deadPresets.some(d => d.key === deadline) ? 'is-active' : ''}`}>
                <MIcon name="cal" size={13} />
                <span>{deadline && !deadPresets.some(d => d.key === deadline) ? deadline : 'Kies datum'}</span>
                <input type="date" value={deadline} onChange={(e) => setDeadline(e.target.value)} />
              </label>
            </div>
          </div>

          {projects.length > 0 && (
            <div className="m-field">
              <div className="m-field__label">Koppel aan project (optioneel)</div>
              <div className="m-projsel">
                <MIcon name="admin" size={14} />
                <select value={projectId} onChange={(e) => setProjectId(e.target.value)}>
                  <option value="">Geen project</option>
                  {projects.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
                </select>
                <MIcon name="chevron" size={14} />
              </div>
            </div>
          )}

          {err && <div className="m-quickadd__err">Toevoegen mislukt — probeer opnieuw.</div>}
        </div>

        <div className="m-sheet__cta">
          <button type="button" className="m-sheet__add" onClick={submit} disabled={busy || !title.trim()}>
            <MIcon name="plus" size={18} color="#fff" stroke={2.2} /> {busy ? 'Bezig…' : 'Voeg taak toe'}
          </button>
        </div>
      </div>
    </>
  )
}
