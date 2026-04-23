import { useContext } from 'react'
import MicButton from './MicButton'
import { PipelineLookupContext, CATEGORIES, CATEGORY_LABEL, formatDateTime } from './views/HubSpotView'
import { useProposalActions, statusLabel, sortedActions, actionDetails } from './useProposalActions'

// ProposalCardV7 — Compact variant met "banner-top" action cards.
//   Andere aanpak voor leesbaarheid: elk actieblok heeft een gekleurde top-
//   banner (volledig ingekleurd met type-kleur 18% alpha) waarin icon + type
//   + title in één strip staan. Daaronder een schone inhoudelijke area met
//   2-koloms label/value-grid en body als quote-blok met " karakter.
export default function ProposalCardV7({ proposal }) {
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
    <article className={`pcv7 pcv7--${A.status} ${A.isRevised ? 'pcv7--revised' : ''} ${A.needsInfo ? 'pcv7--needs' : ''}`}>

      <header className="pcv7__header">
        <div className="pcv7__header-main">
          <div className="pcv7__header-top">
            <select
              className={`cat-select cat-select--${A.cat}`}
              value={A.cat} onChange={e => A.onRecategorize(e.target.value)} disabled={A.busy}
              style={{ fontSize: 11, padding: '2px 6px' }} aria-label="Categorie"
            >
              {CATEGORIES.map(c => <option key={c} value={c}>{CATEGORY_LABEL[c]}</option>)}
            </select>
            <span className={`pcv7__status pcv7__status--${A.status}`}>{statusLabel(A.status)}</span>
            {A.needsInfo && <span className="pcv7__tag pcv7__tag--needs">⚠ input</span>}
            {A.isRevised && <span className="pcv7__tag pcv7__tag--revised">✎ herzien</span>}
            <span className="pcv7__time">{formatDateTime(proposal.created_at)}</span>
          </div>
          <h2 className="pcv7__subject">{proposal.subject}</h2>
          {proposal.summary && <p className="pcv7__summary">{proposal.summary}</p>}
        </div>
        {confidencePct != null && (
          <div className={`pcv7__conf pcv7__conf--${confTone}`} title={`Confidence ${confidencePct}%`}>
            <div className="pcv7__conf-num">{confidencePct}<span>%</span></div>
          </div>
        )}
      </header>

      {(pipelineLabel || dealOwner || csm) && (
        <div className="pcv7__meta-chips">
          {(pipelineLabel || pipelineRaw) && (
            <span className="pcv7__chip pcv7__chip--pipeline">
              <span className="pcv7__chip-icon">📁</span>
              {pipelineLabel || `? ${pipelineRaw}`}
              {stageLabel && <span className="pcv7__chip-sub">· {stageLabel}</span>}
            </span>
          )}
          {dealOwner && (
            <span className="pcv7__chip">
              <span className="pcv7__chip-icon">👤</span>{dealOwner}
            </span>
          )}
          {csm && (
            <span className="pcv7__chip">
              <span className="pcv7__chip-icon">🤝</span>CSM · {csm}
            </span>
          )}
        </div>
      )}

      {actions.length > 0 && (
        <section className="pcv7__actions">
          <div className="pcv7__actions-label">
            Wat er gebeurt bij ✓ Accepteer <span className="pcv7__actions-count">{actions.length}</span>
          </div>
          <div className="pcv7__actions-list">
            {actions.map((a, i) => <BannerActionBlock key={i} action={a} lookup={lookup} />)}
          </div>
        </section>
      )}

      {A.liveAmendment && (
        <div className="pcv7__amendment">
          <div className="pcv7__amendment-label">⟨ jouw feedback ⟩</div>
          <div className="pcv7__amendment-text">{A.liveAmendment}</div>
        </div>
      )}

      {A.isPending && (
        A.mode === 'amending' ? (
          <div className="pcv7__amend-form">
            <div className="textarea-wrap">
              <textarea
                className="pcv7__amend-input"
                value={A.amendText}
                onChange={e => A.setAmendText(e.target.value)}
                placeholder="Wat moet de agent anders doen?"
                rows={3} autoFocus
              />
              <MicButton onTranscript={t => A.setAmendText(prev => (prev ? `${prev} ${t}` : t).trim())} />
            </div>
            <div className="pcv7__btns">
              <button className="btn btn--accent pcv7__btn" onClick={A.onAmend} disabled={A.busy || !A.amendText.trim()}>Opslaan</button>
              <button className="btn btn--ghost pcv7__btn" onClick={() => { A.setMode('view'); A.setAmendText('') }}>Annuleer</button>
            </div>
          </div>
        ) : A.needsInfo ? (
          <div className="pcv7__btns">
            <button className="btn btn--warning pcv7__btn pcv7__btn--primary" onClick={() => A.setMode('amending')} disabled={A.busy}>✎ Antwoord geven</button>
            <button className="btn btn--danger pcv7__btn" onClick={A.onReject} disabled={A.busy}>✕ Afwijzen</button>
          </div>
        ) : (
          <div className="pcv7__btns">
            <button className="btn btn--success pcv7__btn pcv7__btn--primary" onClick={A.onAccept} disabled={A.busy}>✓ Accepteer</button>
            <button className="btn btn--warning pcv7__btn" onClick={() => A.setMode('amending')} disabled={A.busy}>✎ Aanpassen</button>
            <button className="btn btn--danger pcv7__btn" onClick={A.onReject} disabled={A.busy}>✕ Afwijzen</button>
          </div>
        )
      )}

      {A.err && <div className="pcv7__error">⚠ {A.err}</div>}
    </article>
  )
}

function BannerActionBlock({ action, lookup }) {
  const d = actionDetails(action, lookup)
  return (
    <div className={`pcv7__action pcv7__action--${d.meta.color}`}>
      <div className={`pcv7__action-banner pcv7__action-banner--${d.meta.color}`}>
        <span className="pcv7__action-icon">{d.meta.icon}</span>
        <span className="pcv7__action-type">{d.meta.label}</span>
        <span className="pcv7__action-title">{d.title}</span>
      </div>
      {(d.rows.length > 0 || d.body) && (
        <div className="pcv7__action-content">
          {d.rows.length > 0 && (
            <div className="pcv7__action-grid">
              {d.rows.map(([k, v], i) => (
                <div key={i} className="pcv7__action-grid-row">
                  <div className="pcv7__action-grid-key">{k}</div>
                  <div className="pcv7__action-grid-val">{v}</div>
                </div>
              ))}
            </div>
          )}
          {d.body && (
            <blockquote className="pcv7__action-body">{d.body}</blockquote>
          )}
        </div>
      )}
    </div>
  )
}
