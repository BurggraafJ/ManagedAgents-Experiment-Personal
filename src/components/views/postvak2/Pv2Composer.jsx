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
        Taalcheck: <b>{tc.stats.ins} toegevoegd</b> · {tc.stats.del} verwijderd — doorgestreept rood vervalt, groen komt erbij.
      </span>
      <button type="button" className="tc-accept" onClick={onAccept}><Ic n="check" s={12}/> Overnemen</button>
      <button type="button" className="tc-reject" onClick={onReject}>Verwerpen</button>
    </div>
  )
}

// Hook die de taalcheck-flow bundelt: run → tc-state → accept/reject.
export function useTaalcheck({ getBody, setBody }) {
  const [tc, setTc] = useState(null)
  const [busy, setBusy] = useState(false)

  async function run() {
    const original = getBody()
    if (!original || !original.trim() || busy) return
    setBusy(true)
    try {
      const { data, error } = await supabase.functions.invoke('mail-taalcheck', {
        body: { original_mail: original },
      })
      if (error) throw new Error(error.message)
      if (!data || !data.ok) {
        const detail = data?.detail ? ` (${data.detail})` : ''
        throw new Error(`AI-output week te veel af van het origineel${detail}.`)
      }
      const corrected = data.corrected_body || ''
      const segments = diffWords(original, corrected)
      const stats = diffStats(segments)
      if (!stats.changed || data.changed === false) {
        showToast({ kind: 'info', message: 'Geen taalfouten gevonden', detail: 'De tekst is ongewijzigd.' })
      } else {
        setTc({ segments, stats, original, corrected })
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

  return { tc, taalcheckBusy: busy, runTaalcheck: run, acceptTaalcheck: accept, rejectTaalcheck: reject }
}

export function RefineBar({
  chips = [], onChip, aiInput, setAiInput, onSubmit, busy, pinned,
  placeholder, submitLabel = 'Herschrijf',
  onTaalcheck, taalcheckBusy, tcActive,
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
          <button className="refine-chip" disabled={disabled} onClick={onTaalcheck}
                  title="Pure taalcheck — wijzigingen verschijnen als track changes in het schrijfvlak">
            <Ic n="spell" s={11}/>{taalcheckBusy ? 'Taalcheck…' : 'Taalcheck'}
          </button>
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
