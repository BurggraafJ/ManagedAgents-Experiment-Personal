import { useCallback, useEffect, useMemo, useState } from 'react'
import { supabase, createRealtimeChannel } from '../lib/supabase'

/**
 * useKlantbaseData — laadt klantbase_proposals + klantbase_field_proposals
 *                    + klantbase_field_definitions met realtime updates.
 *
 * Vervangt de DEALS_OVER/DEALS_REN dummy-imports uit klantbase-data.js. Mapt
 * de DB-shape naar de UI-shape die KlantbaseListPane/DetailPane/FieldRow al
 * verwachten (deal.id, deal.fields[], etc).
 *
 * Returns:
 *   • proposalsOver  — Array<UIdeal>  (proposal_type='overdracht', status≠rejected/dismissed)
 *   • proposalsRen   — Array<UIdeal>  (proposal_type='renewal')
 *   • fieldDefs      — Array<row>     (alle 19 veld-definities — voor instellingen/uitleg)
 *   • loading, error
 *   • refresh()                          — handmatig re-fetchen
 *   • requestRun()                       — "Nu draaien" → klantbase-schedule
 *   • acceptProposal(proposalId)         — RPC accept_klantbase_proposal
 *   • rejectProposal(proposalId)         — RPC reject_klantbase_proposal
 *   • dismissProposal(proposalId)        — RPC dismiss_klantbase_proposal
 *   • approveField(fieldId)              — RPC approve_klantbase_field
 *   • acceptFieldWithEdits(fieldId, v)   — RPC accept_klantbase_field_with_edits
 *   • rejectField(fieldId)               — RPC reject_klantbase_field
 *   • rerunField(fieldId)                — RPC rerun_klantbase_field
 *   • approveAllPendingFields(proposalId) — batch approveField over alle pending fields
 */
