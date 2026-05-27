import { useState, useEffect, useCallback, useRef } from 'react'
import { supabase, createRealtimeChannel } from '../lib/supabase'

/**
 * useAutoDraft — alle data voor de Postvak / AutoDraft-view.
 *
 * Bundelt mail_messages (truth-of-source), autodraft_* tabellen, awaiting_dismissed
 * en hubspot_customer_emails. Levert ook agent_config-rij voor auto-draft-instructies.
 *
 * Returns:
 *  - mails                       autodraft_mails (laatste 300)
 *  - decisions                   autodraft_decisions (laatste 300)
 *  - categories                  autodraft_categories
 *  - categoryProposals           autodraft_category_proposals (pending)
 *  - folders                     autodraft_folders
 *  - lessons                     autodraft_style_lessons (active)
 *  - lessonProposals             autodraft_lesson_proposals (pending)
 *  - mailMessages                mail_messages light-select, laatste 500
 *  - ignoreRules                 autodraft_ignore_rules (active)
 *  - awaitingDismissed           awaiting_dismissed
 *  - hubspotCustomerEmails       hubspot_customer_emails (set voor klant-detectie)
 *  - agentInstructions           agent_config rows met config_key in (custom_instructions, reminder_style)
 *  - loading / error / refresh()
 */
const POLL_MS = 2 * 60 * 1000
const REALTIME_DEBOUNCE_MS = 1500

export function useAutoDraft() {
  const [mails, setMails] = useState([])
  const [decisions, setDecisions] = useState([])
  const [categories, setCategories] = useState([])
  const [categoryProposals, setCategoryProposals] = useState([])
  const [folders, setFolders] = useState([])
  const [lessons, setLessons] = useState([])
  const [lessonProposals, setLessonProposals] = useState([])
  const [mailMessages, setMailMessages] = useState([])
  const [ignoreRules, setIgnoreRules] = useState([])
  const [awaitingDismissed, setAwaitingDismissed] = useState([])
  const [hubspotCustomerEmails, setHubspotCustomerEmails] = useState([])
  // 2026-05-27 — lichte index van inkomende mails (incl. is_deleted) voor
  // robuuste In-Afwachting reply-detectie (zie lib/autodraft buildAwaitingReplyIndex).
  const [awaitingReplyIndex, setAwaitingReplyIndex] = useState([])
  // 2026-05-27 — handmatige categorie-overrides (persist, ook voor mails zonder
  // autodraft_mails-row zoals uitgaande/awaiting mails).
  const [manualCategoryOverrides, setManualCategoryOverrides] = useState([])
  const [agentInstructions, setAgentInstructions] = useState([])
  const [loading, setLoading] = useState(true)
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
      setMails(m.data || [])
      setDecisions(d.data || [])
      setCategories(c.data || [])
      setCategoryProposals(cp.data || [])
      setFolders(fo.data || [])
      setLessons(le.data || [])
      setLessonProposals(lp.data || [])
      setMailMessages(mm.data || [])
      setIgnoreRules(ir.data || [])
      setAwaitingDismissed(ad.data || [])
      setHubspotCustomerEmails(hc.data || [])
      setAgentInstructions(ai.data || [])
      setAwaitingReplyIndex(ari.data || [])
      setManualCategoryOverrides(mco.data || [])
      setError(null)
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
