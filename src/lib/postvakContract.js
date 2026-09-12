/**
 * postvakContract — F0 shared list/detail field contract for Postvak
 * (desktop Postvak2 + mobile MobilePostvak).
 *
 * Product lock 2026-09-12: Postvak = exact Outlook copy for the mailbox.
 * This module is the single source of truth for *field shapes* and Inbox-root
 * matching. It does NOT yet implement folder-tree UI or pin-to-top sort
 * (see 10-postvak-infra/OUTLOOK-PARITY-RESEARCH.md).
 *
 * Overlay fields from AutoDraft (audience, drafts, …) decorate a row; they
 * must not gate Outlook folder membership.
 */

/** Inbox root folder_path (NL + EN). Subfolders like Inbox/Sales do NOT match. */
export const INBOX_ROOT_RE = /^\s*(Inbox|Postvak[\s-]?IN)\s*$/i

/** Canonical list-row field names (mail_messages + overlays). */
export const LIST_FIELDS = Object.freeze([
  'mail_id',
  'conversation_id',
  'received_at',
  'from_name',
  'from_email',
  'to_recipients',
  'cc_recipients',
  'subject',
  'body_preview',
  'has_attachments',
  'is_read',
  'folder_path',
  'is_pinned',
  'pinned_at',
  'flag_status',
  'inference_classification',
  // Autodraft overlay (nullable)
  'category_key',
  'audience',
  'suggested_action',
  'suggested_reasoning',
  'confidence',
  'status',
  'draft_body',
  'draft_subject',
  'draft_variants',
  'target_folder',
  'rag_context',
  'id',
])

/**
 * Columns selected for mail_messages list fetches (no body_html/body_text).
 * Keep in sync with useAutoDraft list select.
 */
export const MAIL_LIST_SELECT = [
  'id', 'conversation_id', 'received_at', 'from_email', 'from_name',
  'to_recipients', 'cc_recipients', 'bcc_recipients', 'subject', 'body_preview',
  'has_attachments', 'folder_id', 'folder_path', 'is_read', 'is_from_me',
  'is_deleted', 'synced_at', 'body_truncated', 'flag_status', 'is_calendar_invite',
  'flagged_as_spam', 'is_pinned', 'pinned_at', 'inference_classification',
].join(',')

/** Tab / segment sources — documentation + future routing. */
export const TAB_SOURCES = Object.freeze({
  inbox: 'mail_messages:inbox-root',
  sent: 'mail_messages:is_from_me',
  drafts: 'outlook-live:drafts|fallback:placed-decisions',
  pin: 'mail_messages:is_pinned (not flag_status)',
  folder: 'mail_folders.tree → mail_messages.folder_id',
})

/**
 * Target sort for Outlook sticky pins (F4). F0 does not change sort behaviour
 * in callers yet — document only.
 */
export function compareOutlookListOrder(a, b) {
  const ap = a?.is_pinned === true ? 1 : 0
  const bp = b?.is_pinned === true ? 1 : 0
  if (ap !== bp) return bp - ap
  if (ap && bp) {
    const at = a?.pinned_at ? new Date(a.pinned_at).getTime() : 0
    const bt = b?.pinned_at ? new Date(b.pinned_at).getTime() : 0
    if (at !== bt) return bt - at
  }
  return new Date(b?.received_at || 0) - new Date(a?.received_at || 0)
}

export function isInboxRoot(folderPath) {
  return INBOX_ROOT_RE.test(folderPath || '')
}

/** Stable display accessors — tolerate sparse / legacy aliases without inventing data. */
export function fromNameOf(m) {
  return m?.from_name || m?.sender_name || m?.sender || m?.from_email || '—'
}

export function subjectOf(m) {
  return m?.subject || '(geen onderwerp)'
}

export function bodyPreviewOf(m) {
  return m?.body_preview || m?.summary || m?.snippet || m?.preview || ''
}

export function receivedAtOf(m) {
  return m?.received_at || m?.created_at || null
}

export function mailIdOf(m) {
  return m?.mail_id || m?.id || null
}

/**
 * Outlook mail_messages row → Postvak list shape, optional autodraft overlay.
 * Mirrors prior usePv2Pools mmShape (behaviour-preserving for desktop).
 *
 * @param {object} m mail_messages row
 * @param {object|null|undefined} ad autodraft_mails row
 * @param {{ inferAudience?: (email: string) => string }} [opts]
 */
export function shapeListRow(m, ad, opts = {}) {
  const infer = opts.inferAudience || (() => 'for_you')
  const inferredAudience = ad?.audience || infer(m.from_email)
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
    is_read: m.is_read,
    folder_path: m.folder_path,
    is_pinned: m.is_pinned === true,
    pinned_at: m.pinned_at || null,
    flag_status: m.flag_status || null,
    inference_classification: m.inference_classification || null,
    category_key: ad?.category_key || '',
    audience: inferredAudience,
    suggested_action: noDraft
      ? (!ad && inferredAudience === 'not_for_you' ? 'skip' : null)
      : ad.suggested_action,
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

/** Normalize any list row (autodraft or mm) onto contract field names for shared UI. */
export function normalizeListRow(m) {
  if (!m) return null
  return {
    ...m,
    mail_id: mailIdOf(m),
    from_name: m.from_name || fromNameOf(m),
    body_preview: m.body_preview != null && m.body_preview !== '' ? m.body_preview : bodyPreviewOf(m),
    received_at: receivedAtOf(m),
    subject: m.subject != null && m.subject !== '' ? m.subject : subjectOf(m),
  }
}
