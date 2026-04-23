import { useState, useContext } from 'react'
import { supabase } from '../lib/supabase'
import MicButton from './MicButton'
import {
  AGENT,
  CATEGORIES,
  CATEGORY_LABEL,
  CATEGORY_CLASS,
  PipelineLookupContext,
  formatDateTime,
} from './views/HubSpotView'

// ProposalCardV2 — herziene kaart met duidelijke visuele hiërarchie:
//   1. Meta-strip  (category · status · tijd · herzien/input-tags)
//   2. Hero        (subject groot + summary als lead)
//   3. Kerngegevens (pipeline · owner · CSM · confidence in labeled fact-grid)
//   4. Wat er gebeurt (per actie een eigen mini-card, type-gekleurd)
//   5. Amendment-callout (indien aanwezig)
//   6. Actieknoppen (groot, primary = Accepteer)
//
// Vervangt de originele ProposalCard in nieuwe views. Zelfde RPC-gedrag,
// schonere layout. Volledig standalone (geen deps op HubSpotView internals
// behalve gedeelde constants + context).

const TYPE_META = {
  deal:    { label: 'Deal',            icon: '◆',  color: 'accent',   order: 1 },
  company: { label: 'Company',         icon: '⌂',  color: 'orange',   order: 2 },
  contact: { label: 'Contact',         icon: '⊕',  color: 'yellow',   order: 3 },
  stage:   { label: 'Stage-update',    icon: '↗',  color: 'purple',   order: 4 },
  note:    { label: 'Note',            icon: '✎',  color: 'blue',     order: 5 },
  task:    { label: 'Task',            icon: '✓',  color: 'green',    order: 6 },
  jira:    { label: 'Jira',            icon: '⊞',  color: 'sky',      order: 7 },
  card:    { label: 'Recruitment-kaart', icon: '⊠', color: 'cyan',    order: 8 },
  comment: { label: 'Comment',         icon: '💬', color: 'blue',     order: 9 },
}