export function useKlantbaseData() {
  const [proposals, setProposals] = useState([])
  const [fieldProposals, setFieldProposals] = useState([])
  const [fieldDefs, setFieldDefs] = useState([])
  const [scheduleRows, setScheduleRows] = useState([])  // klantbase + klantbase-execute schedule-state
  const [renewalRequests, setRenewalRequests] = useState([])  // handmatige verlenging-aanvragen
  const [dealsByHsId, setDealsByHsId] = useState({})  // hubspot_deal_id → {closedate, dealname}
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)

  const fetchAll = useCallback(async () => {
    try {
      setError(null)
      const [{ data: defs, error: e0 },
             { data: props, error: e1 },
             { data: fields, error: e2 },
             { data: scheds, error: e3 },
             { data: reqs, error: e4 }] = await Promise.all([
        supabase
          .from('klantbase_field_definitions')
          .select('*')
          .eq('active', true)
          .order('display_order', { ascending: true }),
        supabase
          .from('klantbase_proposals')
          .select('*')
          .in('status', ['pending'])
          .order('ai_run_at', { ascending: false, nullsFirst: false }),
        supabase
          .from('klantbase_field_proposals')
          .select('*'),
        supabase
          .from('agent_schedules')
          .select('agent_name, enabled, is_running, manual_run_requested_at, last_run_at, next_run_at, run_lock_acquired_at')
          .in('agent_name', ['klantbase','klantbase-execute']),
        supabase
          .from('klantbase_renewal_requests')
          .select('*')
          .in('status', ['queued','matched','failed'])
          .order('created_at', { ascending: false }),
      ])
      if (e0) throw e0
      if (e1) throw e1
      if (e2) throw e2
      if (e3) throw e3
      // e4 mag fail-soft — tabel kan nog niet bestaan in dev-DB
      if (e4 && !String(e4.message || '').includes('does not exist')) throw e4

      setFieldDefs(defs || [])
      setProposals(props || [])
      setFieldProposals(fields || [])
      setScheduleRows(scheds || [])
      setRenewalRequests(reqs || [])

      // Verrijk met closedate uit hubspot_deals (client-join, faalt stilletjes bij RLS-block)
      const hsIds = Array.from(new Set([
        ...(props || []).map(p => p.hubspot_deal_id),
        ...(props || []).map(p => p.old_hubspot_deal_id).filter(Boolean),
      ]))
      if (hsIds.length > 0) {
        const { data: deals } = await supabase
          .from('hubspot_deals')
          .select('deal_id, closedate, dealname')
          .in('deal_id', hsIds)
        const map = Object.fromEntries((deals || []).map(d => [d.deal_id, d]))
        setDealsByHsId(map)
      } else {
        setDealsByHsId({})
      }
    } catch (err) {
      setError(err.message || String(err))
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    fetchAll()
    const ch = createRealtimeChannel('klantbase-live')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'klantbase_proposals' }, () => fetchAll())
      .on('postgres_changes', { event: '*', schema: 'public', table: 'klantbase_field_proposals' }, () => fetchAll())
      .on('postgres_changes', { event: '*', schema: 'public', table: 'klantbase_field_definitions' }, () => fetchAll())
      .on('postgres_changes', { event: '*', schema: 'public', table: 'agent_schedules' }, () => fetchAll())
      .on('postgres_changes', { event: '*', schema: 'public', table: 'klantbase_renewal_requests' }, () => fetchAll())
      .subscribe()
    // Poll elke 20s als fallback voor de schedule-status (manual_run_requested_at -> orchestrator)
    const pollId = setInterval(() => { fetchAll() }, 20000)
    return () => { supabase.removeChannel(ch); clearInterval(pollId) }
  }, [fetchAll])

  // ────────── Acties (RPCs) ──────────

  const acceptProposal = useCallback(async (proposalId) => {
    const { error } = await supabase.rpc('accept_klantbase_proposal', { p_id: proposalId })
    if (error) throw error
  }, [])

  const rejectProposal = useCallback(async (proposalId) => {
    const { error } = await supabase.rpc('reject_klantbase_proposal', { p_id: proposalId })
    if (error) throw error
  }, [])

  const dismissProposal = useCallback(async (proposalId) => {
    const { error } = await supabase.rpc('dismiss_klantbase_proposal', { p_id: proposalId })
    if (error) throw error
  }, [])

  const approveField = useCallback(async (fieldId) => {
    const { error } = await supabase.rpc('approve_klantbase_field', { p_field_id: fieldId })
    if (error) throw error
  }, [])

  const acceptFieldWithEdits = useCallback(async (fieldId, value) => {
    const { error } = await supabase.rpc('accept_klantbase_field_with_edits',
                                          { p_field_id: fieldId, p_value: value })
    if (error) throw error
  }, [])

  const rejectField = useCallback(async (fieldId) => {
    const { error } = await supabase.rpc('reject_klantbase_field', { p_field_id: fieldId })
    if (error) throw error
  }, [])

  const rerunField = useCallback(async (fieldId) => {
    const { error } = await supabase.rpc('rerun_klantbase_field', { p_field_id: fieldId })
    if (error) throw error
  }, [])

  const requestRun = useCallback(async () => {
    // De orchestrator selecteert agents op next_run_at <= now(). Zet beide.
    const now = new Date().toISOString()
    const { error } = await supabase
      .from('agent_schedules')
      .update({ next_run_at: now, manual_run_requested_at: now })
      .eq('agent_name', 'klantbase')
    if (error) throw error
  }, [])

  const approveAllPendingFields = useCallback(async (proposalId) => {
    const pending = fieldProposals.filter(f => f.proposal_id === proposalId && f.status === 'pending')
    // Sequential — max 19 RPCs, geen batch nodig
    for (const fp of pending) {
      await supabase.rpc('approve_klantbase_field', { p_field_id: fp.id })
    }
  }, [fieldProposals])

  const requestRenewal = useCallback(async (companyQuery) => {
    const { data, error } = await supabase.rpc('request_klantbase_renewal',
                                                { p_company_query: companyQuery })
    if (error) throw error
    return data  // uuid van de gequeuede request
  }, [])

  const dismissRenewalRequest = useCallback(async (id) => {
    const { error } = await supabase.rpc('dismiss_klantbase_renewal_request', { p_id: id })
    if (error) throw error
  }, [])

  // ────────── Schedule / run-status ──────────

  const runStatus = useMemo(() => deriveRunStatus(scheduleRows), [scheduleRows])

  // ────────── Mapping naar UI-shape ──────────

  const { proposalsOver, proposalsRen } = useMemo(() => {
    const defsByKey = Object.fromEntries(fieldDefs.map(d => [d.key, d]))
    const fpByProposal = {}
    for (const fp of fieldProposals) {
      (fpByProposal[fp.proposal_id] ||= []).push(fp)
    }

    const deals = proposals.map(p => mapProposalToDeal(p, fpByProposal[p.id] || [], defsByKey, dealsByHsId))
    return {
      proposalsOver: deals.filter(d => d.proposalType === 'overdracht'),
      proposalsRen:  deals.filter(d => d.proposalType === 'renewal'),
    }
  }, [proposals, fieldProposals, fieldDefs, dealsByHsId])

  return {
    proposalsOver,
    proposalsRen,
    fieldDefs,
    runStatus,
    renewalRequests,
    loading,
    error,
    refresh: fetchAll,
    requestRun,
    requestRenewal,
    dismissRenewalRequest,
    acceptProposal,
    rejectProposal,
    dismissProposal,
    approveField,
    acceptFieldWithEdits,
    rejectField,
    rerunField,
    approveAllPendingFields,
  }
}

