import { useEffect, useRef } from 'react'
import { supabase, createRealtimeChannel } from '../lib/supabase'

// =============================================================================
// useRunFollow — volg één of meer chatruns (agent_chat_runs) tot ze klaar zijn
// =============================================================================
// Spoor 02 I2 (v1.151). Sinds rag-chat v6.0 is een vraag een rij in
// agent_chat_runs; de motor schrijft daar stappen, phase_label, het groeiende
// antwoord (answer_partial, ~400 ms) en aan het eind answer_md + envelop. Deze
// hook is het oog van de browser op die rij. Wat hij bewaakt:
//
//   • realtime UITSLUITEND via createRealtimeChannel('agent-run') — hard-rule in
//     CLAUDE.md; een vaste channelnaam crasht bij dubbel mounten (twee incidenten).
//   • één kanaal per run met filter `id=eq.<run_id>`; bij SUBSCRIBED één select,
//     zodat wat vóór het abonnement gebeurde niet gemist wordt;
//   • een poll elke POLL_MS als vangnet (websocket-hik, laptop uit slaap, een
//     rij > 1 MB waarvan realtime velden laat vallen — RESEARCH §2.5/R2/R15);
//   • removeChannel + timer weg zodra de run terminaal is én bij unmount.
//
// De hook kent geen berichten: hij levert rijen af via `onRow(row)`; de
// afnemer (useRagChat) vertaalt een rij naar een chatbericht. `runIds` is de
// lijst runs die nog niet terminaal zijn — komt er een id bij (nieuwe vraag,
// of een sessie die na een reload een lopende run bevat), dan hecht hij aan;
// valt een id weg, dan koppelt hij los.
// =============================================================================

export const TERMINAL_STATES = new Set(['done', 'failed', 'cancelled'])
const POLL_MS = 5000
// Een run die de eigenaar niet (meer) kan lezen — verwijderd na de bewaartermijn,
// of nooit van deze gebruiker geweest — geven we na dit aantal lege polls op.
const MAX_EMPTY_POLLS = 4

export const RUN_ROW_COLUMNS = 'id, state, phase_label, route, effort, budget, spent, hop, hops, steps, answer_partial, answer_md, envelope, citations, analytics, input_request, error, query_log_id, meta, created_at, finished_at'

export function useRunFollow(runIds, onRow) {
  const onRowRef = useRef(onRow)
  onRowRef.current = onRow
  const followsRef = useRef(new Map())   // run_id → { channel, timer, emptyPolls }

  useEffect(() => {
    const wanted = new Set((runIds || []).filter(Boolean))
    const follows = followsRef.current

    const detach = (runId) => {
      const f = follows.get(runId)
      if (!f) return
      follows.delete(runId)
      if (f.timer) clearInterval(f.timer)
      if (f.channel) supabase.removeChannel(f.channel)
    }

    const handleRow = (runId, row) => {
      if (!row || !follows.has(runId)) return
      follows.get(runId).sawRow = true
      try { onRowRef.current?.(row) } catch (e) { console.warn('[run-follow] onRow failed', e) }
      if (TERMINAL_STATES.has(row.state)) detach(runId)
    }

    const fetchOnce = async (runId) => {
      const f = follows.get(runId)
      if (!f) return
      const { data, error } = await supabase
        .from('agent_chat_runs')
        .select(RUN_ROW_COLUMNS)
        .eq('id', runId)
        .maybeSingle()
      if (error) { console.warn('[run-follow] poll failed', error.message); return }
      if (!data) {
        // Nul rijen betekent niet altijd "bestaat niet". Het beleid is
        // `session_mfa_ok() AND owner_id = auth.uid()`, en `session_mfa_ok()` is
        // false zodra de sessie geen geldige tweede factor (meer) heeft — dan
        // geeft REST 0 rijen terwijl de run gewoon loopt. Realtime evalueert die
        // functie níét en blijft in dat geval wél leveren (gemeten in smoke S9,
        // 2026-09-07). Heeft dit kanaal ooit een rij geleverd, dan is "niet
        // zichtbaar" dus een onwaarheid en houden we onze mond.
        if (f.sawRow) return
        f.emptyPolls += 1
        if (f.emptyPolls >= MAX_EMPTY_POLLS) {
          handleRow(runId, { id: runId, state: 'failed', error: { code: 'not_visible', message: 'De run is niet (meer) zichtbaar voor deze gebruiker.' } })
        }
        return
      }
      f.emptyPolls = 0
      f.sawRow = true
      handleRow(runId, data)
    }

    const attach = (runId) => {
      if (follows.has(runId)) return
      const f = { channel: null, timer: null, emptyPolls: 0, sawRow: false }
      follows.set(runId, f)
      f.channel = createRealtimeChannel('agent-run')
        .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'agent_chat_runs', filter: `id=eq.${runId}` }, (payload) => {
          handleRow(runId, payload?.new)
        })
        .subscribe((status) => {
          if (status === 'SUBSCRIBED') fetchOnce(runId)
        })
      // Poll-vangnet (RESEARCH R15): zolang de run niet terminaal is.
      f.timer = setInterval(() => fetchOnce(runId), POLL_MS)
      // Eerste stand meteen — niet wachten op het abonnement.
      fetchOnce(runId)
    }

    for (const id of wanted) attach(id)
    for (const id of Array.from(follows.keys())) if (!wanted.has(id)) detach(id)
  }, [runIds])

  // Unmount: alles los. (Losse effect zodat de runIds-effect hierboven niet bij
  // elke wijziging alle kanalen sluit en heropent.)
  useEffect(() => {
    const follows = followsRef.current
    return () => {
      for (const [, f] of follows) {
        if (f.timer) clearInterval(f.timer)
        if (f.channel) supabase.removeChannel(f.channel)
      }
      follows.clear()
    }
  }, [])
}

// ── Eigenaarsacties op een run (twee SECURITY DEFINER-RPC's + resume) ─────────
export async function cancelRun(runId) {
  const { error } = await supabase.rpc('agent_chat_run_cancel', { p_run_id: runId })
  if (error) throw new Error(error.message || 'cancel_failed')
}

export async function resumeRun(runId, { SUPABASE_URL, SUPABASE_ANON_KEY }) {
  const session = (await supabase.auth.getSession()).data.session
  if (!session?.access_token) throw new Error('not_authenticated')
  const res = await fetch(`${SUPABASE_URL}/functions/v1/rag-chat`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${session.access_token}`, 'apikey': SUPABASE_ANON_KEY },
    body: JSON.stringify({ _run_id: runId, resume: true }),
  })
  const json = await res.json().catch(() => ({}))
  if (!res.ok || json.ok === false) throw new Error(json.error || `HTTP ${res.status}`)
  return json
}

// needs_input (V4): antwoord opslaan via de RPC, daarna de run hervatten.
export async function answerRunInput(runId, answer, env) {
  const { error } = await supabase.rpc('agent_chat_run_answer_input', { p_run_id: runId, p_answer: answer })
  if (error) throw new Error(error.message || 'answer_failed')
  return resumeRun(runId, env)
}
