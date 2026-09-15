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

/**
 * Dezelfde verzameling als INBOX_ROOT_RE, maar als losse waarden — nodig omdat
 * PostgREST geen regex-filter heeft. `ilike` zonder wildcard = hoofdletter-
 * ongevoelige gelijkheid, dus deze lijst dekt de regex op de spellingen die
 * Outlook echt teruggeeft. Wie hier iets bijzet, zet het ook in de regex.
 */
export const INBOX_ROOT_PATHS = Object.freeze(['Inbox', 'Postvak IN', 'Postvak-IN'])

/** PostgREST `.or(...)`-expressie voor de Inbox-root. */
export const INBOX_ROOT_OR = INBOX_ROOT_PATHS
  .map(p => `folder_path.ilike."${p}"`)
  .join(',')

/**
 * Hoeveel Inbox-rijen de lijst-fetch maximaal ophaalt. Eigen limiet, want de
 * Inbox is een **mapquery**, geen plak uit het algemene recency-venster: dat
 * venster (500 nieuwste mails over álle mappen) wordt voor het grootste deel
 * gevuld door Sent Items en zou de Inbox stil kunnen afkappen.
 */
export const INBOX_FETCH_LIMIT = 300

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
 * Outlook's volgorde: vastgemaakte mails plakken bovenaan, daarna op
 * ontvangsttijd.
 *
 * Tot v1.205 was dit documentatie zonder aanroeper: `is_pinned` kwam uit een
 * categorie-heuristiek (paarse categorie / "Pinned") en daar wilde je de lijst
 * niet op herordenen. Sinds v1.205 leest en schrijft Maestro de échte
 * pin-property van Outlook (PidTagPinTimestamp 0x6204, via outlook-live
 * `set_pin`), dus het signaal is nu goed genoeg om de lijst op te sorteren —
 * en `buildInboxRows` doet dat.
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

/**
 * De velden die Outlook bezit. Wat hier in staat komt **altijd** uit
 * `mail_messages`, ook op een rij waar de AutoDraft-skill een voorstel bij
 * heeft geschreven: de skill-tabel kent `is_read`, `is_pinned`, `flag_status`,
 * `inference_classification` en `folder_path` niet eens, en haar kopie van
 * onderwerp/afzender kan verouderd zijn.
 */
export function outlookTruth(m) {
  return {
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
  }
}

/**
 * Eén Outlook-rij + optionele skill-rij → één lijstrij.
 *
 * Staat er een open voorstel (`pending`/`amended`), dan draagt de rij de volle
 * skill-inhoud (draft-varianten, rag_context, doelmap) **onder** de
 * Outlook-waarheid. Anders de Outlook-rij met de autodraft-metadata die er nog
 * bij hoort (categorie blijft zichtbaar ná een beslissing).
 */
export function mergeListRow(m, ad, opts = {}) {
  const open = !!ad && (ad.status === 'pending' || ad.status === 'amended')
  if (!open) return shapeListRow(m, ad, opts)
  return { ...ad, ...outlookTruth(m), __no_draft_yet: false }
}

/**
 * buildInboxRows — de ENIGE plek waar "wat staat er in het Postvak" wordt
 * beslist, voor desktop én mobiel.
 *
 * Productlock 2026-09-12: **Outlook-mapdeelname beslist.** Elke niet-verwijderde
 * mail in de Inbox-root staat in de lijst, in ontvangstvolgorde. AutoDraft
 * decoreert (categorie, concept, voorstel) en filtert nooit: `audience`
 * (`for_you` / `not_for_you`) mag een rij nooit uit deze lijst houden.
 *
 * Sorteren is sinds v1.205 `compareOutlookListOrder`: **vastgemaakt eerst**,
 * daarna `received_at` DESC — de sticky-sectie die Outlook ook toont (F4). Dat
 * kon pas toen `is_pinned` een echt signaal werd: tot v1.204 kwam het uit een
 * categorie-heuristiek ("paarse categorie", 📌) en dan herorden je de lijst op
 * een gok. Zie OUTLOOK-PARITY-RESEARCH §1.2 en RESEARCH-PIN-STATUS.md.
 *
 * @param {object[]} mailMessages  mail_messages-rijen (mag andere mappen bevatten)
 * @param {object[]} autodraftMails autodraft_mails-rijen (overlay)
 * @param {{ inferAudience?: (email: string) => string }} [opts]
 */
