import { useEffect, useRef, useState } from 'react'
import { supabase } from '../../../lib/supabase'
import { showToast } from '../../Toast'
import Ic from './pv2Icons'
import { diffWords, diffStats } from './pv2lib'

/* Pv2Composer — het schrijfvlak van variant 2 (design: .comp-body, .refine)
 * plus de taalcheck-met-track-changes. Gedeeld door het concept-dock en de
 * nieuwe-mail-sheet.
 *
 * Track changes: mail-taalcheck (bestaande Edge Function) levert een
 * gecorrigeerde tekst; we tonen het verschil ín het schrijfvlak — verwijderd
 * = rood + doorgestreept, toegevoegd = groen — met Overnemen/Verwerpen. */

export function ComposeBody({ body, setBody, tc, placeholder = 'Typ je bericht…' }) {
  const ref = useRef(null)
  const last = useRef(body)
  useEffect(() => {
    if (tc) return // track-changes weergave is read-only, geen sync nodig
    if (ref.current && body !== last.current) { ref.current.innerText = body; last.current = body }
  }, [body, tc])
  useEffect(() => {
    if (!tc && ref.current && !ref.current.innerText && body) { ref.current.innerText = body; last.current = body }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tc])

  if (tc) {
    return (
      <div className="comp-body" aria-label="Taalcheck-resultaat met wijzigingen">
        {tc.segments.map((s, i) => {
          if (s.type === 'del') return <span key={i} className="tc-del">{s.text}</span>
          if (s.type === 'ins') return <span key={i} className="tc-ins">{s.text}</span>
          return <span key={i}>{s.text}</span>
        })}
      </div>
    )
  }
  return (
    <div ref={ref} className="comp-body" contentEditable suppressContentEditableWarning
         onInput={e => { last.current = e.currentTarget.innerText; setBody(e.currentTarget.innerText) }}
         data-placeholder={placeholder}/>
  )
}

export function RefineLoading({ verb = 'herschrijft', label }) {
  return (
    <div className="refine-loading">
      <div className="refine-orb"><Ic n="sparkles" s={18}/></div>
      <div className="refine-loading-txt">Maestro {verb}{label ? ` — ${label.toLowerCase()}` : ''}…</div>
      <div className="refine-bar"><span/></div>
    </div>
  )
}

export function TrackChangesBar({ tc, onAccept, onReject }) {
  if (!tc) return null
  return (
    <div className="tc-bar">
      <Ic n="spell" s={15}/>
      <span className="tc-bar-txt">
        Taalcheck{tc.level ? ` (${TC_LEVELS[tc.level]})` : ''}: <b>{tc.stats.ins} toegevoegd</b> · {tc.stats.del} verwijderd — doorgestreept rood vervalt, groen komt erbij.
      </span>
      <button type="button" className="tc-accept" onClick={onAccept}><Ic n="check" s={12}/> Overnemen</button>
      <button type="button" className="tc-reject" onClick={onReject}>Verwerpen</button>
    </div>
  )
}

// Taalcheck-intensiteit (slider): 1 = alleen spelfouten … 4 = vrij herschrijven.
export const TC_LEVELS = {
  1: 'Spelling',
  2: 'Spelling + grammatica',
  3: 'Vloeiend',
  4: 'Herschrijf',
}

// Hook die de taalcheck-flow bundelt: run → tc-state → accept/reject.
// v2 (review-ronde 1): Edge Function `taalcheck-v2` — geen server-side
// afwijzing meer (de track-changes weergave ís de controle) + instelbare
// intensiteit, persist in localStorage.
export function useTaalcheck({ getBody, setBody }) {
  const [tc, setTc] = useState(null)
  const [busy, setBusy] = useState(false)
  const [level, setLevelState] = useState(() => {
    const v = parseInt(localStorage.getItem('pvk2-tc-level') || '2', 10)
    return v >= 1 && v <= 4 ? v : 2
  })
  const setLevel = (v) => {
    const n = Math.max(1, Math.min(4, Number(v) || 2))
    setLevelState(n)
    try { localStorage.setItem('pvk2-tc-level', String(n)) } catch { /* ignore */ }
  }

  async function run() {
    const original = getBody()
    if (!original || !original.trim() || busy) return
    setBusy(true)
    try {
      const { data, error } = await supabase.functions.invoke('taalcheck-v2', {
        body: { text: original, level },
      })
      if (error) throw new Error(error.message)
      if (!data || !data.ok) throw new Error(data?.reason || 'geen resultaat')
      const corrected = data.corrected || ''
      const segments = diffWords(original, corrected)
      const stats = diffStats(segments)
      if (!stats.changed || data.changed === false) {
        showToast({ kind: 'info', message: 'Niets te verbeteren', detail: `Op niveau "${TC_LEVELS[level]}" is de tekst al goed.` })
      } else {
        setTc({ segments, stats, original, corrected, level })
      }
    } catch (e) {
      showToast({ kind: 'error', message: 'Taalcheck mislukt', detail: e.message })
    }
    setBusy(false)
  }

  function accept() {
    if (!tc) return
    setBody(tc.corrected)
    setTc(null)
    showToast({ message: 'Taalcheck overgenomen' })
  }
  function reject() { setTc(null) }

  return { tc, taalcheckBusy: busy, runTaalcheck: run, acceptTaalcheck: accept, rejectTaalcheck: reject, tcLevel: level, setTcLevel: setLevel }
}

export function RefineBar({
  chips = [], onChip, aiInput, setAiInput, onSubmit, busy, pinned,
  placeholder, submitLabel = 'Herschrijf',
  onTaalcheck, taalcheckBusy, tcActive, tcLevel, setTcLevel,
}) {
  const disabled = busy || taalcheckBusy || tcActive
  return (
    <div className={`refine ${pinned ? 'pinned' : ''}`}>
      <div className="refine-chips">
        {chips.map(c => (
          <button key={c} className="refine-chip" disabled={disabled} onClick={() => onChip(c)}>
            <Ic n="sparkles" s={11}/>{c}
          </button>
        ))}
        {onTaalcheck && (
          <>
            <button className="refine-chip" disabled={disabled} onClick={onTaalcheck}
                    title="Taalcheck — wijzigingen verschijnen als track changes (rood = weg, groen = erbij) in het schrijfvlak">
              <Ic n="spell" s={11}/>{taalcheckBusy ? 'Taalcheck…' : 'Taalcheck'}
            </button>
            {setTcLevel && (
              <span className="tc-ctl" title="Hoe streng mag de taalcheck ingrijpen? Links = alleen spelfouten, rechts = vrij herschrijven (inhoud blijft).">
                <input type="range" min={1} max={4} step={1} value={tcLevel} disabled={disabled}
                       onChange={e => setTcLevel(e.target.value)} aria-label="Taalcheck-intensiteit"/>
                <span className="tc-ctl-lbl">{TC_LEVELS[tcLevel]}</span>
              </span>
            )}
          </>
        )}
      </div>
      <div className="refine-row">
        <input className="refine-input" value={aiInput} onChange={e => setAiInput(e.target.value)}
               placeholder={placeholder} disabled={disabled}
               onKeyDown={e => { if (e.key === 'Enter' && aiInput.trim()) onSubmit(aiInput) }}/>
        <button className="refine-send" disabled={disabled || !aiInput.trim()}
                onClick={() => aiInput.trim() && onSubmit(aiInput)}>
          <Ic n="sparkles" s={13}/> {submitLabel}
        </button>
      </div>
    </div>
  )
}
