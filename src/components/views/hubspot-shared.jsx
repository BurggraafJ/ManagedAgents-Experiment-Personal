// Gedeelde helpers voor de vier Daily Admin-varianten. Houd grouping-logica
// consistent zodat "Input nodig" overal dezelfde 3 items toont.
import { useContext } from 'react'
import {
  AGENT,
  CATEGORY_LABEL,
  CATEGORY_CLASS,
  PipelineLookupContext,
  formatDateTime,
} from './HubSpotView'

export function filterAgentProposals(data) {
  return (data.proposals || []).filter(p => p.agent_name === AGENT)
}

export function groupProposals(proposals) {
  const sortNew = (a, b) => new Date(b.created_at) - new Date(a.created_at)
  const sortReviseFirst = (a, b) => {
    const ar = a.amended_from ? 1 : 0
    const br = b.amended_from ? 1 : 0
    if (ar !== br) return br - ar
    return sortNew(a, b)
  }
  return {
    need_input: proposals
      .filter(p => p.status === 'pending' && p.needs_info === true)
      .sort(sortNew),
    to_review: proposals
      .filter(p => p.status === 'pending' && p.needs_info !== true)
      .sort(sortReviseFirst),
    in_progress: proposals
      .filter(p => p.status === 'amended')
      .sort(sortNew),
    done: proposals
      .filter(p => ['accepted', 'rejected', 'executed', 'failed'].includes(p.status))
      .sort(sortNew),
  }
}

// CardBadge — één reusable pill voor status/kind labels. Varianten via className.
export function CardBadge({ children, tone = 'default', title }) {
  return (
    <span className={`v-badge v-badge--${tone}`} title={title}>{children}</span>
  )
}

// CardPipelineStage — compact "Sales · Proeftijd" pill, leest uit context.
export function CardPipelineStage({ proposal }) {
  const lookup = useContext(PipelineLookupContext)
  const ctx = proposal.context || {}
  const pipelineRaw = ctx.pipeline || ctx.pipeline_id || null
  const stageId = ctx.pipeline_stage || ctx.deal_stage || null
  const { pipelineLabel, stageLabel } = lookup.resolve(pipelineRaw, stageId)
  const parts = [pipelineLabel || (pipelineRaw ? `? ${pipelineRaw}` : null),
                 stageLabel    || (stageId ? `? ${stageId}`       : null)]
    .filter(Boolean)
  if (parts.length === 0) return null
  const isCB = String(pipelineRaw) === '2299277539'
  return (
    <span className={`v-pipeline ${isCB ? 'v-pipeline--cb' : ''}`} title={parts.join(' → ')}>
      {parts.join(' · ')}
    </span>
  )
}

// Owner-initialen in een avatar. Compact.
export function CardOwnerAvatar({ proposal }) {
  const ctx = proposal.context || {}
  const name = ctx.deal_owner_name || ctx.dealowner || ctx.jira_assignee || null
  if (!name) return null
  const initials = name.trim().split(/\s+/)
    .map(w => w[0]?.toUpperCase() || '')
    .slice(0, 2)
    .join('')
  return (
    <span className="v-owner" title={`Owner: ${name}`}>{initials}</span>
  )
}

// Category pill — klein, kleur-gecodeerd.
export function CardCategory({ proposal }) {
  const cat = proposal.category || 'overig'
  return (
    <span className={CATEGORY_CLASS[cat]} style={{ fontSize: 10 }}>
      {CATEGORY_LABEL[cat] || 'Overig'}
    </span>
  )
}

// Action-types als icons (wat de proposal wil doen).
const KIND_ICONS = {
  note: '✎', task: '✓', stage: '↗', contact: '⊕', company: '⌂',
  deal: '◆', jira: '⊞', card: '⊠', comment: '💬',
}
export function CardActionKinds({ proposal, max = 4 }) {
  const actions = Array.isArray(proposal.proposal?.actions) ? proposal.proposal.actions : []
  const kinds = Array.from(new Set(actions.map(a => a?.type).filter(Boolean)))
  if (kinds.length === 0) return null
  return (
    <span className="v-kinds">
      {kinds.slice(0, max).map(k => (
        <span key={k} className={`v-kind v-kind--${k}`} title={k}>{KIND_ICONS[k] || '•'}</span>
      ))}
    </span>
  )
}

export function CardConfidence({ proposal }) {
  const conf = typeof proposal.confidence === 'number'
    ? Math.round(proposal.confidence * 100) : null
  if (conf == null) return null
  const tone = conf >= 70 ? 'ok' : conf >= 50 ? 'mid' : 'low'
  return <span className={`v-conf v-conf--${tone}`} title={`Confidence ${conf}%`}>{conf}%</span>
}

export function CardTime({ proposal }) {
  return <span className="v-time">{formatDateTime(proposal.created_at)}</span>
}

// Labels voor groepen — gedeeld zodat Dense/Priority/Thread/Reader dezelfde
// terminologie gebruiken. Concept komt terug uit Kanban/Inbox-ervaring.
export const GROUP_META = {
  need_input:  { label: 'Input nodig',    accent: 'warning', hint: 'agent wacht op jouw instructies' },
  to_review:   { label: 'Te beoordelen',  accent: 'accent',  hint: 'concrete plannen \u2014 ✓ / ✎ / ✕' },
  in_progress: { label: 'In behandeling', accent: 'muted',   hint: 'jouw aanpassing wacht op volgende run' },
  done:        { label: 'Afgehandeld',    accent: 'muted2',  hint: 'historie \u2014 uitgevoerd of afgewezen' },
}
