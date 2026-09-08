import { useState } from 'react'
import s from './zoeken.module.css'
import { Ico } from './Icons'
// Eén formatter voor het bedrag: de metaregel en de verantwoordingsregel
// moeten hetzelfde getal tonen, anders leest het als twee bedragen.
import { fmtUsd } from '../../../lib/answerLayers'

// =============================================================================
// RunControls — wat een chatbericht erbij krijgt nu het een RUN is (spoor 02 I2)
// =============================================================================
// Sinds rag-chat v6.0 leeft een vraag als rij in agent_chat_runs: hij heeft een
// budget, een toestand, hops, kosten, en hij kan om input vragen of falen zonder
// dat het antwoord verloren is. Dit bestand voegt de vier dingen toe die daarbij
// horen; het staat los van ChatMode.jsx omdat dat bestand al boven de bestandscap
// zit en dit blok apart te lezen hoort te zijn.
//
//   RunBudgetLine    één segment in de meta-rij: de kosten tot nu toe ($0,0061)
//   RunCancelButton  stoppen terwijl hij loopt (RPC agent_chat_run_cancel)
//   RunInputPrompt   state needs_input: de vraag + een antwoordveld (V4)
//   RunFailedActions state failed: de fout + "opnieuw proberen" (resume — het
//                    onderzoek is bewaard, dus dit herhaalt geen tool-calls)
//
// Alle vier renderen `null` als het bericht de betreffende velden niet heeft, dus
// een oud bewaard gesprek (vóór v1.151) ziet er precies uit zoals het was.
// =============================================================================

const TERMINAL = new Set(['done', 'failed', 'cancelled'])


// v1.152 (spoor 08) — deze regel was "high · $0,0061 · 2 hops · 12 tool-calls".
// Effort, hops en tool-calls zijn machinetaal in de klantweergave; die staan nu
// in TechnicalPanel (met het volledige budget ernaast). Wat blijft is het
// bedrag: Jelle's uitzondering van 2026-09-07 — kosten per generatie horen
// zichtbaar te zijn in de normale weergave, ook zonder Technisch open.
//
// Ná het antwoord draagt de verantwoordingsregel de kosten. Deze regel is dus
// alleen nog voor de live-fase: dan bestaat die regel nog niet.
export function RunBudgetLine({ m }) {
  const usd = fmtUsd(m.spent?.usd)
  if (!usd) return null
  const limits = m.budget || null
  const title = limits
    ? `Kosten tot nu toe. Budget voor effort ${m.effort || '?'}: ${limits.tool_calls ?? '?'} tool-calls · ${limits.wall_ms ? Math.round(limits.wall_ms / 1000) + ' s' : '?'} · $${limits.usd ?? '?'}`
    : 'Kosten tot nu toe'
  return (
    <>
      <span className={s.asstMetaDot} />
      <span className={s.runBudget} title={title}>{usd}</span>
    </>
  )
}

// Een geannuleerde run houdt het antwoord dat er al stond — zonder dit label
// leest dat als een compleet antwoord. `done` en `failed` zeggen het elders
// (het antwoord zelf, respectievelijk de foutregel), dus alleen `cancelled`.
export function RunStateNote({ m }) {
  if (m.run_state !== 'cancelled') return null
  return (
    <div className={s.runCancelledNote}>
      Gestopt op jouw verzoek — dit is wat er tot dat moment stond.
    </div>
  )
}

// Annuleren mag zolang de run niet terminaal is. De RPC is owner-only en zet de
// rij op `cancelled`; de lopende hop merkt dat aan zijn lease en stopt zelf.
export function RunCancelButton({ m, onCancel }) {
  const [busy, setBusy] = useState(false)
  if (!m.run_id || !onCancel || TERMINAL.has(m.run_state)) return null
  return (
    <button
      type="button"
      className={s.runCancelBtn}
      disabled={busy}
      onClick={async () => { setBusy(true); try { await onCancel(m.run_id) } finally { setBusy(false) } }}
      title="Stop deze run — wat al gevonden is blijft bewaard"
    >
      {busy ? 'Stoppen…' : 'Stoppen'}
    </button>
  )
}

// Vork V4: de UI toont alleen de vraag en een tekstveld. De producent (een
// ask_user-tool) komt in spoor 03b; de toestand, de RPC en resume staan er al,
// dus dit werkt zodra de eerste tool het vraagt.
export function RunInputPrompt({ m, onAnswer }) {
  const [text, setText] = useState('')
  const [busy, setBusy] = useState(false)
  if (m.run_state !== 'needs_input' || !m.input_request || !onAnswer) return null
  const submit = async () => {
    const v = text.trim()
    if (!v || busy) return
    setBusy(true)
    try { await onAnswer(m.run_id, v) } finally { setBusy(false) }
  }
  return (
    <div className={s.runAsk}>
      <div className={s.runAskQ}>
        {Ico.info}
        <span>{m.input_request.question || 'Maestro heeft een aanvulling nodig.'}</span>
      </div>
      <div className={s.runAskRow}>
        <input
          type="text"
          className={s.runAskInput}
          value={text}
          disabled={busy}
          placeholder="Je antwoord…"
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); submit() } }}
        />
        <button type="button" className={s.runAskBtn} onClick={submit} disabled={busy || !text.trim()}>
          {busy ? 'Versturen…' : 'Versturen'}
        </button>
      </div>
    </div>
  )
}

// Een mislukte run is niet weg: het onderzoek staat in agent_chat_run_state, dus
// `resume` schrijft het antwoord zonder de tool-calls te herhalen. Vandaar dat
// deze knop "opnieuw proberen" heet en niet "opnieuw vragen".
export function RunFailedActions({ m, onResume }) {
  const [busy, setBusy] = useState(false)
  if (m.run_state !== 'failed' || !m.run_id || !onResume) return null
  return (
    <div className={s.runFailedRow}>
      <button
        type="button"
        className={s.runResumeBtn}
        disabled={busy}
        onClick={async () => { setBusy(true); try { await onResume(m.run_id) } finally { setBusy(false) } }}
        title="Hervat deze run — het onderzoek is bewaard, alleen het antwoord wordt opnieuw geschreven"
      >
        {busy ? 'Hervatten…' : 'Opnieuw proberen'}
      </button>
    </div>
  )
}
