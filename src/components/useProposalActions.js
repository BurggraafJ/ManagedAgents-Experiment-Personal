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
export function useProposalActions(proposal, onRefresh, onMutate) {
  const [mode, setMode] = useState('view') // view | amending
  const [amendText, setAmendText] = useState('')
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState(null)
  const [statusOverride, setStatusOverride] = useState(null)
  const [amendOverride, setAmendOverride] = useState(null)
  const [catOverride, setCatOverride] = useState(null)
  // Hard optimistic-hide: bij succesvol accept/reject/amend wordt dit gezet
  // zodat de detail-card direct een "✓ Verwerkt"-state toont, ook als de
  // parent-state nog niet ververst is. Voorkomt "klik en niets gebeurt"-gevoel.
  const [resolvedAs, setResolvedAs] = useState(null) // null | 'accepted' | 'rejected' | 'amended'

  // Edits per action-index. Removed = set met indices die weg moeten.
  // Edits = map met {assignee?, due?, title?} overrides per index.
  const [removed, setRemoved] = useState(() => new Set())
  const [edits, setEdits] = useState({})
  // ExtraActions: door Jelle handmatig toegevoegd via "+ Voeg toe"-knop in
  // ProposalCardMaestro. Volgen exact dezelfde shape als bestaande actions
  // ({type, payload}). Worden bij accept aangevuld op editedActions.
  const [extraActions, setExtraActions] = useState([])

  const cat = catOverride || proposal.category || 'overig'
  const status = statusOverride || proposal.status
  const liveAmendment = amendOverride != null ? amendOverride : proposal.amendment
  const isPending = status === 'pending' || status === 'amended'
  const isRevised = !!proposal.amended_from && status === 'pending'
  const needsInfo = proposal.needs_info === true

  // Gefilterde + bewerkte actions-lijst die we meesturen met de RPC.
  // Return null als er geen wijzigingen zijn — dan weet de caller dat-ie
  // de goedkopere accept_proposal/amend_proposal kan gebruiken.
  //
  // Schema-drift fix: oude daily-admin runs schreven action-velden top-level
  // (action.body / action.title / action.due_date) in plaats van payload-wrapped.
  // We normaliseren bij read-tijd zodat downstream (RecCardMaestro, RPC-write)
  // altijd canonical {type, label, payload: {...}} ziet.
  const rawActions = useMemo(
    () => {
      const raw = Array.isArray(proposal.proposal?.actions) ? proposal.proposal.actions : []
      return raw.map(normalizeActionShape)
    },
    [proposal.proposal]
  )
  const hasEdits = removed.size > 0 || Object.keys(edits).length > 0 || extraActions.length > 0

  // Fallback-defaults die we ALTIJD toepassen bij accept/amend, ook als Jelle
  // verder geen dropdown aanraakt. Recruitment zonder assignee → Jelle.
  function applyImplicitDefaults(action) {
    if (!action || typeof action !== 'object') return action
    const needsAssignee = ['task', 'jira', 'card'].includes(action.type)
    if (!needsAssignee) return action
    const p = action.payload || {}
    const hasAssignee = p.assignee || p.jira_assignee || p.assigned_to || p.owner
    if (hasAssignee) return action
    if (proposal.category === 'recruitment') {
      return { ...action, payload: { ...p, assignee: 'Jelle Burggraaf' } }
    }
    return action
  }

  const editedActions = useMemo(() => {
    // Pas altijd implicit defaults toe (recruitment-assignee). Als daar géén
    // wijziging uit komt én er geen expliciete edits zijn → null retourneren
    // zodat de caller de simpele accept_proposal kan gebruiken.
    const defaulted = rawActions.map(applyImplicitDefaults)
    const defaultsChanged = defaulted.some((a, i) => a !== rawActions[i])

    if (!hasEdits && !defaultsChanged) return null

    const main = rawActions
      .map((a, i) => {
        if (removed.has(i)) return null
        const e = edits[i]
        const merged = e ? { ...a, payload: { ...(a?.payload || {}), ...e } } : a
        return applyImplicitDefaults(merged)
      })
      .filter(Boolean)
    // Voeg extraActions toe na de bestaande (in volgorde van toevoeging).
    return [...main, ...extraActions.map(applyImplicitDefaults)]
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rawActions, removed, edits, hasEdits, proposal.category, extraActions])

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
    setRemoved(new Set()); setEdits({}); setExtraActions([])
  }

  // ── Extra-acties API (toegevoegd 2026-05-14) ──
  // Maak een lege template voor een nieuwe actie van het gevraagde type.
  // Recruitment-default voor assignee zit al in applyImplicitDefaults, dus
  // hier hoef je 'm niet expliciet te zetten.
  function makeActionTemplate(type) {
    switch (type) {
      case 'note':
        return { type: 'note', payload: { content: '' } }
      case 'task':
        return { type: 'task', payload: { title: '', assignee: '', due: '' } }
      case 'contact':
        return { type: 'contact', payload: { firstname: '', lastname: '', email: '' } }
      case 'card':
        // Recruitment Kanban-card. Default 'create' op REC-board, assignee Jelle.
        return { type: 'card', payload: { operation: 'create', board: 'REC', title: '', assignee: 'Jelle Burggraaf' } }
      case 'jira':
        // Jira-comment op bestaande issue (REC of Partnerships).
        return { type: 'jira', payload: { operation: 'comment', issueKey: '', description: '' } }
      default:
        return { type, payload: {} }
    }
  }
  function addAction(type) {
    setExtraActions(prev => [...prev, makeActionTemplate(type)])
  }
  function patchExtraAction(i, patch) {
    setExtraActions(prev => prev.map((a, idx) =>
      idx === i ? { ...a, payload: { ...(a?.payload || {}), ...patch } } : a
    ))
  }
  function removeExtraAction(i) {
    setExtraActions(prev => prev.filter((_, idx) => idx !== i))
  }

  async function call(rpc, payload, optimistic = {}) {
    const originalStatus = proposal.status
    const originalAmendment = proposal.amendment
    if (optimistic.status) setStatusOverride(optimistic.status)
    if (optimistic.amendment != null) setAmendOverride(optimistic.amendment)
    // Parent-state optimistic: kaart verspringt direct uit Pending naar Verwerkt.
    // Zonder dit blijft 'ie tot de 1.5s realtime-debounce in de lijst hangen en
    // krijgt Jelle bij tweede klik "already rejected" terug.
    if (onMutate && (optimistic.status || optimistic.amendment != null)) {
      const patch = {}
      if (optimistic.status) patch.status = optimistic.status
      if (optimistic.amendment != null) patch.amendment = optimistic.amendment
      if (optimistic.status && optimistic.status !== 'pending') patch.reviewed_at = new Date().toISOString()
      onMutate(proposal.id, patch)
    }
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
    if (!succeeded && onMutate) {
      // Revert parent-state als RPC alsnog faalt.
      onMutate(proposal.id, { status: originalStatus, amendment: originalAmendment })
    }
    if (succeeded) {
      // Hard optimistic-hide: zet resolvedAs zodat ProposalCard direct
      // de verwerkt-state toont (niet wachten op parent re-render).
      if (optimistic.status === 'accepted')      setResolvedAs('accepted')
      else if (optimistic.status === 'rejected') setResolvedAs('rejected')
      else if (optimistic.status === 'amended')  setResolvedAs('amended')
      if (typeof onRefresh === 'function') onRefresh()
    }
  }

  // Goedkeuren: als er edits of implicit-defaults zijn → accept_proposal_with_edits;
  // anders kaal accept. editedActions is null wanneer geen van beide geldt.
  async function onAccept() {
    if (editedActions) {
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
    extraActions, addAction, patchExtraAction, removeExtraAction,
    onAccept, onReject, onAmend, onAmendAndAccept, onRecategorize,
    // Inline-edit API
    removed, edits, hasEdits,
    removeAction, restoreAction, patchAction, clearEdits,
    // Optimistic-hide signal
    resolvedAs,
  }
}

