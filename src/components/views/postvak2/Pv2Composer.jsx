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
  const editing = !tc
  // Bij (her)mount van de editor (incl. terugschakelen vanuit track-changes):
  // DOM-tekst hard gelijkzetten aan de state. De key's hieronder zorgen dat
  // React de twee weergaven als aparte nodes behandelt — zonder key hergebruikte
  // React dezelfde div en bleven onze innerText-mutaties naast de React-children
  // staan (de "dubbele tekst"-bug uit review-ronde 2).
  useEffect(() => {
    if (!editing) return
    if (ref.current) { ref.current.innerText = body; last.current = body }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editing])
  // Externe body-wijzigingen (variant-wissel, herschrijf, spelcheck) syncen;
  // eigen toetsaanslagen niet (last.current loopt via onInput mee).
  useEffect(() => {
    if (!editing) return
    if (ref.current && body !== last.current) { ref.current.innerText = body; last.current = body }
  }, [body, editing])

  if (tc) {
    return (
      <div key="pvk2-tcview" className="comp-body" aria-label="Taalcheck-resultaat met wijzigingen">
        {tc.segments.map((s, i) => {
          if (s.type === 'del') return <span key={i} className="tc-del">{s.text}</span>
          if (s.type === 'ins') return <span key={i} className="tc-ins">{s.text}</span>
          return <span key={i}>{s.text}</span>
        })}
      </div>
    )
  }
  return (
    <div key="pvk2-editor" ref={ref} className="comp-body" contentEditable suppressContentEditableWarning
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

export function TrackChangesBar({ tc, onAccept, onReject, onRerun, onCopy, tcLevel, setTcLevel, busy }) {
  if (!tc) return null
  return (
    <div className="tc-bar">
      <Ic n="spell" s={15}/>
      <span className="tc-bar-txt">
        Taalcheck ({TC_LEVELS[tc.level] || ''}): <b>{tc.stats.ins} toegevoegd</b> · {tc.stats.del} verwijderd — rood vervalt, groen komt erbij.
      </span>
      {setTcLevel && (
        <span className="tc-ctl" title="Ander niveau kiezen en opnieuw checken">
          <input type="range" min={1} max={TC_MAX_LEVEL} step={1} value={tcLevel} disabled={busy}
                 onChange={e => setTcLevel(e.target.value)} aria-label="Taalcheck-intensiteit"/>
          <span className="tc-ctl-lbl">{TC_LEVELS[tcLevel]}</span>
        </span>
      )}
      {onRerun && (
        <button type="button" className="tc-reject" disabled={busy} onClick={onRerun}
                title="Verwerp dit resultaat en check de originele tekst opnieuw op het gekozen niveau">
          <Ic n="refresh" s={12}/> {busy ? 'Opnieuw…' : 'Opnieuw'}
        </button>
      )}
      {onCopy && (
        <button type="button" className="tc-reject" onClick={onCopy} title="Kopieer de gecorrigeerde tekst">
          <Ic n="copy" s={12}/>
        </button>
      )}
      <button type="button" className="tc-accept" onClick={onAccept}><Ic n="check" s={12}/> Overnemen</button>
      <button type="button" className="tc-reject" onClick={onReject}>Verwerpen</button>
    </div>
  )
}

// Taalcheck-intensiteit (slider) — review-ronde 2, Jelle's definitie:
// 1 = altijd alle fouten eruit, zo min mogelijk herschrijven;
// 2 = ook kromme/niet-lopende zinnen beter vormgeven;
// 3 = boodschap en stijl behouden maar beter verwoord.
export const TC_LEVELS = {
  1: 'Foutloos',
  2: 'Vloeiend',
  3: 'Beter verwoord',
}
export const TC_MAX_LEVEL = 3

// Hook die de taalcheck-flow bundelt: run → tc-state → accept/reject/rerun.
// Edge Function `taalcheck-v2` — geen server-side afwijzing (de track-changes
// weergave ís de controle) + instelbare intensiteit, persist in localStorage.
export function useTaalcheck({ getBody, setBody }) {
  const [tc, setTc] = useState(null)
  const [busy, setBusy] = useState(false)
  const [level, setLevelState] = useState(() => {
    const v = parseInt(localStorage.getItem('pvk2-tc-level') || '1', 10)
    return v >= 1 && v <= TC_MAX_LEVEL ? v : 1
  })
  const setLevel = (v) => {
    const n = Math.max(1, Math.min(TC_MAX_LEVEL, Number(v) || 1))
    setLevelState(n)
    try { localStorage.setItem('pvk2-tc-level', String(n)) } catch { /* ignore */ }
  }

  async function runOn(original, lvl) {
    if (!original || !original.trim() || busy) return
    setBusy(true)
    try {
      const { data, error } = await supabase.functions.invoke('taalcheck-v2', {
        body: { text: original, level: lvl },
      })
      if (error) throw new Error(error.message)
      if (!data || !data.ok) throw new Error(data?.reason || 'geen resultaat')
      const corrected = data.corrected || ''
      const segments = diffWords(original, corrected)
      const stats = diffStats(segments)
      if (!stats.changed || data.changed === false) {
        showToast({ kind: 'info', message: 'Niets te verbeteren', detail: `Op niveau "${TC_LEVELS[lvl]}" is de tekst al goed.` })
        setTc(null)
      } else {
        setTc({ segments, stats, original, corrected, level: lvl })
      }
    } catch (e) {
      showToast({ kind: 'error', message: 'Taalcheck mislukt', detail: e.message })
    }
    setBusy(false)
  }

  const run = () => runOn(getBody(), level)
  // Opnieuw: zelfde ORIGINELE tekst, met het (evt. net gewijzigde) niveau.
  const rerun = () => { if (tc) runOn(tc.original, level) }

  function accept() {
    if (!tc) return
    setBody(tc.corrected)
    setTc(null)
    showToast({ message: 'Taalcheck overgenomen' })
  }
  function reject() { setTc(null) }
  function copyCorrected() {
    if (!tc) return
    navigator.clipboard.writeText(tc.corrected).then(
      () => showToast({ message: 'Gecorrigeerde tekst gekopieerd' }),
      () => showToast({ kind: 'error', message: 'Kopiëren mislukt' }),
    )
  }

  return {
    tc, taalcheckBusy: busy, runTaalcheck: run, rerunTaalcheck: rerun,
    acceptTaalcheck: accept, rejectTaalcheck: reject, copyTaalcheck: copyCorrected,
    tcLevel: level, setTcLevel: setLevel,
  }
}

export function RefineBar({
  chips = [], onChip, aiInput, setAiInput, onSubmit, busy, pinned,
  placeholder, submitLabel = 'Herschrijf', hideInput = false,
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
              <span className="tc-ctl" title="Hoe ver mag de taalcheck gaan? Foutloos = alle fouten, minimaal herschrijven · Vloeiend = ook kromme zinnen · Beter verwoord = jouw boodschap en stijl, sterkst verwoord.">
                <input type="range" min={1} max={TC_MAX_LEVEL} step={1} value={tcLevel} disabled={disabled}
                       onChange={e => setTcLevel(e.target.value)} aria-label="Taalcheck-intensiteit"/>
                <span className="tc-ctl-lbl">{TC_LEVELS[tcLevel]}</span>
              </span>
            )}
          </>
        )}
      </div>
      {!hideInput && (
        <div className="refine-row">
          <input className="refine-input" value={aiInput} onChange={e => setAiInput(e.target.value)}
                 placeholder={placeholder} disabled={disabled}
                 onKeyDown={e => { if (e.key === 'Enter' && aiInput.trim()) onSubmit(aiInput) }}/>
          <button className="refine-send" disabled={disabled || !aiInput.trim()}
                  onClick={() => aiInput.trim() && onSubmit(aiInput)}>
            <Ic n="sparkles" s={13}/> {submitLabel}
          </button>
        </div>
      )}
    </div>
  )
}
