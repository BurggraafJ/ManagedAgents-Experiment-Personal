import { useContext } from 'react'
import MicButton from './MicButton'
import { PipelineLookupContext, CATEGORIES, CATEGORY_LABEL, formatDateTime } from './views/HubSpotView'
import { useProposalActions, statusLabel, sortedActions, actionDetails } from './useProposalActions'

// ProposalCardV5 — Timeline / narrative flow.
//   Het voorstel leest als een verhaal in 4 stappen:
//     1. "Waar komt dit vandaan" — signaal-bron (mail/agenda/slack, afzender, tijd)
//     2. "Wat er al bekend is" — bestaande HubSpot/Jira records + pipeline-context
//     3. "Wat de agent voorstelt" — concrete acties, als onderdeel van de story
//     4. "Jouw beslissing" — amendment + buttons
//   Confidence verschijnt alleen als kleine inline-pill in stap 3.
export default function ProposalCardV5({ proposal }) {
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

  // Signaal-bron samenvatten
  const origin = ctx.origin || (ctx.event_date ? 'calendar_event' : (ctx.sender ? 'email' : null))
  const originLabel = origin === 'calendar_event' ? 'Agenda-event'
    : origin === 'email' ? 'E-mail'
    : origin === 'slack' || ctx.slack_ts ? 'Slack-bericht'
    : 'Signaal'
  const sourceLine = [ctx.sender, ctx.event_date, ctx.meeting_date, ctx.date].filter(Boolean).join(' · ')

  // Bekende records
  const known = []
  if (ctx.existing_company_id) known.push(`Company-ID ${ctx.existing_company_id}`)
  if (ctx.existing_contact_id) known.push(`Contact-ID ${ctx.existing_contact_id}`)
  if (ctx.existing_deal_id)    known.push(`Deal-ID ${ctx.existing_deal_id}`)
  if (ctx.existing_jira_issue) known.push(`Jira ${ctx.existing_jira_issue}`)
  if (ctx.preflight_match_method) known.push(`match via ${ctx.preflight_match_method}`)
  if (ctx.merged_from_signals && Array.isArray(ctx.merged_from_signals)) {
    known.push(`gemerged: ${ctx.merged_from_signals.length} signaal${ctx.merged_from_signals.length > 1 ? 'en' : ''}`)
  }

  return (
    <article className={`pcv5 pcv5--${A.status} ${A.isRevised ? 'pcv5--revised' : ''} ${A.needsInfo ? 'pcv5--needs' : ''}`}>

      {/* Header */}
      <header className="pcv5__header">
        <div className="pcv5__header-left">
          <select
            className={`cat-select cat-select--${A.cat}`}
            value={A.cat} onChange={e => A.onRecategorize(e.target.value)} disabled={A.busy}
            style={{ fontSize: 11, padding: '2px 6px' }}
            aria-label="Categorie"
          >
            {CATEGORIES.map(c => <option key={c} value={c}>{CATEGORY_LABEL[c]}</option>)}
          </select>
          <span className={`pcv5__status pcv5__status--${A.status}`}>{statusLabel(A.status)}</span>
          {A.needsInfo && <span className="pcv5__tag pcv5__tag--needs">⚠ input</span>}
          {A.isRevised && <span className="pcv5__tag pcv5__tag--revised">✎ herzien</span>}
        </div>
        <span className="pcv5__time">{formatDateTime(proposal.created_at)}</span>
      </header>

      <h2 className="pcv5__subject">{proposal.subject}</h2>
      {proposal.summary && <p className="pcv5__summary">{proposal.summary}</p>}

      {/* Timeline */}
      <div className="pcv5__timeline">

        {/* Stap 1: bron */}
        <TimelineStep step={1} title={`Binnengekomen via ${originLabel}`} color="blue">
          {sourceLine
            ? <div className="pcv5__step-line">{sourceLine}</div>
            : <div className="muted" style={{ fontSize: 12 }}>bron niet expliciet vastgelegd</div>}
        </TimelineStep>

        {/* Stap 2: bekend */}
        <TimelineStep step={2} title="Wat al bekend is" color="purple">
          {known.length > 0 ? (
            <ul className="pcv5__step-list">
              {known.map((k, i) => <li key={i}>{k}</li>)}
            </ul>
          ) : (
            <div className="muted" style={{ fontSize: 12 }}>geen bestaande records gematcht — mogelijk nieuw</div>
          )}
          {(pipelineLabel || pipelineRaw) && (
            <div className="pcv5__step-pipeline">
              <span className="pcv5__step-pipeline-label">Pipeline:</span>{' '}
              <span className="pcv5__step-pipeline-value">
                {pipelineLabel || `? ${pipelineRaw}`}
                {stageLabel && <> · {stageLabel}</>}
              </span>
            </div>
          )}
          {(dealOwner || csm) && (
            <div className="pcv5__step-owner">
              {dealOwner && <span>Owner: {dealOwner}</span>}
              {csm && <span> · CSM: {csm}</span>}
            </div>
          )}
        </TimelineStep>

        {/* Stap 3: agent voorstel */}
        <TimelineStep step={3} title="Wat de agent voorstelt" color="accent"
          rightBadge={confidencePct != null
            ? <span className={`pcv5__conf-pill pcv5__conf-pill--${confTone}`}>{confidencePct}% zeker</span>
            : null}>
          {actions.length > 0 ? (
            <div className="pcv5__step-actions">
              {actions.map((a, i) => <ActionLine key={i} action={a} lookup={lookup} />)}
            </div>
          ) : (
            <div className="muted" style={{ fontSize: 12 }}>geen concrete acties — agent wacht op je input</div>
          )}
        </TimelineStep>

        {/* Stap 4: jouw beslissing */}
        <TimelineStep step={4} title="Jouw beslissing" color="green" isLast>
          {A.liveAmendment && (
            <div className="pcv5__prev-feedback">
              <span className="pcv5__prev-feedback-label">Eerdere feedback:</span>
              <span>{A.liveAmendment}</span>
            </div>
          )}

          {A.isPending && (
            A.mode === 'amending' ? (
              <div className="pcv5__amend-form">
                <div className="textarea-wrap">
                  <textarea
                    className="pcv5__amend-input"
                    value={A.amendText}
                    onChange={e => A.setAmendText(e.target.value)}
                    placeholder="Wat moet de agent anders doen?"
                    rows={3}
                    autoFocus
                  />
                  <MicButton onTranscript={t => A.setAmendText(prev => (prev ? `${prev} ${t}` : t).trim())} />
                </div>
                <div className="pcv5__btns">
                  <button className="btn btn--accent pcv5__btn" onClick={A.onAmend} disabled={A.busy || !A.amendText.trim()}>Opslaan</button>
                  <button className="btn btn--ghost pcv5__btn" onClick={() => { A.setMode('view'); A.setAmendText('') }}>Annuleer</button>
                </div>
              </div>
            ) : A.needsInfo ? (
              <div className="pcv5__btns">
                <button className="btn btn--warning pcv5__btn pcv5__btn--primary" onClick={() => A.setMode('amending')} disabled={A.busy}>✎ Antwoord geven</button>
                <button className="btn btn--danger pcv5__btn" onClick={A.onReject} disabled={A.busy}>✕ Afwijzen</button>
              </div>
            ) : (
              <div className="pcv5__btns">
                <button className="btn btn--success pcv5__btn pcv5__btn--primary" onClick={A.onAccept} disabled={A.busy}>✓ Accepteer</button>
                <button className="btn btn--warning pcv5__btn" onClick={() => A.setMode('amending')} disabled={A.busy}>✎ Aanpassen</button>
                <button className="btn btn--danger pcv5__btn" onClick={A.onReject} disabled={A.busy}>✕ Afwijzen</button>
              </div>
            )
          )}

          {A.err && <div className="pcv5__error">⚠ {A.err}</div>}
        </TimelineStep>
      </div>
    </article>
  )
}

