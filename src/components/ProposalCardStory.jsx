import { useContext } from 'react'
import MicButton from './MicButton'
import { PipelineLookupContext, CATEGORIES, CATEGORY_LABEL, formatDateTime } from './views/HubSpotView'
import { useProposalActions, statusLabel, sortedActions, actionDetails } from './useProposalActions'

// ProposalCardV9 — Story met 3 stappen, conversationeel.
//   Stap 1: "Wat er is gebeurd" — signaal + bekende records in één compacte
//           inleiding (2 regels, geen sub-kolommen). Focus op "wat zag de agent".
//   Stap 2: "Wat wij voorstellen" — acties als banner-blokken, met pipeline
//           en owner mee-gereist als context binnen deze stap (niet los).
//   Stap 3: "Jouw keuze" — amendment + knoppen.
//   Minder proces-visual dan V5 (geen nummer-cirkels/verticale lijn), meer
//   als drie paragrafen die logisch op elkaar volgen.
export default function ProposalCardV9({ proposal }) {
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
  const originLabel = origin === 'calendar_event' ? 'agenda-event'
    : origin === 'email' ? 'e-mail'
    : origin === 'slack' || ctx.slack_ts ? 'Slack-bericht'
    : 'signaal'
  const sourceLine = [ctx.sender, ctx.event_date, ctx.meeting_date, ctx.date].filter(Boolean).join(' · ')
  const known = []
  if (ctx.existing_company_id) known.push(`Company ${ctx.existing_company_id}`)
  if (ctx.existing_contact_id) known.push(`Contact ${ctx.existing_contact_id}`)
  if (ctx.existing_deal_id)    known.push(`Deal ${ctx.existing_deal_id}`)
  if (ctx.existing_jira_issue) known.push(ctx.existing_jira_issue)
  if (ctx.preflight_match_method) known.push(`match: ${ctx.preflight_match_method}`)

  return (
    <article className={`pcv9 pcv9--${A.status} ${A.isRevised ? 'pcv9--revised' : ''} ${A.needsInfo ? 'pcv9--needs' : ''}`}>

      <header className="pcv9__header">
        <div className="pcv9__header-left">
          <select
            className={`cat-select cat-select--${A.cat}`}
            value={A.cat} onChange={e => A.onRecategorize(e.target.value)} disabled={A.busy}
            style={{ fontSize: 11, padding: '2px 6px' }} aria-label="Categorie"
          >
            {CATEGORIES.map(c => <option key={c} value={c}>{CATEGORY_LABEL[c]}</option>)}
          </select>
          <span className={`pcv9__status pcv9__status--${A.status}`}>{statusLabel(A.status)}</span>
          {A.needsInfo && <span className="pcv9__tag pcv9__tag--needs">⚠ input</span>}
          {A.isRevised && <span className="pcv9__tag pcv9__tag--revised">✎ herzien</span>}
        </div>
        <span className="pcv9__time">{formatDateTime(proposal.created_at)}</span>
      </header>

      <h2 className="pcv9__subject">{proposal.subject}</h2>
      {proposal.summary && <p className="pcv9__summary">{proposal.summary}</p>}

      {/* Stap 1 — Wat er is gebeurd (compacte inleiding) */}
      <section className="pcv9__step pcv9__step--incoming">
        <div className="pcv9__step-head">Wat er is gebeurd</div>
        <div className="pcv9__step-body pcv9__incoming">
          <div className="pcv9__incoming-line">
            Via {originLabel}{sourceLine && <> — <span className="pcv9__incoming-source">{sourceLine}</span></>}
          </div>
          {known.length > 0 ? (
            <div className="pcv9__incoming-known">
              Gevonden: {known.map((k, i) => <span key={i} className="pcv9__known-chip">{k}</span>)}
            </div>
          ) : (
            <div className="muted" style={{ fontSize: 12 }}>Geen bestaande records — mogelijk nieuw.</div>
          )}
        </div>
      </section>

      {/* Stap 2 — Wat wij voorstellen */}
      <section className="pcv9__step pcv9__step--proposal">
        <div className="pcv9__step-head">
          <span>Wat wij voorstellen</span>
          {confidencePct != null && (
            <span className={`pcv9__conf-pill pcv9__conf-pill--${confTone}`}>{confidencePct}%</span>
          )}
        </div>

        {(pipelineLabel || dealOwner || csm) && (
          <div className="pcv9__context-chips">
            {(pipelineLabel || pipelineRaw) && (
              <span className="pcv9__ctx-chip pcv9__ctx-chip--pipeline">
                {pipelineLabel || `? ${pipelineRaw}`}
                {stageLabel && <span className="pcv9__ctx-chip-sub">{stageLabel}</span>}
              </span>
            )}
            {dealOwner && <span className="pcv9__ctx-chip">Owner · {dealOwner}</span>}
            {csm && <span className="pcv9__ctx-chip">CSM · {csm}</span>}
          </div>
        )}

        {actions.length > 0 ? (
          <div className="pcv9__actions-list">
            {actions.map((a, i) => <ActionBlock key={i} action={a} lookup={lookup} />)}
          </div>
        ) : (
          <div className="muted" style={{ fontSize: 12, padding: '8px 0' }}>
            Geen concrete acties — agent wacht op jouw input.
          </div>
        )}
      </section>

      {/* Stap 3 — Jouw keuze */}
      <section className="pcv9__step pcv9__step--decision">
        <div className="pcv9__step-head">Jouw keuze</div>

        {A.liveAmendment && (
          <div className="pcv9__feedback">
            <span className="pcv9__feedback-label">Eerdere feedback:</span>
            <span>{A.liveAmendment}</span>
          </div>
        )}

        {A.isPending && (
          A.mode === 'amending' ? (
            <div className="pcv9__amend-form">
              <div className="textarea-wrap">
                <textarea
                  className="pcv9__amend-input"
                  value={A.amendText}
                  onChange={e => A.setAmendText(e.target.value)}
                  placeholder="Wat moet de agent anders doen?"
                  rows={3} autoFocus
                />
                <MicButton onTranscript={t => A.setAmendText(prev => (prev ? `${prev} ${t}` : t).trim())} />
              </div>
              <div className="pcv9__btns">
                <button className="btn btn--accent pcv9__btn" onClick={A.onAmend} disabled={A.busy || !A.amendText.trim()}>Opslaan</button>
                <button className="btn btn--ghost pcv9__btn" onClick={() => { A.setMode('view'); A.setAmendText('') }}>Annuleer</button>
              </div>
            </div>
          ) : A.needsInfo ? (
            <div className="pcv9__btns">
              <button className="btn btn--warning pcv9__btn pcv9__btn--primary" onClick={() => A.setMode('amending')} disabled={A.busy}>✎ Antwoord geven</button>
              <button className="btn btn--danger pcv9__btn" onClick={A.onReject} disabled={A.busy}>✕ Afwijzen</button>
            </div>
          ) : (
            <div className="pcv9__btns">
              <button className="btn btn--success pcv9__btn pcv9__btn--primary" onClick={A.onAccept} disabled={A.busy}>✓ Accepteer</button>
              <button className="btn btn--warning pcv9__btn" onClick={() => A.setMode('amending')} disabled={A.busy}>✎ Aanpassen</button>
              <button className="btn btn--danger pcv9__btn" onClick={A.onReject} disabled={A.busy}>✕ Afwijzen</button>
            </div>
          )
        )}

        {A.err && <div className="pcv9__error">⚠ {A.err}</div>}
      </section>
    </article>
  )
}

function ActionBlock({ action, lookup }) {
  const d = actionDetails(action, lookup)
  return (
    <div className={`pcv9__action pcv9__action--${d.meta.color}`}>
      <div className={`pcv9__action-stripe pcv9__action-stripe--${d.meta.color}`}>
        <span className="pcv9__action-icon">{d.meta.icon}</span>
        <span className="pcv9__action-type">{d.meta.label}</span>
        <span className="pcv9__action-title">{d.title}</span>
      </div>
      {(d.rows.length > 0 || d.body) && (
        <div className="pcv9__action-content">
          {d.rows.length > 0 && (
            <div className="pcv9__action-grid">
              {d.rows.map(([k, v], i) => (
                <div key={i} className="pcv9__action-grid-row">
                  <div className="pcv9__action-grid-key">{k}</div>
                  <div className="pcv9__action-grid-val">{v}</div>
                </div>
              ))}
            </div>
          )}
          {d.body && <blockquote className="pcv9__action-body">{d.body}</blockquote>}
        </div>
      )}
    </div>
  )
}
