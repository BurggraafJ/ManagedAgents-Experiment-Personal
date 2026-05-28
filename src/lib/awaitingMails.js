// Centrale logica voor "In afwachting" — wordt door InboxPanel (lijst +
// sub-counts) én AutoDraftView (audienceCounts) gebruikt. Single bron zodat
// een fix op één plek landt i.p.v. drie keer schrijven.
//
// Twee functies:
//   • buildAwaitingMails(mailMessages, opts) → array van awaiting-mails
//     gevormd als autodraft-shape (compatible met MailRow/MailDetail).
//   • awaitingBucketOf(categoryKey, toRecipients, customerEmails) → 'klant'|'algemeen'

import {
  isOutOfOffice, isCanceledInvite, isClosingMail, isInternalRecipient,
  inferOutgoingLabel,
  buildAwaitingReplyIndex, awaitingHasReply,
} from './autodraft'

// Categorie leidend (klant_* → klant, andere expliciete categorie → algemeen),
// fallback op afzender-match tegen HubSpot-klantenset. Zelfde regel als de
// originele awaitingBucketOf in InboxPanel, nu central.
export function awaitingBucketOf(categoryKey, toRecip, customerEmails) {
  const k = categoryKey || ''
  if (k.startsWith('klant_')) return 'klant'
  if (k) return 'algemeen'
  if (!toRecip || !customerEmails || customerEmails.size === 0) return 'algemeen'
  const arr = Array.isArray(toRecip) ? toRecip : [toRecip]
  for (const x of arr) {
    const e = typeof x === 'string' ? x : (x?.email || x?.address || '')
    if (e && customerEmails.has(e.toLowerCase())) return 'klant'
  }
  return 'algemeen'
}

// Bouw awaiting-mails uit mail_messages. Filters: geen calendar-invites, geen
// canceled invites, geen closing-mails, geen volledig-interne mails, geen
// gedismist'e conversations, geen ignore-rule-subjects, 1-30 dagen oud, geen
// reply binnen (incl. cross-conversation-match + deleted replies via replyIndex).
//
// Opties:
//   • dismissedConvIds:        Set<conversation_id>
//   • customerEmails:          Set<email>
//   • subjectMatchesIgnore:    fn(subject) → bool
//   • awaitingReplyRows:       lichte index van inbound mails (incl. deleted)
//   • allAutodraftMails:       voor inferOutgoingLabel (categorie van eerdere klant-mail)
//   • categoryOverrides:       Map<mail_id, category_key> — optimistic overrides
//   • manualCategoryOverrides: Map<mail_id, category_key> — persisted overrides
//
// Retourneert array van mail-shapes met __awaiting=true en pending_bucket gezet.
export function buildAwaitingMails(mailMessages, opts = {}) {
  const {
    dismissedConvIds = new Set(),
    customerEmails = new Set(),
    subjectMatchesIgnore = () => false,
    awaitingReplyRows = [],
    allAutodraftMails = [],
    categoryOverrides = new Map(),
    manualCategoryOverrides = new Map(),
  } = opts
  if (!mailMessages || mailMessages.length === 0) return []

  const replyIndex = buildAwaitingReplyIndex(awaitingReplyRows)
  const byConv = new Map()
  for (const m of mailMessages) {
    if (!m.conversation_id) continue
    const slot = byConv.get(m.conversation_id) || { mine: null, reply: null }
    if (m.is_from_me) {
      if (!slot.mine || new Date(m.received_at) > new Date(slot.mine.received_at)) slot.mine = m
    } else {
      // OOO-antwoorden zijn geen echte reactie — sla over.
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
    if ((reply && new Date(reply.received_at) >= new Date(mine.received_at)) ||
        awaitingHasReply(mine, replyIndex)) continue
    const ageDays = (now - new Date(mine.received_at).getTime()) / (1000 * 60 * 60 * 24)
    if (ageDays < 1 || ageDays > 30) continue

    let toLabel = ''
    if (Array.isArray(mine.to_recipients)) {
      toLabel = mine.to_recipients
        .map(x => typeof x === 'string' ? x : (x?.email || x?.name || ''))
        .filter(Boolean).join(', ')
    } else if (typeof mine.to_recipients === 'string') {
      toLabel = mine.to_recipients
    }

    const inferredCategoryKey = inferOutgoingLabel(mine.to_recipients, allAutodraftMails)
    const effectiveCat = categoryOverrides.has(mine.id)
      ? categoryOverrides.get(mine.id)
      : manualCategoryOverrides.has(mine.id)
        ? manualCategoryOverrides.get(mine.id)
        : (inferredCategoryKey || '')

    out.push({
      __awaiting: true,
      mail_id: mine.id,
      conversation_id: mine.conversation_id,
      received_at: mine.received_at,
      from_email: toLabel || '—',
      from_name: toLabel ? `aan ${toLabel}` : 'aan —',
      to_recipients: mine.to_recipients,
      cc_recipients: mine.cc_recipients,
      subject: mine.subject,
      body_preview: mine.body_preview,
      body_html: mine.body_html,
      body_text: mine.body_text,
      has_attachments: mine.has_attachments,
      category_key: effectiveCat,
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
      pending_bucket: awaitingBucketOf(effectiveCat, mine.to_recipients, customerEmails),
    })
  }
  return out.sort((a, b) => new Date(b.received_at) - new Date(a.received_at))
}

// Categorisatie binnen 'Voor jou' — aandeelhouder/klant/intern/overig.
// Verplaatst uit InboxPanel zodat tellers + lijst dezelfde regel volgen.
export const FOR_YOU_INTERN_KEYS = new Set(['intern', 'partner', 'recruitment', 'leverancier'])
const INTERNAL_DOMAINS_LC = ['legal-mind.nl']

export function forYouBucketOf(mail, isFromShareholder) {
  const k = mail.category_key || ''
  if (k === 'aandeelhouder' || isFromShareholder(mail.from_email)) return 'aandeelhouder'
  if (FOR_YOU_INTERN_KEYS.has(k)) return 'intern'
  if (k.startsWith('klant_')) return 'klant'
  const dom = (mail.from_email || '').split('@')[1] || ''
  if (INTERNAL_DOMAINS_LC.includes(dom)) return 'intern'
  return 'overig'
}
