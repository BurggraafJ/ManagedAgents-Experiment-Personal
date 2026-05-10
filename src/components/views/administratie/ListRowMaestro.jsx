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
  const hasSubText = !!(pipelineLabel || stageLabel)
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
                {pipelineLabel && <strong>{pipelineLabel}</strong>}
                {pipelineLabel && stageLabel && ' · '}
                {stageLabel && <span>{stageLabel}</span>}
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
