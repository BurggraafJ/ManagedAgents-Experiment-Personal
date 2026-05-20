import { useState, useEffect } from 'react'
import { supabase } from '../lib/supabase'

// Objects-mode timeline. Gebruikt dezelfde RPCs als Postvak CompanyTimeline /
// SenderTimeline — get_company_mails/events/notes voor company,
// get_sender_history/events + get_contact_notes_full voor contact.
//
// Geen RAG-detour — die misste relationele data en gaf 0 hits voor entities
// zonder embeddings. Deze versie laat ALTIJD zien wat er in de operationele
// data staat, ongeacht of het ge-embed is.
export function useRagV2Timeline(entity) {
  const [items, setItems] = useState([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState(null)
  const [counts, setCounts] = useState({ mail: 0, event: 0, meeting: 0, note: 0 })

  useEffect(() => {
    if (!entity) { setItems([]); setCounts({ mail: 0, event: 0, meeting: 0, note: 0 }); return }
    let cancelled = false
    setLoading(true); setError(null)

    if (entity.kind === 'company') {
      loadCompanyTimeline(entity.company_id).then((res) => {
        if (cancelled) return
        if (res.error) setError(res.error)
        setItems(res.items)
        setCounts(res.counts)
        setLoading(false)
      })
    } else if (entity.kind === 'contact') {
      const email = entity.email
      const contactId = entity.hubspot_contact_id || entity.contact_id
      loadContactTimeline(email, contactId).then((res) => {
        if (cancelled) return
        if (res.error) setError(res.error)
        setItems(res.items)
        setCounts(res.counts)
        setLoading(false)
      })
    } else {
      setItems([]); setLoading(false)
    }
    return () => { cancelled = true }
  }, [entity])

  return { items, loading, error, counts }
}

async function loadCompanyTimeline(companyId) {
  if (!companyId) return { items: [], counts: { mail: 0, event: 0, meeting: 0, note: 0 }, error: null }
  try {
    const [mails, events, notes] = await Promise.all([
      supabase.rpc('get_company_mails', { p_hubspot_company_id: companyId, p_exclude_conversation_id: null }),
      supabase.rpc('get_company_events', { p_hubspot_company_id: companyId, p_lookback_days: 730 }),
      supabase.rpc('get_company_notes', { p_hubspot_company_id: companyId, p_lookback_days: 730 }),
    ])
    const firstErr = mails.error?.message || events.error?.message || notes.error?.message || null
    return mergeAndSort(mails.data, events.data, notes.data, firstErr)
  } catch (e) {
    return { items: [], counts: { mail: 0, event: 0, meeting: 0, note: 0 }, error: e.message || String(e) }
  }
}

async function loadContactTimeline(email, contactId) {
  if (!email) return { items: [], counts: { mail: 0, event: 0, meeting: 0, note: 0 }, error: null }
  try {
    const [mails, events, notes] = await Promise.all([
      supabase.rpc('get_sender_history', { p_from_email: email, p_exclude_conversation_id: null }),
      supabase.rpc('get_sender_events', { p_from_email: email, p_lookback_days: 730 }),
      contactId
        ? supabase.rpc('get_contact_notes_full', { p_hubspot_contact_id: contactId, p_lookback_days: 730 })
        : Promise.resolve({ data: [], error: null }),
    ])
    const firstErr = mails.error?.message || events.error?.message || notes.error?.message || null
    return mergeAndSort(mails.data, events.data, notes.data, firstErr)
  } catch (e) {
    return { items: [], counts: { mail: 0, event: 0, meeting: 0, note: 0 }, error: e.message || String(e) }
  }
}

function mergeAndSort(mailsData, eventsData, notesData, error) {
  const mails = Array.isArray(mailsData) ? mailsData : []
  const events = Array.isArray(eventsData) ? eventsData : []
  const notes = Array.isArray(notesData) ? notesData : []

  const mailItems = mails
    .filter(t => !t.latest_is_calendar_invite)
    .map(t => ({
      kind: 'mail',
      key: `m-${t.conversation_id}`,
      title: t.subject || t.latest_subject || '(geen onderwerp)',
      snip: t.latest_body_preview || t.body_preview || null,
      ts: t.latest_received_at,
      who: t.from_name ? `van ${t.from_name}` : (t.from_email ? `van ${t.from_email}` : null),
      direction: t.latest_is_outbound ? 'outbound' : 'inbound',
      meta: {
        thread_count: t.thread_count,
        conversation_id: t.conversation_id,
        latest_message_id: t.latest_message_id || t.id,
        from_email: t.from_email,
        to_emails: t.to_emails,
      },
    }))

  const now = Date.now()
  const eventItems = events.map(e => {
    const future = e.start_time && new Date(e.start_time).getTime() > now
    const attendeeNames = (e.attendees || []).map(a => a.name || a.email).filter(Boolean)
    return {
      kind: future ? 'agenda' : 'meeting',
      key: `e-${e.event_id}`,
      title: e.subject || e.title || '(meeting)',
      snip: e.location || e.body_preview || null,
      ts: e.start_time,
      who: attendeeNames.slice(0, 3).join(', ') || null,
      meta: {
        event_id: e.event_id,
        location: e.location,
        body_preview: e.body_preview,
        attendees: attendeeNames,
        end_time: e.end_time,
      },
    }
  })

  const noteItems = notes.map(n => ({
    kind: 'note',
    key: `n-${n.engagement_id}`,
    title: n.title || (n.body_preview || n.body_text || '').slice(0, 80) || 'HubSpot-notitie',
    snip: n.body_preview || n.body_text || null,
    ts: n.hs_timestamp,
    who: n.owner_name ? `door ${n.owner_name}` : null,
    meta: {
      engagement_id: n.engagement_id,
      body_text: n.body_text,
      body_truncated: n.body_truncated,
    },
  }))

  const all = [...mailItems, ...eventItems, ...noteItems]
    .filter(it => it.ts)
    .sort((a, b) => new Date(b.ts) - new Date(a.ts))

  const counts = {
    mail: mailItems.length,
    event: eventItems.filter(e => e.kind === 'agenda').length,
    meeting: eventItems.filter(e => e.kind === 'meeting').length,
    note: noteItems.length,
  }
  return { items: all, counts, error }
}
