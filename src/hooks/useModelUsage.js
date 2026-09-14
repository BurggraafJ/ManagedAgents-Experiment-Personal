import { useCallback, useEffect, useMemo, useState } from 'react'
import { supabase } from '../lib/supabase'

// Multi-user · wat verbruiken de mensen aan betaalde model-calls, en hoeveel
// daarvan weten we eigenlijk? (beslissing 5, Jelle 2026-09-14)
//
// ⚠ Drie waarschuwingen die het scherm moet dragen, niet verstoppen:
//
// 1. **De noemer.** `v_user_model_usage_month` telt alleen vragen die aan een
//    persoon te koppelen zijn — via rag_chat_query_log → agent_chat_runs
//    .caller_user_id. In september 2026 was dat 37 van de 311 vragen. Een
//    bedrag per persoon zonder die noemer leest als het hele verhaal terwijl
//    het een achtste is. Daarom komt `v_model_usage_dekking` altijd mee.
//    Zelfde regel als DOC-10/11/12 in de agent-docs: `1/4` is een ander
//    bericht dan `1/1`, en `0/0` is geen groen maar een onthouding.
//
// 2. **De munt.** Het plafond staat in euro (€50), de meting in dollar
//    (est_cost_usd). De koers staat als `model_budget_usd_per_eur` in
//    dash_parameters met waarde NULL — bewust, want een zelf gekozen koers is
//    een verzonnen getal. Zolang die leeg is rekent dit scherm niets om en
//    toont het geen percentage van het plafond. Twee getallen naast elkaar,
//    met de reden erbij.
//
// 3. **Het plafond is geen rem.** `user_model_budget` bestaat, staat op €50 en
//    wordt door geen enkele Edge Function gelezen. Het is een schema, geen
//    begrenzing (P0-IMPL-NOTES restrisico 2).
//
// Wat er NIET in zit: claude_api_calls. Die tabel is dood — 253 rijen, laatste
// 2026-05-19 (geheugen claude-api-calls-telemetry-is-dead). Hem meenemen zou
// nullen opleveren die als "gebruikt niets" lezen.
export function useModelUsage() {
  const [usage, setUsage] = useState([])
  const [dekking, setDekking] = useState([])
  const [budget, setBudget] = useState([])
  const [koers, setKoers] = useState(undefined) // undefined = nog niet geladen
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)

  const fetchAll = useCallback(async () => {
    setLoading(true)
    setError(null)
    const [u, d, b, k] = await Promise.all([
      supabase.from('v_user_model_usage_month').select('user_id, maand, vragen, cost_usd'),
      supabase.from('v_model_usage_dekking')
        .select('maand, vragen_totaal, vragen_toegewezen, usd_totaal, usd_toegewezen')
        .order('maand', { ascending: false }),
      supabase.from('v_user_model_budget').select('user_id, monthly_cap_eur, alert_at_pct, paused, expliciet_gezet'),
      supabase.from('dash_parameters').select('waarde').eq('sleutel', 'model_budget_usd_per_eur').maybeSingle(),
    ])
    const err = u.error || d.error || b.error
    if (err) {
      setError(err.message)
      setLoading(false)
      return
    }
    setUsage(u.data || [])
    setDekking(d.data || [])
    setBudget(b.data || [])
    // k.error is geen blokkade: geen koers is het verwachte geval.
    setKoers(k.error ? null : (k.data?.waarde ?? null))
    setLoading(false)
  }, [])

  useEffect(() => { fetchAll() }, [fetchAll])

  // De maanden waarvoor er überhaupt iets te zien is, nieuwste eerst.
  const maanden = useMemo(() => {
    const s = new Set([...dekking.map(r => r.maand), ...usage.map(r => r.maand)])
    return [...s].filter(Boolean).sort().reverse()
  }, [dekking, usage])

  const budgetByUser = useMemo(
    () => new Map(budget.map(r => [r.user_id, r])),
    [budget],
  )

  // Alles voor één maand bij elkaar.
  const forMonth = useCallback((maand) => {
    const perUser = new Map()
    for (const r of usage) {
      if (r.maand === maand) perUser.set(r.user_id, r)
    }
    const dek = dekking.find(r => r.maand === maand) || null
    return { perUser, dekking: dek }
  }, [usage, dekking])

  return {
    usage, dekking, maanden, budgetByUser, koers,
    loading, error, refresh: fetchAll, forMonth,
  }
}

// ── Presentatie-helpers ────────────────────────────────────────────────────

export function usd(n) {
  if (n === null || n === undefined) return null
  return `$${Number(n).toLocaleString('nl-NL', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
}

export function eur(n) {
  if (n === null || n === undefined) return null
  return `€${Number(n).toLocaleString('nl-NL', { minimumFractionDigits: 0, maximumFractionDigits: 0 })}`
}

export function maandLabel(iso) {
  if (!iso) return '—'
  try {
    return new Date(iso).toLocaleDateString('nl-NL', { month: 'long', year: 'numeric' })
  } catch { return iso }
}

// Het percentage toegewezen, als er iets te delen valt. 0 van 0 is géén 0 % —
// dat is een onthouding, en die geeft null terug.
export function dekkingPct(dek) {
  if (!dek || !dek.vragen_totaal) return null
  return Math.round((dek.vragen_toegewezen / dek.vragen_totaal) * 100)
}
