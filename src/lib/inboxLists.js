// Pure data-mappers voor de Postvak-lijsten. Geen React, geen state — alleen
// het transformeren van mail_messages/autodraft_mails/decisions naar de shapes
// die MailRow/MailDetail verwachten.

import { inferPseudoAudience, isMailAlreadyHandled } from './autodraft'

// Pseudo-pending: inbox-mails die mail-sync wel kent maar auto-draft nog niet
// zag (skill-backlog). Maakt nieuwe mails zichtbaar zonder te wachten op de
// skill — krijgen __no_draft_yet=true zodat MailRow ze als plain inbox-mail
// toont (geen draft-acties).
export function buildPseudoPending(mailMessages, autodraftMails) {
  if (!mailMessages) return []
  const inAutodraft = new Set((autodraftMails || []).map(m => m.mail_id))
  const out = []
  for (const m of mailMessages) {
    if (m.is_from_me) continue
    if (m.is_deleted) continue
    if (!m.folder_path || m.folder_path !== 'Inbox') continue
    if (m.is_calendar_invite) continue
    if (inAutodraft.has(m.id)) continue
    const inferredAudience = inferPseudoAudience(m.from_email)
    const isNotForYou = inferredAudience === 'not_for_you'
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
      body_html: m.body_html,
      body_text: m.body_text,
      has_attachments: m.has_attachments,
      category_key: isNotForYou ? 'notificatie' : '',
      audience: inferredAudience,
      suggested_action: isNotForYou ? 'skip' : null,
      suggested_reasoning: isNotForYou
        ? 'Pre-classificatie: notification/newsletter/marketing — voorgesteld om te negeren.'
        : 'Skill heeft nog geen draft gemaakt — typ zelf je antwoord of klik snel-acties.',
      confidence: isNotForYou ? 0.7 : 0,
      status: 'pending',
      draft_body: '',
      draft_subject: m.subject ? `RE: ${m.subject}` : '',
      draft_variants: [],
      target_folder: null,
    })
  }
  return out
}

// Drafts klaar — autodraft_decisions met action='send' + execution_status='done',
// nog niet handmatig in Outlook verstuurd. "Al verstuurd" = eigen mail in
// dezelfde conversation_id ná decided_at — verdwijnt dan automatisch.
export function buildSentDrafts(decisions, autodraftMails, mailMessages) {
  const placed = (decisions || []).filter(d => d.action === 'send' && d.execution_status === 'done')
  const out = []
  for (const d of placed) {
    const sourceMail = (autodraftMails || []).find(m => m.mail_id === d.mail_id)
    if (!sourceMail) continue
    const myReplyAfter = (mailMessages || []).find(mm =>
      mm.is_from_me &&
      mm.conversation_id === sourceMail.conversation_id &&
      mm.received_at && d.executed_at &&
      new Date(mm.received_at) > new Date(d.executed_at)
    )
    if (myReplyAfter) continue
    out.push({
      __sent_draft: true,
      mail_id: sourceMail.mail_id,
      conversation_id: sourceMail.conversation_id,
      received_at: d.executed_at || sourceMail.received_at,
      from_email: sourceMail.from_email,
      from_name: sourceMail.from_name,
      to_recipients: sourceMail.to_recipients,
      cc_recipients: sourceMail.cc_recipients,
      subject: d.final_subject || sourceMail.subject,
      body_preview: sourceMail.body_preview,
      body_html: sourceMail.body_html,
      body_text: sourceMail.body_text,
      has_attachments: sourceMail.has_attachments,
      category_key: sourceMail.category_key,
      audience: sourceMail.audience,
      suggested_action: null,
      suggested_reasoning: null,
      confidence: sourceMail.confidence,
      status: 'placed',
      draft_body: d.final_body || sourceMail.draft_body,
      draft_subject: d.final_subject || sourceMail.draft_subject,
      draft_variants: [],
      target_folder: d.target_folder,
      days_since_placed: Math.floor((Date.now() - new Date(d.executed_at).getTime()) / (1000 * 60 * 60 * 24)),
    })
  }
  return out.sort((a, b) => new Date(b.received_at) - new Date(a.received_at))
}

// Splits pending in actief (nog niets mee gedaan) vs handled (al verplaatst
// naar sub-folder, of eigen reply in thread). Handled wordt default verborgen.
export function partitionHandled(pending, mailMessagesById, conversationByMyReplyAfter) {
  const active = []
  const handled = []
  for (const m of pending) {
    if (isMailAlreadyHandled(m, mailMessagesById, conversationByMyReplyAfter)) handled.push(m)
    else active.push(m)
  }
  return { active, handled }
}

// Indices voor isMailAlreadyHandled — kost weinig om hier uit te bouwen want
// callers hebben mailMessages al in de hand.
export function buildMailMessagesById(mailMessages) {
  const m = new Map()
  for (const x of (mailMessages || [])) m.set(x.id, x)
  return m
}
export function buildConversationByMyReplyAfter(mailMessages) {
  const m = new Map()
  for (const x of (mailMessages || [])) {
    if (!x.is_from_me || !x.conversation_id || !x.received_at) continue
    const prev = m.get(x.conversation_id)
    if (!prev || new Date(x.received_at) > new Date(prev)) {
      m.set(x.conversation_id, x.received_at)
    }
  }
  return m
}
