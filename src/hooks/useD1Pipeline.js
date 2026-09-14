import { useCallback, useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'

/**
 * useD1Pipeline — data achter het pipelinebord D1 (/pipeline).
 *
 * Negen lichte reads op de metric-laag; de hook rekent niets uit. Elke KPI is
 * één view met zijn eigen peildatum (skill `dashboarding`, bouwproces.md:
 * "de UI rekent niet"). Dat is bewust een breuk met het patroon van
 * `KpiStrip.jsx`, dat client-side over de volledige array optelde — precies
 * daardoor kon het klantverlies-getal jarenlang fout staan zonder dat iemand
 * het zag.
 *
 *   v_d1_meta                peildatum, zichtbaarheid, de constateringen
 *   v_d1_aanvoer_kop         het critical number (kennismakingen/week)
 *   v_d1_aanvoer             twaalf weken aanvoer + de proxy
 *   v_d1_pipeline_per_fase   de trechter — fase 1, 2, 3, altijd alle drie
 *   v_d1_dekking             plafond fase 3 tegen het kwartaaldoel
 *   v_d1_win_rate            vier hoeken van één bandbreedte
 *   v_d1_forecast_per_maand  bodem/plafond per maand op beslisdatum
 *   v_d1_ontleding           fase · stage · eigenaar
 *   v_d1_waarde              de open deals zelf — het detailpaneel achter een
 *                            regel in "Landt het?". Bewust dezelfde view waar
 *                            v_d1_forecast_per_maand en v_d1_ontleding op
 *                            rusten, zodat een deal in het paneel en in de
 *                            telling links één en dezelfde rij is.
 *   v_d1_waarde (2×)         nog eens, maar op kennismakingsdatum in plaats van
 *                            op is_open: de deals achter één staaf van de
 *                            aanvoerstrip (C1 → zone 4). Open én gesloten, want
 *                            een kennismaking van week 34 kan intussen gewonnen
 *                            of verloren zijn; alleen de open deals tonen zou
 *                            een deel van de staaf stil weglaten.
 *   v_d1_werkbord_tellers    de vier werklijsten mét hun (mogelijk nul) telling
 *   v_d1_werkbord            de regels achter die lijsten
 *   v_d9_forecast_blokkers   het critical number van D9 — bewust hergebruikt,
 *                            zodat "N van 32 open deals heeft een blokkerende
 *                            fout" op beide borden hetzelfde getal is.
 *
 * Geen realtime: de pipeline beweegt op het tempo van de HubSpot-sync (delta
 * elke 30 minuten), dus een poll van vijf minuten is ruim genoeg en scheelt een
 * channel. Zou dit ooit realtime worden, dan via `createRealtimeChannel('d1-live')`
 * uit lib/supabase — nooit de kale supabase-channel-helper met een vaste naam
 * (CLAUDE.md hard-rule; twee incidenten, sessie 12 en 15). De pre-flight-grep
 * op die helper moet leeg blijven, ook op commentaar.
 *
 * Foutafhandeling met opzet: `deals_zichtbaar === 0` is géén fout maar een
 * toestand die twee dingen kan betekenen — er zijn geen records, óf de kijker
 * mist rechten (hubspot_deals eist is_admin_or_higher() + session_mfa_ok()).
 * De view geeft dan nul rijen en geen foutmelding. Ontbreekt de metric-laag
 * helemaal, dan geeft PostgREST 42P01 en zetten we `schemaMissing`.
 */
const POLL_MS = 5 * 60 * 1000

/**
 * De maandag van elf weken terug — de eerste week die `v_d1_aanvoer` toont.
 * Die view bouwt zijn venster met `date_trunc('week', current_date)` en
 * `generate_series(0, 11)`; deze grens is dezelfde rekensom in JS, zodat de
 * lijst achter een staaf nooit een week mist die de strip wél tekent.
 *
 * Dit is geen bordgetal maar een queryvenster: de tellingen blijven in de view
 * (G5). Wat hier gebeurt is bepalen wélke rijen opgehaald worden.
 */
function vensterStart() {
  const d = new Date()
  d.setHours(12, 0, 0, 0)                     // middag: geen zomertijd-randgeval
  const maandagOffset = (d.getDay() + 6) % 7  // zo=0 → 6, ma=1 → 0
  d.setDate(d.getDate() - maandagOffset - 11 * 7)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

export function useD1Pipeline() {
  const [meta, setMeta] = useState(null)
  const [aanvoerKop, setAanvoerKop] = useState(null)
  const [aanvoer, setAanvoer] = useState([])
  const [perFase, setPerFase] = useState([])
  const [dekking, setDekking] = useState(null)
  const [winRate, setWinRate] = useState([])
  const [forecast, setForecast] = useState([])
  const [ontleding, setOntleding] = useState([])
  const [deals, setDeals] = useState([])
  const [aanvoerDeals, setAanvoerDeals] = useState([])
  const [werkbordTellers, setWerkbordTellers] = useState([])
  const [werkbord, setWerkbord] = useState([])
  const [blokkers, setBlokkers] = useState(null)

  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const [schemaMissing, setSchemaMissing] = useState(false)
  const [refreshedAt, setRefreshedAt] = useState(null)

  const fetchAll = useCallback(async () => {
    const res = await Promise.all([
      supabase.from('v_d1_meta').select('*').maybeSingle(),
      supabase.from('v_d1_aanvoer_kop').select('*').maybeSingle(),
      supabase.from('v_d1_aanvoer').select('*').order('week_start', { ascending: true }),
      supabase.from('v_d1_pipeline_per_fase').select('*').order('volgnummer', { ascending: true }),
      supabase.from('v_d1_dekking').select('*').maybeSingle(),
      supabase.from('v_d1_win_rate').select('*').order('volgnummer', { ascending: true }),
      supabase.from('v_d1_forecast_per_maand').select('*').order('volgnummer', { ascending: true }),
      supabase.from('v_d1_ontleding').select('*').order('volgnummer', { ascending: true }),
      // Alleen de open deals, en alleen de kolommen die het detailpaneel toont.
      // Honderd rijen van acht velden; de selectie gebeurt in de component,
      // maar geen enkel getál — elke som blijft in de view staan.
      supabase.from('v_d1_waarde')
        .select('deal_id,dealname,fase,fase_label,hubspot_owner_id,eigenaar,beslisdatum,mrr_bodem,mrr_plafond,waardeerbaar,dagen_open,hubspot_url')
        .eq('is_open', true)
        .order('mrr_plafond', { ascending: false, nullsFirst: false }),
      // De deals achter een staaf van de aanvoerstrip (C1 → zone 4, G7). Een
      // aparte query en niet een veld erbij op de regel hierboven: die gaat
      // over *open* deals, en een kennismaking van week 34 kan intussen
      // gewonnen of verloren zijn. Wie hier alleen de open deals zou tonen,
      // laat stilzwijgend een deel van de staaf weg — precies het soort
      // afwijking dat niemand opmerkt. Twaalf weken terug plus de lopende week
      // dekt exact het venster van v_d1_aanvoer.
      supabase.from('v_d1_waarde')
        .select('deal_id,dealname,fase,fase_label,stage_label,is_open,eigenaar,kennismaking,beslisdatum,mrr_bodem,mrr_plafond,hubspot_url')
        .gte('kennismaking', vensterStart())
        .order('kennismaking', { ascending: false }),
      supabase.from('v_d1_werkbord_tellers').select('*').order('lijst_volgnummer', { ascending: true }),
      supabase.from('v_d1_werkbord').select('*').order('dagen_open', { ascending: false, nullsFirst: false }),
      supabase.from('v_d9_forecast_blokkers').select('*').maybeSingle(),
    ])

    const firstError = res.map(r => r.error).find(Boolean)
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

    const [m, ak, av, pf, dk, wr, fc, on, dl, ad, wt, wb, bl] = res
    setSchemaMissing(false)
    setError(null)
    setMeta(m.data || null)
    setAanvoerKop(ak.data || null)
    setAanvoer(av.data || [])
    setPerFase(pf.data || [])
    setDekking(dk.data || null)
    setWinRate(wr.data || [])
    setForecast(fc.data || [])
    setOntleding(on.data || [])
    setDeals(dl.data || [])
    setAanvoerDeals(ad.data || [])
    setWerkbordTellers(wt.data || [])
    setWerkbord(wb.data || [])
    setBlokkers(bl.data || null)
    setRefreshedAt(new Date())
    setLoading(false)
  }, [])

  useEffect(() => {
    fetchAll()
    const id = setInterval(fetchAll, POLL_MS)
    return () => clearInterval(id)
  }, [fetchAll])

  return {
    meta, aanvoerKop, aanvoer, perFase, dekking, winRate, forecast,
    ontleding, deals, aanvoerDeals, werkbordTellers, werkbord, blokkers,
    loading, error, schemaMissing, refreshedAt, refresh: fetchAll,
  }
}