export function buildInboxRows(mailMessages, autodraftMails, opts = {}) {
  const adByMailId = new Map()
  for (const a of (autodraftMails || [])) if (a?.mail_id) adByMailId.set(a.mail_id, a)
  const out = []
  const seen = new Set()
  for (const m of (mailMessages || [])) {
    if (!m || m.is_deleted) continue
    if (!isInboxRoot(m.folder_path)) continue
    if (seen.has(m.id)) continue
    seen.add(m.id)
    out.push(mergeListRow(m, adByMailId.get(m.id), opts))
  }
  return out.sort(compareOutlookListOrder)
}

/**
 * bucketOf — Prioriteit of Overige, voor desktop én mobiel.
 *
 * Eén regel, drie bronnen, in deze volgorde:
 *  1. `postvak_bucket_overrides` — Jelle heeft de mail zelf verplaatst. Wint
 *     altijd, ook van Outlook.
 *  2. `mail_messages.inference_classification === 'other'` — Outlook's eigen
 *     Prioriteit/Overige-vlag, gesynct door `mail-sync-etl-v2` v3.4. Sleept
 *     Jelle in Outlook een mail naar Overige, dan volgt het Postvak vanzelf.
 *  3. `audience === 'not_for_you'` — de AI-inschatting, als laatste redmiddel
 *     voor mails waar Outlook geen vlag op zette.
 *
 * Let op het verschil met `buildInboxRows`: dit is een **indeling**, geen
 * filter. Een mail verdwijnt nooit uit het Postvak doordat hij Overige is; hij
 * staat in de andere bak. De oude "Voor jou / Niet voor jou"-framing (waar
 * `audience` een rij uit de lijst kon houden) is daarmee definitief weg.
 *
 * @param {object} row  lijstrij uit buildInboxRows
 * @param {{ bucketOverrides?: Map<string,string>, byId?: Map<string,object> }} [ctx]
 * @returns {'prio'|'overig'}
 */
export function bucketOf(row, ctx = {}) {
  const id = row?.mail_id
  const ov = ctx.bucketOverrides?.get?.(id)
  if (ov) return ov === 'overig' ? 'overig' : 'prio'
  const cls = row?.inference_classification ?? ctx.byId?.get?.(id)?.inference_classification
  if (cls === 'other') return 'overig'
  return row?.audience === 'not_for_you' ? 'overig' : 'prio'
}

/**
 * splitBuckets — dezelfde lijst in twee bakken plus de tellers die in de
 * schakelaar staan. De tellers tellen wat er ná verbergen (beslist/gesnoozed)
 * nog zichtbaar is, want een teller die niet met de lijst meetelt is erger dan
 * geen teller.
 *
 * @param {object[]} rows
 * @param {{ bucketOverrides?: Map, byId?: Map, hidden?: Set<string> }} [ctx]
 */
export function splitBuckets(rows, ctx = {}) {
  const prio = []
  const overig = []
  for (const r of (rows || [])) {
    if (ctx.hidden?.has?.(r.mail_id)) continue
    if (bucketOf(r, ctx) === 'overig') overig.push(r)
    else prio.push(r)
  }
  return { prio, overig, counts: { prio: prio.length, overig: overig.length } }
}

/**
 * buildSentRows — Verzonden: door mij verstuurde mails uit de al-gefetchte
 * `mail_messages`. Geen aparte query; `is_from_me` is de bron.
 */
export function buildSentRows(mailMessages, opts = {}) {
  const limit = opts.limit || 80
  return (mailMessages || [])
    .filter(m => m?.is_from_me === true && !m.is_deleted)
    .map(m => normalizeListRow({ ...m, mail_id: m.id }))
    .sort((a, b) => new Date(b.received_at) - new Date(a.received_at))
    .slice(0, limit)
}

/** Zoeken over een lijst — zelfde velden als de desktop-filter. */
export function matchesQuery(m, query) {
  const q = (query || '').trim().toLowerCase()
  if (!q) return true
  return (m.subject || '').toLowerCase().includes(q) ||
         (m.from_email || '').toLowerCase().includes(q) ||
         (m.from_name || '').toLowerCase().includes(q) ||
         (m.body_preview || '').toLowerCase().includes(q)
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
