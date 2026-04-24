import { useState, useMemo } from 'react'
import { supabase } from '../lib/supabase'

// Shared state + RPC-logica voor de ProposalCard.
// `onRefresh` (optioneel): wordt aangeroepen na een geslaagde RPC zodat de
// parent direct een verse fetch doet — zo verhuist het item meteen naar
// Verwerkt/Logboek zonder te wachten op de 1.5s realtime-debounce.
//
// Inline-editing: Jelle kan per actie (chip) een ×-knop klikken om 'm te
// verwijderen, en bij task/jira/card een deadline en assignee kiezen. De
// edits leven lokaal tot-ie op Goedkeuren/Doorvoeren/Opnieuw klikt — dan
// gaan ze mee naar de RPC (accept_proposal_with_edits of
// amend_proposal_with_edits). Geen edits = gewone accept/amend.
export function useProposalActions(proposal, onRefresh) {
  const [mode, setMode] = useState('view') // view | amending
  const [amendText, setAmendText] = useState('')
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState(null)
  const [statusOverride, setStatusOverride] = useState(null)
  const [amendOverride, setAmendOverride] = useState(null)
  const [catOverride, setCatOverride] = useState(null)

  // Edits per action-index. Removed = set met indices die weg moeten.
  // Edits = map met {assignee?, due?, title?} overrides per index.
  const [removed, setRemoved] = useState(() => new Set())
  const [edits, setEdits] = useState({})

  const cat = catOverride || proposal.category || 'overig'
  const status = statusOverride || proposal.status
  const liveAmendment = amendOverride != null ? amendOverride : proposal.amendment
  const isPending = status === 'pending' || status === 'amended'
  const isRevised = !!proposal.amended_from && status === 'pending'
  const needsInfo = proposal.needs_info === true

  // Gefilterde + bewerkte actions-lijst die we meesturen met de RPC.
  // Return null als er geen wijzigingen zijn — dan weet de caller dat-ie
  // de goedkopere accept_proposal/amend_proposal kan gebruiken.
  const rawActions = useMemo(
    () => Array.isArray(proposal.proposal?.actions) ? proposal.proposal.actions : [],
    [proposal.proposal]
  )
  const hasEdits = removed.size > 0 || Object.keys(edits).length > 0
  const editedActions = useMemo(() => {
    if (!hasEdits) return null
    return rawActions
      .map((a, i) => {
        if (removed.has(i)) return null
        const e = edits[i]
        if (!e) return a
        return { ...a, payload: { ...(a?.payload || {}), ...e } }
      })
      .filter(Boolean)
  }, [rawActions, removed, edits, hasEdits])

  function removeAction(i) {
    setRemoved(prev => { const next = new Set(prev); next.add(i); return next })
  }
  function restoreAction(i) {
    setRemoved(prev => { const next = new Set(prev); next.delete(i); return next })
  }
  function patchAction(i, patch) {
    setEdits(prev => ({ ...prev, [i]: { ...(prev[i] || {}), ...patch } }))
  }
  function clearEdits() {
    setRemoved(new Set()); setEdits({})
  }

  async function call(rpc, payload, optimistic = {}) {
    if (optimistic.status) setStatusOverride(optimistic.status)
    if (optimistic.amendment != null) setAmendOverride(optimistic.amendment)
    setBusy(true); setErr(null)
    let succeeded = false
    try {
      const { data, error } = await supabase.rpc(rpc, payload)
      if (error) { setErr(error.message); setStatusOverride(null); setAmendOverride(null) }
      else if (data && data.ok === false) { setErr(data.reason || 'mislukt'); setStatusOverride(null); setAmendOverride(null) }
      else { succeeded = true }
    } catch (e) {
      setErr(e.message || 'netwerkfout'); setStatusOverride(null); setAmendOverride(null)
    }
    setBusy(false)
    if (succeeded && typeof onRefresh === 'function') onRefresh()
  }

  // Goedkeuren: met inline-edits → accept_proposal_with_edits; anders kaal accept.
  async function onAccept() {
    if (hasEdits) {
      await call('accept_proposal_with_edits',
        { proposal_id: proposal.id, edited_actions: editedActions, amendment_note: null },
        { status: 'accepted' })
    } else {
      await call('accept_proposal', { proposal_id: proposal.id }, { status: 'accepted' })
    }
  }

  async function onReject() {
    await call('reject_proposal', { proposal_id: proposal.id }, { status: 'rejected' })
  }

  // "Opnieuw" in aanpassen-panel: amendment + edits naar re-propose.
  async function onAmend() {
    const txt = amendText.trim()
    if (!txt) return
    setMode('view'); setAmendText('')
    await call('amend_proposal_with_edits',
      { proposal_id: proposal.id, amendment_text: txt, edited_actions: editedActions },
      { status: 'amended', amendment: txt })
  }

  // "Doorvoeren" in aanpassen-panel: edits + tekst → direct accepted.
  async function onAmendAndAccept() {
    const txt = amendText.trim()
    setMode('view'); setAmendText('')
    await call('accept_proposal_with_edits',
      { proposal_id: proposal.id, edited_actions: editedActions, amendment_note: txt || null },
      { status: 'accepted', amendment: txt || proposal.amendment })
  }

  async function onRecategorize(newCat) {
    if (newCat === cat) return
    setCatOverride(newCat)
    setBusy(true); setErr(null)
    let succeeded = false
    try {
      const { data, error } = await supabase.rpc('recategorize_proposal', {
        proposal_id: proposal.id, new_category: newCat,
      })
      if (error) { setErr(error.message); setCatOverride(null) }
      else if (data && data.ok === false) { setErr(data.reason || 'mislukt'); setCatOverride(null) }
      else { succeeded = true }
    } catch (e) {
      setErr(e.message || 'netwerkfout'); setCatOverride(null)
    }
    setBusy(false)
    if (succeeded && typeof onRefresh === 'function') onRefresh()
  }

  return {
    cat, status, liveAmendment, isPending, isRevised, needsInfo,
    mode, setMode, amendText, setAmendText, busy, err,
    onAccept, onReject, onAmend, onAmendAndAccept, onRecategorize,
    // Inline-edit API
    removed, edits, hasEdits,
    removeAction, restoreAction, patchAction, clearEdits,
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

// Shared helper: resolver voor action-details in elke card.
// Fallback-assignee volgorde: payload.assignee > payload.jira_assignee > payload.owner > dealowner uit context.
function resolveAssignee(payload, proposalContext) {
  return payload.assignee
      || payload.jira_assignee
      || payload.assigned_to
      || payload.owner
      || proposalContext?.deal_owner_name
      || proposalContext?.jira_assignee
      || null
}

export function actionDetails(action, lookup, proposalContext) {
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
    if (payload.title) rows.push(['Titel', payload.title])
    const assignee = resolveAssignee(payload, proposalContext)
    rows.push(['Toegewezen aan', assignee || '⚠ niet opgegeven'])
    if (payload.due) rows.push(['Deadline', payload.due])
  } else if (type === 'jira' || type === 'card') {
    if (payload.board) rows.push(['Bord', payload.board])
    if (payload.issueKey) rows.push(['Kaart', payload.issueKey])
    if (payload.operation) rows.push(['Actie', payload.operation])
    if (payload.transitionName) rows.push(['Naar stage', payload.transitionName])
    if (payload.summary || payload.title) rows.push(['Titel', payload.summary || payload.title])
    if (payload.column) rows.push(['Kolom', payload.column])
    // Voor create-operaties: assignee uitdrukkelijk tonen. Comments op
    // bestaande kaarten hebben meestal al een assignee; toon 'm alleen
    // als ie meegegeven is.
    const assignee = resolveAssignee(payload, proposalContext)
    const isCreate = payload.operation === 'create' || !payload.operation || payload.operation === 'update'
    if (assignee) rows.push(['Toegewezen aan', assignee])
    else if (isCreate) rows.push(['Toegewezen aan', '⚠ niet opgegeven'])
  }

  return { type, meta: TYPE_META[type] || { label: type, icon: '•', color: 'neutral' },
           title: action?.label || '', rows, body }
}