function TimelineStep({ step, title, color, children, rightBadge, isLast }) {
  return (
    <div className={`pcv5__step pcv5__step--${color} ${isLast ? 'pcv5__step--last' : ''}`}>
      <div className="pcv5__step-marker">
        <div className="pcv5__step-number">{step}</div>
        {!isLast && <div className="pcv5__step-line-v" />}
      </div>
      <div className="pcv5__step-content">
        <div className="pcv5__step-head">
          <span className="pcv5__step-title">{title}</span>
          {rightBadge && <span className="pcv5__step-badge">{rightBadge}</span>}
        </div>
        <div className="pcv5__step-body">{children}</div>
      </div>
    </div>
  )
}

function ActionLine({ action, lookup }) {
  const d = actionDetails(action, lookup)
  return (
    <div className={`pcv5__action pcv5__action--${d.meta.color}`}>
      <div className="pcv5__action-head">
        <span className="pcv5__action-icon">{d.meta.icon}</span>
        <span className="pcv5__action-type">{d.meta.label}</span>
        <span className="pcv5__action-title">{d.title}</span>
      </div>
      {d.rows.length > 0 && (
        <div className="pcv5__action-rows">
          {d.rows.map(([k, v], i) => (
            <div key={i} className="pcv5__action-row">
              <span className="pcv5__action-row-key">{k}</span>
              <span className="pcv5__action-row-val">{v}</span>
            </div>
          ))}
        </div>
      )}
      {d.body && <blockquote className="pcv5__action-body">{d.body}</blockquote>}
    </div>
  )
}
