import { useState, useCallback, useEffect } from 'react'
import s from './zoeken.module.css'
import { Ico } from './Icons'
import { supabase } from '../../../lib/supabase'

// WP4 — een antwoord met een tabel kun je meenemen. Spoor 05 (v2) maakt van de
// PDF-knop een écht bestand.
//
// Er wordt niets vooraf gebouwd: rag-chat zet in de envelop alleen
// `artifacts_available`, en pas een klik hier laat `agent-artifact-build` het
// bestand maken. Een xlsx die niemand opent kost rekentijd en opslag, en de
// meeste antwoorden worden gelezen in plaats van gedownload.
//
// De link is een signed URL van 24 uur op een private bucket, en het pad hangt
// aan de user-id. Geen open URL's: een uitdraai van de klantenportefeuille is
// geen ding dat je per ongeluk deelt.
//
// v2: PDF is geen `window.print()` meer maar dezelfde serverweg als xlsx/csv —
// dat levert een bestand mét verantwoording op, op elk apparaat, en het is wat
// een print-dialoog op een geïnstalleerde PWA niet kan. *Afdrukken* blijft
// daarnaast bestaan op desktop; die knop verdwijnt niet.
const LABELS = { xlsx: 'Excel', csv: 'CSV', pdf: 'PDF' }
const TITELS = { xlsx: 'Download als Excel', csv: 'Download als CSV', pdf: 'Download als PDF (met verantwoording)' }

