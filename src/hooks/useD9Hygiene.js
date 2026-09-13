import { useCallback, useEffect, useRef, useState } from 'react'
import { supabase } from '../lib/supabase'

/**
 * useD9Hygiene — data achter het hygiënebord D9 (/pipeline/hygiene).
 *
 * Vijf lichte reads op de metric-laag; de hook rekent niets uit. Elke KPI is
 * één view met zijn eigen peildatum (skill `dashboarding`, bouwproces.md:
 * "de UI rekent niet"). Dat is bewust een breuk met het patroon van
 * `KpiStrip.jsx`, dat client-side over de volledige array optelt — precies
 * daardoor kon het klantverlies-getal fout worden zonder dat iemand het zag.
 *
 *   v_d9_meta               peildatum, zichtbaarheid, welke properties er al zijn
 *   v_d9_checks             één rij per check (H1–H19)
 *   v_d9_tellers            openstaande fouten per datagebied
 *   v_d9_forecast_blokkers  het critical number
 *   v_d9_trend              acht weken per check (leeg tot de snapshots draaien)
 *
 * Geen realtime: hygiëne beweegt op het tempo van de HubSpot-sync (delta elke
 * 30 minuten), dus een poll van vijf minuten is ruim genoeg en scheelt een
 * channel. Zou dit ooit realtime worden, dan via `createRealtimeChannel('d9-live')`
 * uit lib/supabase — nooit de kale supabase-channel-helper met een vaste naam
 * (CLAUDE.md hard-rule; twee incidenten, sessie 12 en 15).
 *
 * Foutafhandeling met opzet: `deals_zichtbaar === 0` is géén fout maar een
 * toestand die twee dingen kan betekenen — er zijn geen records, óf de kijker
 * mist rechten (hubspot_deals eist is_admin_or_higher() + session_mfa_ok()).
 * De view geeft dan nul rijen en geen foutmelding; het bord moet dat verschil
 * zelf benoemen. Ontbreekt de metric-laag helemaal (migratie nog niet
 * uitgerold), dan geeft PostgREST 42P01 en zetten we `schemaMissing`.
 */
const POLL_MS = 5 * 60 * 1000
const RECORD_LIMIT = 200
const VIEW_NAME = /^v_d9_[a-z0-9_]+$/

export function useD9Hygiene() {
  const [meta, setMeta] = useState(null)
  const [checks, setChecks] = useState([])
  const [tellers, setTellers] = useState([])
  const [blokkers, setBlokkers] = useState(null)
  const [trend, setTrend] = useState({})
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const [schemaMissing, setSchemaMissing] = useState(false)
  const [refreshedAt, setRefreshedAt] = useState(null)

  // Recordlijsten per check, lazy geladen bij het openklappen van een regel.
  const [records, setRecords] = useState({})
  const recordsRef = useRef(records)
  recordsRef.current = records

  const fetchAll = useCallback(async () => {
    const [metaRes, checkRes, tellerRes, blokRes, trendRes] = await Promise.all([
      supabase.from('v_d9_meta').select('*').maybeSingle(),
      supabase.from('v_d9_checks').select('*').order('volgnummer', { ascending: true }),
      supabase.from('v_d9_tellers').select('*').order('sort_order', { ascending: true }),
      supabase.from('v_d9_forecast_blokkers').select('*').maybeSingle(),
      supabase.from('v_d9_trend').select('*'),
    ])

    const firstError = [metaRes, checkRes, tellerRes, blokRes, trendRes]
      .map(r => r.error).find(Boolean)
    if (firstError) {
      // 42P01 = relation does not exist → de migratie is nog niet uitgerold.
      if (firstError.code === '42P01' || /does not exist/i.test(firstError.message || '')) {
        setSchemaMissing(true)
        setError(null)
      } else {
        setError(firstError.message || String(firstError))
      }
      setLoading(false)
      return
    }

    setSchemaMissing(false)
    setError(null)
    setMeta(metaRes.data || null)
    setChecks(checkRes.data || [])
    setTellers(tellerRes.data || [])
    setBlokkers(blokRes.data || null)
    setTrend(Object.fromEntries((trendRes.data || []).map(t => [t.check_id, t])))
    setRefreshedAt(new Date())
    setLoading(false)
  }, [])

  useEffect(() => {
    fetchAll()
    const id = setInterval(fetchAll, POLL_MS)
    return () => clearInterval(id)
  }, [fetchAll])

  /**
   * Niveau 3 van het drill-pad: de records achter één check. De viewnaam komt
   * uit v_d9_checks.records_view — de koppeling check ↔ lijst staat dus in de
   * data en niet in JSX. De regex is een slot op die waarde: alleen onze eigen
   * v_d9_*-views mogen hier langs.
   */
  const loadRecords = useCallback(async (check) => {
    const view = check?.records_view
    if (!view || !VIEW_NAME.test(view)) return
    const key = check.check_id
    if (recordsRef.current[key]?.rows || recordsRef.current[key]?.loading) return

    setRecords(prev => ({ ...prev, [key]: { loading: true, rows: null, error: null } }))
    const { data, error: err } = await supabase
      .from(view)
      .select('*')
      .order('dagen_open', { ascending: false, nullsFirst: false })
      .limit(RECORD_LIMIT)

    setRecords(prev => ({
      ...prev,
      [key]: {
        loading: false,
        rows: err ? null : (data || []),
        error: err ? (err.message || String(err)) : null,
        afgekapt: !err && (data || []).length >= RECORD_LIMIT,
      },
    }))
  }, [])

  return {
    meta, checks, tellers, blokkers, trend, records,
    loading, error, schemaMissing, refreshedAt,
    loadRecords, refresh: fetchAll,
  }
}
