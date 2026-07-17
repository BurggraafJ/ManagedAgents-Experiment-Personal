import { useCallback, useEffect, useMemo, useState } from 'react'
import { groupByAge, INBOX_ROOT_RE, inferPseudoAudience } from '../lib/autodraft'
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

// Outlook-rij → mail-shape voor rijen zonder (actieve) autodraft-rij.
// Categorie/audience uit een eerdere autodraft-rij als die bestaat.
function mmShape(m, ad) {
  const inferredAudience = ad?.audience || inferPseudoAudience(m.from_email)
  const noDraft = !ad || !(ad.status === 'pending' || ad.status === 'amended')
  return {
    __no_draft_yet: !ad,
    mail_id: m.id,
    conversation_id: m.conversation_id,
    received_at: m.received_at,
    from_email: m.from_email,
    from_name: m.from_name,
    to_recipients: m.to_recipients,
    cc_recipients: m.cc_recipients,
    subject: m.subject,
    body_preview: m.body_preview,
    has_attachments: m.has_attachments,
    category_key: ad?.category_key || '',
    audience: inferredAudience,
    suggested_action: noDraft ? (!ad && inferredAudience === 'not_for_you' ? 'skip' : null) : ad.suggested_action,
    suggested_reasoning: ad?.suggested_reasoning || null,
    confidence: ad?.confidence || 0,
    status: 'pending',
    draft_body: '',
    draft_subject: m.subject ? `RE: ${m.subject}` : '',
    draft_variants: [],
    target_folder: ad?.target_folder || null,
    rag_context: ad?.rag_context || null,
    id: ad?.id,
  }
}

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
  // ontvangst-volgorde. Skill-rij (pending/amended) levert de volle shape
  // (drafts + voorstellen); anders de Outlook-rij zelf met gemergde
  // autodraft-metadata (categorie blijft ook ná een beslissing zichtbaar).
  const inboxPool = useMemo(() => {
    const byId = new Map((mails || []).map(m => [m.mail_id, m]))
    const out = []
    for (const m of (mailMessages || [])) {
      if (!m || m.is_deleted) continue
      if (!INBOX_ROOT_RE.test(m.folder_path || '')) continue
      const ad = byId.get(m.id)
      if (ad && (ad.status === 'pending' || ad.status === 'amended')) out.push(ad)
      else out.push(mmShape(m, ad))
    }
    return out.sort((a, b) => new Date(b.received_at) - new Date(a.received_at))
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

  const hideDone = useCallback(list => list.filter(m =>
    !actionedIds.has(m.mail_id) && !snoozedIds.has(m.mail_id)), [actionedIds, snoozedIds])

  // Prioriteit/Overige-splitsing (review-ronde 2): 1:1 Outlook blijft — niets
  // wordt verborgen — maar nieuwsbrieven/notificaties (audience not_for_you)
  // krijgen hun eigen "Overige"-bak, net als Outlook's Prioriteit/Overige.
  // Volgorde: handmatige verplaatsing (postvak_bucket_overrides) wint, dan
  // Outlook's eigen vlag (mail_messages.inference_classification === 'other',
  // gesynct door mail-sync-etl-v2 v3.4 — sleept Jelle een mail in Outlook naar
  // Overige, dan volgt het Postvak vanzelf), dan AI-audience als fallback.
  const isOverig = useCallback(m => {
    const ov = bucketOverrides.get(m.mail_id)
    if (ov) return ov === 'overig'
    if (mailMessagesById.get(m.mail_id)?.inference_classification === 'other') return true
    return m.audience === 'not_for_you'
  }, [bucketOverrides, mailMessagesById])
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
    'logs': [],
  }), [inboxPool, awaitingMails, sentDraftsList, outlookDrafts, flaggedMailIds, hideDone, isOverig, inboxSub])

  const tabCounts = useMemo(() => ({
    'voor-jou': inboxCounts.prio,
    'pin': tabPools['pin'].length,
    'wachten-klant': tabPools['wachten-klant'].length,
    'wachten-algemeen': tabPools['wachten-algemeen'].length,
    'drafts': tabPools['drafts'].length,
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
