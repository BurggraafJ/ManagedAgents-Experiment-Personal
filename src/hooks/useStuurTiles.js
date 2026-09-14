import { useCallback, useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'

/**
 * useStuurTiles — de drie critical numbers achter de stuurkaarten op de
 * mobiele Home (v1.176): D1 (aanvoer), D9 (forecast-blokkers) en D10 (B als
 * stuurgetal, C ernaast).
 *
 * Zes lichte reads op de metric-laag; de hook rekent niets uit behalve de
 * som over de fase-rijen die D1Kaarten en useHomeTiles ook maken. Elke waarde
 * komt uit dezelfde `v_d1_*` / `v_d9_*` / `v_d10_*`-views als de borden zelf,
 * zodat het getal op de tegel en het getal op het bord nooit uit elkaar lopen.
 *
 * Elke read faalt stil: een tegel zonder data toont "geen zicht", nooit een
 * foutmelding. Dat is hier extra belangrijk: de views lezen de HubSpot-mirror
 * en die eist beheerdersrechten plus tweede factor. Een member krijgt nul
 * rijen en géén fout — dan is het bord `null`, niet "0 blokkers".
 *
 * Staat náást `useHomeTiles` (kennisbank + agent-runs) in dezelfde tree.
 * Twee verschillende hooks naast elkaar mag; dezelfde hook twee keer niet
 * (pre-flight punt 4). Geen realtime: de mirror beweegt per 30 minuten, een
 * poll van vijf minuten is ruim genoeg (zie useD1Pipeline voor de channel-regel).
 *
 * Returns { d1, d9, d10, loading, refresh }
 *   d1   { kennismakingen, doel, gemiddeld4wk, actief, perFase[], minutenOud, verouderd, peildatum } | null
 *   d9   { aantal, noemer, blindVoor[], peildatum, minutenOud } | null
 *   d10  { b: rij, c: rij, proeven, peildatum, minutenOud } | null   (rijen uit v_d10_kop)
 *
 * `peildatum` en `minutenOud` staan sinds v1.189 op alle drie: de tegel toont
 * de laatste peiling van zijn bord ("13-09 00:04"), uit dezelfde `v_d*_meta`
 * als de standaardbalk van het bord zelf. Zeven reads, niet zes: D9 had nog
 * geen meta-read, alleen de blokkerteller.
 */
const POLL_MS = 5 * 60 * 1000

export function useStuurTiles() {
  const [d1, setD1] = useState(null)
  const [d9, setD9] = useState(null)
  const [d10, setD10] = useState(null)
  const [loading, setLoading] = useState(true)

  const fetchAll = useCallback(async () => {
    const safe = (q) => Promise.resolve(q).then(r => r).catch(() => ({ data: null }))
    const [meta1, kop1, fase1, blok9, meta9, kop10, meta10] = await Promise.all([
      safe(supabase.from('v_d1_meta').select('peildatum,minuten_oud,mirror_verouderd,deals_zichtbaar').maybeSingle()),
      safe(supabase.from('v_d1_aanvoer_kop').select('kennismakingen,doel,km_gemiddeld_4wk,week_start,week_eind').maybeSingle()),
      safe(supabase.from('v_d1_pipeline_per_fase').select('fase,aantal,volgnummer').order('volgnummer', { ascending: true })),
      safe(supabase.from('v_d9_forecast_blokkers').select('aantal,noemer,blind_voor').maybeSingle()),
      safe(supabase.from('v_d9_meta').select('peildatum,minuten_oud').maybeSingle()),
      safe(supabase.from('v_d10_kop').select('soort,deze_maand,vorige_maand,laatste_13_maanden,churn_label').order('volgnummer', { ascending: true })),
      safe(supabase.from('v_d10_meta').select('peildatum,minuten_oud,deals_zichtbaar,proeven').maybeSingle()),
    ])

    // D1: zichtbaar zolang de mirror rijen geeft. De fase-view geeft altijd
    // drie rijen; nul rijen = niet gelezen, niet "geen pipeline".
    const fasen = fase1.data || []
    const m1 = meta1.data
    setD1((!m1 || (m1.deals_zichtbaar ?? 0) === 0 || fasen.length === 0) ? null : {
      kennismakingen: kop1.data?.kennismakingen ?? null,
      doel: kop1.data?.doel ?? null,
      gemiddeld4wk: kop1.data?.km_gemiddeld_4wk ?? null,
      actief: fasen.reduce((n, f) => n + (f.aantal || 0), 0),
      perFase: fasen,
      minutenOud: m1.minuten_oud ?? null,
      verouderd: !!m1.mirror_verouderd,
      peildatum: m1.peildatum || null,
    })

    // D9: de view geeft één rij met noemer 0 als de kijker niets ziet.
    const b9 = blok9.data
    setD9((!b9 || (b9.noemer ?? 0) === 0) ? null : {
      aantal: b9.aantal ?? null,
      noemer: b9.noemer ?? null,
      blindVoor: b9.blind_voor || [],
      peildatum: meta9.data?.peildatum || null,
      minutenOud: meta9.data?.minuten_oud ?? null,
    })

    // D10: altijd drie rijen (A, B, C) zolang de kijker de mirror mag lezen.
    const rijen = kop10.data || []
    const m10 = meta10.data
    const b = rijen.find(r => r.soort === 'B')
    const c = rijen.find(r => r.soort === 'C')
    setD10((!m10 || (m10.deals_zichtbaar ?? 0) === 0 || !b || !c) ? null : {
      b, c,
      proeven: m10.proeven ?? null,
      peildatum: m10.peildatum || null,
      minutenOud: m10.minuten_oud ?? null,
    })

    setLoading(false)
  }, [])

  useEffect(() => {
    fetchAll()
    const id = setInterval(fetchAll, POLL_MS)
    return () => clearInterval(id)
  }, [fetchAll])

  return { d1, d9, d10, loading, refresh: fetchAll }
}
