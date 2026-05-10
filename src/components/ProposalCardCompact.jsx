import { useContext, useState } from 'react'
import MicButton from './MicButton'
import { PipelineLookupContext, HubSpotUsersContext, CATEGORIES, CATEGORY_LABEL, formatDateTime } from './views/hubspot-common'
import { useProposalActions } from './useProposalActions'
import RagDetailsModal from './RagDetailsModal'
import ChipAction from './ChipAction'

// ProposalCardCompact — Zen-stijl met inline-edit per actie.
//   Structuur:
//     1. meta-tags-rij (categorie-pill + status-pill)
//     2. subject + summary
//     3. submeta — 4 kolommen (Pipeline, Owner, CSM, Confidence)
//     4. chip-actions: elke actie heeft een ×-knop + inline edit voor
//        task-deadline en assignee (via dropdown van hubspot_users).
//     5. amendment-callout als er feedback is
//     6. action-knoppen:
//        - view mode: Goedkeuren (pakt edits mee) · Aanpassen · Afwijzen
//        - amending mode: Opnieuw (agent schrijft nieuw voorstel) ·
//          Doorvoeren (edits + tekst direct accept) · Annuleer
export default function ProposalCardCompact({ proposal, onRefresh }) {
  const lookup       = useContext(PipelineLookupContext)
  const hubspotUsers = useContext(HubSpotUsersContext)
  const A = useProposalActions(proposal, onRefresh)
  const ctx = proposal.context || {}
  const pipelineRaw = ctx.pipeline || ctx.pipeline_id || null
  const stageId     = ctx.pipeline_stage || ctx.deal_stage || null
  const { pipelineLabel, stageLabel } = lookup.resolve(pipelineRaw, stageId)
  const dealOwner = ctx.deal_owner_name || ctx.dealowner || ctx.jira_assignee || null
  const csm       = ctx.csm_name || ctx.customer_success_manager || null
  const confidencePct = typeof proposal.confidence === 'number' ? Math.round(proposal.confidence * 100) : null
  const actions = Array.isArray(proposal.proposal?.actions) ? proposal.proposal.actions : []

  // Bron-detectie voor de "via mail/agenda/fireflies"-pill (mockup pcard__head).
  // Eerste hit wint — proposals hebben meestal precies één bron-trigger.
  const sourceLabel = (() => {
    if (ctx.message_id || ctx.thread_id || ctx.mail_id) return 'via mail'
    if (ctx.calendar_event_id) return 'via agenda'
    if (ctx.fireflies_id || ctx.transcript_id || ctx.meeting_id) return 'via meeting'
    return null
  })()

  const showNeedsInfo = A.needsInfo && !A.isRevised
  const amending = A.mode === 'amending'

  // Effectief aantal actieve acties (zonder verwijderde), voor label.
  const activeCount = actions.length - A.removed.size

  return (
    <article className={`pcv7 pcv7--${A.status} ${A.isRevised ? 'pcv7--revised' : ''} ${showNeedsInfo ? 'pcv7--needs' : ''}`}>

      <div className="pcv7__meta">
        <select
          className={`pcv7__cat cat-select cat-select--${A.cat}`}
          value={A.cat} onChange={e => A.onRecategorize(e.target.value)} disabled={A.busy}
          aria-label="Categorie"
        >
          {CATEGORIES.map(c => <option key={c} value={c}>{CATEGORY_LABEL[c]}</option>)}
        </select>
        {(pipelineLabel || stageLabel) && (
          <span className="pcv7__stage-pill" title="Pipeline · stage uit voorstel-context">
            {[pipelineLabel, stageLabel].filter(Boolean).join(' · ')}
          </span>
        )}
        {sourceLabel && (
          <span className="pcv7__source-pill" title="Trigger-bron van dit voorstel">
            {sourceLabel}
          </span>
        )}
        <span className={`pcv7__status pcv7__status--${A.status}`}>{statusText(A.status)}</span>
        {showNeedsInfo && <span className="pcv7__tag pcv7__tag--needs">⚠ meer info nodig</span>}
        {A.isRevised   && <span className="pcv7__tag pcv7__tag--revised">✎ herzien na feedback</span>}
        {A.hasEdits    && <span className="pcv7__tag pcv7__tag--edits">● bewerkt</span>}
        <span className="pcv7__spacer" />
        {confidencePct != null && (
          <span className="pcv7__confidence" title={`Confidence ${confidencePct}%`}>
            {confidencePct}%
          </span>
        )}
        <span className="pcv7__time">{formatDateTime(proposal.created_at)}</span>
      </div>

      <h3 className="pcv7__subject">{proposal.subject}</h3>
      <div className="pcv7__sub">
        <span>{proposal.agent_name || 'daily-admin'}</span>
        <span className="pcv7__sub-sep">·</span>
        <span>{formatDateTime(proposal.created_at)}</span>
        {confidencePct != null && (
          <>
            <span className="pcv7__sub-sep">·</span>
            <span>confidence <strong className="pcv7__sub-conf">{(confidencePct / 100).toFixed(2)}</strong></span>
          </>
        )}
      </div>
      {proposal.summary && (
        <>
          <div className="pcv7__why-label">Samenvatting</div>
          <p className="pcv7__summary">{proposal.summary}</p>
        </>
      )}

      {/* Submeta-rij — Pipeline / Owner / CSM / RAG. RAG-item is ALTIJD
          zichtbaar zodat Jelle direct ziet of de skill context heeft
          gebruikt of niet. Score = avg combined-similarity over de top-K
          RAG-matches; 0 = geen RAG-call gedaan voor dit voorstel. */}
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
        <RagSubmetaItem ctx={ctx} proposalId={proposal.id} />
      </div>

      {actions.length > 0 && (
        <section className="pcv7__actions">
          <div className="pcv7__actions-head">
            <span className="pcv7__actions-label">
              Bij ✓ Goedkeuren — {activeCount} {activeCount === 1 ? 'actie' : 'acties'}
              {A.removed.size > 0 && <span className="muted"> · {A.removed.size} verwijderd</span>}
            </span>
          </div>
          <div className="pcv7__chips">
            {actions.map((a, i) => (
              <ChipAction
                key={i}
                action={a}
                index={i}
                lookup={lookup}
                proposalContext={ctx}
                proposalCategory={A.cat}
                removed={A.removed.has(i)}
                edits={A.edits[i] || {}}
                onRemove={() => A.removeAction(i)}
                onRestore={() => A.restoreAction(i)}
                onPatch={(patch) => A.patchAction(i, patch)}
                hubspotUsers={hubspotUsers}
                disabled={A.busy}
                canEdit={A.isPending}
              />
            ))}
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
        amending ? (
          <div className="pcv7__amend-form">
            <div className="textarea-wrap">
              <textarea
                className="pcv7__amend-input"
                value={A.amendText}
                onChange={e => A.setAmendText(e.target.value)}
                placeholder="Extra richtlijn voor de agent (optioneel bij Doorvoeren)"
                rows={3} autoFocus
              />
              <MicButton onTranscript={t => A.setAmendText(prev => (prev ? `${prev} ${t}` : t).trim())} />
            </div>
            <div className="pcv7__btns">
              <button
                className="btn btn--warning pcv7__btn"
                onClick={A.onAmend}
                disabled={A.busy || !A.amendText.trim()}
                title="Stuur feedback terug — agent schrijft een nieuw voorstel met jouw aanpassingen."
              >
                ↻ Opnieuw
              </button>
              <button
                className="btn btn--success pcv7__btn pcv7__btn--primary"
                onClick={A.onAmendAndAccept}
                disabled={A.busy}
                title="Accepteer direct met deze bewerkingen en eventuele extra richtlijn — geen re-review nodig."
              >
                ✓ Doorvoeren
              </button>
              <button
                className="btn btn--ghost pcv7__btn"
                onClick={() => { A.setMode('view'); A.setAmendText('') }}
                disabled={A.busy}
              >
                Annuleer
              </button>
            </div>
          </div>
        ) : showNeedsInfo ? (
          <div className="pcv7__btns">
            <button className="btn btn--warning pcv7__btn pcv7__btn--primary" onClick={() => A.setMode('amending')} disabled={A.busy}>✎ Antwoord geven</button>
            <button className="btn btn--danger pcv7__btn" onClick={A.onReject} disabled={A.busy}>✕ Afwijzen</button>
          </div>
        ) : (
          <div className="pcv7__btns">
            <button
              className="btn btn--success pcv7__btn pcv7__btn--primary"
              onClick={A.onAccept}
              disabled={A.busy || activeCount === 0}
              title={activeCount === 0 ? 'Alle acties zijn verwijderd — niets om goed te keuren.' : ''}
            >
              ✓ Goedkeuren{A.hasEdits ? ' (met bewerkingen)' : ''}
            </button>
            <button className="btn btn--warning pcv7__btn" onClick={() => A.setMode('amending')} disabled={A.busy}>✎ Aanpassen</button>
            <button className="btn btn--danger pcv7__btn" onClick={A.onReject} disabled={A.busy}>✕ Afwijzen</button>
          </div>
        )
      )}

      {A.err && <div className="pcv7__error">⚠ {A.err}</div>}
    </article>
  )
}