// Normaliseert een action-object zodat downstream code altijd één shape ziet:
//   { type, label, payload: { content, title, due, assignee, deal_id, ... } }
// Vangt drift: top-level body/title/due_date, kind i.p.v. type, lege payload.
export function normalizeActionShape(a) {
  if (!a || typeof a !== 'object') return a
  // Al canoniek? Behoud — alleen zorgen dat due_date → due ook hier gepatched is.
  if (a.payload && typeof a.payload === 'object') {
    const p = a.payload
    if (p.due_date && !p.due) return { ...a, payload: { ...p, due: p.due_date } }
    return a
  }
  // Top-level drift — alles na 'type'/'kind'/'label' is payload.
  const { type, kind, label, ...rest } = a
  const resolvedType = type || kind || 'overig'
  const payload = { ...rest }
  // Body-aliassen → content (note/jira primair, alle types via fallback)
  if (rest.body != null && payload.content == null) payload.content = rest.body
  if (rest.description != null && payload.content == null) payload.content = rest.description
  if (rest.note != null && payload.content == null) payload.content = rest.note
  // Due-alias → due
  if (rest.due_date != null && payload.due == null) payload.due = rest.due_date
  // Subject-alias → title (voor jira/card waar subject = title)
  if (rest.subject != null && payload.title == null) payload.title = rest.subject
  return {
    type: resolvedType,
    label: label || rest.title || rest.subject || rest.name || resolvedType,
    payload,
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
  deal:                 { label: 'Deal',              icon: '◆',  color: 'accent',   order: 1 },
  company:              { label: 'Company',           icon: '⌂',  color: 'orange',   order: 2 },
  contact:              { label: 'Contact',           icon: '⊕',  color: 'yellow',   order: 3 },
  stage:                { label: 'Stage-update',      icon: '↗',  color: 'purple',   order: 4 },
  deal_property_update: { label: 'Deal-wijziging',    icon: '⚙',  color: 'purple',   order: 4 },
  property_update:      { label: 'Wijziging',         icon: '⚙',  color: 'purple',   order: 4 },
  company_update:       { label: 'Company-wijziging', icon: '⌂',  color: 'orange',   order: 4 },
  contact_update:       { label: 'Contact-wijziging', icon: '⊕',  color: 'yellow',   order: 4 },
  update:               { label: 'Wijziging',         icon: '⚙',  color: 'purple',   order: 4 },
  note:                 { label: 'Note',              icon: '✎',  color: 'blue',     order: 5 },
  task:                 { label: 'Task',              icon: '✓',  color: 'green',    order: 6 },
  jira:                 { label: 'Jira',              icon: '⊞',  color: 'sky',      order: 7 },
  card:                 { label: 'Recruitment-kaart', icon: '⊠',  color: 'cyan',     order: 8 },
  comment:              { label: 'Comment',           icon: '💬', color: 'blue',     order: 9 },
}

export function sortedActions(proposal) {
  const raw = Array.isArray(proposal.proposal?.actions) ? proposal.proposal.actions : []
  const actions = raw.map(normalizeActionShape)
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
  // Action is genormaliseerd door normalizeActionShape() in useProposalActions,
  // dus we kunnen veilig action.type + action.payload gebruiken zonder fallbacks.
  // Defensive: als deze functie buiten useProposalActions wordt aangeroepen
  // (sortedActions in deze file zelf, of door externe callers), normalize on-the-fly.
  const a = action?.payload ? action : normalizeActionShape(action)
  const type = a?.type || 'overig'
  const payload = a?.payload || {}
  const body = payload.content
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
  } else if (['deal_property_update','property_update','company_update','contact_update','update'].includes(type)) {
    // Sinds v5.7: structured property-mutation. Toon "veld: van → naar" + uitleg.
    const propName = payload.property || payload.field
    if (propName) {
      const fromVal = payload.from
      const toVal = payload.to
      const arrow = (fromVal !== undefined && fromVal !== null && fromVal !== '')
        ? `${fromVal} → ${toVal}`
        : String(toVal ?? '')
      rows.push(['Veld', `${propName}: ${arrow}`])
    } else if (payload.to !== undefined) {
      rows.push(['Nieuwe waarde', String(payload.to)])
    }
    if (payload.deal_id)    rows.push(['Op deal',    payload.deal_id])
    if (payload.company_id) rows.push(['Op company', payload.company_id])
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
