import { useContext } from 'react'
import MicButton from './MicButton'
import { PipelineLookupContext, CATEGORIES, CATEGORY_LABEL, formatDateTime } from './views/HubSpotView'
import { useProposalActions, statusLabel, sortedActions, actionDetails } from './useProposalActions'

// ProposalCardV6 — Compact variant met "TAG-header" actie-blokken.
//   Doel: oplossen van het "blokken-in-blokken-leesbaarheid"-probleem van V3
//   door elk actieblok een prominente gekleurde TAG als eigen header te geven,
//   een horizontale scheidslijn, en vervolgens explicit key/value-grid +
//   inhoud met eigen 'Inhoud:'-label.
export default function ProposalCardV6({ proposal }) {
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
    <article className={`pcv6 pcv6--${A.status} ${A.isRevised ? 'pcv6--revised' : ''} ${A.needsInfo ? 'pcv6--needs' : ''}`}>

      <header className="pcv6__header">
        <div className="pcv6__header-main">
          <div className="pcv6__header-top">
            <select
              className={`cat-select cat-select--${A.cat}`}
              value={A.cat} onChange={e => A.onRecategorize(e.target.value)} disabled={A.busy}
              style={{ fontSize: 11, padding: '2px 6px' }} aria-label="Categorie"
            >
              {CATEGORIES.map(c => <option key={c} value={c}>{CATEGORY_LABEL[c]}</option>)}
            </select>
            <span className={`pcv6__status pcv6__status--${A.status}`}>{statusLabel(A.status)}</span>
            {A.needsInfo && <span className="pcv6__tag pcv6__tag--needs">⚠ input</span>}
            {A.isRevised && <span className="pcv6__tag pcv6__tag--revised">✎ herzien</span>}
            <span className="pcv6__time">{formatDateTime(proposal.created_at)}</span>
          </div>
          <h2 className="pcv6__subject">{proposal.subject}</h2>
          {proposal.summary && <p className="pcv6__summary">{proposal.summary}</p>}
        </div>
        {confidencePct != null && (
          <div className={`pcv6__conf pcv6__conf--${confTone}`} title={`Confidence ${confidencePct}%`}>
            <div className="pcv6__conf-num">{confidencePct}<span>%</span></div>
            <div className="pcv6__conf-label">zeker</div>
          </div>
        )}
      </header>

      {(pipelineLabel || dealOwner || csm) && (
        <div className="pcv6__meta-chips">
          {(pipelineLabel || pipelineRaw) && (
            <span className="pcv6__chip pcv6__chip--pipeline">
              <span className="pcv6__chip-icon">📁</span>
              {pipelineLabel || `? ${pipelineRaw}`}
              {stageLabel && <span className="pcv6__chip-sub">· {stageLabel}</span>}
            </span>
          )}
          {dealOwner && (
            <span className="pcv6__chip">
              <span className="pcv6__chip-icon">👤</span>{dealOwner}
            </span>
          )}
          {csm && (
            <span className="pcv6__chip">
              <span className="pcv6__chip-icon">🤝</span>CSM · {csm}
            </span>
          )}
        </div>
      )}

      {actions.length > 0 && (
        <section className="pcv6__actions">
          <div className="pcv6__actions-label">
            Wat er gebeurt bij ✓ Accepteer <span className="pcv6__actions-count">{actions.length}</span>
          </div>
          <div className="pcv6__actions-list">
            {actions.map((a, i) => <TaggedActionBlock key={i} action={a} lookup={lookup} />)}
          </div>
        </section>
      )}

      {A.liveAmendment && (
        <div className="pcv6__amendment">
          <span className="pcv6__amendment-label">Jouw feedback</span>
          <div className="pcv6__amendment-text">{A.liveAmendment}</div>
        </div>
      )}

      {A.isPending && (
        A.mode === 'amending' ? (
          <div className="pcv6__amend-form">
            <div className="textarea-wrap">
              <textarea
                className="pcv6__amend-input"
                value={A.amendText}
                onChange={e => A.setAmendText(e.target.value)}
                placeholder="Wat moet de agent anders doen?"
                rows={3} autoFocus
              />
              <MicButton onTranscript={t => A.setAmendText(prev => (prev ? `${prev} ${t}` : t).trim())} />
            </div>
            <div className="pcv6__btns">
              <button className="btn btn--accent pcv6__btn" onClick={A.onAmend} disabled={A.busy || !A.amendText.trim()}>Opslaan</button>
              <button className="btn btn--ghost pcv6__btn" onClick={() => { A.setMode('view'); A.setAmendText('') }}>Annuleer</button>
            </div>
          </div>
        ) : A.needsInfo ? (
          <div className="pcv6__btns">
            <button className="btn btn--warning pcv6__btn pcv6__btn--primary" onClick={() => A.setMode('amending')} disabled={A.busy}>✎ Antwoord geven</button>
            <button className="btn btn--danger pcv6__btn" onClick={A.onReject} disabled={A.busy}>✕ Afwijzen</button>
          </div>
        ) : (
          <div className="pcv6__btns">
            <button className="btn btn--success pcv6__btn pcv6__btn--primary" onClick={A.onAccept} disabled={A.busy}>✓ Accepteer</button>
            <button className="btn btn--warning pcv6__btn" onClick={() => A.setMode('amending')} disabled={A.busy}>✎ Aanpassen</button>
            <button className="btn btn--danger pcv6__btn" onClick={A.onReject} disabled={A.busy}>✕ Afwijzen</button>
          </div>
        )
      )}

      {A.err && <div className="pcv6__error">⚠ {A.err}</div>}
    </article>
  )
}

function TaggedActionBlock({ action, lookup }) {
  const d = actionDetails(action, lookup)
  return (
    <div className={`pcv6__action pcv6__action--${d.meta.color}`}>
      <div className="pcv6__action-tag-row">
        <span className={`pcv6__action-tag pcv6__action-tag--${d.meta.color}`}>
          <span className="pcv6__action-tag-icon">{d.meta.icon}</span>
          {d.meta.label}
        </span>
        <span className="pcv6__action-title">{d.title}</span>
      </div>
      {d.rows.length > 0 && (
        <dl className="pcv6__action-grid">
          {d.rows.map(([k, v], i) => (
            <div key={i} className="pcv6__action-grid-row">
              <dt>{k}</dt>
              <dd>{v}</dd>
            </div>
          ))}
        </dl>
      )}
      {d.body && (
        <div className="pcv6__action-body-wrap">
          <div className="pcv6__action-body-label">Inhoud</div>
          <div className="pcv6__action-body">{d.body}</div>
        </div>
      )}
    </div>
  )
}
