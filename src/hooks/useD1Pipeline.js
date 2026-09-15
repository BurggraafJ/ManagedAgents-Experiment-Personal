import { useCallback, useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'

/**
 * useD1Pipeline — data achter het pipelinebord D1 (/pipeline Live en Monthly).
 *
 * Lichte reads op de metric-laag; de hook rekent niets uit. Elke kaart is één
 * view met zijn eigen peildatum (skill `dashboarding`, bouwproces.md: "de UI
 * rekent niet"). Dat is bewust een breuk met het patroon van `KpiStrip.jsx`,
 * dat client-side optelde — precies daardoor kon het klantverlies-getal
 * jarenlang fout staan zonder dat iemand het zag.
 *
 *   v_d1_meta                peildatum, zichtbaarheid, de constateringen
 *   v_d1_aanvoer_kop         het critical number (kennismakingen/week, doel 8)
 *   v_d1_aanvoer             twaalf weken kennismakingen (+ lic mid)
 *   v_d1_aanvoer_gepland     vier weken vooruit: geplande kennismakingen
 *   v_d1_pipeline_per_fase   fase 1 · 2 · 3, altijd alle drie (Waarde)
 *   v_d1_fase_aging          mediaan · P90 · te lang per fase (Tijd in fase)
 *   v_d1_forecast_per_maand  fase 3 en fase 1–2 per maand op beslisdatum (Landt het?)
 *   v_d1_beweging_week       instroom · gewonnen · verloren per week (Beweging)
 *   v_d1_kanaal              open deals per hs_analytics_source (Kanaal)
 *   v_d1_kantoorgrootte      open deals per advocaten-band × fase (Kantoorgrootte)
 *   v_d1_dekking · v_d1_win_rate · v_d1_ontleding   — de Monthly-pagina
 *   v_d1_waarde (3×)         de deals zelf voor het detailpaneel: de open deals
 *                            (fase · maand · kanaal · band · waarde), de deals
 *                            met een kennismaking in het venster (week-staaf,
 *                            open én gesloten) en de deals die in het venster
 *                            binnenkwamen of sloten (Beweging).
 *   v_d9_forecast_blokkers   hetzelfde blokkergetal als op D9
 *
 * Geen realtime: de pipeline beweegt op het tempo van de HubSpot-sync (delta
 * elke 30 minuten), dus een poll van vijf minuten is ruim genoeg en scheelt een
 * channel. Zou dit ooit realtime worden, dan via `createRealtimeChannel('d1-live')`
 * uit lib/supabase — nooit de kale supabase-channel-helper met een vaste naam
 * (CLAUDE.md hard-rule; twee incidenten, sessie 12 en 15).
 *
 * Foutafhandeling met opzet: `deals_zichtbaar === 0` is géén fout maar een
 * toestand die twee dingen kan betekenen — er zijn geen records, óf de kijker
 * mist rechten (hubspot_deals eist is_admin_or_higher() + session_mfa_ok()).
 * Ontbreekt de metric-laag, dan geeft PostgREST 42P01 en zetten we `schemaMissing`.
 */
const POLL_MS = 5 * 60 * 1000

/**
 * De maandag van elf weken terug — de eerste week die `v_d1_aanvoer` en
 * `v_d1_beweging_week` tonen. Dezelfde rekensom als `date_trunc('week',
 * current_date)` + `generate_series(0, 11)` in de views, zodat de lijst achter
 * een staaf nooit een week mist die de chart wél tekent. Een queryvenster, geen
 * bordgetal (G5).
 */
export function vensterStart() {
  const d = new Date()
  d.setHours(12, 0, 0, 0)
  const maandagOffset = (d.getDay() + 6) % 7
  d.setDate(d.getDate() - maandagOffset - 11 * 7)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

const DEAL_VELDEN = [
  'deal_id', 'dealname', 'company_naam', 'fase', 'fase_label', 'stage_label', 'is_open',
  'hubspot_owner_id', 'eigenaar', 'hs_created_at', 'closedate', 'beslisdatum', 'kennismaking',
  'bodem_lic', 'plafond_lic', 'mid_lic', 'mrr_bodem', 'mrr_plafond', 'waardeerbaar',
  'dagen_open', 'dagen_in_fase', 'totale_omvang', 'segment_bucket', 'kantoorband', 'kanaal', 'hubspot_url',
].join(',')

export function useD1Pipeline() {
  const [data, setData] = useState({
    meta: null, aanvoerKop: null, aanvoer: [], gepland: [], perFase: [], aging: [],
    forecast: [], beweging: [], kanaal: [], grootte: [], dekking: null, winRate: [], ontleding: [],
    deals: [], aanvoerDeals: [], bewegingDeals: [], blokkers: null,
  })
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const [schemaMissing, setSchemaMissing] = useState(false)
  const [refreshedAt, setRefreshedAt] = useState(null)

  const fetchAll = useCallback(async () => {
    const start = vensterStart()
    const res = await Promise.all([
      supabase.from('v_d1_meta').select('*').maybeSingle(),
      supabase.from('v_d1_aanvoer_kop').select('*').maybeSingle(),
      supabase.from('v_d1_aanvoer').select('*').order('week_start', { ascending: true }),
      supabase.from('v_d1_aanvoer_gepland').select('*').order('week_start', { ascending: true }),
      supabase.from('v_d1_pipeline_per_fase').select('*').order('volgnummer', { ascending: true }),
      supabase.from('v_d1_fase_aging').select('*').order('volgnummer', { ascending: true }),
      supabase.from('v_d1_forecast_per_maand').select('*').order('volgnummer', { ascending: true }),
      supabase.from('v_d1_beweging_week').select('*').order('week_start', { ascending: true }),
      supabase.from('v_d1_kanaal').select('*').order('aantal', { ascending: false }),
      supabase.from('v_d1_kantoorgrootte').select('*').order('volgnummer', { ascending: true }),
      supabase.from('v_d1_dekking').select('*').maybeSingle(),
      supabase.from('v_d1_win_rate').select('*').order('volgnummer', { ascending: true }),
      supabase.from('v_d1_ontleding').select('*').order('volgnummer', { ascending: true }),
      // De open deals: één lijst, alle sneden van het Live-bord kiezen eruit
      // zonder te tellen (fase · maand · kanaal · band · waarde).
      supabase.from('v_d1_waarde').select(DEAL_VELDEN).eq('is_open', true)
        .order('dagen_in_fase', { ascending: false, nullsFirst: false }),
      // De deals achter een week-staaf: op kennismakingsdatum, open én gesloten
      // (een kennismaking van week 34 kan intussen gewonnen of verloren zijn),
      // inclusief de geplande kennismakingen in de komende vier weken.
      supabase.from('v_d1_waarde').select(DEAL_VELDEN).gte('kennismaking', start)
        .order('kennismaking', { ascending: true }),
      // De deals achter een bewegingsstaaf: binnengekomen óf gesloten in het venster.
      supabase.from('v_d1_waarde').select(DEAL_VELDEN)
        .or(`hs_created_at.gte.${start},closedate.gte.${start}`)
        .order('hs_created_at', { ascending: false }),
      supabase.from('v_d9_forecast_blokkers').select('*').maybeSingle(),
    ])

    const firstError = res.map(r => r.error).find(Boolean)
    if (firstError) {
      // 42P01 = relation does not exist, 42703 = kolom bestaat niet → de
      // migratie 20260915130000 is nog niet uitgerold.
      if (['42P01', '42703'].includes(firstError.code) || /does not exist/i.test(firstError.message || '')) {
        setSchemaMissing(true)
        setError(null)
      } else {
        setError(firstError.message || String(firstError))
      }
      setLoading(false)
      return
    }

    const [m, ak, av, gp, pf, ag, fc, bw, kn, gr, dk, wr, on, dl, ad, bd, bl] = res
    setSchemaMissing(false)
    setError(null)
    setData({
      meta: m.data || null, aanvoerKop: ak.data || null, aanvoer: av.data || [], gepland: gp.data || [],
      perFase: pf.data || [], aging: ag.data || [], forecast: fc.data || [], beweging: bw.data || [],
      kanaal: kn.data || [], grootte: gr.data || [], dekking: dk.data || null, winRate: wr.data || [],
      ontleding: on.data || [], deals: dl.data || [], aanvoerDeals: ad.data || [],
      bewegingDeals: bd.data || [], blokkers: bl.data || null,
    })
    setRefreshedAt(new Date())
    setLoading(false)
  }, [])

  useEffect(() => {
    fetchAll()
    const id = setInterval(fetchAll, POLL_MS)
    return () => clearInterval(id)
  }, [fetchAll])

  return { ...data, loading, error, schemaMissing, refreshedAt, refresh: fetchAll }
}
