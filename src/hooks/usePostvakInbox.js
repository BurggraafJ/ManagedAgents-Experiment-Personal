import { useMemo } from 'react'

// =============================================================================
// usePostvakInbox — gedeelde data-laag voor PostvakV2View en Sidebar.
// -----------------------------------------------------------------------------
// Spiegelt de pool-logica uit AutoDraftView zodat de Postvak-specifieke
// counts en mail-lijsten op één plek leven. Sidebar en PostvakV2View consumeren
// allebei de output zonder elkaars state nodig te hebben.
//
// Output:
//   pending          — for_you + not_for_you (echte mails uit autodraft_mails
//                      + pseudo-pending uit mail_messages)
//   awaiting         — eigen verzonden mails zonder reply (1-30d, met OOO
//                      filter, dismiss-filter, closing-filter)
//   pinPool          — pending+awaiting waar flag_status='flagged' op staat
//   sentDrafts       — decisions met action='send' execution_status='done'
//   decidedIds       — Set van mail_ids waar al een actie op gedaan is
//   counts           — { forYou, pin, wachten, nietVoorJou }
//   folderTree       — hierarchisch boom voor sidebar-render (alleen Inbox-tak)
// =============================================================================

const INTERNAL_DOMAINS = ['legal-mind.nl']
const NOT_FOR_YOU_LOCAL_RE = /^(no-?reply|noreply|notifications?|bounce|do-?not-?reply|team|updates?|news|newsletter|marketing|welcome|onboarding|info|hello|help|support|security|privacy|feedback|digest|alerts?|automated|system)@/i
const NOT_FOR_YOU_DOMAINS = new Set([
  'uber.com', 'ubereats.com', 'ubereats.nl', 'spotify.com', 'github.com', 'gitlab.com',
  'slack.com', 'supabase.com', 'cursor.com', 'mail.cursor.com', 'email.openai.com',
  'noreply.openai.com', 'attiomail.com', 'mail.moonlit.ai', 'notifications.hubspot.com',
  'email.hubspot.com', 'azure-noreply.com', 'email.microsoftonline.com', 'mail.notion.so',
  'mail.figma.com', 'mail.atlassian.net', 'mail.databricks.com', 'mail.linear.app',
  'mailer.linkedin.com', 'mail.linkedin.com', 'noreply.github.com', 'noreply.medium.com',
])
const OOO_SUBJECT_RE = /\b(out of office|automatic reply|auto[-\s]?reply|automatisch antwoord|automatische reactie|afwezig(heidsmelding)?|on (annual )?leave|on holiday|holiday reply|otto|otho|ferien)\b/i
const OOO_BODY_RE = /\b(out of (the )?office|automatically generated|automatisch gegenereerd|automatisch antwoord|niet (op )?kantoor|currently away|will be back|return on|terug op|tijdelijk niet beschikbaar|with limited access)\b/i
const CANCEL_SUBJECT_RE = /^(canceled|cancelled|geannuleerd|annulering|annuleren):/i
const CLOSING_OPENERS_RE = /\b(top|prima|goed|akkoord|ok(é|e)?|dank|thanks|thx|geweldig|perfect|super|fijn|merci|duidelijk)\b[\s.!,]*/i
const CLOSING_TIME_RE = /\b(tot (zo|straks|morgen|vrijdag|maandag|dinsdag|woensdag|donderdag|vanmiddag|volgende week|over))\b/i
const CLOSING_DECISION_RE = /\b(no problem|geen probleem|prima dan|ga (ervoor|er voor)|kom maar door|laat (maar|t weten)|spreken we (af|mekaar))\b/i

