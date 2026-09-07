import { useState } from 'react'
import s from './zoeken.module.css'
import { Ico } from './Icons'

// =============================================================================
// RunControls — wat een chatbericht erbij krijgt nu het een RUN is (spoor 02 I2)
// =============================================================================
// Sinds rag-chat v6.0 leeft een vraag als rij in agent_chat_runs: hij heeft een
// budget, een toestand, hops, kosten, en hij kan om input vragen of falen zonder
// dat het antwoord verloren is. Dit bestand voegt de vier dingen toe die daarbij
// horen; het staat los van ChatMode.jsx omdat dat bestand al boven de bestandscap
// zit en dit blok apart te lezen hoort te zijn.
//
//   RunBudgetLine    één segment in de meta-rij: "high · $0,0061 · 2 hops"
//   RunCancelButton  stoppen terwijl hij loopt (RPC agent_chat_run_cancel)
//   RunInputPrompt   state needs_input: de vraag + een antwoordveld (V4)
//   RunFailedActions state failed: de fout + "opnieuw proberen" (resume — het
//                    onderzoek is bewaard, dus dit herhaalt geen tool-calls)
//
// Alle vier renderen `null` als het bericht de betreffende velden niet heeft, dus
// een oud bewaard gesprek (vóór v1.151) ziet er precies uit zoals het was.
// =============================================================================

const TERMINAL = new Set(['done', 'failed', 'cancelled'])

const fmtUsd = (usd) => {
  if (typeof usd !== 'number' || !isFinite(usd)) return null
  // Onder een cent is twee decimalen "$0,00" — dan liever vier.
  return usd >= 0.01 ? `$${usd.toFixed(2)}` : `$${usd.toFixed(4)}`
}

// "high · $0,0061 · 2 hops · 12 tool-calls". Effort staat vooraan omdat dat de
// knop is die Jelle zelf zet; de rest verantwoordt wat die knop kostte.
export function RunBudgetLine({ m }) {
  const spent = m.spent || null
  const usd = fmtUsd(spent?.usd)
  const hops = typeof spent?.hops === 'number' ? spent.hops : (typeof m.hops === 'number' ? m.hops : null)
  const toolCalls = typeof spent?.tool_calls === 'number' && spent.tool_calls > 0 ? spent.tool_calls : null
  const limits = m.budget || null
  const parts = [
    m.effort || null,
    usd,
    hops && hops > 1 ? `${hops} hops` : null,
    toolCalls ? `${toolCalls} tool-calls` : null,
  ].filter(Boolean)
  if (parts.length === 0) return null
  const title = limits
    ? `Budget voor effort ${m.effort || '?'}: ${limits.tool_calls ?? '?'} tool-calls · ${limits.wall_ms ? Math.round(limits.wall_ms / 1000) + ' s' : '?'} · $${limits.usd ?? '?'}`
    : undefined
  return (
    <>
      <span className={s.asstMetaDot} />
      <span className={s.runBudget} title={title}>{parts.join(' · ')}</span>
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
