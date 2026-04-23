import { useContext } from 'react'
import MicButton from './MicButton'
import { PipelineLookupContext, CATEGORIES, CATEGORY_LABEL, formatDateTime } from './views/HubSpotView'
import { useProposalActions, statusLabel, sortedActions, actionDetails } from './useProposalActions'

// ProposalCardV8 — Story met 2 stappen (compacter).
//   Stap 1: CONTEXT — signaal-bron + bekende records + pipeline-info,
//           samengevoegd in één breed blok met 2 sub-kolommen.
//   Stap 2: VOORSTEL & BESLISSING — acties + confidence + amendment + buttons
//           in één sectie zodat jouw keuze direct onder de voorgestelde acties
//           staat zonder extra stap ertussen.
//   Header apart boven de stappen (subject + status).
export default function ProposalCardV8({ proposal }) {
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

  const origin = ctx.origin || (ctx.event_date ? 'calendar_event' : (ctx.sender ? 'email' : null))
  const originLabel = origin === 'calendar_event' ? 'Agenda-event'
    : origin === 'email' ? 'E-mail'
    : origin === 'slack' || ctx.slack_ts ? 'Slack-bericht'
    : 'Signaal'
  const sourceLine = [ctx.sender, ctx.event_date, ctx.meeting_date, ctx.date].filter(Boolean).join(' · ')
  const known = []
  if (ctx.existing_company_id) known.push(`Company-ID ${ctx.existing_company_id}`)
  if (ctx.existing_contact_id) known.push(`Contact-ID ${ctx.existing_contact_id}`)
  if (ctx.existing_deal_id)    known.push(`Deal-ID ${ctx.existing_deal_id}`)
  if (ctx.existing_jira_issue) known.push(`Jira ${ctx.existing_jira_issue}`)
  if (ctx.preflight_match_method) known.push(`match via ${ctx.preflight_match_method}`)

  return (
    <article className={`pcv8 pcv8--${A.status} ${A.isRevised ? 'pcv8--revised' : ''} ${A.needsInfo ? 'pcv8--needs' : ''}`}>

      <header className="pcv8__header">
        <div className="pcv8__header-left">
          <select
            className={`cat-select cat-select--${A.cat}`}
            value={A.cat} onChange={e => A.onRecategorize(e.target.value)} disabled={A.busy}
            style={{ fontSize: 11, padding: '2px 6px' }} aria-label="Categorie"
          >
            {CATEGORIES.map(c => <option key={c} value={c}>{CATEGORY_LABEL[c]}</option>)}
          </select>
          <span className={`pcv8__status pcv8__status--${A.status}`}>{statusLabel(A.status)}</span>
          {A.needsInfo && <span className="pcv8__tag pcv8__tag--needs">⚠ input</span>}
          {A.isRevised && <span className="pcv8__tag pcv8__tag--revised">✎ herzien</span>}
        </div>
        <span className="pcv8__time">{formatDateTime(proposal.created_at)}</span>
      </header>

      <h2 className="pcv8__subject">{proposal.subject}</h2>
      {proposal.summary && <p className="pcv8__summary">{proposal.summary}</p>}

      {/* Stap 1 — Context (bron + bekend, 2 sub-kolommen naast elkaar) */}
      <section className="pcv8__step pcv8__step--context">
        <div className="pcv8__step-header">
          <span className="pcv8__step-number">1</span>
          <span className="pcv8__step-title">Context</span>
        </div>
        <div className="pcv8__context-grid">
          <div className="pcv8__context-col">
            <div className="pcv8__context-label">Signaal</div>
            <div className="pcv8__context-value">
              <div className="pcv8__source-type">{originLabel}</div>
              {sourceLine && <div className="pcv8__source-line">{sourceLine}</div>}
            </div>
          </div>
          <div className="pcv8__context-col">
            <div className="pcv8__context-label">Bestaande records</div>
            <div className="pcv8__context-value">
              {known.length > 0 ? (
                <ul className="pcv8__known-list">
                  {known.map((k, i) => <li key={i}>{k}</li>)}
                </ul>
              ) : (
                <div className="muted" style={{ fontSize: 12 }}>geen match — mogelijk nieuw</div>
              )}
            </div>
          </div>
          {(pipelineLabel || pipelineRaw) && (
            <div className="pcv8__context-col">
              <div className="pcv8__context-label">Pipeline</div>
              <div className="pcv8__context-value">
                <div style={{ fontWeight: 500 }}>{pipelineLabel || `? ${pipelineRaw}`}</div>
                {stageLabel && <div className="muted" style={{ fontSize: 12 }}>{stageLabel}</div>}
              </div>
            </div>
          )}
          {(dealOwner || csm) && (
            <div className="pcv8__context-col">
              <div className="pcv8__context-label">Owner</div>
              <div className="pcv8__context-value">
                {dealOwner && <div>{dealOwner}</div>}
                {csm && <div className="muted" style={{ fontSize: 12 }}>CSM · {csm}</div>}
              </div>
            </div>
          )}
        </div>
      </section>

      {/* Stap 2 — Voorstel & beslissing (acties + buttons samen) */}
      <section className="pcv8__step pcv8__step--proposal">
        <div className="pcv8__step-header">
          <span className="pcv8__step-number">2</span>
          <span className="pcv8__step-title">Voorstel & beslissing</span>
          {confidencePct != null && (
            <span className={`pcv8__conf-pill pcv8__conf-pill--${confTone}`}>{confidencePct}% zeker</span>
          )}
        </div>

        {actions.length > 0 ? (
          <div className="pcv8__actions-list">
            {actions.map((a, i) => <ActionBlock key={i} action={a} lookup={lookup} />)}
          </div>
        ) : (
          <div className="muted" style={{ fontSize: 12, padding: '8px 0' }}>
            Geen concrete acties — agent wacht op je input.
          </div>
        )}

        {A.liveAmendment && (
          <div className="pcv8__feedback">
            <span className="pcv8__feedback-label">Jouw eerdere feedback</span>
            <div className="pcv8__feedback-text">{A.liveAmendment}</div>
          </div>
        )}

        {A.isPending && (
          A.mode === 'amending' ? (
            <div className="pcv8__amend-form">
              <div className="textarea-wrap">
                <textarea
                  className="pcv8__amend-input"
                  value={A.amendText}
                  onChange={e => A.setAmendText(e.target.value)}
                  placeholder="Wat moet de agent anders doen?"
                  rows={3} autoFocus
                />
                <MicButton onTranscript={t => A.setAmendText(prev => (prev ? `${prev} ${t}` : t).trim())} />
              </div>
              <div className="pcv8__btns">
                <button className="btn btn--accent pcv8__btn" onClick={A.onAmend} disabled={A.busy || !A.amendText.trim()}>Opslaan</button>
                <button className="btn btn--ghost pcv8__btn" onClick={() => { A.setMode('view'); A.setAmendText('') }}>Annuleer</button>
              </div>
            </div>
          ) : A.needsInfo ? (
            <div className="pcv8__btns">
              <button className="btn btn--warning pcv8__btn pcv8__btn--primary" onClick={() => A.setMode('amending')} disabled={A.busy}>✎ Antwoord geven</button>
              <button className="btn btn--danger pcv8__btn" onClick={A.onReject} disabled={A.busy}>✕ Afwijzen</button>
            </div>
          ) : (
            <div className="pcv8__btns">
              <button className="btn btn--success pcv8__btn pcv8__btn--primary" onClick={A.onAccept} disabled={A.busy}>✓ Accepteer</button>
              <button className="btn btn--warning pcv8__btn" onClick={() => A.setMode('amending')} disabled={A.busy}>✎ Aanpassen</button>
              <button className="btn btn--danger pcv8__btn" onClick={A.onReject} disabled={A.busy}>✕ Afwijzen</button>
            </div>
          )
        )}

        {A.err && <div className="pcv8__error">⚠ {A.err}</div>}
      </section>
    </article>
  )
}

function ActionBlock({ action, lookup }) {
  const d = actionDetails(action, lookup)
  return (
    <div className={`pcv8__action pcv8__action--${d.meta.color}`}>
      <div className={`pcv8__action-banner pcv8__action-banner--${d.meta.color}`}>
        <span className="pcv8__action-icon">{d.meta.icon}</span>
        <span className="pcv8__action-type">{d.meta.label}</span>
        <span className="pcv8__action-title">{d.title}</span>
      </div>
      {(d.rows.length > 0 || d.body) && (
        <div className="pcv8__action-content">
          {d.rows.length > 0 && (
            <div className="pcv8__action-grid">
              {d.rows.map(([k, v], i) => (
                <div key={i} className="pcv8__action-grid-row">
                  <div className="pcv8__action-grid-key">{k}</div>
                  <div className="pcv8__action-grid-val">{v}</div>
                </div>
              ))}
            </div>
          )}
          {d.body && <blockquote className="pcv8__action-body">{d.body}</blockquote>}
        </div>
      )}
    </div>
  )
}
