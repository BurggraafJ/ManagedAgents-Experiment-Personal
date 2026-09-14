import { useCallback, useEffect, useMemo, useState } from 'react'
import { groupByAge, inferPseudoAudience } from '../lib/autodraft'
import { buildInboxRows, bucketOf, buildSentRows } from '../lib/postvakContract'
import { buildAwaitingMails } from '../lib/awaitingMails'
import { buildSentDrafts, buildMailMessagesById } from '../lib/inboxLists'

/* usePv2Pools — alle lijst-afleidingen voor Postvak variant 2.
 *
 * Review-ronde 1 (Jelle): de hoofdlijst is **1:1 het Outlook-postvak** —
 * élke mail die in de Inbox-root van mail_messages staat is zichtbaar, in
 * ontvangst-volgorde. Geen audience-uitfiltering ("boeit niet"-filter weg),
 * geen "al afgehandeld"-verberging: een mail verdwijnt alleen zoals in
 * Outlook zelf — doordat hij uit de Inbox-map gaat (mail-sync zet dan een
 * ander folder_path of is_deleted). Autodraft-data (categorie, drafts,
 * voorstellen) wordt op de Outlook-rij gemerged; alle functies blijven.
 * Uitzonderingen die Jelle zelf triggert blijven optimistisch: net-besliste
 * mails (actionedIds, Outlook volgt binnen 15 min) en gesnoozde mails. */

const PAGE = 25

export function usePv2Pools({
  mails, mailMessages, decisions, categories,
  ignoreRules, awaitingDismissed, hubspotCustomerEmails,
  awaitingReplyIndex, manualCategoryOverrides,
  categoryOverrides, actionedIds, flagOverrides,
  snoozedIds, bucketOverrides = new Map(),
  outlookDrafts = null,
  activeTab, filter, query, inboxSub = 'prio',
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

  // 1:1 Outlook-inbox: elke niet-verwijderde mail in de Inbox-root, in
  // ontvangst-volgorde. Eén implementatie voor desktop én mobiel — zie
  // lib/postvakContract.buildInboxRows; wijzig de regel dáár, niet hier.
  const inboxPool = useMemo(
    () => buildInboxRows(mailMessages, mails, { inferAudience: inferPseudoAudience }),
    [mails, mailMessages])

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

  const hideDone = useCallback(list => list.filter(m =>
    !actionedIds.has(m.mail_id) && !snoozedIds.has(m.mail_id)), [actionedIds, snoozedIds])

  // Prioriteit/Overige-splitsing (review-ronde 2): 1:1 Outlook blijft — niets
  // wordt verborgen — maar nieuwsbrieven/notificaties krijgen hun eigen
  // "Overige"-bak, net als Outlook's Prioriteit/Overige.
  //
  // De regel zelf staat sinds v1.202 in `lib/postvakContract.bucketOf`, zodat
  // desktop en mobiel er niet uit elkaar kunnen groeien — dezelfde afspraak als
  // bij `buildInboxRows`. Wijzig hem dáár, niet hier.
  const isOverig = useCallback(m =>
    bucketOf(m, { bucketOverrides, byId: mailMessagesById }) === 'overig',
    [bucketOverrides, mailMessagesById])
  const inboxCounts = useMemo(() => {
    const visible = hideDone(inboxPool)
    let prio = 0, overig = 0
    for (const m of visible) { if (isOverig(m)) overig++; else prio++ }
    return { prio, overig }
  }, [inboxPool, hideDone, isOverig])

  const tabPools = useMemo(() => ({
    'voor-jou': hideDone(inboxPool.filter(m => (inboxSub === 'overig' ? isOverig(m) : !isOverig(m)))),
    'pin': hideDone(inboxPool.filter(m => flaggedMailIds.has(m.mail_id))),
    'wachten-klant': awaitingMails.filter(m => m.pending_bucket === 'klant'),
    'wachten-algemeen': awaitingMails.filter(m => m.pending_bucket !== 'klant'),
    // Concepten = de échte Outlook Concepten-map (live via outlook-live EF);
    // zolang die nog laadt vallen we terug op de geplaatste-drafts-lijst.
    'drafts': outlookDrafts ?? sentDraftsList,
    // Verzonden staat bewust NIET in de tabs-kolom maar in het overloopmenu
    // van de lijstkop: Prioriteit/Overige is de primaire schakelaar, Verzonden
    // is een uitstapje (v1.202, brief prio-overige-swipe punt 2).
    'sent': buildSentRows(mailMessages).map(m => ({ ...m, __sent: true })),
    'logs': [],
  }), [inboxPool, awaitingMails, sentDraftsList, outlookDrafts, flaggedMailIds, hideDone, isOverig,
       inboxSub, mailMessages])

  const tabCounts = useMemo(() => ({
    'voor-jou': inboxCounts.prio,
    'pin': tabPools['pin'].length,
    'wachten-klant': tabPools['wachten-klant'].length,
    'wachten-algemeen': tabPools['wachten-algemeen'].length,
    'drafts': tabPools['drafts'].length,
    'sent': null,
    'logs': null,
  }), [tabPools, inboxCounts])

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

  const skipMails = useMemo(() => inboxPool.filter(m => m.suggested_action === 'skip'), [inboxPool])

  return {
    inboxPool, inboxCounts, awaitingMails, sentDraftsList, flaggedMailIds, skipMails,
    dismissedConvIds, customerEmails, categoriesByKey, catOf,
    tabCounts, catFilters, flat, visibleFlat, groups,
    hasMore: flat.length > visibleCount,
    loadMore: () => setVisibleCount(c => c + PAGE),
    threadCounts, mailMessagesById,
  }
}
