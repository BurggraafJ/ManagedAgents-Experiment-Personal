import { useState, useContext } from 'react'
import MicButton from './MicButton'
import { PipelineLookupContext, CATEGORIES, CATEGORY_LABEL, formatDateTime } from './views/hubspot-common'
import { useProposalActions, sortedActions, actionDetails } from './useProposalActions'

// ProposalCardCompact — "Pure" kaart (winnende mockup).
//   Structuur:
//     1. compact meta-strip (categorie · status · tags · tijd)
//     2. subject + summary
//     3. accordion met 1-regel actie-rijen, bordered-square icoontjes
//        (monochroom), klik om uit te klappen voor details
//     4. amendment-callout als er feedback is
//     5. grote beslis-knoppen
//   Ontwerp-principe: minimaal. Eén accent-kleur (Legal Mind oranje) voor
//   beslispunten, verder alleen grijstinten. Elke actie default collapsed —
//   je ziet snel WAT er gebeurt, klap uit als je details wil.
export default function ProposalCardCompact({ proposal }) {
  const lookup = useContext(PipelineLookupContext)
  const A = useProposalActions(proposal)
  const ctx = proposal.context || {}
  const pipelineRaw = ctx.pipeline || ctx.pipeline_id || null
  const stageId     = ctx.pipeline_stage || ctx.deal_stage || null
  const { pipelineLabel, stageLabel } = lookup.resolve(pipelineRaw, stageId)
  const dealOwner = ctx.deal_owner_name || ctx.dealowner || ctx.jira_assignee || null
  const csm       = ctx.csm_name || ctx.customer_success_manager || null
  const confidencePct = typeof proposal.confidence === 'number' ? Math.round(proposal.confidence * 100) : null
  const actions = sortedActions(proposal)

  // "Meer informatie nodig" alleen tonen als het ook ECHT nog is — d.w.z.
  // eerste keer vragen. Zodra er amended_from is geweest, is het voor Jelle
  // onderdeel van "Goedkeuren" en mag de needs-tag niet meer afleiden.
  const showNeedsInfo = A.needsInfo && !A.isRevised

  return (
    <article className={`pcv7 pcv7--${A.status} ${A.isRevised ? 'pcv7--revised' : ''} ${showNeedsInfo ? 'pcv7--needs' : ''}`}>

      {/* Meta-strip: categorie-select + status-tags + tijd */}
      <div className="pcv7__meta">
        <select
          className={`pcv7__cat cat-select cat-select--${A.cat}`}
          value={A.cat} onChange={e => A.onRecategorize(e.target.value)} disabled={A.busy}
          aria-label="Categorie"
        >
          {CATEGORIES.map(c => <option key={c} value={c}>{CATEGORY_LABEL[c]}</option>)}
        </select>
        <span className={`pcv7__status pcv7__status--${A.status}`}>{statusText(A.status)}</span>
        {showNeedsInfo && <span className="pcv7__tag pcv7__tag--needs">⚠ meer info nodig</span>}
        {A.isRevised   && <span className="pcv7__tag pcv7__tag--revised">✎ herzien na feedback</span>}
        <span className="pcv7__spacer" />
        <span className="pcv7__time">{formatDateTime(proposal.created_at)}</span>
      </div>

      {/* Hero: subject + summary */}
      <h2 className="pcv7__subject">{proposal.subject}</h2>
      {proposal.summary && <p className="pcv7__summary">{proposal.summary}</p>}

      {/* Sub-meta strip: pipeline · owner · CSM · confidence — compact, niet herhaald per actie */}
      {(pipelineLabel || dealOwner || csm || confidencePct != null) && (
        <div className="pcv7__submeta">
          {(pipelineLabel || pipelineRaw) && (
            <span className="pcv7__submeta-item">
              <span className="pcv7__submeta-label">Pipeline</span>
              <span className="pcv7__submeta-val">
                {pipelineLabel || `? ${pipelineRaw}`}
                {stageLabel && <span className="pcv7__submeta-sub"> · {stageLabel}</span>}
              </span>
            </span>
          )}
          {dealOwner && (
            <span className="pcv7__submeta-item">
              <span className="pcv7__submeta-label">Owner</span>
              <span className="pcv7__submeta-val">{dealOwner}</span>
            </span>
          )}
          {csm && (
            <span className="pcv7__submeta-item">
              <span className="pcv7__submeta-label">CSM</span>
              <span className="pcv7__submeta-val">{csm}</span>
            </span>
          )}
          {confidencePct != null && (
            <span className="pcv7__submeta-item">
              <span className="pcv7__submeta-label">Confidence</span>
              <span className="pcv7__submeta-val">{confidencePct}%</span>
            </span>
          )}
        </div>
      )}

      {/* Accordion — elk item default collapsed */}
      {actions.length > 0 && (
        <section className="pcv7__actions">
          <div className="pcv7__actions-head">
            <span className="pcv7__actions-label">Bij ✓ Goedkeuren — {actions.length} acties</span>
          </div>
          <div className="pcv7__accordion">
            {actions.map((a, i) => <AccordionAction key={i} action={a} lookup={lookup} />)}
          </div>
        </section>
      )}

      {A.liveAmendment && (
        <div className="pcv7__amendment">
          <span className="pcv7__amendment-label">Jouw feedback</span>
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
        ) : showNeedsInfo ? (
          <div className="pcv7__btns">
            <button className="btn btn--warning pcv7__btn pcv7__btn--primary" onClick={() => A.setMode('amending')} disabled={A.busy}>✎ Antwoord geven</button>
            <button className="btn btn--danger pcv7__btn" onClick={A.onReject} disabled={A.busy}>✕ Afwijzen</button>
          </div>
        ) : (
          <div className="pcv7__btns">
            <button className="btn btn--success pcv7__btn pcv7__btn--primary" onClick={A.onAccept} disabled={A.busy}>✓ Goedkeuren</button>
            <button className="btn btn--warning pcv7__btn" onClick={() => A.setMode('amending')} disabled={A.busy}>✎ Aanpassen</button>
            <button className="btn btn--danger pcv7__btn" onClick={A.onReject} disabled={A.busy}>✕ Afwijzen</button>
          </div>
        )
      )}

      {A.err && <div className="pcv7__error">⚠ {A.err}</div>}
    </article>
  )
}

