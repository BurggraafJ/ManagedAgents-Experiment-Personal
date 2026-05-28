import { useState, useEffect, useCallback, useRef } from 'react'
import { supabase, createRealtimeChannel } from '../lib/supabase'

/**
 * useAutoDraft — alle data voor de Postvak / AutoDraft-view.
 *
 * Bundelt mail_messages (truth-of-source), autodraft_* tabellen, awaiting_dismissed
 * en hubspot_customer_emails. Levert ook agent_config-rij voor auto-draft-instructies.
 *
 * V1.49 — stale-while-revalidate via localStorage. Bij mount hydraten we
 * direct vanuit de vorige sessie zodat het Postvak meteen zichtbaar is
 * (geen "laden…"-scherm); de fetch loopt parallel en overschrijft zodra
 * verse data binnen is. Cache max 7 dagen oud, anders wegrgooien.
 *
 * Returns:
 *  - mails / decisions / categories / categoryProposals / folders / lessons /
 *    lessonProposals / mailMessages / ignoreRules / awaitingDismissed /
 *    hubspotCustomerEmails / agentInstructions / awaitingReplyIndex /
 *    manualCategoryOverrides
 *  - loading / error / refresh()
 */
const POLL_MS = 2 * 60 * 1000
const REALTIME_DEBOUNCE_MS = 1500

// V1.49 — Stale-while-revalidate cache
const CACHE_KEY = 'useAutoDraft:v1'
const CACHE_MAX_AGE_MS = 7 * 24 * 3600 * 1000

function readCache() {
  try {
    if (typeof localStorage === 'undefined') return null
    const raw = localStorage.getItem(CACHE_KEY)
    if (!raw) return null
    const obj = JSON.parse(raw)
    if (!obj || typeof obj !== 'object') return null
    if (!obj.cachedAt || Date.now() - obj.cachedAt > CACHE_MAX_AGE_MS) return null
    return obj.data || null
  } catch { return null }
}

// V1.51 — strip de zware body-velden uit autodraft_mails vóór cache-write.
// Bodies (body_html / body_text) maken ~80% van de cache-grootte uit (300×
// ~4KB) terwijl ze in de lijst niet getoond worden — MailDetail fetcht
// zelf opnieuw via mail_messages bij selectie. Cache wordt zo ~3× kleiner
// = sneller parsen bij hydrate + minder kans op QuotaExceeded.
function slimMails(mails) {
  if (!Array.isArray(mails)) return mails
  return mails.map(m => {
    if (!m) return m
    const { body_html, body_text, ...rest } = m
    return rest
  })
}

function writeCache(data) {
  try {
    if (typeof localStorage === 'undefined') return
    const slim = { ...data, mails: slimMails(data.mails) }
    localStorage.setItem(CACHE_KEY, JSON.stringify({ cachedAt: Date.now(), data: slim }))
  } catch {
    // QuotaExceededError of disabled storage — silent fallback. Cache is
    // optimisatie, geen correctheid-vereiste.
  }
}

