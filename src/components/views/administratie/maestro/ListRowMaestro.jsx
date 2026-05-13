import { formatDateTime, CATEGORY_LABEL } from '../../hubspot-common'

// ListRowMaestro — Maestro-native list-row voor Daily Admin Inbox.
//
// Mockup-layout (Administratie.html .adm-row): [icon-square] [title + sub] [time]
// Klassen rechtstreeks uit mockup: `.adm-row`, `.adm-row__type`, `.adm-row__main`,
// `.adm-row__title`, `.adm-row__sub`, `.adm-row__meta`, `.adm-row__when`.
// Icon-square (.adm-row__type.cat-{deal|contact|note|task}) krijgt SVG inline
// — mockup gebruikt 4 type-iconen (deal=plus, contact=person, note=document,
// task=check). Subject + meta-info komen onder elkaar; tijd staat rechts.

function formatAmount(ctx) {
  const raw = ctx.amount ?? ctx.deal_amount ?? null
  if (raw == null || raw === '' || isNaN(Number(raw))) return null
  const n = Number(raw)
  if (n === 0) return null
  return new Intl.NumberFormat('nl-NL', {
    style: 'currency',
    currency: 'EUR',
    maximumFractionDigits: 0,
  }).format(n)
}

function pickOwner(ctx) {
  return ctx.deal_owner_name || ctx.dealowner || ctx.owner_name || null
}

function pickIconType(proposal) {
  const actions = Array.isArray(proposal?.proposal?.actions) ? proposal.proposal.actions : []
  if (actions.length === 0) return 'note'
  // Daily-admin emit drift: oude format gebruikt .type, nieuwe (sinds 2026-05-12) .kind. Beide ondersteunen.
  const first = actions[0]?.type || actions[0]?.kind || 'note'
  if (first === 'deal' || first === 'stage' || first === 'company') return 'deal'
  if (first === 'contact') return 'contact'
  if (first === 'task' || first === 'jira' || first === 'card') return 'task'
  return 'note'
}

const TYPE_ICON = {
  deal:    <svg className="lc" viewBox="0 0 24 24"><path d="M12 2v20M2 12h20" /></svg>,
  contact: <svg className="lc" viewBox="0 0 24 24"><circle cx="12" cy="8" r="4" /><path d="M4 21a8 8 0 0116 0" /></svg>,
  note:    <svg className="lc" viewBox="0 0 24 24"><rect x="4" y="4" width="16" height="16" rx="2" /><path d="M9 9h6M9 13h6" /></svg>,
  task:    <svg className="lc" viewBox="0 0 24 24"><path d="M9 12l2 2 4-4" /><rect x="3" y="3" width="18" height="18" rx="3" /></svg>,
}

export default function ListRowMaestro({ proposal, selected, onSelect, pipelineLookup }) {
  const isRevised = !!proposal.amended_from && proposal.status === 'pending'
  const needsInfo = proposal.needs_info === true && !proposal.amended_from
  const iconType = pickIconType(proposal)
  const cat = proposal.category || 'overig'
  const catLabel = CATEGORY_LABEL[cat] || 'Overig'
  const ctx = proposal.context || {}
  const pipelineRaw = ctx.pipeline || ctx.pipeline_id || null
  const stageId = ctx.pipeline_stage || ctx.deal_stage || null
  const resolved = pipelineLookup
    ? pipelineLookup.resolve(pipelineRaw, stageId)
    : { pipelineLabel: null, stageLabel: null }
  const pipelineLabel = resolved.pipelineLabel
  const stageLabel = resolved.stageLabel
  const amount = formatAmount(ctx)
  const owner = pickOwner(ctx)

  // Sub-row info (pipeline · stage · bedrag) — naast de categorie-pill.
  const subParts = []
  if (pipelineLabel) subParts.push({ kind: 'strong', text: pipelineLabel })
  if (stageLabel) subParts.push({ kind: 'plain', text: `stage ${stageLabel}` })
  if (amount) subParts.push({ kind: 'plain', text: amount })
  if (!pipelineLabel && !stageLabel && owner) subParts.push({ kind: 'plain', text: owner })

  const cls = [
    'adm-row',
    selected ? 'is-selected' : '',
    isRevised ? 'is-revised' : '',
    needsInfo ? 'is-needs' : '',
  ].filter(Boolean).join(' ')

  return (
    <button type="button" className={cls} onClick={onSelect}>
      {/* Dot-kleur per CATEGORIE (was per actie-type) — duidelijker informatief.
          data-action-type houden we voor evt. action-icon later. */}
      <span
        className={`adm-row__type cat-${cat}`}
        data-action-type={iconType}
        aria-hidden
      >{TYPE_ICON[iconType]}</span>
      <div className="adm-row__main">
        <div className="adm-row__title">{proposal.subject}</div>
        <div className="adm-row__sub">
          <span className={`adm-row__cat-pill cat-${cat}`}>{catLabel}</span>
          {subParts.length > 0 && (
            <span className="adm-row__sub-text">
              {subParts.map((p, i) => (
                <span key={i}>
                  {i > 0 && ' · '}
                  {p.kind === 'strong' ? <strong>{p.text}</strong> : p.text}
                </span>
              ))}
            </span>
          )}
          {needsInfo && <span className="adm-row__tag adm-row__tag--warn">input</span>}
          {isRevised && <span className="adm-row__tag adm-row__tag--accent">✎ herzien</span>}
        </div>
      </div>
      <div className="adm-row__meta">
        <span className="adm-row__when">{formatDateTime(proposal.created_at)}</span>
      </div>
    </button>
  )
}