// Vriendelijkere status-labels voor bovenaan de kaart
function statusText(s) {
  const map = {
    pending:  'In afwachting',
    amended:  'Aanpassing verstuurd',
    accepted: 'Goedgekeurd',
    executed: 'Uitgevoerd',
    rejected: 'Afgewezen',
    failed:   'Gefaald',
    expired:  'Verlopen',
    superseded: 'Vervangen',
  }
  return map[s] || s
}

function AccordionAction({ action, lookup }) {
  const [open, setOpen] = useState(false)
  const d = actionDetails(action, lookup)
  // Preview-regel: eerste woorden van body, of compact samenvatting van rows.
  const preview = d.body
    ? (d.body.length > 90 ? d.body.slice(0, 90).trim() + '…' : d.body)
    : d.rows.slice(0, 2).map(([k, v]) => v).join(' · ')

  return (
    <div className={`pcv7__acc-item ${open ? 'pcv7__acc-item--open' : ''}`}>
      <button type="button" className="pcv7__acc-row" onClick={() => setOpen(v => !v)}>
        <span className="pcv7__acc-icon">{d.meta.icon}</span>
        <span className="pcv7__acc-type">{d.meta.label}</span>
        <span className="pcv7__acc-title">{d.title || preview}</span>
        {d.title && preview && <span className="pcv7__acc-preview">{preview}</span>}
        <span className="pcv7__acc-caret">▸</span>
      </button>
      {open && (
        <div className="pcv7__acc-body">
          {d.rows.length > 0 && (
            <dl className="pcv7__acc-rows">
              {d.rows.map(([k, v], i) => (
                <div key={i} className="pcv7__acc-row-pair">
                  <dt>{k}</dt>
                  <dd>{v}</dd>
                </div>
              ))}
            </dl>
          )}
          {d.body && <div className="pcv7__acc-body-text">{d.body}</div>}
        </div>
      )}
    </div>
  )
}
