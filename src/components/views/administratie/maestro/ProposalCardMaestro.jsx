import { useContext, useState, useMemo } from 'react'
import { PipelineLookupContext, HubSpotUsersContext, CATEGORIES, CATEGORY_LABEL, formatDateTime } from '../../hubspot-common'
import { useProposalActions, actionDetails, TYPE_META } from '../../../useProposalActions'
import MicButton from '../../../MicButton'
import RichTextEditor from '../../../ui/RichTextEditor'
import './proposal-card-maestro.css'

// ProposalCardMaestro — JSX-rewrite van de detail-card, mockup-exact
// gestructureerd volgens Administratie.html (.pcard__head/__diff/__why/
// __records/__feedback/__actions + .rec-card per actie).
//
// Class-namespace: .pcm__ (proposal-card-maestro) — geen conflict met
// .pcv7__ uit ProposalCardCompact. Beide componenten leven naast elkaar:
//   - /administratie       → ProposalCardCompact (oude, .pcv7__ classes)
//   - /administratie-maestro → ProposalCardMaestro (deze, .pcm__ classes)
//
// Hard-rule: oude code blijft 100% intact. Hooks (useProposalActions),
// actionDetails, RichTextEditor, MicButton zijn allemaal gedeeld.

function formatEur(raw) {
  if (raw == null || raw === '' || isNaN(Number(raw))) return null
  const n = Number(raw)
  if (n === 0) return null
  return new Intl.NumberFormat('nl-NL', {
    style: 'currency', currency: 'EUR', maximumFractionDigits: 0,
  }).format(n)
}
function formatDate(raw) {
  if (!raw) return null
  const d = new Date(raw)
  if (isNaN(d.getTime())) return raw
  return d.toLocaleDateString('nl-NL', { day: '2-digit', month: 'short', year: 'numeric' })
}

const CAT_DOT_COLOR = {
  klant: 'var(--orange-deep)',
  partner: '#1e3a73',
  recruitment: '#4a5147',
  overig: 'var(--neutral-700)',
}

function statusText(s) {
  const map = {
    pending: 'In afwachting', amended: 'Aanpassing verstuurd', accepted: 'Goedgekeurd',
    executed: 'Uitgevoerd', rejected: 'Afgewezen', failed: 'Gefaald',
    expired: 'Verlopen', superseded: 'Vervangen',
  }
  return map[s] || s
}

