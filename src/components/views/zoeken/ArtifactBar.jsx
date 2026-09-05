import { useState, useCallback } from 'react'
import s from './zoeken.module.css'
import { Ico } from './Icons'
import { supabase } from '../../../lib/supabase'

// WP4 — een antwoord met een tabel kun je meenemen.
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
// PDF gaat bewust via de browser (Ctrl/Cmd+P met de print-stylesheet) en niet
// via een servergenerator. Een pdf-bibliotheek in Deno is een project op zich,
// afdrukken werkt vandaag. Zie AGENT-REBUILD.md (V6).
const LABELS = { xlsx: 'Excel', csv: 'CSV' }

export default function ArtifactBar({ envelope, analytics, question, queryLogId }) {
  const [busy, setBusy] = useState(null)
  const [error, setError] = useState(null)
  const [made, setMade] = useState({})

  const available = envelope?.artifacts_available || []
  // De opgeslagen envelop draagt geen `rows` — die staan al in `analytics` en
  // zouden de sessie-save verdubbelen (zie stripEnvelope in useRagChat). Na een
  // reload komen ze dus daarvandaan, en blijft de knop werken.
  const rows = (envelope?.rows?.length ? envelope.rows : analytics?.rows) || []

  const build = useCallback(async (type) => {
    setBusy(type); setError(null)
    try {
      const { data, error: fnErr } = await supabase.functions.invoke('agent-artifact-build', {
        body: {
          type,
          title: envelope?.claim ? String(envelope.claim).slice(0, 60) : 'Chat-export',
          question: question || '',
          rows,
          columns: envelope?.columns?.length ? envelope.columns : (analytics?.columns || []),
          query_log_id: queryLogId || null,
          params: {
            definition: envelope?.definition || null,
            claim: envelope?.claim || null,
            route: envelope?.route || null,
            searched: envelope?.coverage?.searched || [],
            not_searched: envelope?.coverage?.not_searched || [],
          },
        },
      })
      if (fnErr) throw new Error(fnErr.message || 'invoke_error')
      if (!data?.ok) throw new Error(data?.error || 'build_failed')
      setMade(prev => ({ ...prev, [type]: data }))
      // Nieuw tabblad, niet `location.href`: een download mag het gesprek niet
      // wegnavigeren, en de signed URL serveert een bijlage.
      window.open(data.url, '_blank', 'noopener,noreferrer')
    } catch (e) {
      setError(e?.message || String(e))
    } finally {
      setBusy(null)
    }
  }, [envelope, analytics, question, queryLogId, rows])

  if (available.length === 0 || rows.length === 0) return null

  return (
    <div className={s.artBar}>
      <span className={s.artLabel}>{rows.length} {rows.length === 1 ? 'rij' : 'rijen'} meenemen:</span>
      {available.map(type => (
        <button
          key={type}
          type="button"
          className={s.artBtn}
          disabled={busy != null}
          onClick={() => build(type)}
          title={made[type] ? 'Opnieuw genereren (de vorige link blijft 24 uur geldig)' : `Download als ${LABELS[type] || type}`}
        >
          {Ico.download}
          {busy === type ? 'Bezig…' : (LABELS[type] || type)}
        </button>
      ))}
      <button
        type="button"
        className={s.artBtn}
        onClick={() => window.print()}
        title="Afdrukken of opslaan als PDF via de browser"
      >
        {Ico.print}
        PDF
      </button>
      {error && <span className={s.artErr} title={error}>Lukte niet: {error.slice(0, 80)}</span>}
    </div>
  )
}
