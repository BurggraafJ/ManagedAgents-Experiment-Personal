import { formatDateTime } from '../hubspot-common'

// ListRowMaestro — Maestro-design list-row voor Daily Admin Inbox.
//
// Mockup-layout (Administratie.html .adm-row): [icon] [title + sub] [tijd]
// Grid 3-kolom: 26px icon | 1fr main | auto time. Sub-regel toont
// pipeline-stage uit context als die er is.
//
// JSX is afwijkend van de oude ListRow (in HubSpotInboxAView.jsx) zodat de
// rij-layout grid kan zijn ipv flex-column met absolute time. Wordt alleen
// in de Maestro-route gebruikt; oude /administratie blijft de oude ListRow.
// Bedrag uit deal-amount in context — niet alle voorstellen hebben dit;
// HubSpot deals hebben context.amount of context.deal_amount.
function formatAmount(ctx) {
  const raw = ctx.amount ?? ctx.deal_amount ?? null
  if (raw == null || raw === '' || isNaN(Number(raw))) return null
  const n = Number(raw)
  if (n === 0) return null
  // Compact NL formatting: € 18.000 voor 18000
  return new Intl.NumberFormat('nl-NL', {
    style: 'currency',
    currency: 'EUR',
    maximumFractionDigits: 0,
  }).format(n)
}

// Owner-naam korte vorm — alleen als eigenaar in context staat.
function pickOwner(ctx) {
  return ctx.deal_owner_name || ctx.dealowner || ctx.owner_name || null
}

export default function ListRowMaestro({ proposal, selected, onSelect, pipelineLookup }) {
  const isRevised = !!proposal.amended_from && proposal.status === 'pending'
  const needsInfo = proposal.needs_info === true && !proposal.amended_from
  const cat = proposal.category || 'overig'
  const ctx = proposal.context || {}
  const pipelineRaw = ctx.pipeline || ctx.pipeline_id || null
  const stageId = ctx.pipeline_stage || ctx.deal_stage || null
  const resolved = pipelineLookup
    ? pipelineLookup.resolve(pipelineRaw, stageId)
    : { pipelineLabel: null, stageLabel: null }
  const pipelineLabel = resolved.pipelineLabel
  const stageLabel = resolved.stageLabel
  const amount = formatAmount(ctx)
  const owner = pickOwner(ctx)

  // Sub-text bouwen: <strong>Pipeline</strong> · stage X · €18.000 — flexible
  // op welke velden bestaan. Mockup-patroon: bron · stage · bedrag.
  const subParts = []
  if (pipelineLabel) subParts.push({ kind: 'strong', text: pipelineLabel })
  if (stageLabel) subParts.push({ kind: 'plain', text: `stage ${stageLabel}` })
  if (amount) subParts.push({ kind: 'plain', text: amount })
  if (!pipelineLabel && !stageLabel && owner) subParts.push({ kind: 'plain', text: owner })
  const hasSubText = subParts.length > 0
  const showSubRow = hasSubText || needsInfo || isRevised

  return (
    <button
      type="button"
      className={`va-row va-row--maestro ${selected ? 'is-selected' : ''} ${isRevised ? 'is-revised' : ''} ${needsInfo ? 'is-needs' : ''}`}
      onClick={onSelect}
    >
      <span className={`va-dot va-dot--${cat}`} aria-hidden="true" />
      <div className="va-row__main">
        <div className="va-row__subject">{proposal.subject}</div>
        {showSubRow && (
          <div className="va-row__sub">
            {hasSubText && (
              <span className="va-row__sub-text">
                {subParts.map((p, i) => (
                  <span key={i}>
                    {i > 0 && ' · '}
                    {p.kind === 'strong' ? <strong>{p.text}</strong> : p.text}
                  </span>
                ))}
              </span>
            )}
            {needsInfo && <span className="va-row__tag va-row__tag--warn">input</span>}
            {isRevised && <span className="va-row__tag va-row__tag--accent">✎ herzien</span>}
          </div>
        )}
      </div>
      <span className="va-row__time">{formatDateTime(proposal.created_at)}</span>
    </button>
  )
}
