import { useState, createContext } from 'react'
import { supabase } from '../../lib/supabase'

// Gedeelde constants, helpers en componenten voor Daily Admin-weergave.
// Voorheen zaten deze in HubSpotView.jsx; nadat de originele stacked-weergave
// werd verwijderd zijn ze naar dit common-bestand verplaatst. Alleen deze
// exports zijn nog extern nodig (door HubSpotInboxAView, hubspot-shared en
// ProposalCardCompact).

export const AGENT = 'hubspot-daily-sync'

export const CATEGORIES = ['klant', 'partner', 'recruitment', 'overig']

export const CATEGORY_LABEL = {
  klant:       'Klant',
  partner:     'Partner',
  recruitment: 'Recruitment',
  overig:      'Overig',
}

export const CATEGORY_CLASS = {
  klant:       'cat cat--klant',
  partner:     'cat cat--partner',
  recruitment: 'cat cat--recruit',
  overig:      'cat cat--misc',
}

// Minimum score voor "Andere contactmomenten". Onder die drempel is het
// doorgaans rommel (marketing-mail, bulk-uitnodigingen) die niet in het
// overzicht hoort.
const FILTERED_MIN_SCORE = 0.15

export function formatDateTime(iso) {
  if (!iso) return '—'
  return new Date(iso).toLocaleString('nl-NL', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' })
}

// Pipeline-lookup context. HubSpotInboxAView vult de provider met een lookup
// die gebouwd is uit de hubspot_pipelines-tabel, zodat de kaart-component
// pipeline- en stage-ID's kan oplossen zonder prop-drilling.
export const PipelineLookupContext = createContext({
  resolve: () => ({ pipelineLabel: null, stageLabel: null, pipelineIsActive: true }),
})

// HubSpot-users context. HubSpotInboxAView vult de provider met de actieve
// rijen uit `hubspot_users` (met fallback op de seed-lijst) zodat de kaart
// assignee-dropdowns kan renderen zonder prop-drilling.
export const HubSpotUsersContext = createContext([])

export function buildPipelineLookup(pipelines) {
  const byId = new Map()
  for (const p of pipelines || []) {
    const byStage = new Map()
    for (const s of p.stages || []) byStage.set(String(s.id), s.label)
    byId.set(String(p.pipeline_id), { label: p.label, purpose: p.purpose, is_active: p.is_active, byStage })
  }
  return {
    resolve(pipelineId, stageId) {
      const p = pipelineId != null ? byId.get(String(pipelineId)) : null
      const stage = p && stageId != null ? p.byStage.get(String(stageId)) : null
      return {
        pipelineLabel: p?.label || null,
        pipelinePurpose: p?.purpose || null,
        pipelineIsActive: p?.is_active !== false,
        stageLabel: stage || null,
      }
    },
  }
}

// ===== FilteredSection — "Andere contactmomenten" tabel =====
// Records die de agent WEL zag maar NIET als voorstel oppakte (score te laag).
// Plus-knop laat Jelle er alsnog een proposal van forceren via force_propose RPC.
export function FilteredSection({ filtered }) {
  const [domainFilter, setDomainFilter] = useState('')
  const [busy, setBusy] = useState(null)
  const [err, setErr] = useState(null)

  const open = filtered
    .filter(f => !f.forced_proposal_id)
    .filter(f => (Number(f.confidence) || 0) >= FILTERED_MIN_SCORE)
    .sort((a, b) => (Number(b.confidence) || 0) - (Number(a.confidence) || 0))
  const hiddenLowCount = filtered
    .filter(f => !f.forced_proposal_id)
    .filter(f => (Number(f.confidence) || 0) < FILTERED_MIN_SCORE).length
  const filteredByDomain = domainFilter
    ? open.filter(f => (f.sender_domain || '').includes(domainFilter))
    : open
  const uniqueDomains = [...new Set(open.map(f => f.sender_domain).filter(Boolean))].sort()

  async function force(id) {
    setBusy(id); setErr(null)
    try {
      const { data, error } = await supabase.rpc('force_propose', { record_id: id })
      if (error)                        setErr(error.message)
      else if (data && data.ok === false) setErr(data.reason || 'mislukt')
    } catch (e) { setErr(e.message || 'netwerkfout') }
    setBusy(null)
  }

  return (
    <section>
      <div className="section__head">
        <h2 className="section__title">
          Andere contactmomenten {open.length > 0 && <span className="section__count">{open.length}</span>}
        </h2>
        <span className="section__hint">
          contacten uit mail/agenda die de agent zag maar níet als voorstel oppakte (score te laag voor automatisch plan). Klik <strong>+</strong> om er alsnog een voorstel van te maken.
          {hiddenLowCount > 0 && (
            <> <span className="muted">({hiddenLowCount} extra met score &lt; {Math.round(FILTERED_MIN_SCORE * 100)} verborgen — vrijwel zeker rommel)</span></>
          )}
        </span>
      </div>

      {open.length === 0 ? (
        <div className="empty">
          Niks om nog toe te voegen. Zodra Daily Admin scant en records tegenkomt die de filter niet haalden, verschijnen ze hier.
        </div>
      ) : (
        <>
          {uniqueDomains.length > 5 && (
            <div className="filter-domain">
              <input
                type="text"
                className="filter-domain__input"
                placeholder="Filter op domein (bv. ritense.com)"
                value={domainFilter}
                onChange={e => setDomainFilter(e.target.value)}
              />
              {domainFilter && (
                <button className="btn btn--ghost" onClick={() => setDomainFilter('')}>wis</button>
              )}
            </div>
          )}
          <div className="table-wrap">
            <table className="table">
              <thead>
                <tr>
                  <th className="num" style={{ width: 60 }}>Score</th>
                  <th style={{ width: 110 }}>Wanneer</th>
                  <th>Onderwerp / gesprek</th>
                  <th>Afzender / domein</th>
                  <th>Reden niet-opgepakt</th>
                  <th style={{ width: 50 }}></th>
                </tr>
              </thead>
              <tbody>
                {filteredByDomain.slice(0, 60).map(f => {
                  const score = f.confidence != null ? Math.round(Number(f.confidence) * 100) : null
                  const scoreClass = score == null ? 'muted'
                                   : score >= 50 ? 'score--high'
                                   : score >= 30 ? 'score--mid'
                                   : 'score--low'
                  return (
                    <tr key={f.id}>
                      <td className={`num score ${scoreClass}`}>{score != null ? score : '—'}</td>
                      <td className="mono" style={{ fontSize: 12 }}>{formatDateTime(f.scanned_at)}</td>
                      <td style={{ color: 'var(--text)', maxWidth: 280 }} title={f.subject || ''}>
                        {f.subject || f.company_guess || '—'}
                        {f.source && <span className="muted" style={{ marginLeft: 6, fontSize: 11 }}>· {f.source}</span>}
                      </td>
                      <td className="muted" style={{ fontSize: 12 }}>
                        {f.sender_domain || f.sender || '—'}
                      </td>
                      <td className="muted" style={{ fontSize: 12, maxWidth: 260 }} title={f.reason || ''}>
                        {(f.reason || '').slice(0, 60) || '—'}
                      </td>
                      <td style={{ textAlign: 'right' }}>
                        <button
                          className="plus-btn"
                          onClick={() => force(f.id)}
                          disabled={busy === f.id}
                          title="Maak hier alsnog een voorstel van — Daily Admin pakt het bij volgende run op"
                          aria-label="Toevoegen aan voorstellen"
                        >
                          {busy === f.id ? '…' : '+'}
                        </button>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
          {err && <div className="filtered-error" style={{ marginTop: 8, color: 'var(--error)', fontSize: 12 }}>⚠ {err}</div>}
        </>
      )}
    </section>
  )
}