function inferPseudoAudience(fromEmail) {
  if (!fromEmail) return 'not_for_you'
  const e = fromEmail.toLowerCase()
  if (NOT_FOR_YOU_LOCAL_RE.test(e)) return 'not_for_you'
  const domain = e.split('@')[1] || ''
  if (NOT_FOR_YOU_DOMAINS.has(domain)) return 'not_for_you'
  for (const d of NOT_FOR_YOU_DOMAINS) {
    if (domain.endsWith('.' + d)) return 'not_for_you'
  }
  return 'for_you'
}
function isInternalRecipient(emailOrJsonb) {
  if (!emailOrJsonb) return false
  const list = []
  if (typeof emailOrJsonb === 'string') list.push(emailOrJsonb)
  else if (Array.isArray(emailOrJsonb)) {
    for (const x of emailOrJsonb) {
      if (typeof x === 'string') list.push(x)
      else if (x?.email) list.push(x.email)
      else if (x?.address) list.push(x.address)
    }
  } else if (emailOrJsonb?.email) list.push(emailOrJsonb.email)
  if (list.length === 0) return false
  return list.every(e => INTERNAL_DOMAINS.some(d => e.toLowerCase().endsWith('@' + d)))
}
function isOutOfOffice(mail) {
  if (!mail) return false
  const subj = String(mail.subject || '')
  const preview = String(mail.body_preview || mail.body_text || '').slice(0, 600)
  return OOO_SUBJECT_RE.test(subj) || OOO_BODY_RE.test(preview)
}
function isCanceledInvite(mail) {
  if (!mail) return false
  return CANCEL_SUBJECT_RE.test(String(mail.subject || ''))
}
function isClosingMail(mail) {
  if (!mail) return false
  const text = String(mail.body_text || mail.body_preview || '').trim()
  if (!text) return false
  const stripped = text
    .replace(/\bMet vriendelijke groet[,.\s\S]*$/i, '')
    .replace(/\b(Vriendelijke|Hartelijke|Met)\s+groet[,.\s\S]*$/i, '')
    .replace(/\bGroet(en)?\b[,.\s\S]*$/i, '')
    .replace(/\bGr\b[,.\s\S]*$/i, '')
    .trim()
  if (!stripped) return false
  if (stripped.length < 240 && !/\?/.test(stripped)) {
    if (CLOSING_OPENERS_RE.test(stripped.slice(0, 60))) return true
    if (CLOSING_TIME_RE.test(stripped)) return true
    if (CLOSING_DECISION_RE.test(stripped)) return true
  }
  return false
}
function inferOutgoingLabel(toRecipients, allAutodraftMails) {
  const emails = []
  if (Array.isArray(toRecipients)) {
    for (const x of toRecipients) {
      if (typeof x === 'string') emails.push(x.toLowerCase())
      else if (x?.email) emails.push(String(x.email).toLowerCase())
    }
  }
  if (emails.length === 0) return ''
  for (const m of allAutodraftMails || []) {
    const e = (m.from_email || '').toLowerCase()
    if (e && emails.includes(e) && m.category_key) return m.category_key
  }
  return ''
}

// Bouw een hiërarchische tree uit autodraft_folders.full_path strings.
// Output: array nodes met { label, fullPath, children:Map }.
export function buildFolderTree(folders) {
  if (!folders || folders.length === 0) return []
  const paths = folders
    .filter(f => f.full_path && (f.full_path === 'Inbox' || f.full_path.startsWith('Inbox/')))
    .map(f => f.full_path)
    .sort((a, b) => a.localeCompare(b))

  const root = { label: 'root', fullPath: '', children: new Map() }
  for (const p of paths) {
    const parts = p.split('/')
    let cur = root
    let acc = ''
    for (const part of parts) {
      acc = acc ? `${acc}/${part}` : part
      if (!cur.children.has(part)) {
        cur.children.set(part, { label: part, fullPath: acc, children: new Map() })
      }
      cur = cur.children.get(part)
    }
  }
  // Top-level children van 'Inbox' (skip 'Inbox' zelf — die is impliciet)
  const inbox = root.children.get('Inbox')
  if (!inbox) return Array.from(root.children.values()).map(n => ({
    label: n.label, fullPath: n.fullPath, hasChildren: n.children.size > 0, children: n.children,
  }))
  return Array.from(inbox.children.values()).map(n => ({
    label: n.label, fullPath: n.fullPath, hasChildren: n.children.size > 0, children: n.children,
  }))
}

