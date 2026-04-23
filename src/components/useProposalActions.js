import { useState } from 'react'
import { supabase } from '../lib/supabase'

// Shared state + RPC-logica voor alle ProposalCard-varianten (V2, V3, V4, V5).
// Elke card kiest zelf hoe ze dit presenteren, maar het gedrag is identiek.
export function useProposalActions(proposal) {
  const [mode, setMode] = useState('view') // view | amending
  const [amendText, setAmendText] = useState('')
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState(null)
  const [statusOverride, setStatusOverride] = useState(null)
  const [amendOverride, setAmendOverride] = useState(null)
  const [catOverride, setCatOverride] = useState(null)

  const cat = catOverride || proposal.category || 'overig'
  const status = statusOverride || proposal.status
  const liveAmendment = amendOverride != null ? amendOverride : proposal.amendment
  const isPending = status === 'pending' || status === 'amended'
  const isRevised = !!proposal.amended_from && status === 'pending'
  const needsInfo = proposal.needs_info === true

  async function call(rpc, payload, optimistic = {}) {
    if (optimistic.status) setStatusOverride(optimistic.status)
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

  async function onAccept() {
    await call('accept_proposal', { proposal_id: proposal.id }, { status: 'accepted' })
  }
  async function onReject() {
    await call('reject_proposal', { proposal_id: proposal.id }, { status: 'rejected' })
  }
  async function onAmend() {
    const txt = amendText.trim()
    if (!txt) return
    setMode('view'); setAmendText('')
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

  return {
    cat, status, liveAmendment, isPending, isRevised, needsInfo,
    mode, setMode, amendText, setAmendText, busy, err,
    onAccept, onReject, onAmend, onRecategorize,
  }
}

export function statusLabel(status) {
  const map = {
    pending: 'In afwachting', amended: 'Aanpassing verstuurd',
    accepted: 'Geaccepteerd', rejected: 'Afgewezen',
    executed: 'Uitgevoerd', failed: 'Gefaald',
    expired: 'Verlopen', superseded: 'Vervangen',
  }
  return map[status] || status
}

export const TYPE_META = {
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

export function sortedActions(proposal) {
  const actions = Array.isArray(proposal.proposal?.actions) ? proposal.proposal.actions : []
  return actions.slice().sort((a, b) => {
    const oa = TYPE_META[a?.type]?.order || 99
    const ob = TYPE_META[b?.type]?.order || 99
    return oa - ob
  })
}

// Shared helper: resolver voor action-details in elke card
export function actionDetails(action, lookup) {
  const type = action?.type || 'overig'
  const payload = action?.payload || {}
  const body = payload.content || payload.description || payload.note || payload.body
  const rows = []

  if (type === 'deal') {
    const { pipelineLabel, stageLabel } = lookup.resolve(
      payload.pipeline || payload.pipeline_id,
      payload.dealstage || payload.stage_id || payload.stage
    )
    if (payload.dealname) rows.push(['Naam', payload.dealname])
    if (pipelineLabel || payload.pipeline) {
      rows.push(['Pipeline', pipelineLabel ? (stageLabel ? `${pipelineLabel} · ${stageLabel}` : pipelineLabel) : payload.pipeline])
    }
    if (payload.deal_owner_name) rows.push(['Owner', payload.deal_owner_name])
  } else if (type === 'stage') {
    const { pipelineLabel, stageLabel } = lookup.resolve(
      payload.pipeline || payload.pipeline_id,
      payload.dealstage || payload.stage_id || payload.stage
    )
    if (stageLabel) rows.push(['Nieuwe stage', stageLabel])
    if (pipelineLabel) rows.push(['Pipeline', pipelineLabel])
  } else if (type === 'company') {
    if (payload.name) rows.push(['Naam', payload.name])
    if (payload.domain) rows.push(['Domein', payload.domain])
  } else if (type === 'contact') {
    const fullName = [payload.firstname, payload.lastname].filter(Boolean).join(' ')
    if (fullName) rows.push(['Naam', fullName])
    if (payload.email) rows.push(['E-mail', payload.email])
  } else if (type === 'task') {
    if (payload.due) rows.push(['Deadline', payload.due])
  } else if (type === 'jira') {
    if (payload.issueKey) rows.push(['Kaart', payload.issueKey])
    if (payload.operation) rows.push(['Actie', payload.operation])
    if (payload.transitionName) rows.push(['Naar stage', payload.transitionName])
  }

  return { type, meta: TYPE_META[type] || { label: type, icon: '•', color: 'neutral' },
           title: action?.label || '', rows, body }
}
