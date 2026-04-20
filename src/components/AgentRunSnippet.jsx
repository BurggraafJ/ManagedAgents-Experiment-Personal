/**
 * Compacte weergave van de laatste run per agent-type.
 *
 * HubSpot-sync: als `stats.deals_summary` (array van {company, time, subject})
 *   beschikbaar is — toon als mini-lijst. Anders: probeer bedrijven uit summary
 *   te halen en toon als chips. Anders: getrunceerde tekst.
 *
 * Andere agents: summary in 2 regels (bestaande gedrag, maar met mogelijkheid
 *   tot per-agent custom render later).
 */
export default function AgentRunSnippet({ agent, run }) {
  if (agent === 'hubspot-daily-sync') return <HubSpotSnippet run={run} />
  return <DefaultSnippet run={run} />
}

function HubSpotSnippet({ run }) {
  const deals = Array.isArray(run?.stats?.deals_summary) ? run.stats.deals_summary : null

  if (deals && deals.length > 0) {
    return (
      <ul className="agent-card__mini-list">
        {deals.slice(0, 5).map((d, i) => (
          <li key={i} className="agent-card__mini-row">
            <span className="agent-card__mini-company">{d.company || '—'}</span>
            <span className="agent-card__mini-meta">
              {d.time && <span>{formatShortTime(d.time)}</span>}
              {d.subject && <span className="agent-card__mini-subject" title={d.subject}>{truncate(d.subject, 40)}</span>}
            </span>
          </li>
        ))}
        {deals.length > 5 && (
          <li className="agent-card__mini-row agent-card__mini-row--more">
            +{deals.length - 5} meer — zie HubSpot-pagina
          </li>
        )}
      </ul>
    )
  }

  // Fallback: probeer bedrijven uit summary te vissen (pattern: "geidentificeerd (A, B, C)")
  const companies = extractCompaniesFromSummary(run?.summary || '')
  if (companies.length > 0) {
    return (
      <div className="agent-card__chips">
        {companies.slice(0, 8).map(c => <span key={c} className="agent-card__chip">{c}</span>)}
        {companies.length > 8 && <span className="muted" style={{ fontSize: 11 }}>+{companies.length - 8}</span>}
      </div>
    )
  }

  return <DefaultSnippet run={run} />
}

function DefaultSnippet({ run }) {
  return <span>{run?.summary || <span className="muted">—</span>}</span>
}

function extractCompaniesFromSummary(summary) {
  if (!summary) return []
  // Pattern: "(A, B, C)" of "deals: A, B, C"
  const paren = summary.match(/\(([^)]+)\)/)
  const source = paren ? paren[1] : null
  if (!source) return []
  return source
    .split(/,\s*/)
    .map(s => s.trim())
    .filter(s => s.length > 0 && s.length < 40 && /^[A-Z]/.test(s))
}

function formatShortTime(iso) {
  if (!iso) return ''
  const d = new Date(iso)
  if (isNaN(d.getTime())) return iso
  return d.toLocaleTimeString('nl-NL', { hour: '2-digit', minute: '2-digit' })
}

function truncate(s, n) {
  if (!s) return ''
  return s.length > n ? s.slice(0, n - 1) + '…' : s
}
