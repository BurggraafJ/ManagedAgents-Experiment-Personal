import { useContext, useState, useMemo } from 'react'
import { useNavigate } from 'react-router-dom'
import { PipelineLookupContext, HubSpotUsersContext, CATEGORIES, CATEGORY_LABEL, formatDateTime } from '../hubspot-common'
import { useProposalActions, actionDetails, TYPE_META } from '../../useProposalActions'
import MicButton from '../../MicButton'
import RichTextEditor from '../../ui/RichTextEditor'
import { supabase } from '../../../lib/supabase'
import './proposal-card.css'

// ProposalCard — JSX-rewrite van de detail-card, mockup-exact
// gestructureerd volgens Administratie.html (.pcard__head/__diff/__why/
// __records/__feedback/__actions + .rec-card per actie).
//
// Class-namespace: .pcm__ (proposal-card-maestro) — geen conflict met
// .pcv7__ uit ProposalCardCompact. Beide componenten leven naast elkaar:
//   - /administratie       → ProposalCardCompact (oude, .pcv7__ classes)
//   - /administratie-maestro → ProposalCard (deze, .pcm__ classes)
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

export default function ProposalCard({ proposal, onRefresh, onMutate }) {
  const lookup = useContext(PipelineLookupContext)
  const hubspotUsers = useContext(HubSpotUsersContext)
  const A = useProposalActions(proposal, onRefresh, onMutate)

  // Hard optimistic-hide na succesvol accept/reject — toont placeholder zodat
  // Jelle directe feedback heeft, zelfs als parent-state nog ververst. De
  // parent-mutate werkt parallel; bij volgende render is de kaart sowieso uit
  // de Pending-lijst gevallen.
  if (A.resolvedAs) {
    const VERDICT_LABEL = {
      accepted: { icon: '✓', text: 'Goedgekeurd', tone: 'success' },
      rejected: { icon: '✗', text: 'Afgewezen', tone: 'danger' },
      amended:  { icon: '✎', text: 'Aanpassing verstuurd', tone: 'accent' },
    }
    const v = VERDICT_LABEL[A.resolvedAs] || VERDICT_LABEL.accepted
    return (
      <article className={`pcm pcm--resolved pcm--${v.tone}`}>
        <div className="pcm__resolved-state">
          <span className="pcm__resolved-icon">{v.icon}</span>
          <div>
            <strong>{v.text}</strong>
            <span className="pcm__resolved-sub">Volgend voorstel laadt…</span>
          </div>
        </div>
      </article>
    )
  }

  const ctx = proposal.context || {}
  // Helper: lees veld als string, sla over als 't een object is (entity_context
  // kan {id,name,domain,lifecyclestage} bevatten — dat mag NIET in JSX).
  const asText = (v) => (typeof v === 'string' && v.trim()) ? v : null
  const asObjectField = (obj, field) =>
    (obj && typeof obj === 'object' && typeof obj[field] === 'string') ? obj[field] : null
  // ctx.company kan string of object zijn (legacy vs entity_context). Probeer beide.
  const ctxCompanyName = asText(ctx.company_name)
    || asText(ctx.company)
    || asObjectField(ctx.company, 'name')
    || asObjectField(ctx.entity_context?.company, 'name')
    || asText(ctx.deal_company_name)
    || null
  const ctxCompanyId = asText(ctx.company_id)
    || asText(ctx.hubspot_company_id)
    || asObjectField(ctx.company, 'id')
    || asObjectField(ctx.entity_context?.company, 'id')
    || null
  const ctxCompanyDomain = asText(ctx.company_domain)
    || asText(ctx.lead_email_domain)
    || asObjectField(ctx.company, 'domain')
    || asObjectField(ctx.entity_context?.company, 'domain')
    || null

  const pipelineRaw = asText(ctx.pipeline) || asText(ctx.pipeline_id) || null
  const stageId = asText(ctx.pipeline_stage) || asText(ctx.deal_stage) || null
  const { pipelineLabel, stageLabel } = lookup.resolve(pipelineRaw, stageId)
  const dealOwner = asText(ctx.deal_owner_name) || asText(ctx.dealowner) || asText(ctx.jira_assignee) || null
  const confidencePct = typeof proposal.confidence === 'number' ? Math.round(proposal.confidence * 100) : null
  const actions = Array.isArray(proposal.proposal?.actions) ? proposal.proposal.actions : []

  // Heeft skill een Fireflies-transcript gekoppeld? Twee signalen: het
  // boolean kolom op de rij OF een fireflies_meeting / fireflies_id in context.
  const hasFirefliesCtx = proposal.has_fireflies_context === true
    || !!ctx.fireflies_id
    || !!ctx.fireflies_meeting?.id
    || (Array.isArray(ctx.fireflies_transcript_ids) && ctx.fireflies_transcript_ids.length > 0)

  const sourceLabel = (() => {
    if (ctx.message_id || ctx.thread_id || ctx.mail_id || (Array.isArray(ctx.mail_ids) && ctx.mail_ids.length > 0)) return 'via mail'
    if (ctx.calendar_event_id || ctx.calendar_event?.id || (Array.isArray(ctx.calendar_event_ids) && ctx.calendar_event_ids.length > 0)) return 'via agenda'
    if (hasFirefliesCtx) return 'via meeting'
    return null
  })()

  const showNeedsInfo = A.needsInfo && !A.isRevised
  const amending = A.mode === 'amending'
  const activeCount = actions.length - A.removed.size

  const [diffOpen, setDiffOpen] = useState(false)
  const diffFields = useMemo(() => {
    const out = []
    const dealName = asText(ctx.deal_name) || asText(ctx.deal_title)
    if (dealName) out.push(['Naam deal', dealName])
    const amount = formatEur(ctx.deal_amount ?? ctx.amount)
    if (amount) out.push(['Bedrag', amount])
    if (dealOwner) out.push(['Owner', dealOwner])
    const closeDate = formatDate(ctx.close_date || ctx.deal_closedate)
    if (closeDate) out.push(['Close date', closeDate])
    if (ctxCompanyName) out.push(['Company', ctxCompanyName])
    const contact = asText(ctx.contact_name) || asText(ctx.contact) || asObjectField(ctx.contact, 'name')
    if (contact) out.push(['Contact', contact])
    return out
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ctx, dealOwner, ctxCompanyName])
  const hasDiffFields = diffFields.length > 0

  const catLabel = CATEGORY_LABEL[A.cat] || 'Overig'
  const catDotColor = CAT_DOT_COLOR[A.cat] || 'var(--neutral-700)'

  // Pipeline-pill state. Voor NIEUWE deals (type=deal action zonder bestaande
  // ctx.deal_id): val terug op de payload van die action, zodat de pill toch
  // gevuld wordt met de proposed Sales/Kennismaking-default. Bij klik op de
  // ✎ patcht onPatch direct die action.
  const dealActionIdx = actions.findIndex(a => a?.type === 'deal')
  const dealActionPayload = dealActionIdx >= 0 ? (actions[dealActionIdx]?.payload || {}) : null
  const effectivePipelineRaw = pipelineRaw || dealActionPayload?.pipeline || dealActionPayload?.pipeline_id || null
  const effectiveStageId = stageId || dealActionPayload?.dealstage || dealActionPayload?.stage_id || null
  const { pipelineLabel: effPipelineLabel, stageLabel: effStageLabel } = lookup.resolve(effectivePipelineRaw, effectiveStageId)
  const pipelinesList = (lookup?.pipelines || []).filter(p => p.is_active !== false)
  const canEditPipelineFromPill = A.isPending && dealActionIdx >= 0
  function patchPipelineStage(patch) {
    if (dealActionIdx >= 0) A.patchAction(dealActionIdx, patch)
  }

  // Company/contact-link voor deeplink naar /zoeken — voor "ik wil snel zien
  // wat er aan deze klant hangt"-flow vanaf het Daily Admin-voorstel.
  const navigate = useNavigate()
  const companyLink = useMemo(() => {
    const id = ctxCompanyId
    const name = ctxCompanyName
    const domain = ctxCompanyDomain
    if (id) {
      return {
        label: name || domain || 'klantdossier',
        href: `/zoeken?mode=objects&company_id=${encodeURIComponent(id)}`,
        tone: 'matched',
      }
    }
    if (domain) return { label: name || domain, href: `/zoeken?q=${encodeURIComponent(domain)}`, tone: 'unmatched' }
    if (name)   return { label: name,           href: `/zoeken?q=${encodeURIComponent(name)}`,   tone: 'unmatched' }
    return null
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ctxCompanyId, ctxCompanyName, ctxCompanyDomain])

  // Voor "Negeer dit"-knoppen: lead-domain + lead-email afleiden uit context.
  // Fallback ketens: expliciete velden → external_contacts[0] → entity_context.
  const leadEmail = useMemo(() => {
    const candidates = [
      asText(ctx.lead_contact_email),
      asText(ctx.from_email),
      asText(ctx.contact_email),
      Array.isArray(ctx.external_contacts) ? asText(ctx.external_contacts[0]) : null,
      Array.isArray(ctx.entity_context?.contacts) ? asObjectField(ctx.entity_context.contacts[0], 'email') : null,
    ]
    for (const c of candidates) {
      if (c && c.includes('@')) return c.toLowerCase().trim()
    }
    return null
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ctx])
  const leadDomain = useMemo(() => {
    const explicit = ctxCompanyDomain || asText(ctx.lead_email_domain) || asText(ctx.company_domain)
    if (explicit) return explicit.toLowerCase().trim()
    if (leadEmail) return leadEmail.split('@')[1]
    return null
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [leadEmail, ctxCompanyDomain])
  // Knop altijd zichtbaar als er een lead-domein bekend is — ook bij bestaande
  // deals, want Jelle wil partner-domains die toch in HubSpot belanden ook kunnen
  // markeren (cleanup-pad).
  const canMarkPartner = !!leadDomain

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
          {(effPipelineLabel || effStageLabel) && (
            <PipelineStagePill
              pipelineLabel={effPipelineLabel}
              stageLabel={effStageLabel}
              pipelineId={effectivePipelineRaw}
              stageId={effectiveStageId}
              pipelinesList={pipelinesList}
              canEdit={canEditPipelineFromPill}
              onPatch={patchPipelineStage}
              disabled={A.busy}
            />
          )}
          {companyLink && (
            <button
              type="button"
              className={`pcm__pill pcm__pill--company pcm__pill--${companyLink.tone}`}
              onClick={() => navigate(companyLink.href)}
              title={companyLink.tone === 'matched' ? 'Open klantdossier in Zoeken' : 'Zoeken naar deze klant (nog geen HubSpot-koppeling)'}
            >
              <span className="pcm__pill-icon" aria-hidden>⌂</span>
              {companyLink.label}
              <span className="pcm__pill-arrow" aria-hidden>→</span>
            </button>
          )}
          {sourceLabel && (
            <span className="pcm__pill pcm__pill--success">{sourceLabel}</span>
          )}
          {hasFirefliesCtx && (
            <span
              className="pcm__pill pcm__pill--fireflies"
              title={`Fireflies-transcript gekoppeld${ctx.fireflies_meeting?.title ? ': ' + ctx.fireflies_meeting.title : ''}${ctx.fireflies_meeting?.duration_min ? ' (' + ctx.fireflies_meeting.duration_min + ' min)' : ''}`}
            >
              🦟 Fireflies
            </span>
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

      {/* RECORDS — Bij ✓ Goedkeuren — N records.
       * Toont eerst de agent-acties (actions), daarna handmatig toegevoegde
       * extra-actions (A.extraActions). Onderaan een "+ Toevoegen"-menu
       * waarmee Jelle Contact / Task / Note kan bijvoegen. */}
      {(actions.length > 0 || A.extraActions.length > 0 || A.isPending) && (
        <>
          <div className="pcm__records-head">
            Bij ✓ Goedkeuren — {activeCount + A.extraActions.length} {(activeCount + A.extraActions.length) === 1 ? 'record' : 'records'}
            {A.removed.size > 0 && <span className="pcm__records-removed"> · {A.removed.size} verwijderd</span>}
            {A.extraActions.length > 0 && <span className="pcm__records-added"> · {A.extraActions.length} handmatig toegevoegd</span>}
          </div>
          <div className="pcm__records">
            {actions.map((a, i) => (
              <RecCardMaestro
                key={`a-${i}`}
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
            {A.extraActions.map((a, i) => (
              <RecCardMaestro
                key={`x-${i}`}
                action={a}
                index={i}
                lookup={lookup}
                proposalContext={ctx}
                proposalCategory={A.cat}
                hubspotUsers={hubspotUsers}
                removed={false}
                edits={{}}
                onRemove={() => A.removeExtraAction(i)}
                onRestore={() => {}}
                onPatch={(patch) => A.patchExtraAction(i, patch)}
                disabled={A.busy}
                canEdit={A.isPending}
                isExtra
              />
            ))}
            {A.isPending && actions.length === 0 && A.extraActions.length === 0 && (
              <div className="pcm__no-records">
                <strong>Geen acties voorgesteld</strong> — voeg er zelf één toe zodat dit voorstel een opvolging krijgt.
              </div>
            )}
            {A.isPending && <AddActionMenu onAdd={(t) => A.addAction(t)} disabled={A.busy} category={A.cat} />}
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
            {canMarkPartner && (
              <MarkPartnerButton
                domain={leadDomain}
                email={leadEmail}
                companyName={ctx.company_name || ctx.company || ctx.lead_company || ''}
                contactName={ctx.lead_contact_name || ctx.contact_name || ''}
                onMarked={A.onReject}
                disabled={A.busy}
              />
            )}
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
  const isDeal = type === 'deal'
  const isStage = type === 'stage'
  const needsAssignee = isTask || isJiraCard
  const needsDue = isTask
  const needsTitle = isTask || isJiraCard
  const needsContent = isNote
  // Sinds 2026-05-21: nieuwe deals (Parcom-achtige proposals) krijgen een
  // pipeline + stage keuze in de UI. Skill zet defaults voor (pipeline_id:
  // 'default', dealstage: 'appointmentscheduled'), Jelle past aan vóór accept.
  const needsDealForm = isDeal
  const needsStageForm = isStage

  const currentAssignee =
    payload.assignee || payload.jira_assignee || payload.owner ||
    (proposalCategory === 'recruitment' ? 'Jelle Burggraaf' : '')
  const currentTitle = payload.title || payload.summary || ''
  const currentContent = payload.content || ''
  const currentDealName = payload.dealname || payload.name || ''
  const currentPipelineId = String(payload.pipeline || payload.pipeline_id || '')
  const currentStageId = String(payload.dealstage || payload.stage_id || payload.stage || '')

  const pipelinesList = (lookup?.pipelines || []).filter(p => p.is_active !== false)
  const stagesForCurrentPipeline = useMemo(() => {
    if (!currentPipelineId) return []
    const p = pipelinesList.find(p => String(p.pipeline_id) === currentPipelineId)
    return (p?.stages || [])
  }, [pipelinesList, currentPipelineId])

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

          {/* Deal (nieuw): alleen dealname-input. Pipeline/stage zit in
              de PipelineStagePill bovenin de ProposalCard. */}
          {needsDealForm && canEdit && (
            <DealCompactForm
              dealName={currentDealName}
              onPatch={onPatch}
              disabled={disabled}
            />
          )}

          {/* Stage-update: GROOT blok blijft — het is een echte mutatie-voorstel
              dat Jelle expliciet moet beoordelen, dus volledige edit zichtbaar. */}
          {needsStageForm && canEdit && (
            <div className="pcm__rec-task">
              <div className="pcm__rec-task-row">
                <label className="pcm__rec-task-field">
                  <span>Nieuwe stage</span>
                  <select
                    value={currentStageId}
                    onChange={e => onPatch({ dealstage: e.target.value })}
                    disabled={disabled || !currentPipelineId}
                  >
                    <option value="">— kies stage —</option>
                    {stagesForCurrentPipeline.map(s => (
                      <option key={s.id} value={s.id}>{s.label}</option>
                    ))}
                  </select>
                </label>
              </div>
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

// AddActionMenu — kleine dropdown waarmee Jelle een handmatige actie kan
// PipelineStagePill — bovenin de ProposalCard. Default read-only label. Bij
// klik (alleen wanneer canEdit=true, dus bij type=deal-actions) opent inline
// edit met pipeline + stage selects die de bijbehorende action-payload
// patchen. Houdt het voorstelscherm verder schoon.
function PipelineStagePill({ pipelineLabel, stageLabel, pipelineId, stageId, pipelinesList, canEdit, onPatch, disabled }) {
  const [editing, setEditing] = useState(false)
  const stagesForCurrentPipeline = useMemo(() => {
    if (!pipelineId) return []
    const p = (pipelinesList || []).find(p => String(p.pipeline_id) === String(pipelineId))
    return p?.stages || []
  }, [pipelinesList, pipelineId])
  const label = [pipelineLabel, stageLabel].filter(Boolean).join(' · ')

  if (!canEdit) {
    // Bestaande deal / non-editable proposal: alleen tonen, geen klik-affordance
    return <span className="pcm__pill pcm__pill--info">{label}</span>
  }
  if (!editing) {
    return (
      <button
        type="button"
        className="pcm__pill pcm__pill--info pcm__pill--editable"
        onClick={() => setEditing(true)}
        disabled={disabled}
        title="Klik om pipeline/stage aan te passen"
      >
        {label}
        <span className="pcm__pill-edit-icon" aria-hidden>✎</span>
      </button>
    )
  }
  return (
    <span className="pcm__pill-edit-inline">
      <select
        value={String(pipelineId || '')}
        onChange={e => onPatch({ pipeline: e.target.value, dealstage: '' })}
        disabled={disabled}
        className="pcm__pill-select"
      >
        <option value="">— pipeline —</option>
        {(pipelinesList || []).map(p => (
          <option key={p.pipeline_id} value={p.pipeline_id}>{p.label}</option>
        ))}
      </select>
      <select
        value={String(stageId || '')}
        onChange={e => onPatch({ dealstage: e.target.value })}
        disabled={disabled || !pipelineId}
        className="pcm__pill-select"
      >
        <option value="">— stage —</option>
        {stagesForCurrentPipeline.map(s => (
          <option key={s.id} value={s.id}>{s.label}</option>
        ))}
      </select>
      <button type="button" className="pcm__pill-done" onClick={() => setEditing(false)}>klaar</button>
    </span>
  )
}

// DealCompactForm — voor type=deal action. Alleen dealname-input.
// Pipeline/stage live in de pill bovenin de ProposalCard (PipelineStagePill).
// Voor nieuwe deals erft de bovenin-pill de proposed pipeline/stage zodat
// Jelle 'm op één plek ziet en bewerkt.
function DealCompactForm({ dealName, onPatch, disabled }) {
  return (
    <div className="pcm__rec-task">
      <input
        type="text"
        className="pcm__rec-task-title"
        value={dealName}
        onChange={e => onPatch({ dealname: e.target.value })}
        disabled={disabled}
        placeholder="Dealnaam"
      />
      <div className="pcm__rec-hint">
        Pipeline en stage pas je aan via de label bovenin — klik op de pill met ✎.
      </div>
    </div>
  )
}

// MarkPartnerButton — voegt het lead-DOMEIN of LEAD-EMAIL toe aan de
// external_party_directory en wijst het voorstel direct af.
//
// Twee scopes:
//   - "Hele domein" — heliview.com → alle medewerkers gefilterd
//   - "Alleen deze persoon" — hans@heliview.com → andere hans-collega's
//                              kunnen wel proposals worden
//
// Default classification 'partner'. Open dropdown om aan te passen.
function MarkPartnerButton({ domain, email, companyName, contactName, onMarked, disabled }) {
  const [open, setOpen] = useState(false)
  const [busy, setBusy] = useState(false)
  const [scope, setScope] = useState('domain') // 'domain' | 'email'

  async function mark(classification) {
    setOpen(false)
    setBusy(true)
    const params = scope === 'email'
      ? { p_email: email, p_domain: null, p_canonical_name: contactName || null,
          p_notes: `Per-contact filter via Daily Admin-voorstel (${email})` }
      : { p_domain: domain, p_email: null, p_canonical_name: companyName || null,
          p_notes: `Domein-filter via Daily Admin-voorstel (${domain})` }
    const { data, error } = await supabase.rpc('upsert_external_party', {
      ...params,
      p_classification: classification,
      p_skip_proposal: true,
      p_skip_autodraft: false,
      p_skip_admin_future: true,
      p_source: 'proposal_button',
    })
    setBusy(false)
    if (error) { window.alert('Mislukt: ' + error.message); return }
    if (data?.ok === false) { window.alert('Mislukt: ' + (data.reason || 'onbekend')); return }
    if (typeof onMarked === 'function') onMarked()
  }

  const OPTIONS = [
    { id: 'partner',    label: 'Partner',     hint: 'Strategic partner' },
    { id: 'vendor',     label: 'Leverancier', hint: 'We kopen iets' },
    { id: 'recruiter',  label: 'Recruiter',   hint: 'Recruitment-bureau' },
    { id: 'competitor', label: 'Concurrent',  hint: 'Concurrent in markt' },
    { id: 'community',  label: 'Community',   hint: 'Newsletter / forum' },
    { id: 'press',      label: 'Press',       hint: 'Media / journalist' },
    { id: 'spam',       label: 'Spam',        hint: 'Geen waarde' },
  ]

  const target = scope === 'email' ? email : domain
  return (
    <div className={`pcm__add-menu ${open ? 'is-open' : ''}`}>
      <button
        type="button"
        className="pcm__btn pcm__btn--filter"
        onClick={() => setOpen(v => !v)}
        disabled={disabled || busy || !target}
        title={`Geen klant — voeg ${target} toe aan filterlijst zodat volgende scans 'm overslaan`}
      >
        {busy ? '…' : `⊘ Geen klant — filteren`}
      </button>
      {open && (
        <div className="pcm__add-popover" role="menu" style={{ minWidth: 280 }}>
          <div style={{ display:'flex', gap:6, padding:'8px 10px', borderBottom:'1px solid #eee' }}>
            <button
              type="button"
              className={`pcm__btn ${scope === 'domain' ? 'pcm__btn--primary' : ''}`}
              style={{ flex:1, fontSize:11 }}
              onClick={() => setScope('domain')}
              disabled={!domain}
            >
              Hele domein<br/><small>{domain}</small>
            </button>
            <button
              type="button"
              className={`pcm__btn ${scope === 'email' ? 'pcm__btn--primary' : ''}`}
              style={{ flex:1, fontSize:11 }}
              onClick={() => setScope('email')}
              disabled={!email}
            >
              Alleen persoon<br/><small>{email}</small>
            </button>
          </div>
          {OPTIONS.map(o => (
            <button key={o.id} type="button" role="menuitem" className="pcm__add-option" onClick={() => mark(o.id)}>
              <span className="pcm__add-option-text">
                <strong>{o.label}</strong>
                <span>{o.hint}</span>
              </span>
            </button>
          ))}
        </div>
      )}
    </div>
  )
}

// toevoegen aan het voorstel. Opties hangen af van categorie:
//   - recruitment → Note + Jira-kaart (geen losse Task; recruitment werkt
//                                       altijd via Recruitment Kanban-card)
//   - andere       → Note + Task + Contact
// Sluit auto na keuze (state managed door deze component).
function AddActionMenu({ onAdd, disabled, category }) {
  const [open, setOpen] = useState(false)
  const isRecruitment = category === 'recruitment'

  function pick(type) {
    onAdd(type)
    setOpen(false)
  }

  return (
    <div className={`pcm__add-menu ${open ? 'is-open' : ''}`}>
      <button
        type="button"
        className="pcm__add-trigger"
        onClick={() => setOpen(v => !v)}
        disabled={disabled}
        aria-expanded={open}
        aria-haspopup="menu"
      >
        <span className="pcm__add-icon" aria-hidden>+</span>
        <span>Toevoegen</span>
        <span className="pcm__add-caret" aria-hidden>{open ? '▴' : '▾'}</span>
      </button>
      {open && (
        <div className="pcm__add-popover" role="menu">
          <button type="button" role="menuitem" className="pcm__add-option pcm__add-option--note" onClick={() => pick('note')}>
            <span className="pcm__add-option-icon" aria-hidden>✎</span>
            <span className="pcm__add-option-text">
              <strong>Note</strong>
              <span>{isRecruitment ? 'Comment op de REC-Jira-kaart' : 'Notitie op de deal/contact in HubSpot'}</span>
            </span>
          </button>
          {isRecruitment ? (
            <button type="button" role="menuitem" className="pcm__add-option pcm__add-option--task" onClick={() => pick('card')}>
              <span className="pcm__add-option-icon" aria-hidden>⊠</span>
              <span className="pcm__add-option-text">
                <strong>Recruitment-kaart</strong>
                <span>Nieuwe kaart op het REC-Jira-bord (Kanban)</span>
              </span>
            </button>
          ) : (
            <button type="button" role="menuitem" className="pcm__add-option pcm__add-option--task" onClick={() => pick('task')}>
              <span className="pcm__add-option-icon" aria-hidden>✓</span>
              <span className="pcm__add-option-text">
                <strong>Task</strong>
                <span>Opvolg-actie met titel, deadline en assignee</span>
              </span>
            </button>
          )}
          <button type="button" role="menuitem" className="pcm__add-option pcm__add-option--contact" onClick={() => pick('contact')}>
            <span className="pcm__add-option-icon" aria-hidden>⊕</span>
            <span className="pcm__add-option-text">
              <strong>Contact</strong>
              <span>Nieuwe contactpersoon in HubSpot</span>
            </span>
          </button>
        </div>
      )}
    </div>
  )
}