// Eén unified run-status uit de 2 schedule-rijen (klantbase + klantbase-execute):
//   • isRunning        — orchestrator heeft een lock op één van beide
//   • isPending        — manual_run_requested_at > last_run_at (of last_run_at is NULL)
//   • requestedAt      — laatste manual-trigger timestamp
//   • runningSince     — wanneer de lock acquired werd
//   • lastRunAt        — laatste succesvolle run
//   • enabled          — beide schedules enabled?
//   • scanEnabled / executeEnabled — per-skill
function deriveRunStatus(rows) {
  const scan    = rows.find(r => r.agent_name === 'klantbase')
  const execute = rows.find(r => r.agent_name === 'klantbase-execute')
  const isPendingFor = (r) => {
    if (!r) return false
    const req = r.manual_run_requested_at ? new Date(r.manual_run_requested_at).getTime() : 0
    const last = r.last_run_at ? new Date(r.last_run_at).getTime() : 0
    return req > 0 && req > last
  }
  const isRunning = !!(scan?.is_running || execute?.is_running)
  const isPending = isPendingFor(scan) || isPendingFor(execute)
  const requestedAt =
    [scan?.manual_run_requested_at, execute?.manual_run_requested_at]
      .filter(Boolean).sort().pop() || null
  const runningSince =
    [scan?.run_lock_acquired_at, execute?.run_lock_acquired_at]
      .filter(Boolean).sort().pop() || null
  const lastRunAt =
    [scan?.last_run_at, execute?.last_run_at]
      .filter(Boolean).sort().pop() || null
  return {
    isRunning,
    isPending: isPending && !isRunning,    // running heeft prioriteit
    requestedAt,
    runningSince,
    lastRunAt,
    enabled: !!(scan?.enabled && execute?.enabled),
    scanEnabled: !!scan?.enabled,
    executeEnabled: !!execute?.enabled,
  }
}

// ─────────────────────────────────────────────────────────────────────
// Mapping helpers — DB-shape → UI-shape die de bestaande components al
// gebruiken (deal.fields[], deal.avCls, deal.dueLabel, etc).
// ─────────────────────────────────────────────────────────────────────

function mapProposalToDeal(p, fps, defsByKey, dealsByHsId) {
  const orderedFps = [...fps].sort((a, b) =>
    (defsByKey[a.field_key]?.display_order || 99) - (defsByKey[b.field_key]?.display_order || 99)
  )
  const fields = orderedFps.map(fp => mapFieldProposal(fp, defsByKey[fp.field_key]))
  const av = computeAvatar(p.company_name || p.hubspot_deal_id || '?')
  const hsDeal = dealsByHsId[p.hubspot_deal_id]
  const oldHsDeal = p.old_hubspot_deal_id ? dealsByHsId[p.old_hubspot_deal_id] : null

  return {
    id: p.id,                                              // proposal uuid (UI key)
    proposalId: p.id,
    hubspotDealId: p.hubspot_deal_id,
    proposalType: p.proposal_type,
    status: p.status,
    company: p.company_name || hsDeal?.dealname || 'Onbekend',
    avCls: av.cls,
    avInit: av.init,
    domain: p.company_domain || '',
    hubspot: `https://app.hubspot.com/deals/${p.hubspot_deal_id}`,
    stage: p.proposal_type === 'renewal' ? null : 'Closed Won',
    closedAt: formatDateLong(hsDeal?.closedate),
    missingLoa: (p.ai_sources_count ?? 0) === 0,           // LoA-bijlage ontbreekt op deal
    dueDate: formatDateLong(p.due_date),
    dueLabel: p.due_label || (p.proposal_type === 'renewal' ? 'Verlenging' : 'Voor maandafsluiting'),
    dueUrg: !!p.due_urgent,
    aiRun: formatRelative(p.ai_run_at),
    aiSources: p.ai_sources_count || 0,
    aiSummary: p.ai_summary || '',
    filter: deriveFilter(p, fields),
    fields,
    // Renewal-only
    oldDealName: oldHsDeal?.dealname || null,
    oldDealStage: p.old_hubspot_deal_id ? 'Customer' : null,
    renBasis: p.renewal_basis || null,
    proposedFrom: formatDateShort(p.proposed_from),
    oldEnds: formatDateShort(p.old_ends),
    // Snapshot voor deal_owner-filter
    ownerId: p.deal_owner_id || null,
    ownerName: p.deal_owner_name || null,
    ownerEmail: p.deal_owner_email || null,
  }
}

