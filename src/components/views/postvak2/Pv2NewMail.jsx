import { useEffect, useRef, useState } from 'react'
import { supabase } from '../../../lib/supabase'
import { showToast } from '../../Toast'
import Ic from './pv2Icons'
import { ComposeBody, RefineBar, RefineLoading, TrackChangesBar, useTaalcheck } from './Pv2Composer'

/* Pv2NewMail — "Nieuw"-sheet (design: NewMailSheet). Versleepbaar glossy vel
 * met composer + Maestro-schrijffunctionaliteit:
 *  - chips + vrije opdracht → mail-verbeteraar (herschrijft/schrijft in
 *    Jelle's stijl o.b.v. 5 vergelijkbare verzonden mails)
 *  - Taalcheck → track changes in het schrijfvlak
 *  - "Verstuur" levert het concept op het klembord (het platform heeft
 *    bewust geen los verstuur-kanaal — zelfde contract als de verbeteraar). */

const CHIP_PROMPTS = {
  'Schrijf voor mij': 'Schrijf op basis van deze opdracht een complete, natuurlijke mail in Jelle’s stijl.',
  'Korter': 'Maak de mail korter en directer.',
  'Vriendelijker': 'Maak de toon vriendelijker en warmer.',
  'Zakelijker': 'Maak de toon zakelijker en formeler.',
  'Vraag om bevestiging': 'Sluit af met een korte, vriendelijke vraag om bevestiging.',
}

export default function Pv2NewMail({ onClose }) {
  const [to, setTo] = useState('')
  const [subject, setSubject] = useState('')
  const [body, setBody] = useState('')
  const [aiInput, setAiInput] = useState('')
  const [refining, setRefining] = useState(false)
  const [refineLabel, setRefineLabel] = useState('')
  const bodyRef = useRef(body)
  bodyRef.current = body
  const {
    tc, taalcheckBusy, runTaalcheck, rerunTaalcheck, acceptTaalcheck, rejectTaalcheck, copyTaalcheck,
    tcLevel, setTcLevel,
  } = useTaalcheck({ getBody: () => bodyRef.current, setBody })

  const [box, setBox] = useState(() => {
    try {
      const v = JSON.parse(localStorage.getItem('pvk2-newmail') || 'null')
      if (v && v.left >= 80) return v
    } catch { /* ignore */ }
    return { left: 300, top: 70 }
  })
  const drag = useRef(false)
  function onResizeDown(e) {
    e.preventDefault(); e.stopPropagation()
    drag.current = true
    document.body.style.cursor = 'nwse-resize'
    document.body.style.userSelect = 'none'
  }
  useEffect(() => {
    function mv(e) {
      if (!drag.current) return
      setBox({
        left: Math.max(80, Math.min(window.innerWidth - 460, e.clientX)),
        top: Math.max(44, Math.min(window.innerHeight - 260, e.clientY)),
      })
    }
    function up() {
      if (drag.current) {
        drag.current = false
        document.body.style.cursor = ''
        document.body.style.userSelect = ''
        try { localStorage.setItem('pvk2-newmail', JSON.stringify(box)) } catch { /* ignore */ }
      }
    }
    window.addEventListener('mousemove', mv)
    window.addEventListener('mouseup', up)
    return () => { window.removeEventListener('mousemove', mv); window.removeEventListener('mouseup', up) }
  }, [box])

  async function runRefine(label) {
    if (refining || tc) return
    const instruction = CHIP_PROMPTS[label] || label
    setRefineLabel(label)
    setRefining(true)
    try {
      const hasBody = body.trim().length > 0
      const { data, error } = await supabase.functions.invoke('mail-verbeteraar', {
        body: hasBody
          ? { original_mail: body, extra_prompt: instruction }
          : { original_mail: instruction, extra_prompt: CHIP_PROMPTS['Schrijf voor mij'] },
      })
      if (error) throw new Error(error.message)
      if (!data || !data.ok) throw new Error(data?.reason || 'mislukt')
      setBody(data.improved_mail || '')
      if (data.examples_used) {
        showToast({ message: 'Maestro schreef mee', detail: `${data.examples_used} vergelijkbare verzonden mails als stijlvoorbeeld.` })
      }
      setAiInput('')
    } catch (e) {
      showToast({ kind: 'error', message: 'Schrijven mislukt', detail: e.message })
    }
    setRefining(false)
  }

  function copyOut() {
    const txt = body.trim()
    if (!txt) { showToast({ kind: 'error', message: 'Nog geen tekst om te versturen' }); return }
    navigator.clipboard.writeText(txt).then(
      () => showToast({ message: 'Concept gekopieerd', detail: 'Plak in een nieuw Outlook-bericht om te versturen — versturen gebeurt bewust nooit vanuit Maestro.' }),
      () => showToast({ kind: 'error', message: 'Kopiëren mislukt' }),
    )
  }

  return (
    <>
      <div className="focus-scrim" onClick={onClose}/>
      <div className="dock-sheet newmail" style={{ position: 'absolute', left: box.left, right: 18, top: box.top, bottom: 18, zIndex: 60 }}>
        <div className="dock-resize" onMouseDown={onResizeDown} title="Versleep de hoek om de grootte aan te passen"><span/></div>
        <div className="dock-panel">
          <div className="dock-compose">
            <div className="newmail-head"><span className="newmail-title"><Ic n="send" s={15}/> Nieuwe mail</span></div>
            <div className="composer">
              <div className="comp-row">
                <span className="comp-label">Aan</span>
                <input className="comp-input" autoFocus placeholder="Ontvanger toevoegen…" value={to} onChange={e => setTo(e.target.value)}/>
              </div>
              <div className="comp-row">
                <span className="comp-label">Onderwerp</span>
                <input className="comp-input comp-subject" placeholder="Onderwerp" value={subject} onChange={e => setSubject(e.target.value)}/>
                <span className="draft-tag"><span className="draft-tag-dot"/>Concept</span>
              </div>
              <TrackChangesBar tc={tc} onAccept={acceptTaalcheck} onReject={rejectTaalcheck}
                               onRerun={rerunTaalcheck} onCopy={copyTaalcheck}
                               tcLevel={tcLevel} setTcLevel={setTcLevel} busy={taalcheckBusy}/>
              <ComposeBody body={body} setBody={setBody} tc={tc}/>
              <div className="comp-sign"><div><b>Jelle Burggraaf</b></div><div>Founder · Legal Mind</div></div>
              {refining && <RefineLoading verb="schrijft" label={refineLabel}/>}
              <RefineBar
                chips={['Schrijf voor mij', 'Korter', 'Vriendelijker', 'Zakelijker', 'Vraag om bevestiging']}
                onChip={runRefine}
                aiInput={aiInput} setAiInput={setAiInput}
                onSubmit={runRefine}
                busy={refining}
                placeholder="Vertel Maestro wat je wil sturen…"
                submitLabel="Schrijf"
                onTaalcheck={runTaalcheck} taalcheckBusy={taalcheckBusy} tcActive={!!tc}
                tcLevel={tcLevel} setTcLevel={setTcLevel}
              />
            </div>
          </div>
          <div className="dock-foot">
            <span className="dock-foot-meta"><Ic n="cube" s={13}/> Stijl uit je verzonden mails · jij blijft eindredacteur</span>
            <span style={{ flex: 1 }}/>
            <button className="btn dock-save" onClick={onClose}>Sluit</button>
            <button className="btn btn-primary" onClick={copyOut} title="Kopieert het concept — plak in Outlook om te versturen">
              <Ic n="send" s={14}/> Verstuur
            </button>
          </div>
        </div>
      </div>
    </>
  )
}