// Submeta-item dat altijd toont of/hoe RAG is ingezet voor dit voorstel.
// Leest twee context-keys (compat met beide skills):
//   - daily-admin-future: rag_match_count + rag_avg_similarity + rag_bundle_id
//   - daily-admin (v5.3+): bundle_id (zonder count → toon ✓ zonder score)
// Geen RAG-data → "0" met grijze styling zodat Jelle direct ziet dat de
// skill geen verrijking heeft gedaan voor dit voorstel.
function RagSubmetaItem({ ctx, proposalId }) {
  const c = ctx || {}
  const count = typeof c.rag_match_count === 'number' ? c.rag_match_count : null
  const avg = typeof c.rag_avg_similarity === 'number' ? c.rag_avg_similarity : null
  const bundleId = c.rag_bundle_id || c.bundle_id || c.context_bundle_id || null
  const reclassified = c.rag_reclassified === true
  const [modalOpen, setModalOpen] = useState(false)

  const hasRag = (count !== null && count > 0) || !!bundleId
  const clickable = hasRag && !!proposalId

  const onClick = (e) => {
    e.stopPropagation()
    if (clickable) setModalOpen(true)
  }

  // Geval 1 — counts beschikbaar
  if (count !== null && count > 0) {
    const tone = avg && avg >= 0.30 ? 'success' : avg && avg >= 0.20 ? 'mid' : 'low'
    const colorMap = { success: 'var(--success, #0a7)', mid: 'var(--accent, #0066cc)', low: 'var(--warning, #c80)' }
    return (
      <>
        <span
          className="pcv7__submeta-item"
          onClick={onClick}
          style={clickable ? { cursor: 'pointer' } : undefined}
          title={
            `RAG context-build: ${count} matches uit chunks-archief\n` +
            `avg combined-score: ${avg != null ? avg.toFixed(3) : '—'}\n` +
            `top-similarity: ${typeof c.rag_top_similarity === 'number' ? c.rag_top_similarity.toFixed(3) : '—'}\n` +
            (reclassified ? 'RAG heeft categorie geüpgraded naar lead.\n' : '') +
            (bundleId ? `bundle_id: ${bundleId}\n` : 'geen bundle_id\n') +
            (clickable ? '\n→ Klik voor details (chunks, fact-types, lessons)' : '')
          }
        >
          <span className="pcv7__submeta-label">RAG</span>
          <span className="pcv7__submeta-val" style={{ color: colorMap[tone] }}>
            ✓ {count} match{count === 1 ? '' : 'es'}
            {avg != null && <span className="pcv7__submeta-sub"> · {avg.toFixed(2)}</span>}
            {reclassified && <span className="pcv7__submeta-sub"> · ↑lead</span>}
          </span>
        </span>
        {modalOpen && (
          <RagDetailsModal recordType="agent_proposal" recordId={proposalId} onClose={() => setModalOpen(false)} />
        )}
      </>
    )
  }

  // Geval 2 — bundle_id zonder count
  if (bundleId) {
    return (
      <>
        <span
          className="pcv7__submeta-item"
          onClick={onClick}
          style={clickable ? { cursor: 'pointer' } : undefined}
          title={`Skill heeft context-build aangeroepen — bundle_id: ${bundleId}\n→ Klik voor details`}
        >
          <span className="pcv7__submeta-label">RAG</span>
          <span className="pcv7__submeta-val" style={{ color: 'var(--accent, #0066cc)' }}>
            ✓ verrijkt
          </span>
        </span>
        {modalOpen && (
          <RagDetailsModal recordType="agent_proposal" recordId={proposalId} onClose={() => setModalOpen(false)} />
        )}
      </>
    )
  }

  // Geval 3 — geen RAG-data
  return (
    <span
      className="pcv7__submeta-item"
      title="Skill heeft GEEN context-build / RAG-lookup aangeroepen voor dit voorstel"
    >
      <span className="pcv7__submeta-label">RAG</span>
      <span className="pcv7__submeta-val muted" style={{ opacity: 0.6 }}>0</span>
    </span>
  )
}

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
