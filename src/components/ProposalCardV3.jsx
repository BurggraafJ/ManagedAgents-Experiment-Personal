import { useContext } from 'react'
import MicButton from './MicButton'
import { PipelineLookupContext, CATEGORIES, CATEGORY_LABEL, formatDateTime } from './views/HubSpotView'
import { useProposalActions, statusLabel, sortedActions, actionDetails } from './useProposalActions'

// ProposalCardV3 — Compact / Action-focused.
//   • Geen aparte Kerngegevens-sectie; pipeline/owner/confidence als inline
//     meta-chips onder de subject-regel.
//   • Confidence is klein pillje rechts, geen grote bar + geen uitklapbare
//     reasons (die nemen ruimte die niet elke review nodig heeft).
//   • Acties dominieren het visuele gewicht — dat is waar je op klikt voor
//     accept/reject, dus dat krijgt de ruimte.
export default function ProposalCardV3({ proposal }) {
  const lookup = useContext(PipelineLookupContext)
  const A = useProposalActions(proposal)
  const ctx = proposal.context || {}
  const pipelineRaw = ctx.pipeline || ctx.pipeline_id || null
  const stageId     = ctx.pipeline_stage || ctx.deal_stage || null
  const { pipelineLabel, stageLabel } = lookup.resolve(pipelineRaw, stageId)
  const dealOwner = ctx.deal_owner_name || ctx.dealowner || ctx.jira_assignee || null
  const csm       = ctx.csm_name || ctx.customer_success_manager || null
  const confidencePct = typeof proposal.confidence === 'number' ? Math.round(proposal.confidence * 100) : null
  const confTone = confidencePct == null ? null : confidencePct >= 70 ? 'ok' : confidencePct >= 50 ? 'mid' : 'low'
  const actions = sortedActions(proposal)

  return (
    <article className={`pcv3 pcv3--${A.status} ${A.isRevised ? 'pcv3--revised' : ''} ${A.needsInfo ? 'pcv3--needs' : ''}`}>

      {/* Header: subject + compact meta rechts */}
      <header className="pcv3__header">
        <div className="pcv3__header-main">
          <div className="pcv3__header-top">
            <select
              className={`cat-select cat-select--${A.cat}`}
              value={A.cat} onChange={e => A.onRecategorize(e.target.value)} disabled={A.busy}
              aria-label="Categorie"
              style={{ fontSize: 11, padding: '2px 6px' }}
            >
              {CATEGORIES.map(c => <option key={c} value={c}>{CATEGORY_LABEL[c]}</option>)}
            </select>
            <span className={`pcv3__status pcv3__status--${A.status}`}>{statusLabel(A.status)}</span>
            {A.needsInfo && <span className="pcv3__tag pcv3__tag--needs">⚠ input</span>}
            {A.isRevised && <span className="pcv3__tag pcv3__tag--revised">✎ herzien</span>}
            <span className="pcv3__time">{formatDateTime(proposal.created_at)}</span>
          </div>
          <h2 className="pcv3__subject">{proposal.subject}</h2>
          {proposal.summary && <p className="pcv3__summary">{proposal.summary}</p>}
        </div>
        {confidencePct != null && (
          <div className={`pcv3__conf pcv3__conf--${confTone}`} title={`Confidence ${confidencePct}%`}>
            <div className="pcv3__conf-num">{confidencePct}<span>%</span></div>
            <div className="pcv3__conf-label">confidence</div>
          </div>
        )}
      </header>

      {/* Meta-chips row: pipeline · owner · csm */}
      {(pipelineLabel || dealOwner || csm) && (
        <div className="pcv3__meta-chips">
          {(pipelineLabel || pipelineRaw) && (
            <span className="pcv3__chip pcv3__chip--pipeline">
              <span className="pcv3__chip-icon">📁</span>
              {pipelineLabel || `? ${pipelineRaw}`}
              {stageLabel && <span className="pcv3__chip-sub">{stageLabel}</span>}
            </span>
          )}
          {dealOwner && (
            <span className="pcv3__chip pcv3__chip--owner">
              <span className="pcv3__chip-icon">👤</span>{dealOwner}
            </span>
          )}
          {csm && (
            <span className="pcv3__chip pcv3__chip--csm">
              <span className="pcv3__chip-icon">🤝</span>CSM · {csm}
            </span>
          )}
        </div>
      )}

      {/* Acties dominieren — compact-stijl */}
      {actions.length > 0 && (
        <section className="pcv3__actions">
          <div className="pcv3__actions-head">
            <span className="pcv3__actions-label">Wat er gebeurt bij ✓ Accepteer</span>
            <span className="pcv3__actions-count">{actions.length}</span>
          </div>
          <div className="pcv3__actions-list">
            {actions.map((a, i) => <ActionRow key={i} action={a} lookup={lookup} />)}
          </div>
        </section>
      )}

      {A.liveAmendment && (
        <div className="pcv3__amendment">
          <span className="pcv3__amendment-label">Jouw feedback:</span>{' '}
          <span className="pcv3__amendment-text">{A.liveAmendment}</span>
        </div>
      )}

      {A.isPending && (
        A.mode === 'amending' ? (
          <div className="pcv3__amend-form">
            <div className="textarea-wrap">
              <textarea
                className="pcv3__amend-input"
                value={A.amendText}
                onChange={e => A.setAmendText(e.target.value)}
                placeholder="Wat moet de agent anders doen?"
                rows={3}
                autoFocus
              />
              <MicButton onTranscript={t => A.setAmendText(prev => (prev ? `${prev} ${t}` : t).trim())} />
            </div>
            <div className="pcv3__btns">
              <button className="btn btn--accent pcv3__btn" onClick={A.onAmend} disabled={A.busy || !A.amendText.trim()}>Opslaan</button>
              <button className="btn btn--ghost pcv3__btn" onClick={() => { A.setMode('view'); A.setAmendText('') }}>Annuleer</button>
            </div>
          </div>
        ) : A.needsInfo ? (
          <div className="pcv3__btns">
            <button className="btn btn--warning pcv3__btn pcv3__btn--primary" onClick={() => A.setMode('amending')} disabled={A.busy}>✎ Antwoord geven</button>
            <button className="btn btn--danger pcv3__btn" onClick={A.onReject} disabled={A.busy}>✕ Afwijzen</button>
          </div>
        ) : (
          <div className="pcv3__btns">
            <button className="btn btn--success pcv3__btn pcv3__btn--primary" onClick={A.onAccept} disabled={A.busy}>✓ Accepteer</button>
            <button className="btn btn--warning pcv3__btn" onClick={() => A.setMode('amending')} disabled={A.busy}>✎ Aanpassen</button>
            <button className="btn btn--danger pcv3__btn" onClick={A.onReject} disabled={A.busy}>✕ Afwijzen</button>
          </div>
        )
      )}

      {A.err && <div className="pcv3__error">⚠ {A.err}</div>}
    </article>
  )
}

function ActionRow({ action, lookup }) {
  const d = actionDetails(action, lookup)
  return (
    <div className={`pcv3__action pcv3__action--${d.meta.color}`}>
      <div className="pcv3__action-head">
        <span className="pcv3__action-icon">{d.meta.icon}</span>
        <span className="pcv3__action-type">{d.meta.label}</span>
        <span className="pcv3__action-title">{d.title}</span>
      </div>
      {d.rows.length > 0 && (
        <div className="pcv3__action-rows">
          {d.rows.map(([k, v], i) => (
            <span key={i} className="pcv3__action-row"><span className="pcv3__action-row-key">{k}:</span> {v}</span>
          ))}
        </div>
      )}
      {d.body && <blockquote className="pcv3__action-body">{d.body}</blockquote>}
    </div>
  )
}
