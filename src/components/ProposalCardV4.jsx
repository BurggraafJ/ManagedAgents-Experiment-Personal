import { useContext } from 'react'
import MicButton from './MicButton'
import { PipelineLookupContext, CATEGORIES, CATEGORY_LABEL, formatDateTime } from './views/HubSpotView'
import { useProposalActions, statusLabel, sortedActions, actionDetails } from './useProposalActions'

// ProposalCardV4 — Horizontal split.
//   Links: meta-kolom (subject, summary, category, pipeline, owner, CSM,
//     kleine confidence-pill).
//   Rechts: action-list dominant.
//   Onder: amendment (indien aanwezig) + button-strip over volledige breedte.
//
// Gebruikt de breedte van het detail-paneel goed; info en acties direct
// visueel gescheiden zonder door elkaar heen te scrollen.
export default function ProposalCardV4({ proposal }) {
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
    <article className={`pcv4 pcv4--${A.status} ${A.isRevised ? 'pcv4--revised' : ''} ${A.needsInfo ? 'pcv4--needs' : ''}`}>

      {/* Top meta-strip — klein, over hele breedte */}
      <div className="pcv4__top">
        <select
          className={`cat-select cat-select--${A.cat}`}
          value={A.cat} onChange={e => A.onRecategorize(e.target.value)} disabled={A.busy}
          style={{ fontSize: 11, padding: '2px 6px' }}
          aria-label="Categorie"
        >
          {CATEGORIES.map(c => <option key={c} value={c}>{CATEGORY_LABEL[c]}</option>)}
        </select>
        <span className={`pcv4__status pcv4__status--${A.status}`}>{statusLabel(A.status)}</span>
        {A.needsInfo && <span className="pcv4__tag pcv4__tag--needs">⚠ input</span>}
        {A.isRevised && <span className="pcv4__tag pcv4__tag--revised">✎ herzien</span>}
        <span className="pcv4__spacer" />
        <span className="pcv4__time">{formatDateTime(proposal.created_at)}</span>
      </div>

      {/* Split: meta links, actions rechts */}
      <div className="pcv4__split">
        <div className="pcv4__meta-col">
          <h2 className="pcv4__subject">{proposal.subject}</h2>
          {proposal.summary && <p className="pcv4__summary">{proposal.summary}</p>}

          <dl className="pcv4__meta-list">
            {(pipelineLabel || pipelineRaw) && (
              <>
                <dt>Pipeline</dt>
                <dd>
                  {pipelineLabel || `? ${pipelineRaw}`}
                  {stageLabel && <span className="pcv4__meta-sub">· {stageLabel}</span>}
                </dd>
              </>
            )}
            {dealOwner && (<><dt>Owner</dt><dd>{dealOwner}</dd></>)}
            {csm      && (<><dt>CSM</dt><dd>{csm}</dd></>)}
            {confidencePct != null && (
              <>
                <dt>Confidence</dt>
                <dd>
                  <span className={`pcv4__conf-pill pcv4__conf-pill--${confTone}`}>
                    {confidencePct}%
                  </span>
                </dd>
              </>
            )}
          </dl>
        </div>

        <div className="pcv4__actions-col">
          {actions.length > 0 ? (
            <>
              <div className="pcv4__actions-head">Wat er gebeurt bij ✓ Accepteer</div>
              <div className="pcv4__actions-list">
                {actions.map((a, i) => <ActionBlock key={i} action={a} lookup={lookup} />)}
              </div>
            </>
          ) : (
            <div className="empty empty--compact">Geen concrete acties — alleen input nodig.</div>
          )}
        </div>
      </div>

      {A.liveAmendment && (
        <div className="pcv4__amendment">
          <span className="pcv4__amendment-label">Jouw feedback:</span>
          <span className="pcv4__amendment-text">{A.liveAmendment}</span>
        </div>
      )}

      {A.isPending && (
        A.mode === 'amending' ? (
          <div className="pcv4__amend-form">
            <div className="textarea-wrap">
              <textarea
                className="pcv4__amend-input"
                value={A.amendText}
                onChange={e => A.setAmendText(e.target.value)}
                placeholder="Wat moet de agent anders doen?"
                rows={3}
                autoFocus
              />
              <MicButton onTranscript={t => A.setAmendText(prev => (prev ? `${prev} ${t}` : t).trim())} />
            </div>
            <div className="pcv4__btns">
              <button className="btn btn--accent pcv4__btn" onClick={A.onAmend} disabled={A.busy || !A.amendText.trim()}>Opslaan</button>
              <button className="btn btn--ghost pcv4__btn" onClick={() => { A.setMode('view'); A.setAmendText('') }}>Annuleer</button>
            </div>
          </div>
        ) : A.needsInfo ? (
          <div className="pcv4__btns">
            <button className="btn btn--warning pcv4__btn pcv4__btn--primary" onClick={() => A.setMode('amending')} disabled={A.busy}>✎ Antwoord geven</button>
            <button className="btn btn--danger pcv4__btn" onClick={A.onReject} disabled={A.busy}>✕ Afwijzen</button>
          </div>
        ) : (
          <div className="pcv4__btns">
            <button className="btn btn--success pcv4__btn pcv4__btn--primary" onClick={A.onAccept} disabled={A.busy}>✓ Accepteer</button>
            <button className="btn btn--warning pcv4__btn" onClick={() => A.setMode('amending')} disabled={A.busy}>✎ Aanpassen</button>
            <button className="btn btn--danger pcv4__btn" onClick={A.onReject} disabled={A.busy}>✕ Afwijzen</button>
          </div>
        )
      )}

      {A.err && <div className="pcv4__error">⚠ {A.err}</div>}
    </article>
  )
}

function ActionBlock({ action, lookup }) {
  const d = actionDetails(action, lookup)
  return (
    <div className={`pcv4__action pcv4__action--${d.meta.color}`}>
      <div className="pcv4__action-head">
        <span className="pcv4__action-icon">{d.meta.icon}</span>
        <span className="pcv4__action-type">{d.meta.label}</span>
      </div>
      {d.title && <div className="pcv4__action-title">{d.title}</div>}
      {d.rows.length > 0 && (
        <dl className="pcv4__action-rows">
          {d.rows.map(([k, v], i) => (
            <div key={i}>
              <dt>{k}</dt>
              <dd>{v}</dd>
            </div>
          ))}
        </dl>
      )}
      {d.body && <blockquote className="pcv4__action-body">{d.body}</blockquote>}
    </div>
  )
}