function mapFieldProposal(fp, def) {
  const def_ = def || {}
  return {
    id: fp.id,                                              // klantbase_field_proposals.id (voor RPC)
    proposalId: fp.proposal_id,
    key: fp.field_key,
    status: fp.status,
    proposed: fp.user_amended_value ?? fp.proposed_value ?? '—',
    current: fp.current_value ?? null,
    srcKey: fp.src_key || 'hubspotDeal',
    reason: fp.reason || '',
    sources: fp.sources || [fp.src_key].filter(Boolean),
    sourceQuote: fp.source_quote || null,   // letterlijke passage uit de bron
    sourceDoc: fp.source_doc || null,       // bron-document label (bv. "LoA — art. 6.1")
    confidence: fp.confidence != null ? Number(fp.confidence) : null,
    // Veld-definitie metadata (UI rendering)
    label: def_.label || fp.field_key,
    group: def_.group_name || 'Overig',
    type: def_.field_type || 'text',
    req: !!def_.required,
    options: Array.isArray(def_.options) ? def_.options : [],
    xor: def_.xor_with || null,
    computed: def_.computed || null,
    uitleg: def_.uitleg || '',
  }
}

function deriveFilter(p, fields) {
  // 'urg'   = due_urgent + heeft pending velden
  // 'ready' = 0 pending velden
  // 'check' = ≥1 conflict / low-confidence (≥1 veld confidence<0.7)
  // 'hold'  = ai_sources_count=0 (LoA ontbreekt) of due_label bevat 'wacht'
  // default 'check'
  const pendingCount = fields.filter(f => f.status === 'pending').length
  const lowConf = fields.some(f => f.confidence != null && f.confidence < 0.7)
  if ((p.ai_sources_count ?? 0) === 0) return 'hold'
  if ((p.due_label || '').toLowerCase().includes('wacht')) return 'hold'
  if (pendingCount === 0) return 'ready'
  if (p.due_urgent && pendingCount > 0) return 'urg'
  if (lowConf) return 'check'
  return 'check'
}

function computeAvatar(name) {
  const cleaned = (name || '').trim()
  const init = cleaned
    ? cleaned.split(/\s+/).filter(Boolean).map(w => w[0]).slice(0, 2).join('').toUpperCase()
    : '?'
  // Deterministische avatar-kleur — 1..7
  let hash = 0
  for (const ch of cleaned) hash = (hash * 31 + ch.charCodeAt(0)) | 0
  const idx = (Math.abs(hash) % 7) + 1
  return { cls: `av-${idx}`, init }
}

const MONTHS_NL = ['jan', 'feb', 'mrt', 'apr', 'mei', 'jun', 'jul', 'aug', 'sep', 'okt', 'nov', 'dec']

function formatDateLong(iso) {
  if (!iso) return '—'
  const d = new Date(iso)
  if (isNaN(d.getTime())) return '—'
  return `${d.getDate().toString().padStart(2, '0')} ${MONTHS_NL[d.getMonth()]} ${d.getFullYear()}`
}

function formatDateShort(iso) {
  if (!iso) return '—'
  const d = new Date(iso)
  if (isNaN(d.getTime())) return '—'
  return `${String(d.getDate()).padStart(2, '0')}-${String(d.getMonth() + 1).padStart(2, '0')}-${d.getFullYear()}`
}

function formatRelative(iso) {
  if (!iso) return '—'
  const ms = Date.now() - new Date(iso).getTime()
  if (isNaN(ms) || ms < 0) return 'zojuist'
  const min = Math.floor(ms / 60000)
  if (min < 1) return 'zojuist'
  if (min < 60) return `${min} min geleden`
  const h = Math.floor(min / 60)
  if (h < 24) return `${h}u geleden`
  const days = Math.floor(h / 24)
  if (days < 7) return `${days}d geleden`
  const weeks = Math.floor(days / 7)
  return `${weeks}w geleden`
}