export default function ProposalCardMaestro({ proposal, onRefresh }) {
  const lookup = useContext(PipelineLookupContext)
  const hubspotUsers = useContext(HubSpotUsersContext)
  const A = useProposalActions(proposal, onRefresh)
  const ctx = proposal.context || {}
  const pipelineRaw = ctx.pipeline || ctx.pipeline_id || null
  const stageId = ctx.pipeline_stage || ctx.deal_stage || null
  const { pipelineLabel, stageLabel } = lookup.resolve(pipelineRaw, stageId)
  const dealOwner = ctx.deal_owner_name || ctx.dealowner || ctx.jira_assignee || null
  const confidencePct = typeof proposal.confidence === 'number' ? Math.round(proposal.confidence * 100) : null
  const actions = Array.isArray(proposal.proposal?.actions) ? proposal.proposal.actions : []

  const sourceLabel = (() => {
    if (ctx.message_id || ctx.thread_id || ctx.mail_id) return 'via mail'
    if (ctx.calendar_event_id) return 'via agenda'
    if (ctx.fireflies_id || ctx.transcript_id || ctx.meeting_id) return 'via meeting'
    return null
  })()

  const showNeedsInfo = A.needsInfo && !A.isRevised
  const amending = A.mode === 'amending'
  const activeCount = actions.length - A.removed.size

  const [diffOpen, setDiffOpen] = useState(false)
  const diffFields = useMemo(() => {
    const out = []
    const dealName = ctx.deal_name || ctx.deal_title
    if (dealName) out.push(['Naam deal', dealName])
    const amount = formatEur(ctx.deal_amount ?? ctx.amount)
    if (amount) out.push(['Bedrag', amount])
    if (dealOwner) out.push(['Owner', dealOwner])
    const closeDate = formatDate(ctx.close_date || ctx.deal_closedate)
    if (closeDate) out.push(['Close date', closeDate])
    const company = ctx.company_name || ctx.company
    if (company) out.push(['Company', company])
    const contact = ctx.contact_name || ctx.contact
    if (contact) out.push(['Contact', contact])
    return out
  }, [ctx, dealOwner])
  const hasDiffFields = diffFields.length > 0

  const catLabel = CATEGORY_LABEL[A.cat] || 'Overig'
  const catDotColor = CAT_DOT_COLOR[A.cat] || 'var(--neutral-700)'

  return (
    <article className="pcm">
      {/* HEAD — cat-pill + stage-pill + source-pill + ℹ-toggle, dan h3 + sub */}
      <div className="pcm__head">
        <div className="pcm__cat-row">
          {/* Cat-pill als select met dot-prefix (mockup pcard__cat-pill behoudt
              functionele categorie-wijziging via dropdown). */}
          <span className={`pcm__cat-pill pcm__cat-pill--${A.cat}`}>
            <span className="pcm__pill-dot" style={{ background: catDotColor }} />
            <select
              className="pcm__cat-select"
              value={A.cat}
              onChange={e => A.onRecategorize(e.target.value)}
              disabled={A.busy}
              aria-label="Categorie"
            >
              {CATEGORIES.map(c => (
                <option key={c} value={c}>{CATEGORY_LABEL[c]}</option>
              ))}
            </select>
            <span className="pcm__cat-label">{catLabel}</span>
          </span>
          {(pipelineLabel || stageLabel) && (
            <span className="pcm__pill pcm__pill--info">
              {[pipelineLabel, stageLabel].filter(Boolean).join(' · ')}
            </span>
          )}
          {sourceLabel && (
            <span className="pcm__pill pcm__pill--success">{sourceLabel}</span>
          )}
          {showNeedsInfo && (
            <span className="pcm__pill pcm__pill--warn">⚠ meer info nodig</span>
          )}
          {A.isRevised && (
            <span className="pcm__pill pcm__pill--accent">✎ herzien</span>
          )}
          {hasDiffFields && (
            <button
              type="button"
              className={`pcm__info-btn ${diffOpen ? 'is-open' : ''}`}
              onClick={() => setDiffOpen(o => !o)}
              title={diffOpen ? 'Verberg velddetails' : 'Toon velddetails'}
              aria-label="Velddetails"
              aria-expanded={diffOpen}
            >
              ℹ
            </button>
          )}
        </div>
        <h3 className="pcm__title">{proposal.subject}</h3>
        <div className="pcm__sub">
          <span>{proposal.agent_name || 'daily-admin'} · {formatDateTime(proposal.created_at)}</span>
          {confidencePct != null && (
            <>
              <span className="pcm__sub-sep">·</span>
              <span>confidence <strong className="pcm__sub-conf">{(confidencePct / 100).toFixed(2)}</strong></span>
            </>
          )}
        </div>
      </div>

      {/* DIFF — paper-2 panel met label/value-paren, alleen open via ℹ */}
      {diffOpen && hasDiffFields && (
        <div className="pcm__diff">
          <dl className="pcm__diff-grid">
            {diffFields.map(([label, value]) => (
              <div key={label} className="pcm__diff-row">
                <dt className="pcm__diff-label">{label}</dt>
                <dd className="pcm__diff-val">{value}</dd>
              </div>
            ))}
          </dl>
        </div>
      )}

      {/* WHY — Samenvatting (alleen als proposal.summary bestaat) */}
      {proposal.summary && (
        <div className="pcm__why">
          <div className="pcm__why-label">Samenvatting</div>
          <p className="pcm__why-text">{proposal.summary}</p>
        </div>
      )}

      {/* AMENDMENT — eerder gegeven feedback (orange callout) */}
      {A.liveAmendment && (
        <div className="pcm__amendment">
          <div className="pcm__amendment-label">Jouw feedback</div>
          <div className="pcm__amendment-text">{A.liveAmendment}</div>
        </div>
      )}

      {/* RECORDS — Bij ✓ Goedkeuren — N records */}
      {actions.length > 0 && (
        <>
          <div className="pcm__records-head">
            Bij ✓ Goedkeuren — {activeCount} {activeCount === 1 ? 'record' : 'records'}
            {A.removed.size > 0 && <span className="pcm__records-removed"> · {A.removed.size} verwijderd</span>}
          </div>
          <div className="pcm__records">
            {actions.map((a, i) => (
              <RecCardMaestro
                key={i}
                action={a}
                index={i}
                lookup={lookup}
                proposalContext={ctx}
                proposalCategory={A.cat}
                hubspotUsers={hubspotUsers}
                removed={A.removed.has(i)}
                edits={A.edits[i] || {}}
                onRemove={() => A.removeAction(i)}
                onRestore={() => A.restoreAction(i)}
                onPatch={(patch) => A.patchAction(i, patch)}
                disabled={A.busy}
                canEdit={A.isPending}
              />
            ))}
          </div>
        </>
      )}

      {/* FEEDBACK — textarea + dicteren-knop, alleen in amending mode */}
      {A.isPending && amending && (
        <div className="pcm__feedback">
          <div className="pcm__feedback-head">
            <span className="pcm__feedback-label">Feedback voor de agent</span>
          </div>
          <div className="pcm__feedback-body">
            <textarea
              className="pcm__feedback-input"
              value={A.amendText}
              onChange={e => A.setAmendText(e.target.value)}
              placeholder="Bv: 'Bedrag laten leeg, we weten dat nog niet.'"
              rows={3}
              autoFocus
            />
            <MicButton onTranscript={t => A.setAmendText(prev => (prev ? `${prev} ${t}` : t).trim())} />
          </div>
        </div>
      )}

      {/* ACTIONS — Goedkeuren / Aanpassen / Afwijzen (of Antwoord geven bij needs_info) */}
      {A.isPending && (
        amending ? (
          <div className="pcm__actions">
            <button
              type="button"
              className="pcm__btn pcm__btn--primary"
              onClick={A.onAmendAndAccept}
              disabled={A.busy}
            >
              ✓ Doorvoeren
            </button>
            <button
              type="button"
              className="pcm__btn"
              onClick={A.onAmend}
              disabled={A.busy || !A.amendText.trim()}
              title="Stuur feedback terug — agent schrijft een nieuw voorstel"
            >
              ↻ Opnieuw
            </button>
            <button
              type="button"
              className="pcm__btn pcm__btn--ghost"
              onClick={() => { A.setMode('view'); A.setAmendText('') }}
              disabled={A.busy}
            >
              Annuleer
            </button>
          </div>
        ) : showNeedsInfo ? (
          <div className="pcm__actions">
            <button
              type="button"
              className="pcm__btn pcm__btn--primary"
              onClick={() => A.setMode('amending')}
              disabled={A.busy}
            >
              ✎ Antwoord geven
            </button>
            <button
              type="button"
              className="pcm__btn pcm__btn--danger"
              onClick={A.onReject}
              disabled={A.busy}
            >
              ✕ Afwijzen
            </button>
          </div>
        ) : (
          <div className="pcm__actions">
            <button
              type="button"
              className="pcm__btn pcm__btn--primary"
              onClick={A.onAccept}
              disabled={A.busy || activeCount === 0}
              title={activeCount === 0 ? 'Alle records zijn verwijderd' : ''}
            >
              ✓ Goedkeuren{A.hasEdits ? ' (met bewerkingen)' : ''}
            </button>
            <button
              type="button"
              className="pcm__btn"
              onClick={() => A.setMode('amending')}
              disabled={A.busy}
            >
              ✎ Aanpassen
            </button>
            <button
              type="button"
              className="pcm__btn pcm__btn--danger"
              onClick={A.onReject}
              disabled={A.busy}
            >
              ✕ Afwijzen
            </button>
          </div>
        )
      )}
      {A.err && <div className="pcm__error">⚠ {A.err}</div>}
    </article>
  )
}