export default function usePostvakInbox(data, opts = {}) {
  const { actionedIds = new Set() } = opts

  const mails        = data?.autodraftMails       || []
  const decisions    = data?.autodraftDecisions   || []
  const folders      = data?.autodraftFolders     || []
  const mailMessages = data?.mailMessages         || []
  const ignoreRules  = data?.autodraftIgnoreRules || []
  const awaitingDis  = data?.awaitingDismissed    || []

  const decidedIds = useMemo(() => {
    const s = new Set()
    for (const d of decisions) {
      if (d.action === 'send' || d.action === 'ignore' || d.action === 'spam') {
        if (d.mail_id) s.add(d.mail_id)
      }
    }
    return s
  }, [decisions])

  const dismissedConvIds = useMemo(
    () => new Set(awaitingDis.map(d => d.conversation_id)),
    [awaitingDis]
  )

  const subjectIgnoreNeedles = useMemo(() => (
    ignoreRules
      .filter(r => r.active !== false && r.pattern_type === 'subject_keyword' && r.pattern_value)
      .map(r => String(r.pattern_value).toLowerCase().trim())
      .filter(Boolean)
  ), [ignoreRules])

  function subjectMatchesIgnore(subject) {
    if (!subject || subjectIgnoreNeedles.length === 0) return false
    const s = String(subject).toLowerCase()
    return subjectIgnoreNeedles.some(n => s.includes(n))
  }

  const skillPending = useMemo(() => (
    mails.filter(m => m.status === 'pending' || m.status === 'amended')
  ), [mails])

  const pseudoPending = useMemo(() => {
    if (!mailMessages || mailMessages.length === 0) return []
    const inAutodraft = new Set(mails.map(m => m.mail_id))
    const out = []
    for (const m of mailMessages) {
      if (m.is_from_me) continue
      if (m.is_deleted) continue
      if (!m.folder_path || m.folder_path !== 'Inbox') continue
      if (m.is_calendar_invite) continue
      if (inAutodraft.has(m.id)) continue
      const inferred = inferPseudoAudience(m.from_email)
      const isNotForYou = inferred === 'not_for_you'
      out.push({
        __no_draft_yet: true,
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
        category_key: isNotForYou ? 'notificatie' : '',
        audience: inferred,
        suggested_action: isNotForYou ? 'skip' : null,
        suggested_reasoning: isNotForYou
          ? 'Pre-classificatie: notification/newsletter — voorgesteld om te negeren.'
          : null,
        confidence: isNotForYou ? 0.7 : 0,
        status: 'pending',
        draft_body: '',
        draft_subject: m.subject ? `RE: ${m.subject}` : '',
        draft_variants: [],
        target_folder: null,
        flag_status: m.flag_status,
      })
    }
    return out
  }, [mailMessages, mails])

  const pending = useMemo(() => (
    [...skillPending, ...pseudoPending]
      .sort((a, b) => new Date(b.received_at) - new Date(a.received_at))
  ), [skillPending, pseudoPending])

  const awaiting = useMemo(() => {
    if (!mailMessages || mailMessages.length === 0) return []
    const byConv = new Map()
    for (const m of mailMessages) {
      if (!m.conversation_id) continue
      const slot = byConv.get(m.conversation_id) || { mine: null, reply: null }
      if (m.is_from_me) {
        if (!slot.mine || new Date(m.received_at) > new Date(slot.mine.received_at)) slot.mine = m
      } else {
        if (isOutOfOffice(m)) continue
        if (!slot.reply || new Date(m.received_at) > new Date(slot.reply.received_at)) slot.reply = m
      }
      byConv.set(m.conversation_id, slot)
    }
    const now = Date.now()
    const out = []
    for (const { mine, reply } of byConv.values()) {
      if (!mine) continue
      if (mine.is_calendar_invite) continue
      if (subjectMatchesIgnore(mine.subject)) continue
      if (isCanceledInvite(mine)) continue
      if (isClosingMail(mine)) continue
      if (isInternalRecipient(mine.to_recipients)) continue
      if (dismissedConvIds.has(mine.conversation_id)) continue
      if (reply && new Date(reply.received_at) >= new Date(mine.received_at)) continue
      const ageDays = (now - new Date(mine.received_at).getTime()) / (1000 * 60 * 60 * 24)
      if (ageDays < 1 || ageDays > 30) continue
      let toLabel = ''
      if (Array.isArray(mine.to_recipients)) {
        toLabel = mine.to_recipients.map(x => typeof x === 'string' ? x : (x?.name || x?.email || '')).filter(Boolean).join(', ')
      } else if (typeof mine.to_recipients === 'string') {
        toLabel = mine.to_recipients
      }
      const inferredCategoryKey = inferOutgoingLabel(mine.to_recipients, mails)
      out.push({
        __awaiting: true,
        mail_id: mine.id,
        conversation_id: mine.conversation_id,
        received_at: mine.received_at,
        from_email: toLabel || '—',
        from_name: toLabel || 'aan —',
        to_recipients: mine.to_recipients,
        cc_recipients: mine.cc_recipients,
        subject: mine.subject,
        body_preview: mine.body_preview,
        body_text: mine.body_text,
        has_attachments: mine.has_attachments,
        category_key: inferredCategoryKey || '',
        audience: 'for_you',
        suggested_action: null,
        suggested_reasoning: null,
        confidence: 0,
        status: 'awaiting',
        draft_body: '',
        draft_subject: '',
        draft_variants: [],
        target_folder: null,
        days_waiting: Math.floor(ageDays),
        flag_status: mine.flag_status,
      })
    }
    return out.sort((a, b) => new Date(b.received_at) - new Date(a.received_at))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mailMessages, mails, dismissedConvIds, subjectIgnoreNeedles])

  const sentDrafts = useMemo(() => (
    decisions
      .filter(d => d.action === 'send' && d.execution_status === 'done' && d.mail_id)
      .map(d => {
        const m = mails.find(x => x.mail_id === d.mail_id)
        if (!m) return null
        return { ...m, __sent_draft: true, _decision: d }
      })
      .filter(Boolean)
  ), [decisions, mails])

  const flaggedIds = useMemo(() => {
    const s = new Set()
    for (const m of mailMessages) {
      if (m.flag_status === 'flagged') s.add(m.id)
    }
    return s
  }, [mailMessages])

  const pinPool = useMemo(() => (
    [...pending, ...awaiting].filter(m => flaggedIds.has(m.mail_id))
  ), [pending, awaiting, flaggedIds])

  const counts = useMemo(() => {
    const fy = pending.filter(m => m.audience === 'for_you' && !actionedIds.has(m.mail_id)).length
    const ny = pending.filter(m => m.audience === 'not_for_you' && !actionedIds.has(m.mail_id)).length
    const wa = awaiting.filter(m => !actionedIds.has(m.mail_id)).length
    const pn = pinPool.filter(m => !actionedIds.has(m.mail_id)).length
    return { forYou: fy, pin: pn, wachten: wa, nietVoorJou: ny }
  }, [pending, awaiting, pinPool, actionedIds])

  const folderTree = useMemo(() => buildFolderTree(folders), [folders])

  return {
    pending, awaiting, pinPool, sentDrafts,
    decidedIds, flaggedIds,
    counts, folderTree,
  }
}
