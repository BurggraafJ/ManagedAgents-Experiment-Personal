import { useCallback, useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'

/**
 * useD10Verlies — data achter de stuurbordzone van /klantverlies (D10).
 *
 * Acht lichte reads op de metric-laag; de hook rekent niets uit. Elke waarde
 * komt uit een view met zijn eigen peildatum (skill `dashboarding`,
 * bouwproces.md: "de UI rekent niet"). Dat is bewust de breuk met
 * `KpiStrip.jsx`, dat client-side over de churn-array optelde en daardoor
 * jarenlang "Totaal verloren 18" kon tonen — B en C op één hoop, bijna twintig
 * keer de werkelijke churn, zonder dat iemand het zag.
 *
 *   v_d10_meta                     peildatum, zichtbaarheid, noemer in twee
 *                                  tellingen, dossier-achterstand, AFAS-status
 *   v_d10_kop                      de drie kaarten A · B · C, altijd drie rijen
 *   v_d10_verlies_per_soort_maand  13 maanden × 3 soorten = 39 rijen, ook nul
 *   v_d10_redenen                  redenen mét bron-kolom, nooit gemengd
 *   v_d10_verlengingskalender      het CS-werkbord vooruit
 *   v_d10_proeven_lopend           de lopende proeven met hun einde
 *   v_d10_verlies_records          niveau 3 van het drill-pad
 *   events_annotaties              de markeringen op de tijdas
 *
 * Deze hook staat **náást** `useChurnData`, niet in plaats daarvan: die blijft
 * de dossierlaag (AI-samenvatting, categorieën, notitie) voeden. Ze draaien in
 * dezelfde tree, elk op hun eigen plek — `useChurnData` in `KlantverliesV2View`,
 * deze in `D10Zone`. Dezelfde hook twee keer in één tree is wat pre-flight punt
 * 4 verbiedt; twee verschillende hooks naast elkaar is gewoon toegestaan.
 *
 * Geen realtime: dit bord leest de HubSpot-mirror, en die beweegt op het tempo
 * van de sync (delta elke 30 minuten). Een poll van vijf minuten is ruim genoeg
 * en scheelt een channel. Zou dit ooit realtime worden, dan via
 * `createRealtimeChannel('d10-live')` uit lib/supabase — nooit een kale
 * channel-aanroep met een vaste naam (CLAUDE.md hard-rule, sessie 12 en 15).
 *
 * Foutafhandeling met opzet: `deals_zichtbaar === 0` is géén fout maar een
 * toestand die twee dingen kan betekenen — er zijn geen records, óf de kijker
 * mist rechten. `/klantverlies` is niet `adminOnly`, terwijl `hubspot_deals`
 * wél `is_admin_or_higher()` + `session_mfa_ok()` eist. Een member ziet dus nul
 * rijen en géén foutmelding; het bord moet dat als "geen rechten" tonen en niet
 * als "nul verliezen". Ontbreekt de metric-laag helemaal, dan geeft PostgREST
 * 42P01 en zetten we `schemaMissing`.
 */
const POLL_MS = 5 * 60 * 1000

export function useD10Verlies() {
  const [meta, setMeta] = useState(null)
  const [kop, setKop] = useState([])
  const [maandreeks, setMaandreeks] = useState([])
  const [redenen, setRedenen] = useState([])
  const [verlenging, setVerlenging] = useState([])
  const [proeven, setProeven] = useState([])
  const [records, setRecords] = useState([])
  const [annotaties, setAnnotaties] = useState([])

  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const [schemaMissing, setSchemaMissing] = useState(false)
  const [refreshedAt, setRefreshedAt] = useState(null)

  const fetchAll = useCallback(async () => {
    const res = await Promise.all([
      supabase.from('v_d10_meta').select('*').maybeSingle(),
      supabase.from('v_d10_kop').select('*').order('volgnummer', { ascending: true }),
      supabase.from('v_d10_verlies_per_soort_maand').select('*')
        .order('maand', { ascending: true }).order('volgnummer', { ascending: true }),
      supabase.from('v_d10_redenen').select('*')
        .order('blok', { ascending: true }).order('sort_order', { ascending: true }),
      supabase.from('v_d10_verlengingskalender').select('*')
        .order('verlengingsmoment', { ascending: true, nullsFirst: false }),
      supabase.from('v_d10_proeven_lopend').select('*')
        .order('einddatum', { ascending: true, nullsFirst: false }),
      supabase.from('v_d10_verlies_records').select('*')
        .order('verliesdatum', { ascending: false, nullsFirst: false }),
      supabase.from('events_annotaties').select('datum, gebeurtenis, toelichting')
        .contains('borden', ['D10']).order('datum', { ascending: true }),
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

    const [m, k, mr, rd, vl, pr, rc, an] = res
    setSchemaMissing(false)
    setError(null)
    setMeta(m.data || null)
    setKop(k.data || [])
    setMaandreeks(mr.data || [])
    setRedenen(rd.data || [])
    setVerlenging(vl.data || [])
    setProeven(pr.data || [])
    setRecords(rc.data || [])
    setAnnotaties(an.data || [])
    setRefreshedAt(new Date())
    setLoading(false)
  }, [])

  useEffect(() => {
    fetchAll()
    const id = setInterval(fetchAll, POLL_MS)
    return () => clearInterval(id)
  }, [fetchAll])

  return {
    meta, kop, maandreeks, redenen, verlenging, proeven, records, annotaties,
    loading, error, schemaMissing, refreshedAt, refresh: fetchAll,
  }
}
