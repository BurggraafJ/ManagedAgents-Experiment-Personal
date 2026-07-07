import { useCallback, useEffect, useMemo, useState } from 'react'
import { groupByAge } from '../lib/autodraft'
import { buildAwaitingMails } from '../lib/awaitingMails'
import {
  buildPseudoPending, buildSentDrafts, partitionHandled,
  buildMailMessagesById, buildConversationByMyReplyAfter,
} from '../lib/inboxLists'

/* usePv2Pools — alle lijst-afleidingen voor Postvak variant 2, met exact
 * dezelfde regels als variant 1 (InboxPanel + AutoDraftView): pending =
 * skill + pseudo, awaiting-split op pending_bucket, handled verborgen,
 * pin = gevlagde mails, concepten = geplaatste drafts. Daarbovenop de
 * variant 2-tabs, categorie-filter, zoekfilter, daggroepen en paging. */

const PAGE = 25

export function usePv2Pools({
  mails, mailMessages, decisions, categories,
  ignoreRules, awaitingDismissed, hubspotCustomerEmails,
  awaitingReplyIndex, manualCategoryOverrides,
  categoryOverrides, actionedIds, flagOverrides,
  snoozedIds,
  activeTab, filter, query,
}) {
  const dismissedConvIds = useMemo(() =>
    new Set((awaitingDismissed || []).map(d => d.conversation_id)), [awaitingDismissed])
  const customerEmails = useMemo(() =>
    new Set((hubspotCustomerEmails || []).map(c => (c.email || '').toLowerCase())), [hubspotCustomerEmails])
  const manualCatMap = useMemo(() => {
    const m = new Map()
    for (const r of (manualCategoryOverrides || [])) if (r?.mail_id) m.set(r.mail_id, r.category_key || '')
    return m
  }, [manualCategoryOverrides])
  const categoriesByKey = useMemo(() =>
    new Map((categories || []).map(c => [c.category_key, c])), [categories])

  const catOf = useCallback(it => {
    if (categoryOverrides.has(it.mail_id)) return categoryOverrides.get(it.mail_id)
    if (manualCatMap.has(it.mail_id)) return manualCatMap.get(it.mail_id)
    return it.category_key || ''
  }, [categoryOverrides, manualCatMap])

  // Pending: skill-rijen + pseudo-pending (mail-sync kent 'm, skill nog niet).
  const pending = useMemo(() => {
    const skill = (mails || []).filter(m => m.status === 'pending' || m.status === 'amended')
    const pseudo = buildPseudoPending(mailMessages, mails)
    return [...skill, ...pseudo].sort((a, b) => new Date(b.received_at) - new Date(a.received_at))
  }, [mails, mailMessages])

  const subjectMatchesIgnore = useCallback(subject => {
    if (!subject) return false
    const needles = (ignoreRules || [])
      .filter(r => r.active !== false && r.pattern_type === 'subject_keyword' && r.pattern_value)
      .map(r => String(r.pattern_value).toLowerCase().trim())
    if (needles.length === 0) return false
    const s = String(subject).toLowerCase()
    return needles.some(n => s.includes(n))
  }, [ignoreRules])

  const awaitingMails = useMemo(() =>
    buildAwaitingMails(mailMessages, {
      dismissedConvIds, customerEmails, subjectMatchesIgnore,
      awaitingReplyRows: awaitingReplyIndex, allAutodraftMails: mails,
      categoryOverrides, manualCategoryOverrides: manualCatMap,
    }),
    [mailMessages, mails, dismissedConvIds, customerEmails, subjectMatchesIgnore,
     awaitingReplyIndex, categoryOverrides, manualCatMap])

  const flaggedMailIds = useMemo(() => {
    const s = new Set()
    for (const m of (mailMessages || [])) {
      if (m.is_pinned === true || m.flag_status === 'flagged') s.add(m.id)
    }
    for (const [id, entry] of flagOverrides.entries()) {
      if (entry?.val) s.add(id); else s.delete(id)
    }
    return s
  }, [mailMessages, flagOverrides])

  const sentDraftsList = useMemo(() =>
    buildSentDrafts(decisions, mails, mailMessages), [decisions, mails, mailMessages])

  const mailMessagesById = useMemo(() => buildMailMessagesById(mailMessages), [mailMessages])
  const conversationByMyReplyAfter = useMemo(() =>
    buildConversationByMyReplyAfter(mailMessages), [mailMessages])
  const { active } = useMemo(() =>
    partitionHandled(pending, mailMessagesById, conversationByMyReplyAfter),
    [pending, mailMessagesById, conversationByMyReplyAfter])

  const hideDone = useCallback(list => list.filter(m =>
    !actionedIds.has(m.mail_id) && !snoozedIds.has(m.mail_id)), [actionedIds, snoozedIds])

  const tabPools = useMemo(() => ({
    'voor-jou': hideDone(active.filter(m => m.audience === 'for_you')),
    'pin': hideDone(pending.filter(m => flaggedMailIds.has(m.mail_id))),
    'wachten-klant': awaitingMails.filter(m => m.pending_bucket === 'klant'),
    'wachten-algemeen': awaitingMails.filter(m => m.pending_bucket !== 'klant'),
    'niet-jou': hideDone(active.filter(m => m.audience === 'not_for_you')),
    'drafts': sentDraftsList,
    'logs': [],
  }), [active, pending, awaitingMails, sentDraftsList, flaggedMailIds, hideDone])

  const tabCounts = useMemo(() => ({
    'voor-jou': tabPools['voor-jou'].length,
    'pin': tabPools['pin'].length,
    'wachten-klant': tabPools['wachten-klant'].length,
    'wachten-algemeen': tabPools['wachten-algemeen'].length,
    'niet-jou': tabPools['niet-jou'].length,
    'drafts': tabPools['drafts'].length,
    'logs': null,
  }), [tabPools])

  const tabPool = tabPools[activeTab] || []

  // Categorie-filters met tellers binnen de actieve tab.
  const catFilters = useMemo(() => {
    const counts = new Map()
    for (const m of tabPool) {
      const k = catOf(m) || ''
      counts.set(k, (counts.get(k) || 0) + 1)
    }
    const out = [{ id: 'all', label: 'Alles', count: tabPool.length, accent: null }]
    for (const c of (categories || [])) {
      const n = counts.get(c.category_key) || 0
      if (n > 0) out.push({ id: c.category_key, label: c.label, count: n, accent: c.color || null })
    }
    const uncat = counts.get('') || 0
    if (uncat > 0) out.push({ id: '__none', label: 'Zonder categorie', count: uncat, accent: null })
    return out
  }, [tabPool, categories, catOf])

  const filtered = useMemo(() => {
    const q = (query || '').trim().toLowerCase()
    return tabPool.filter(m => {
      if (filter !== 'all') {
        const k = catOf(m) || ''
        if (filter === '__none' ? k !== '' : k !== filter) return false
      }
      if (!q) return true
      return (m.subject || '').toLowerCase().includes(q) ||
             (m.from_email || '').toLowerCase().includes(q) ||
             (m.from_name || '').toLowerCase().includes(q) ||
             (m.body_preview || '').toLowerCase().includes(q)
    })
  }, [tabPool, filter, query, catOf])

  // Daggroepen (Vandaag/Gisteren/weekdag/…) + paging.
  const [visibleCount, setVisibleCount] = useState(PAGE)
  const resetKey = `${activeTab}|${filter}|${query}`
  useEffect(() => { setVisibleCount(PAGE) }, [resetKey])
  const flat = filtered
  const visibleFlat = useMemo(() => flat.slice(0, visibleCount), [flat, visibleCount])
  const groups = useMemo(() => {
    const b = groupByAge(visibleFlat)
    return (b.__order || []).map(day => ({ day, items: b[day] }))
  }, [visibleFlat])

  // Thread-tellers: wat er echt zichtbaar wordt bij uitklappen (variant 1 V1.49).
  const threadCounts = useMemo(() => {
    const mainIds = new Set(flat.map(m => m.mail_id))
    const memberCountByConv = new Map()
    for (const x of (mailMessages || [])) {
      if (!x?.conversation_id || mainIds.has(x.id)) continue
      memberCountByConv.set(x.conversation_id, (memberCountByConv.get(x.conversation_id) || 0) + 1)
    }
    const out = new Map()
    for (const main of flat) {
      if (!main.conversation_id) continue
      const members = memberCountByConv.get(main.conversation_id) || 0
      if (members > 0) out.set(main.conversation_id, 1 + members)
    }
    return out
  }, [flat, mailMessages])

  const skipMails = useMemo(() => pending.filter(m => m.suggested_action === 'skip'), [pending])

  return {
    pending, awaitingMails, sentDraftsList, flaggedMailIds, skipMails,
    dismissedConvIds, customerEmails, categoriesByKey, catOf,
    tabCounts, catFilters, flat, visibleFlat, groups,
    hasMore: flat.length > visibleCount,
    loadMore: () => setVisibleCount(c => c + PAGE),
    threadCounts, mailMessagesById,
  }
}