export function useAutoDraft() {
  // Lees cache één keer per hook-mount via useRef zodat alle lazy-init's
  // dezelfde snapshot zien.
  const cachedRef = useRef(undefined)
  if (cachedRef.current === undefined) cachedRef.current = readCache() || {}
  const cached = cachedRef.current

  const [mails, setMails] = useState(() => cached.mails || [])
  const [decisions, setDecisions] = useState(() => cached.decisions || [])
  const [categories, setCategories] = useState(() => cached.categories || [])
  const [categoryProposals, setCategoryProposals] = useState(() => cached.categoryProposals || [])
  const [folders, setFolders] = useState(() => cached.folders || [])
  const [lessons, setLessons] = useState(() => cached.lessons || [])
  const [lessonProposals, setLessonProposals] = useState(() => cached.lessonProposals || [])
  const [mailMessages, setMailMessages] = useState(() => cached.mailMessages || [])
  const [ignoreRules, setIgnoreRules] = useState(() => cached.ignoreRules || [])
  const [awaitingDismissed, setAwaitingDismissed] = useState(() => cached.awaitingDismissed || [])
  const [hubspotCustomerEmails, setHubspotCustomerEmails] = useState(() => cached.hubspotCustomerEmails || [])
  // 2026-05-27 — lichte index van inkomende mails (incl. is_deleted) voor
  // robuuste In-Afwachting reply-detectie (zie lib/autodraft buildAwaitingReplyIndex).
  const [awaitingReplyIndex, setAwaitingReplyIndex] = useState(() => cached.awaitingReplyIndex || [])
  // 2026-05-27 — handmatige categorie-overrides (persist, ook voor mails zonder
  // autodraft_mails-row zoals uitgaande/awaiting mails).
  const [manualCategoryOverrides, setManualCategoryOverrides] = useState(() => cached.manualCategoryOverrides || [])
  const [agentInstructions, setAgentInstructions] = useState(() => cached.agentInstructions || [])
  // loading=false zodra we cache hebben — UI toont meteen oude data terwijl
  // de fetch op de achtergrond loopt. Alleen bij een lege/expired cache zien
  // we het traditionele 'laden…'-scherm.
  const [loading, setLoading] = useState(() => !(cached.mails && cached.mails.length > 0))
  const [error, setError] = useState(null)
  const debounceRef = useRef(null)

  const fetchAll = useCallback(async () => {
    const safeQ = (q) => Promise.resolve(q).then(r => r).catch(e => ({ data: [], error: e }))
    try {
      const [m, d, c, cp, fo, le, lp, mm, ir, ad, hc, ai, ari, mco] = await Promise.all([
        safeQ(supabase.from('autodraft_mails').select('*').order('received_at', { ascending: false }).limit(300)),
        safeQ(supabase.from('autodraft_decisions').select('*').order('decided_at', { ascending: false }).limit(300)),
        safeQ(supabase.from('autodraft_categories').select('*').order('sort_order')),
        safeQ(supabase.from('autodraft_category_proposals').select('*').eq('status', 'pending').order('created_at', { ascending: false }).limit(50)),
        safeQ(supabase.from('autodraft_folders').select('*').order('full_path')),
        safeQ(supabase.from('autodraft_style_lessons').select('*').eq('active', true).order('created_at', { ascending: false }).limit(100)),
        safeQ(supabase.from('autodraft_lesson_proposals').select('*').eq('status', 'pending').order('created_at', { ascending: false }).limit(50)),
        safeQ(supabase.from('mail_messages')
          .select('id,conversation_id,received_at,from_email,from_name,to_recipients,cc_recipients,bcc_recipients,subject,body_preview,has_attachments,folder_id,folder_path,is_read,is_from_me,is_deleted,synced_at,body_truncated,flag_status,is_calendar_invite,flagged_as_spam,is_pinned,pinned_at')
          .eq('is_deleted', false)
          .order('received_at', { ascending: false }).limit(500)),
        safeQ(supabase.from('autodraft_ignore_rules').select('*').eq('active', true).order('created_at', { ascending: false }).limit(200)),
        safeQ(supabase.from('awaiting_dismissed').select('conversation_id,dismissed_at')),
        safeQ(supabase.from('hubspot_customer_emails').select('email')),
        safeQ(supabase.from('agent_config')
          .select('agent_name,config_key,config_value,updated_at')
          .in('config_key', ['custom_instructions', 'reminder_style'])),
        // 2026-05-27 — inbound-index voor reply-detectie: GEEN is_deleted-filter
        // (verwerkte/verplaatste replies tellen ook), laatste 40 dagen, lichte velden.
        safeQ(supabase.from('mail_messages')
          .select('conversation_id,from_email,subject,received_at')
          .eq('is_from_me', false)
          .gt('received_at', new Date(Date.now() - 40 * 24 * 3600 * 1000).toISOString())
          .order('received_at', { ascending: false }).limit(2000)),
        safeQ(supabase.from('autodraft_mail_category_overrides').select('mail_id,category_key').limit(2000)),
      ])
      const fresh = {
        mails: m.data || [],
        decisions: d.data || [],
        categories: c.data || [],
        categoryProposals: cp.data || [],
        folders: fo.data || [],
        lessons: le.data || [],
        lessonProposals: lp.data || [],
        mailMessages: mm.data || [],
        ignoreRules: ir.data || [],
        awaitingDismissed: ad.data || [],
        hubspotCustomerEmails: hc.data || [],
        agentInstructions: ai.data || [],
        awaitingReplyIndex: ari.data || [],
        manualCategoryOverrides: mco.data || [],
      }
      setMails(fresh.mails)
      setDecisions(fresh.decisions)
      setCategories(fresh.categories)
      setCategoryProposals(fresh.categoryProposals)
      setFolders(fresh.folders)
      setLessons(fresh.lessons)
      setLessonProposals(fresh.lessonProposals)
      setMailMessages(fresh.mailMessages)
      setIgnoreRules(fresh.ignoreRules)
      setAwaitingDismissed(fresh.awaitingDismissed)
      setHubspotCustomerEmails(fresh.hubspotCustomerEmails)
      setAgentInstructions(fresh.agentInstructions)
      setAwaitingReplyIndex(fresh.awaitingReplyIndex)
      setManualCategoryOverrides(fresh.manualCategoryOverrides)
      setError(null)
      writeCache(fresh)
    } catch (e) {
      setError(e.message || String(e))
    } finally {
      setLoading(false)
    }
  }, [])

  const scheduleRefetch = useCallback(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current)
    debounceRef.current = setTimeout(fetchAll, REALTIME_DEBOUNCE_MS)
  }, [fetchAll])

  useEffect(() => {
    fetchAll()
    const id = setInterval(fetchAll, POLL_MS)
    return () => clearInterval(id)
  }, [fetchAll])

  useEffect(() => {
    const channel = createRealtimeChannel('autodraft-live')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'autodraft_mails' }, scheduleRefetch)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'autodraft_decisions' }, scheduleRefetch)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'autodraft_categories' }, scheduleRefetch)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'autodraft_category_proposals' }, scheduleRefetch)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'autodraft_folders' }, scheduleRefetch)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'autodraft_style_lessons' }, scheduleRefetch)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'autodraft_lesson_proposals' }, scheduleRefetch)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'mail_messages' }, scheduleRefetch)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'autodraft_ignore_rules' }, scheduleRefetch)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'awaiting_dismissed' }, scheduleRefetch)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'agent_config' }, scheduleRefetch)
      .subscribe()
    return () => {
      supabase.removeChannel(channel)
      if (debounceRef.current) clearTimeout(debounceRef.current)
    }
  }, [scheduleRefetch])

  return {
    mails,
    decisions,
    categories,
    categoryProposals,
    folders,
    lessons,
    lessonProposals,
    mailMessages,
    ignoreRules,
    awaitingDismissed,
    hubspotCustomerEmails,
    agentInstructions,
    awaitingReplyIndex,
    manualCategoryOverrides,
    loading,
    error,
    refresh: fetchAll,
  }
}
