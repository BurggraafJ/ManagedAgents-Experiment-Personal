import { useCallback, useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'

/**
 * useHomeTiles — data achter de dashboard-tegels op Home (v1.158).
 *
 * Bewust klein gehouden: twee lichte reads op `agent_runs`, één count op
 * `kb_articles` en sinds v1.174 één read op `v_d1_pipeline_per_fase` voor de
 * Sales-pipeline-tegel. De overige tegels zijn placeholders tot we per dashboard
 * afspreken wát erin komt — die hoeven dus geen query.
 *
 * Elke read faalt stil: een tegel zonder data toont "Dashboard nog leeg",
 * nooit een foutmelding of een leeg scherm. Voor de pipeline-tegel is dat extra
 * belangrijk: `v_d1_pipeline_per_fase` leest de HubSpot-mirror, en die is
 * afgeschermd met beheerdersrechten plus tweede factor. Een member krijgt nul
 * rijen en géén fout — dan blijft de tegel leeg in plaats van "0 deals" te
 * beweren.
 *
 * Returns:
 *  - runs7d       { total, ok, rate, spark[7] }  runs van de afgelopen 7 dagen
 *  - today        { runs[], agents, lastAt }     runs van vandaag (strip)
 *  - kbArticles   aantal artikelen in de kennisbank (of null)
 *  - pipeline     { actief, perFase[] } of null   open sales-deals per fase
 *  - loading
 */
const POLL_MS = 5 * 60 * 1000
const DAY = 86400000

export function useHomeTiles() {
  const [runs7d, setRuns7d] = useState({ total: 0, ok: 0, rate: null, spark: [] })
  const [today, setToday] = useState({ runs: [], agents: 0, lastAt: null })
  const [kbArticles, setKbArticles] = useState(null)
  const [pipeline, setPipeline] = useState(null)
  const [loading, setLoading] = useState(true)

  const fetchAll = useCallback(async () => {
    const safeQ = (q) => Promise.resolve(q).then(r => r).catch(() => ({ data: null, count: null }))
    const since7d = new Date(Date.now() - 7 * DAY).toISOString()
    const midnight = new Date()
    midnight.setHours(0, 0, 0, 0)

    const [weekRes, todayRes, kbRes, pipeRes] = await Promise.all([
      safeQ(supabase.from('agent_runs')
        .select('status,started_at')
        .gte('started_at', since7d)
        .limit(2000)),
      safeQ(supabase.from('agent_runs')
        .select('id,agent_name,status,summary,started_at')
        .gte('started_at', midnight.toISOString())
        .order('started_at', { ascending: false })
        .limit(40)),
      safeQ(supabase.from('kb_articles').select('id', { count: 'exact', head: true })),
      safeQ(supabase.from('v_d1_pipeline_per_fase')
        .select('fase,aantal,volgnummer')
        .order('volgnummer', { ascending: true })),
    ])

    const week = weekRes.data || []
    const ok = week.filter(r => r.status === 'success').length
    // Zeven dag-emmers, oud → nieuw; voedt de spark onderin de tegel.
    const spark = Array.from({ length: 7 }, (_, i) => {
      const start = new Date()
      start.setHours(0, 0, 0, 0)
      start.setTime(start.getTime() - (6 - i) * DAY)
      const end = start.getTime() + DAY
      return week.filter(r => {
        const t = new Date(r.started_at).getTime()
        return t >= start.getTime() && t < end
      }).length
    })
    setRuns7d({
      total: week.length,
      ok,
      rate: week.length ? Math.round((ok / week.length) * 100) : null,
      spark,
    })

    const rows = todayRes.data || []
    setToday({
      runs: rows,
      agents: new Set(rows.map(r => r.agent_name)).size,
      lastAt: rows[0]?.started_at || null,
    })

    setKbArticles(typeof kbRes.count === 'number' ? kbRes.count : null)

    // De view geeft altijd drie rijen (fase 1, 2, 3), ook als een fase leeg is.
    // Nul rijen betekent dus niet "geen pipeline" maar "niet gelezen" — geen
    // rechten, of de metric-laag staat er nog niet. Dan blijft de tegel leeg.
    const fasen = pipeRes.data || []
    setPipeline(fasen.length === 0 ? null : {
      actief: fasen.reduce((n, f) => n + (f.aantal || 0), 0),
      perFase: fasen,
    })

    setLoading(false)
  }, [])

  useEffect(() => {
    fetchAll()
    const id = setInterval(fetchAll, POLL_MS)
    return () => clearInterval(id)
  }, [fetchAll])

  return { runs7d, today, kbArticles, pipeline, loading, refresh: fetchAll }
}