export default function ProposalCardV2({ proposal }) {
  const lookup = useContext(PipelineLookupContext)
  const [mode, setMode] = useState('view') // view | amending
  const [amendText, setAmendText] = useState('')
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState(null)

  // Optimistische overrides zodat UI direct reageert op klik
  const [statusOverride, setStatusOverride] = useState(null)
  const [amendOverride, setAmendOverride] = useState(null)
  const [catOverride, setCatOverride] = useState(null)

  const cat = catOverride || proposal.category || 'overig'
  const status = statusOverride || proposal.status
  const liveAmendment = amendOverride != null ? amendOverride : proposal.amendment
  const isPending = status === 'pending' || status === 'amended'
  const isRevised = !!proposal.amended_from && status === 'pending'
  const needsInfo = proposal.needs_info === true

  const ctx = proposal.context || {}
  const pipelineRaw = ctx.pipeline || ctx.pipeline_id || null
  const stageId     = ctx.pipeline_stage || ctx.deal_stage || null
  const { pipelineLabel, stageLabel } = lookup.resolve(pipelineRaw, stageId)
  const dealOwner = ctx.deal_owner_name || ctx.dealowner || null
  const csm       = ctx.csm_name || ctx.customer_success_manager || null
  const jiraOwner = ctx.jira_assignee || null

  const confidencePct = typeof proposal.confidence === 'number'
    ? Math.round(proposal.confidence * 100) : null
  const confTone = confidencePct == null ? null
    : confidencePct >= 70 ? 'ok'
    : confidencePct >= 50 ? 'mid' : 'low'

  const actions = Array.isArray(proposal.proposal?.actions) ? proposal.proposal.actions : []
  // Sorteer volgens creation-volgorde in HubSpot: company → contact → deal → note → task
  const sortedActions = actions.slice().sort((a, b) => {
    const oa = TYPE_META[a?.type]?.order || 99
    const ob = TYPE_META[b?.type]?.order || 99
    return oa - ob
  })

  async function call(rpc, payload, optimistic = {}) {
    if (optimistic.status)    setStatusOverride(optimistic.status)
    if (optimistic.amendment != null) setAmendOverride(optimistic.amendment)
    setBusy(true); setErr(null)
    try {
      const { data, error } = await supabase.rpc(rpc, payload)
      if (error) { setErr(error.message); setStatusOverride(null); setAmendOverride(null) }
      else if (data && data.ok === false) { setErr(data.reason || 'mislukt'); setStatusOverride(null); setAmendOverride(null) }
    } catch (e) {
      setErr(e.message || 'netwerkfout'); setStatusOverride(null); setAmendOverride(null)
    }
    setBusy(false)
  }

  async function onAccept() { await call('accept_proposal', { proposal_id: proposal.id }, { status: 'accepted' }) }
  async function onReject() { await call('reject_proposal', { proposal_id: proposal.id }, { status: 'rejected' }) }
  async function onAmend() {
    const txt = amendText.trim()
    if (!txt) return
    setMode('view')
    setAmendText('')
    await call('amend_proposal', { proposal_id: proposal.id, amendment_text: txt },
      { status: 'amended', amendment: txt })
  }
  async function onRecategorize(newCat) {
    if (newCat === cat) return
    setCatOverride(newCat)
    setBusy(true); setErr(null)
    try {
      const { data, error } = await supabase.rpc('recategorize_proposal', {
        proposal_id: proposal.id, new_category: newCat,
      })
      if (error) { setErr(error.message); setCatOverride(null) }
      else if (data && data.ok === false) { setErr(data.reason || 'mislukt'); setCatOverride(null) }
    } catch (e) {
      setErr(e.message || 'netwerkfout'); setCatOverride(null)
    }
    setBusy(false)
  }

  return (
    <article className={`pcv2 pcv2--${status} ${isRevised ? 'pcv2--revised' : ''} ${needsInfo ? 'pcv2--needs' : ''}`}>

      {/* ==== Meta-strip: status-tags + tijd + category-select ==== */}
      <div className="pcv2__meta">
        <select
          className={`pcv2__cat cat-select cat-select--${cat}`}
          value={cat}
          onChange={e => onRecategorize(e.target.value)}
          disabled={busy}
          aria-label="Categorie"
        >
          {CATEGORIES.map(c => <option key={c} value={c}>{CATEGORY_LABEL[c]}</option>)}
        </select>
        <span className={`pcv2__status pcv2__status--${status}`}>{statusLabel(status)}</span>
        {needsInfo && <span className="pcv2__tag pcv2__tag--needs">⚠ input nodig</span>}
        {isRevised && <span className="pcv2__tag pcv2__tag--revised">✎ herzien</span>}
        <span className="pcv2__spacer" />
        <span className="pcv2__time">{formatDateTime(proposal.created_at)}</span>
      </div>

      {/* ==== Hero: subject + summary ==== */}
      <header className="pcv2__hero">
        <h2 className="pcv2__subject">{proposal.subject}</h2>
        {proposal.summary && <p className="pcv2__summary">{proposal.summary}</p>}
      </header>

      {/* ==== Kerngegevens: fact-grid ==== */}
      <section className="pcv2__facts">
        <div className="pcv2__section-label">Kerngegevens</div>
        <div className="pcv2__facts-grid">
          <Fact label="Pipeline" icon="📁">
            {pipelineLabel || (pipelineRaw ? <span className="pcv2__unknown">? {pipelineRaw}</span> : '—')}
            {stageLabel && <span className="pcv2__fact-sub">{stageLabel}</span>}
          </Fact>
          <Fact label="Owner" icon="👤">
            {dealOwner || jiraOwner || '—'}
            {csm && <span className="pcv2__fact-sub">CSM: {csm}</span>}
          </Fact>
          <Fact label="Confidence" icon="📊">
            {confidencePct != null ? (
              <div className={`pcv2__conf pcv2__conf--${confTone}`}>
                <span className="pcv2__conf-num">{confidencePct}%</span>
                <ConfidenceBar pct={confidencePct} tone={confTone} />
              </div>
            ) : '—'}
            {Array.isArray(proposal.confidence_reasons) && proposal.confidence_reasons.length > 0 && (
              <ConfidenceReasons reasons={proposal.confidence_reasons} />
            )}
          </Fact>
        </div>
      </section>

      {/* ==== Wat er gebeurt: één mini-card per actie ==== */}
      {sortedActions.length > 0 && (
        <section className="pcv2__actions">
          <div className="pcv2__section-label">Wat er gebeurt bij ✓ Accepteer</div>
          <div className="pcv2__action-list">
            {sortedActions.map((a, i) => <ActionBlock key={i} action={a} lookup={lookup} />)}
          </div>
        </section>
      )}

      {/* ==== Amendment (jouw feedback) ==== */}
      {liveAmendment && (
        <section className="pcv2__amendment">
          <div className="pcv2__section-label">Jouw feedback</div>
          <blockquote className="pcv2__amendment-body">{liveAmendment}</blockquote>
        </section>
      )}

      {/* ==== Actieknoppen ==== */}
      {isPending && (
        mode === 'amending' ? (
          <section className="pcv2__amend-form">
            <div className="pcv2__section-label">Wat moet de agent anders doen?</div>
            <div className="textarea-wrap">
              <textarea
                className="pcv2__amend-input"
                value={amendText}
                onChange={e => setAmendText(e.target.value)}
                placeholder={needsInfo
                  ? "Wat moet de agent met dit record doen? De volgende run maakt er een voorstel van."
                  : "Beschrijf kort wat de agent anders moet doen — dit wordt bij de volgende run uitgevoerd."}
                rows={4}
                autoFocus
              />
              <MicButton onTranscript={t => setAmendText(prev => (prev ? `${prev} ${t}` : t).trim())} />
            </div>
            <div className="pcv2__btns">
              <button className="btn btn--accent pcv2__btn" onClick={onAmend} disabled={busy || !amendText.trim()}>Opslaan</button>
              <button className="btn btn--ghost pcv2__btn"  onClick={() => { setMode('view'); setAmendText('') }}>Annuleer</button>
            </div>
          </section>
        ) : needsInfo ? (
          <div className="pcv2__btns">
            <button className="btn btn--warning pcv2__btn pcv2__btn--primary" onClick={() => setMode('amending')} disabled={busy}>✎ Antwoord geven</button>
            <button className="btn btn--danger  pcv2__btn" onClick={onReject} disabled={busy}>✕ Afwijzen</button>
          </div>
        ) : (
          <div className="pcv2__btns">
            <button className="btn btn--success pcv2__btn pcv2__btn--primary" onClick={onAccept} disabled={busy}>✓ Accepteer</button>
            <button className="btn btn--warning pcv2__btn" onClick={() => setMode('amending')} disabled={busy}>✎ Aanpassen</button>
            <button className="btn btn--danger  pcv2__btn" onClick={onReject} disabled={busy}>✕ Afwijzen</button>
          </div>
        )
      )}

      {err && <div className="pcv2__error">⚠ {err}</div>}
    </article>
  )
}

