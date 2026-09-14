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
//
// ── v1.193 · het plafond wordt bewerkbaar ───────────────────────────────────
// Jelle: "plafond €50 standaard, instelbaar per gebruiker (incl. Maestro = ook
// €50 default)". Twee opslagplekken, want Maestro is geen gebruiker:
//   • een mens  → `user_model_budget` (rij weg = terug naar de standaard)
//   • Maestro   → `dash_parameters.model_budget_maestro_eur`
// Beide remmen vandaag niets — geen Edge Function leest ze (GAP-3). Het scherm
// zegt dat erbij; een plafond dat stil doet alsof het begrenst is erger dan
// geen plafond.
export const STANDAARD_PLAFOND_EUR = 50

const PARAMS = ['model_budget_usd_per_eur', 'model_budget_maestro_eur']

export function useModelUsage() {
  const [usage, setUsage] = useState([])
  const [dekking, setDekking] = useState([])
  const [budget, setBudget] = useState([])
  const [params, setParams] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)

  const fetchAll = useCallback(async () => {
    setLoading(true)
    setError(null)
    const [u, d, b, k] = await Promise.all([
      supabase.from('v_user_model_usage_month').select('user_id, maand, vragen, cost_usd'),
      supabase.from('v_model_usage_dekking')
        // v1.192: de noemer in drie stukken. `systeem` = Maestro zelf (cron,
        // agents, scripts — rag-chat zag geen ingelogde gebruiker), `gat` =
        // herkend maar niet vastgelegd. Zie migratie 20260914160000.
        .select('maand, vragen_totaal, vragen_toegewezen, usd_totaal, usd_toegewezen, vragen_systeem, usd_systeem, vragen_gat, usd_gat')
        .order('maand', { ascending: false }),
      supabase.from('v_user_model_budget').select('user_id, monthly_cap_eur, alert_at_pct, paused, expliciet_gezet'),
      supabase.from('dash_parameters').select('sleutel, waarde').in('sleutel', PARAMS),
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
    // k.error is geen blokkade: geen parameterrij is een lege plek met reden,
    // geen fout die de hele pagina tegenhoudt.
    setParams(k.error ? [] : (k.data || []))
    setLoading(false)
  }, [])

  useEffect(() => { fetchAll() }, [fetchAll])

  const paramWaarde = useCallback(
    (sleutel) => {
      const rij = params.find(p => p.sleutel === sleutel)
      return rij ? (rij.waarde ?? null) : null
    },
    [params],
  )

  const koers = paramWaarde('model_budget_usd_per_eur')
  const maestroCap = paramWaarde('model_budget_maestro_eur')

  // De maanden die je kunt kiezen, nieuwste eerst. De HUIDIGE maand hoort er
  // altijd bij, ook als er nog geen vraag in staat: "deze maand nul gemeten" is
  // een antwoord, en een kiezer die de maand van vandaag weglaat lijkt stuk.
  const maanden = useMemo(() => {
    const nu = new Date()
    const dezeMaand = `${nu.getFullYear()}-${String(nu.getMonth() + 1).padStart(2, '0')}-01`
    const s = new Set([dezeMaand, ...dekking.map(r => r.maand), ...usage.map(r => r.maand)])
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

  // De vragen achter het bedrag van één persoon. Bewust lui: een totaal per
  // persoon haal je in drie selects op, de vragen zelf zijn honderden rijen met
  // vraagtekst erin en die haal je pas op als er iemand op klikt.
  const loadDetail = useCallback(async (userId, maand) => {
    const { data, error: err } = await supabase
      .from('v_user_model_usage_detail')
      .select('id, asked_at, question, route, answer_model, est_cost_usd, latency_ms, answer_chars, fout')
      .eq('user_id', userId)
      .eq('maand', maand)
      .order('asked_at', { ascending: false })
      .limit(200)
    if (err) throw new Error(err.message)
    return data || []
  }, [])

  // ── Het plafond zetten ────────────────────────────────────────────────────
  // Zelfde regel als bij de rechten-matrix: **gelijk aan de standaard = geen
  // eigen rij.** Dan betekent "eigen plafond" in de kolom altijd "hier is
  // bewust van €50 afgeweken", en levert "terug naar de standaard" zichzelf op
  // — een rij weggooien in plaats van er 50 in schrijven.
  const setUserCap = useCallback(async (userId, eurWaarde) => {
    if (eurWaarde === null || Number(eurWaarde) === STANDAARD_PLAFOND_EUR) {
      const { error: delErr } = await supabase
        .from('user_model_budget').delete().eq('user_id', userId)
      if (delErr) throw new Error(delErr.message)
    } else {
      const { data: sessie } = await supabase.auth.getUser()
      const { error: upErr } = await supabase.from('user_model_budget').upsert({
        user_id: userId,
        monthly_cap_eur: Number(eurWaarde),
        updated_at: new Date().toISOString(),
        updated_by: sessie?.user?.id || null,
      }, { onConflict: 'user_id' })
      if (upErr) throw new Error(upErr.message)
    }
    await fetchAll()
  }, [fetchAll])

  // Maestro heeft geen rij in auth.users en dus geen rij in user_model_budget.
  // Zijn plafond is een parameter; leeg maken zet hem terug op de standaard.
  const setMaestroCapWaarde = useCallback(async (eurWaarde) => {
    const { error: upErr } = await supabase
      .from('dash_parameters')
      .update({
        waarde: eurWaarde === null ? STANDAARD_PLAFOND_EUR : Number(eurWaarde),
        peildatum: new Date().toISOString().slice(0, 10),
      })
      .eq('sleutel', 'model_budget_maestro_eur')
    if (upErr) throw new Error(upErr.message)
    await fetchAll()
  }, [fetchAll])

  return {
    usage, dekking, maanden, budgetByUser, koers, maestroCap,
    loading, error, refresh: fetchAll, forMonth, loadDetail,
    setUserCap, setMaestroCap: setMaestroCapWaarde,
  }
}

// ── Presentatie-helpers ────────────────────────────────────────────────────

export function usd(n) {
  if (n === null || n === undefined) return null
  return `$${Number(n).toLocaleString('nl-NL', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
}

// Eén vraag kost zelden meer dan een cent ($0,0054 is een gewone rij). Met twee
// decimalen wordt de hele doorkijk een kolom $0,00 en $0,01 — een tabel die
// niets onderscheidt. Onder de cent dus vier decimalen, daarboven twee.
export function usdFijn(n) {
  if (n === null || n === undefined) return null
  const v = Number(n)
  const d = Math.abs(v) < 0.01 ? 4 : 2
  return `$${v.toLocaleString('nl-NL', { minimumFractionDigits: d, maximumFractionDigits: d })}`
}

// Een plafond is meestal een rond bedrag (€50, €150). Zet de owner er €12,50
// neer, dan hoort daar €12,50 te staan en niet €13 — een afgerond plafond leest
// als het plafond en is het niet.
export function eur(n) {
  if (n === null || n === undefined) return null
  const v = Number(n)
  const d = Number.isInteger(v) ? 0 : 2
  return `€${v.toLocaleString('nl-NL', { minimumFractionDigits: d, maximumFractionDigits: d })}`
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