// RecCardMaestro — één actie als mockup .rec-card met __bar + content.
// Mockup-exact structuur:
//   <div class="rec-card">
//     <div class="rec-card__bar">
//       <svg>icon</svg>
//       <span class="rec-card__type">Note</span>
//       <span class="rec-card__sub">op {target}</span>
//       <div class="rec-card__tools">B I U •</div>
//       <button class="rec-card__del">×</button>
//     </div>
//     <div class="rec-card__editor">contenteditable</div>
//   </div>
function RecCardMaestro({ action, lookup, proposalContext, proposalCategory, hubspotUsers, removed, edits, onRemove, onRestore, onPatch, disabled, canEdit }) {
  const mergedAction = { ...action, payload: { ...(action?.payload || {}), ...edits } }
  const d = actionDetails(mergedAction, lookup, proposalContext)
  const type = d.type
  const payload = mergedAction.payload || {}
  const meta = TYPE_META[type] || { label: type, icon: '•' }

  const isTask = type === 'task'
  const isNote = type === 'note'
  const isJiraCard = type === 'jira' || type === 'card'
  const needsAssignee = isTask || isJiraCard
  const needsDue = isTask
  const needsTitle = isTask || isJiraCard
  const needsContent = isNote

  const currentAssignee =
    payload.assignee || payload.jira_assignee || payload.owner ||
    (proposalCategory === 'recruitment' ? 'Jelle Burggraaf' : '')
  const currentTitle = payload.title || payload.summary || ''
  const currentContent = payload.content || payload.description || payload.note || payload.body || ''

  // Format-tools voor note: bold/italic/underline/list via execCommand
  const fmt = (cmd) => (e) => {
    e.preventDefault()
    if (disabled) return
    document.execCommand(cmd, false, null)
  }

  const subText = (() => {
    if (type === 'deal' && payload.dealname) return `op ${payload.dealname}`
    if (type === 'stage' && payload.transitionName) return `naar ${payload.transitionName}`
    if (type === 'company' && payload.name) return payload.name
    if (type === 'contact' && (payload.firstname || payload.lastname)) {
      return [payload.firstname, payload.lastname].filter(Boolean).join(' ')
    }
    if (type === 'note' && proposalContext?.company_name) return `op ${proposalContext.company_name}`
    if (type === 'task') return 'opvolg-actie'
    if (isJiraCard && payload.board) return payload.board
    return ''
  })()

  return (
    <div className={`pcm__rec-card pcm__rec-card--${type} ${removed ? 'is-removed' : ''}`}>
      <div className="pcm__rec-bar">
        <span className="pcm__rec-icon">{meta.icon}</span>
        <span className="pcm__rec-type">{meta.label}</span>
        {subText && <span className="pcm__rec-sub">{subText}</span>}
        {removed && <span className="pcm__rec-removed-tag">verwijderd</span>}
        {canEdit && isNote && (
          <div className="pcm__rec-tools">
            <button type="button" className="pcm__rec-tool" onMouseDown={fmt('bold')} disabled={disabled} title="Vet (Ctrl+B)" aria-label="Vet"><b>B</b></button>
            <button type="button" className="pcm__rec-tool" onMouseDown={fmt('italic')} disabled={disabled} title="Cursief (Ctrl+I)" aria-label="Cursief"><i>I</i></button>
            <button type="button" className="pcm__rec-tool" onMouseDown={fmt('underline')} disabled={disabled} title="Onderstrepen (Ctrl+U)" aria-label="Onderstrepen"><u>U</u></button>
            <button type="button" className="pcm__rec-tool" onMouseDown={fmt('insertUnorderedList')} disabled={disabled} title="Lijst" aria-label="Lijst">•</button>
          </div>
        )}
        {canEdit && (
          <button
            type="button"
            className={`pcm__rec-del ${removed ? 'is-restore' : ''}`}
            onClick={removed ? onRestore : onRemove}
            disabled={disabled}
            aria-label={removed ? 'Actie terugzetten' : 'Actie verwijderen'}
            title={removed ? 'Terugzetten' : 'Verwijderen'}
          >
            {removed ? '↺' : '×'}
          </button>
        )}
      </div>

      {/* Content per type */}
      {!removed && (
        <div className="pcm__rec-body">
          {/* Rows (huidige waarden, niet-editable) */}
          {!canEdit && d.rows.length > 0 && (
            <dl className="pcm__rec-rows">
              {d.rows.map(([k, v], i) => (
                <div key={i} className="pcm__rec-row">
                  <dt>{k}</dt>
                  <dd>{v}</dd>
                </div>
              ))}
            </dl>
          )}

          {/* Note: contenteditable RichTextEditor */}
          {needsContent && canEdit && (
            <RichTextEditor
              valueMd={currentContent}
              onChangeMd={(v) => onPatch({ content: v })}
              placeholder="Notitie inhoud…"
              minHeight={140}
              disabled={disabled}
            />
          )}
          {needsContent && !canEdit && d.body && (
            <div className="pcm__rec-text">{d.body}</div>
          )}

          {/* Task / Jira card: title + assignee + deadline */}
          {(needsTitle || needsDue || needsAssignee) && canEdit && (
            <div className="pcm__rec-task">
              {needsTitle && (
                <input
                  type="text"
                  className="pcm__rec-task-title"
                  value={currentTitle}
                  onChange={e => onPatch(isJiraCard ? { summary: e.target.value } : { title: e.target.value })}
                  disabled={disabled}
                  placeholder="Titel van de actie"
                />
              )}
              {(needsDue || needsAssignee) && (
                <div className="pcm__rec-task-row">
                  {needsAssignee && (
                    <label className="pcm__rec-task-field">
                      <span>Assignee</span>
                      <select
                        value={currentAssignee}
                        onChange={e => onPatch({ assignee: e.target.value })}
                        disabled={disabled}
                      >
                        <option value="">— kies —</option>
                        {(hubspotUsers || []).map(u => (
                          <option key={u.hubspot_owner_id} value={u.full_name || u.email}>
                            {u.full_name || u.email}{u.is_primary ? ' ★' : ''}
                          </option>
                        ))}
                      </select>
                    </label>
                  )}
                  {needsDue && (
                    <label className="pcm__rec-task-field">
                      <span>Deadline</span>
                      <input
                        type="date"
                        value={payload.due || ''}
                        onChange={e => onPatch({ due: e.target.value })}
                        disabled={disabled}
                      />
                    </label>
                  )}
                </div>
              )}
            </div>
          )}

          {/* Non-editable display voor non-note types */}
          {!canEdit && !needsContent && d.body && (
            <div className="pcm__rec-text">{d.body}</div>
          )}
        </div>
      )}
    </div>
  )
}