export default function ArtifactBar({ envelope, analytics, question, queryLogId, answerMd }) {
  const [busy, setBusy] = useState(null)
  const [error, setError] = useState(null)
  const [made, setMade] = useState({})
  const [recent, setRecent] = useState([])
  const [sourceId, setSourceId] = useState('')

  const available = envelope?.artifacts_available || []
  // De opgeslagen envelop draagt geen `rows` — die staan al in `analytics` en
  // zouden de sessie-save verdubbelen (zie stripEnvelope in useRagChat). Na een
  // reload komen ze dus daarvandaan, en blijft de knop werken.
  const rows = (envelope?.rows?.length ? envelope.rows : analytics?.rows) || []
  const columns = envelope?.columns?.length ? envelope.columns : (analytics?.columns || [])

  // De PDF-knop stond er vóór v2 altijd (als afdrukknop). Hem laten verdwijnen
  // zodra een oude, opgeslagen envelop nog geen "pdf" in de lijst heeft zou een
  // functie wegnemen; vandaar de of-tak.
  const tableTypes = available.filter(t => t !== 'pdf' && rows.length > 0)
  const canPdf = available.includes('pdf') || rows.length > 0

  // "Zelfde als …" — de eigen, nog geldige artefacten van deze gebruiker.
  // SECURITY INVOKER + owner-only RLS: een andere persona krijgt hier nul rijen.
  //
  // De dependency is bewust de gesérialiseerde sleutel en niet `columns` zelf:
  // dat is bij de `|| []`-tak elke render een nieuwe array-referentie, en met
  // een setState in de .then() zou dit effect zichzelf eindeloos opnieuw
  // aanroepen.
  const columnsKey = JSON.stringify(columns)
  useEffect(() => {
    if (rows.length === 0) return
    let afgebroken = false
    supabase.rpc('agent_artifact_recent', { p_limit: 10 }).then(({ data }) => {
      if (afgebroken || !Array.isArray(data)) return
      setRecent(data.filter(r => JSON.stringify(r.columns || []) === columnsKey))
    }, () => {})
    return () => { afgebroken = true }
  }, [columnsKey, rows.length])

  const build = useCallback(async (type) => {
    setBusy(type); setError(null)
    try {
      const { data, error: fnErr } = await supabase.functions.invoke('agent-artifact-build', {
        body: {
          type,
          title: envelope?.claim ? String(envelope.claim).slice(0, 60) : 'Chat-export',
          question: question || '',
          rows,
          columns,
          // Een pdf mag een rapport zonder tabel zijn (AR08). Voor xlsx/csv doet
          // de server hier niets mee.
          body_markdown: type === 'pdf' ? (answerMd || null) : null,
          column_defs: envelope?.column_defs || [],
          query_log_id: queryLogId || null,
          source_artifact_id: sourceId || null,
          params: {
            definition: envelope?.definition || null,
            claim: envelope?.claim || null,
            route: envelope?.route || null,
            period: envelope?.period || null,
            searched: envelope?.coverage?.searched || [],
            not_searched: envelope?.coverage?.not_searched || [],
          },
        },
      })
      if (fnErr) throw new Error(fnErr.message || 'invoke_error')
      if (!data?.ok) throw new Error(data?.error || 'build_failed')
      setMade(prev => ({ ...prev, [type]: data }))
      // Nieuw tabblad, niet `location.href`: een download mag het gesprek niet
      // wegnavigeren, en de signed URL serveert een bijlage. Op iOS opent dit de
      // pdf in de viewer, mét deelmenu.
      window.open(data.url, '_blank', 'noopener,noreferrer')
    } catch (e) {
      setError(e?.message || String(e))
    } finally {
      setBusy(null)
    }
  }, [envelope, question, queryLogId, rows, columns, answerMd, sourceId])

  if (available.length === 0 || (rows.length === 0 && !canPdf)) return null

  const laatste = made.pdf || made.xlsx || made.csv
  const bewaartermijn = laatste?.retention_days ?? 30

  return (
    <div className={s.artBar}>
      <div className={s.artRow}>
        {rows.length > 0 && (
          <span className={s.artLabel}>{rows.length} {rows.length === 1 ? 'rij' : 'rijen'} meenemen:</span>
        )}
        {tableTypes.map(type => (
          <button
            key={type}
            type="button"
            className={s.artBtn}
            disabled={busy != null}
            onClick={() => build(type)}
            title={made[type] ? 'Opnieuw genereren (de vorige link blijft 24 uur geldig)' : TITELS[type]}
          >
            {Ico.download}
            {busy === type ? 'Bezig…' : (LABELS[type] || type)}
          </button>
        ))}
        {canPdf && (
          <button
            type="button"
            className={s.artBtn}
            disabled={busy != null}
            onClick={() => build('pdf')}
            title={made.pdf ? 'Opnieuw genereren (de vorige link blijft 24 uur geldig)' : TITELS.pdf}
          >
            {Ico.download}
            {busy === 'pdf' ? 'Bezig…' : 'PDF'}
          </button>
        )}
        {/* Afdrukken blijft, maar alleen op desktop: in een geïnstalleerde PWA
            doet window.print() niets, en dan is een dode knop erger dan geen. */}
        <button
          type="button"
          className={`${s.artBtn} ${s.artBtnDesktop}`}
          onClick={() => window.print()}
          title="Dit scherm afdrukken via de browser"
        >
          {Ico.print}
          Afdrukken
        </button>
        {recent.length > 0 && (
          <label className={s.artSame}>
            Zelfde als
            <select
              className={s.artSelect}
              value={sourceId}
              onChange={e => setSourceId(e.target.value)}
              title="Leg een lijn naar een eerder bestand met dezelfde kolommen"
            >
              <option value="">— nieuw bestand —</option>
              {recent.map(r => (
                <option key={r.id} value={r.id}>
                  {r.period?.label || new Date(r.created_at).toLocaleDateString('nl-NL')} · {r.title}
                </option>
              ))}
            </select>
          </label>
        )}
      </div>
      {/* Het feit waar AR10 om vraagt, en waar de chat het antwoord op moet
          kunnen geven: twee termijnen, en ze zijn niet hetzelfde. */}
      <span className={s.artNote}>
        link 24 uur geldig · bestand {bewaartermijn} dagen bewaard
      </span>
      {error && <span className={s.artErr} title={error}>Lukte niet: {error.slice(0, 80)}</span>}
    </div>
  )
}