function statusLabel(status) {
  const map = {
    pending:   'In afwachting',
    amended:   'Aanpassing verstuurd',
    accepted:  'Geaccepteerd',
    rejected:  'Afgewezen',
    executed:  'Uitgevoerd',
    failed:    'Gefaald',
    expired:   'Verlopen',
    superseded: 'Vervangen',
  }
  return map[status] || status
}

function Fact({ label, icon, children }) {
  return (
    <div className="pcv2__fact">
      <div className="pcv2__fact-label">
        <span className="pcv2__fact-icon" aria-hidden="true">{icon}</span> {label}
      </div>
      <div className="pcv2__fact-value">{children}</div>
    </div>
  )
}

function ConfidenceBar({ pct, tone }) {
  return (
    <div className="pcv2__conf-bar">
      <div className={`pcv2__conf-bar-fill pcv2__conf-bar-fill--${tone}`} style={{ width: `${pct}%` }} />
    </div>
  )
}

function ConfidenceReasons({ reasons }) {
  const [open, setOpen] = useState(false)
  return (
    <div className="pcv2__conf-reasons">
      <button type="button" className="pcv2__conf-toggle" onClick={() => setOpen(v => !v)}>
        {open ? '▾ verberg toelichting' : '▸ toon toelichting'}
      </button>
      {open && (
        <ul className="pcv2__conf-list">
          {reasons.map((r, i) => (
            <li key={i} className={r.weight < 0 ? 'is-negative' : ''}>
              <span className="pcv2__conf-weight">{r.weight >= 0 ? '+' : ''}{(r.weight * 100).toFixed(0)}%</span>
              <span className="pcv2__conf-factor">{r.factor}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}

function ActionBlock({ action, lookup }) {
  const type = action?.type || 'overig'
  const meta = TYPE_META[type] || { label: type, icon: '•', color: 'neutral' }
  const payload = action?.payload || {}
  const body = payload.content || payload.description || payload.note || payload.body

  // Specifieke previews per type
  let details = null
  if (type === 'deal') {
    const { pipelineLabel, stageLabel } = lookup.resolve(payload.pipeline || payload.pipeline_id, payload.dealstage || payload.stage_id || payload.stage)
    details = (
      <dl className="pcv2__action-details">
        {payload.dealname && <DetailRow label="Naam">{payload.dealname}</DetailRow>}
        {(pipelineLabel || payload.pipeline) && <DetailRow label="Pipeline">{pipelineLabel || payload.pipeline}{stageLabel && <> · {stageLabel}</>}</DetailRow>}
        {payload.deal_owner_name && <DetailRow label="Owner">{payload.deal_owner_name}</DetailRow>}
        {payload.associate_with_company && <DetailRow label="Koppeling">aan company + contact</DetailRow>}
      </dl>
    )
  } else if (type === 'stage') {
    const { pipelineLabel, stageLabel } = lookup.resolve(payload.pipeline || payload.pipeline_id, payload.dealstage || payload.stage_id || payload.stage)
    details = (
      <dl className="pcv2__action-details">
        {stageLabel && <DetailRow label="Nieuwe stage">{stageLabel}</DetailRow>}
        {pipelineLabel && <DetailRow label="Pipeline">{pipelineLabel}</DetailRow>}
      </dl>
    )
  } else if (type === 'company') {
    details = (
      <dl className="pcv2__action-details">
        {payload.name && <DetailRow label="Naam">{payload.name}</DetailRow>}
        {payload.domain && <DetailRow label="Domein">{payload.domain}</DetailRow>}
      </dl>
    )
  } else if (type === 'contact') {
    const fullName = [payload.firstname, payload.lastname].filter(Boolean).join(' ')
    details = (
      <dl className="pcv2__action-details">
        {fullName && <DetailRow label="Naam">{fullName}</DetailRow>}
        {payload.email && <DetailRow label="E-mail">{payload.email}</DetailRow>}
      </dl>
    )
  } else if (type === 'task') {
    details = (
      <dl className="pcv2__action-details">
        {payload.due && <DetailRow label="Deadline">{payload.due}</DetailRow>}
      </dl>
    )
  } else if (type === 'jira') {
    details = (
      <dl className="pcv2__action-details">
        {payload.issueKey && <DetailRow label="Kaart">{payload.issueKey}</DetailRow>}
        {payload.operation && <DetailRow label="Actie">{payload.operation}</DetailRow>}
        {payload.transitionName && <DetailRow label="Naar stage">{payload.transitionName}</DetailRow>}
      </dl>
    )
  }

  return (
    <div className={`pcv2__action pcv2__action--${meta.color}`}>
      <div className="pcv2__action-head">
        <span className="pcv2__action-icon" aria-hidden="true">{meta.icon}</span>
        <span className="pcv2__action-type">{meta.label}</span>
        <span className="pcv2__action-title">{action?.label || ''}</span>
      </div>
      {details}
      {body && (
        <blockquote className="pcv2__action-body">{body}</blockquote>
      )}
    </div>
  )
}

function DetailRow({ label, children }) {
  return (
    <>
      <dt>{label}</dt>
      <dd>{children}</dd>
    </>
  )
}
