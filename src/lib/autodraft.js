// Pure helpers + constants gedeeld tussen AutoDraftView en sub-components.
// Geen React, geen JSX, geen state — verplaatsbaar naar Edge Function indien nodig.

import DOMPurify from 'dompurify'

// =====================================================================
// CONSTANTS
// =====================================================================

export const AGENT = 'auto-draft'

// Folder-naam = Inbox/Postvak IN (case-insensitive). Sub-folders ("Inbox/Sales")
// zijn dus NIET de inbox-root → daar staat de mail al verwerkt.
export const INBOX_ROOT_RE = /^\s*(Inbox|Postvak[\s-]?IN)\s*$/i

// E-mailadressen van aandeelhouders — krijgen rood-accent in MailRow zodat ze
// direct opvallen in 'Voor jou'. Lokale constante; later via DB-instelling.
export const SHAREHOLDER_EMAILS = new Set([
  'tarik@legal-mind.nl',
  'maarten@legal-mind.nl',
  'hans@legal-mind.nl',
  'hansdewert@legal-mind.nl',
  'h.dewert@legal-mind.nl',
])

// Domeinen die intern zijn — geen mails naar deze domeinen tellen als awaiting.
export const INTERNAL_DOMAINS = ['legal-mind.nl']

// Jelle's eigen email — gebruikt om te detecteren waar hij staat in de header.
export const MY_EMAIL = 'burggraaf@legal-mind.nl'

// Patronen die per definitie NIET-voor-jou zijn (newsletters, notifications,
// bounces). Worden gebruikt om pseudo-pending mails (= mails die auto-draft
// nog niet heeft geclassificeerd) automatisch een audience te geven zodat ze
// niet ten onrechte in 'Voor jou' belanden.
export const NOT_FOR_YOU_LOCAL_RE = /^(no-?reply|noreply|notifications?|bounce|do-?not-?reply|team|updates?|news|newsletter|marketing|welcome|onboarding|info|hello|help|support|security|privacy|feedback|digest|alerts?|automated|system)@/i
export const NOT_FOR_YOU_DOMAINS = new Set([
  'uber.com', 'ubereats.com', 'ubereats.nl',
  'spotify.com', 'github.com', 'gitlab.com',
  'slack.com', 'supabase.com', 'cursor.com',
  'mail.cursor.com', 'email.openai.com', 'noreply.openai.com',
  'attiomail.com', 'mail.moonlit.ai',
  'notifications.hubspot.com', 'email.hubspot.com',
  'azure-noreply.com', 'email.microsoftonline.com',
  'mail.notion.so', 'mail.figma.com', 'mail.atlassian.net',
  'mail.databricks.com', 'mail.linear.app',
  'mailer.linkedin.com', 'mail.linkedin.com',
  'noreply.github.com', 'noreply.medium.com',
  'mailing.pinkletter.de', 'engaging-networks.app',
  'invite.zoom.us', 'no-reply.invideo.io',
  'no-reply@accounts.google.com', 'noreply@accounts.google.com',
])

// F.5.e — out-of-office detectoren voor "In afwachting"
// Patronen die een automatische OOO-melding markeren — zo'n mail telt NIET
// als echt antwoord, dus moet de awaiting-mail in de wachtrij blijven.
export const OOO_SUBJECT_RE = /\b(out of office|automatic reply|auto[-\s]?reply|automatisch antwoord|automatische reactie|afwezig(heidsmelding)?|on (annual )?leave|on holiday|holiday reply|otto|otho|ferien)\b/i
export const OOO_BODY_RE = /\b(out of (the )?office|automatically generated|automatisch gegenereerd|automatisch antwoord|niet (op )?kantoor|currently away|will be back|return on|terug op|ik ben (.*?)afwezig|tijdelijk niet beschikbaar|with limited access)\b/i

// F.5.e — Outlook-cancellation/annuleringsmail (Jelle annuleert een afspraak):
// niemand reageert hierop, dus niet in awaiting tonen.
export const CANCEL_SUBJECT_RE = /^(canceled|cancelled|geannuleerd|annulering|annuleren):/i

// F.5.e — Closing-mail: Jelle's eigen mail rondt het gesprek af zonder
// een vraag te stellen. Dan verwacht hij geen antwoord.
export const CLOSING_OPENERS_RE = /\b(top|prima|goed|akkoord|ok(é|e)?|dank|thanks|thx|geweldig|perfect|super|fijn|merci|duidelijk)\b[\s.!,]*/i
export const CLOSING_TIME_RE = /\b(tot (zo|straks|morgen|vrijdag|maandag|dinsdag|woensdag|donderdag|vanmiddag|volgende week|over))\b/i
export const CLOSING_DECISION_RE = /\b(no problem|geen probleem|prima dan|ga (ervoor|er voor)|kom maar door|laat (maar|t weten)|spreken we (af|mekaar))\b/i

export const NL_WEEKDAYS = ['zondag','maandag','dinsdag','woensdag','donderdag','vrijdag','zaterdag']

// =====================================================================
// HELPERS — al-verwerkt detectie, recipient-parsing, classifiers
// =====================================================================

// Geeft true als jij in Outlook al actie op de mail hebt genomen — verplaatst
// naar een andere map, of in dezelfde thread al geantwoord. Beide signalen komen
// uit mail_messages (truth-of-source). Conservatief: bij ontbrekende data
// retourneert false zodat we niets onterecht verbergen.
export function isMailAlreadyHandled(mail, mailMessagesById, conversationByMyReplyAfter) {
  // Bron-mail in mail_messages
  const mm = mailMessagesById.get(mail.mail_id)
  if (mm) {
    const folder = mm.folder_path
    if (folder && !INBOX_ROOT_RE.test(folder)) return true
  }
  // Antwoord van jou in dezelfde thread, ná received_at?
  if (mail.conversation_id) {
    const myLastReplyIso = conversationByMyReplyAfter.get(mail.conversation_id)
    if (myLastReplyIso && new Date(myLastReplyIso) > new Date(mail.received_at)) return true
  }
  return false
}

export function isFromShareholder(email) {
  if (!email) return false
  return SHAREHOLDER_EMAILS.has(email.toLowerCase())
}

// Bepaal of jouw email in een recipient-lijst staat (voor highlighting).
export function findMyPosition(toRecip, ccRecip, bccRecip) {
  function listHas(list) {
    if (!list) return false
    if (typeof list === 'string') return list.toLowerCase().includes(MY_EMAIL.toLowerCase())
    if (Array.isArray(list)) {
      for (const x of list) {
        const e = typeof x === 'string' ? x : (x?.email || x?.address || '')
        if (e && e.toLowerCase() === MY_EMAIL.toLowerCase()) return true
      }
    }
    return false
  }
  if (listHas(toRecip)) return 'to'
  if (listHas(ccRecip)) return 'cc'
  if (listHas(bccRecip)) return 'bcc'
  return null
}

export function recipientsToString(list, max = 3) {
  if (!list) return ''
  const out = []
  if (Array.isArray(list)) {
    for (const x of list) {
      if (typeof x === 'string') out.push(x)
      else if (x?.name && x?.email) out.push(`${x.name} <${x.email}>`)
      else if (x?.email) out.push(x.email)
      else if (x?.address) out.push(x.address)
    }
  } else if (typeof list === 'string') {
    out.push(list)
  }
  if (out.length === 0) return ''
  if (out.length <= max) return out.join(', ')
  return `${out.slice(0, max).join(', ')} +${out.length - max} meer`
}

export function inferPseudoAudience(fromEmail) {
  if (!fromEmail) return 'not_for_you'
  const e = fromEmail.toLowerCase()
  if (NOT_FOR_YOU_LOCAL_RE.test(e)) return 'not_for_you'
  const domain = e.split('@')[1] || ''
  if (NOT_FOR_YOU_DOMAINS.has(domain)) return 'not_for_you'
  // Sub-domeinen van bekende notification-providers
  for (const d of NOT_FOR_YOU_DOMAINS) {
    if (domain.endsWith('.' + d) || domain.endsWith('@' + d)) return 'not_for_you'
  }
  // Default: for_you (echte persoon → liever zichtbaar dan verborgen)
  return 'for_you'
}

export function isInternalRecipient(emailOrJsonb) {
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

export function isOutOfOffice(mail) {
  if (!mail) return false
  const subj = String(mail.subject || '')
  const preview = String(mail.body_preview || mail.body_text || '').slice(0, 600)
  return OOO_SUBJECT_RE.test(subj) || OOO_BODY_RE.test(preview)
}

export function isCanceledInvite(mail) {
  if (!mail) return false
  return CANCEL_SUBJECT_RE.test(String(mail.subject || ''))
}

export function isClosingMail(mail) {
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
  // Korte mail zonder vraagteken die met afsluitings-pattern start of bevat
  if (stripped.length < 240 && !/\?/.test(stripped)) {
    if (CLOSING_OPENERS_RE.test(stripped.slice(0, 60))) return true
    if (CLOSING_TIME_RE.test(stripped)) return true
    if (CLOSING_DECISION_RE.test(stripped)) return true
  }
  return false
}

// Infer label voor uitgaande mail door te kijken of de ontvanger ooit zelf
// is gecategoriseerd in autodraft_mails (= klant Y mailde ooit en kreeg label).
export function inferOutgoingLabel(toRecipients, allAutodraftMails) {
  const emails = []
  if (Array.isArray(toRecipients)) {
    for (const x of toRecipients) {
      if (typeof x === 'string') emails.push(x)
      else if (x?.email) emails.push(x.email)
      else if (x?.address) emails.push(x.address)
    }
  } else if (typeof toRecipients === 'string') {
    emails.push(...toRecipients.split(',').map(s => s.trim()))
  }
  for (const e of emails) {
    const match = allAutodraftMails.find(m => m.from_email && m.from_email.toLowerCase() === e.toLowerCase() && m.category_key)
    if (match) return match.category_key
  }
  return null
}

export function isInternalEmail(email) {
  if (!email) return false
  return INTERNAL_DOMAINS.some(d => email.toLowerCase().endsWith('@' + d))
}

// Maakt zowel een mail_messages-row als een autodraft_mails-row uniform werkbaar
export function normalizeThreadMail(m) {
  return {
    id: m.mail_id || m.id,
    received_at: m.received_at,
    from_name: m.from_name,
    from_email: m.from_email,
    to_recipients: m.to_recipients || null,
    body_preview: m.body_preview,
    body_html: m.body_html || null,
    body_text: m.body_text || null,
    is_from_me: m.is_from_me === true,
    body_truncated: m.body_truncated || false,
  }
}

export function parseRecipientTokens(str) {
  if (!str) return []
  return str.split(',').map(s => s.trim()).filter(Boolean)
}

export function chipLabel(token) {
  const m = token.match(/^(.+?)\s*<([^>]+)>\s*$/)
  return m ? m[1] : token
}

// =====================================================================
// FORMATTERS / HTML SANITIZATION
// =====================================================================

export function escapeHtml(s) {
  return String(s || '').replace(/[&<>"']/g, ch => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  }[ch]))
}

export function sanitizeHtml(html) {
  return DOMPurify.sanitize(String(html || ''), {
    FORBID_TAGS: ['script', 'style', 'iframe', 'object', 'embed', 'form', 'meta', 'link'],
    FORBID_ATTR: ['onerror', 'onload', 'onclick', 'onmouseover', 'onfocus', 'formaction'],
    ALLOWED_URI_REGEXP: /^(?:(?:https?|mailto|tel|cid|data:image\/(?:png|jpe?g|gif|webp|svg\+xml)):)/i,
  })
}

export function formatRelative(iso) {
  if (!iso) return ''
  const d = new Date(iso)
  const now = new Date()
  const min = Math.round((now - d) / 60000)
  if (min < 1) return 'net'
  if (min < 60) return `${min}m`
  const h = Math.round(min / 60)
  if (h < 24) return `${h}u`
  return d.toLocaleDateString('nl-NL', { day: '2-digit', month: 'short' })
}

export function formatDateTime(iso) {
  if (!iso) return ''
  return new Date(iso).toLocaleString('nl-NL', {
    day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit',
  })
}

export function confTone(c) {
  const n = Number(c || 0)
  if (n >= 0.75) return 'high'
  if (n >= 0.5) return 'mid'
  return 'low'
}

export function colorWithAlpha(color, alpha) {
  if (!color) return 'var(--border)'
  return `color-mix(in srgb, ${color} ${Math.round(alpha * 100)}%, transparent)`
}

// =====================================================================
// GROEPERING
// =====================================================================

// Groepeer mails op gedetailleerde leeftijd:
//   - vandaag, gisteren  (dag 0/1)
//   - eergisteren als losse weekdag-naam (dag 2 t/m 6)
//   - "vorige week", "twee weken terug" (dag 7-30)
//   - "ouder" (>30 dagen)
// Zo zie je op vrijdag bv. dat je op maandag iets had — duidelijker dan 'deze week'.
export function groupByAge(mails) {
  const now = new Date()
  const todayStart = new Date(now); todayStart.setHours(0, 0, 0, 0)
  const out = { __order: [] }
  function bucketFor(date) {
    const ageMs = todayStart.getTime() - new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime()
    const ageDays = Math.round(ageMs / 86400000)
    if (ageDays <= 0) return 'Vandaag'
    if (ageDays === 1) return 'Gisteren'
    if (ageDays <= 6) return NL_WEEKDAYS[date.getDay()].charAt(0).toUpperCase() + NL_WEEKDAYS[date.getDay()].slice(1)
    if (ageDays <= 13) return 'Vorige week'
    if (ageDays <= 30) return `${Math.floor(ageDays / 7)} weken terug`
    return 'Ouder'
  }
  for (const m of mails) {
    const d = new Date(m.received_at)
    const key = bucketFor(d)
    if (!out[key]) { out[key] = []; out.__order.push(key) }
    out[key].push(m)
  }
  // Volgorde: nieuwste eerst — bouw netjes op.
  // We sorten __order op gemiddelde received_at desc.
  out.__order.sort((a, b) => {
    const aMax = Math.max(...out[a].map(m => new Date(m.received_at).getTime()))
    const bMax = Math.max(...out[b].map(m => new Date(m.received_at).getTime()))
    return bMax - aMax
  })
  return out
}

// =====================================================================
// UI CONFIG — filter/audience presets, forward-templates, quick-actions
// =====================================================================

export const FILTER_PRESETS = [
  { id: 'all',   label: 'Alles',          match: () => true },
  { id: 'draft', label: '✎ Draft klaar',  match: m => m.suggested_action === 'draft' },
  { id: 'skip',  label: '🗂 Negeer-voorstel', match: m => m.suggested_action === 'skip' },
  { id: 'flag',  label: '⚠ Vlaggen',      match: m => m.suggested_action === 'flag' },
]

// Audience-tabs: 'Alle' verwijderd, 'Prioriteit' hernoemd naar 'Pin', en
// nieuwe 'Logs'-tab toegevoegd voor traceability.
export const AUDIENCE_PRESETS = [
  { id: 'for_you',     label: '👤 Voor jou',     match: m => m.audience === 'for_you' },
  { id: 'priority',    label: '⭐ Pin',           match: () => true },  // pool wordt apart bepaald
  { id: 'awaiting',    label: '⏳ In afwachting', match: () => true },
  // 2026-05-27 — In Afwachting opgesplitst in twee top-level tabs (Klanten /
  // Algemeen) i.p.v. één tab met sub-filter-pillen. Pool wordt apart bepaald
  // in InboxPanel (awaitingMails gefilterd op pending_bucket = recipient-in-
  // customerEmails). De oude 'awaiting'-preset blijft staan voor de legacy
  // MinimalToolbar (CSS-verborgen in Maestro).
  { id: 'awaiting_klant',    label: '🟢 Klanten',  match: () => true },
  { id: 'awaiting_algemeen', label: '⚪ Algemeen', match: () => true },
  { id: 'not_for_you', label: '🤖 Niet voor jou', match: m => m.audience === 'not_for_you' },
  { id: 'sent_drafts', label: '📤 Drafts klaar',  match: () => true },
  { id: 'logs',        label: '📜 Logs',          match: () => true },  // shows decisions history
]

export const FINANCE_FORWARD_TEMPLATE = (mail) =>
  `Dag Finance,\n\nDit is bedoeld voor de administratie. Indien vragen weet je me te vinden.\n\nGroet,\nJelle\n\n` +
  `--- Doorgestuurd bericht ---\n` +
  `Van: ${mail.from_name ? `${mail.from_name} <${mail.from_email}>` : mail.from_email}\n` +
  `Onderwerp: ${mail.subject || '(geen onderwerp)'}\n` +
  `Datum: ${formatDateTime(mail.received_at)}\n\n` +
  `${mail.body_text || mail.body_preview || '(originele body niet beschikbaar — open Outlook)'}`

export const FEEDBACK_FORWARD_TEMPLATE = (mail) =>
  `Hi feedback,\n\nDoorsturen voor jullie ter info / opvolging.\n\nGroet,\nJelle\n\n` +
  `--- Doorgestuurd bericht ---\n` +
  `Van: ${mail.from_name ? `${mail.from_name} <${mail.from_email}>` : mail.from_email}\n` +
  `Onderwerp: ${mail.subject || '(geen onderwerp)'}\n` +
  `Datum: ${formatDateTime(mail.received_at)}\n\n` +
  `${mail.body_text || mail.body_preview || '(originele body niet beschikbaar — open Outlook)'}`

export const QUICK_ACTIONS = [
  {
    id: 'forward_finance',
    label: '💰 Stuur door naar Finance',
    description: 'Forward naar finance@legal-mind.nl met admin-template',
    run: (mail, submit) => submit('send', {
      busyTag: 'forward_finance',
      decision_kind: 'forward',
      final_to: ['finance@legal-mind.nl'],
      subject: `FW: ${mail.subject || '(geen onderwerp)'}`,
      body: FINANCE_FORWARD_TEMPLATE(mail),
      target_folder: 'Verwijderd',
    }),
  },
  {
    id: 'forward_feedback',
    label: '💡 Stuur door naar Feedback',
    description: 'Forward naar feedback@legal-mind.nl voor opvolging',
    run: (mail, submit) => submit('send', {
      busyTag: 'forward_feedback',
      decision_kind: 'forward',
      final_to: ['feedback@legal-mind.nl'],
      subject: `FW: ${mail.subject || '(geen onderwerp)'}`,
      body: FEEDBACK_FORWARD_TEMPLATE(mail),
      target_folder: 'Verwijderd',
    }),
  },
]

// =====================================================================
// STYLE HELPERS — UI-styling die door MailRow/MailDetail/popovers gedeeld wordt
// =====================================================================

export function tagStyle(variant) {
  const base = { padding: '1px 6px', borderRadius: 4, fontSize: 10, fontWeight: 500, textTransform: 'uppercase', letterSpacing: '0.04em' }
  if (variant === 'warn')   return { ...base, background: 'color-mix(in srgb, var(--warning, #f59e0b) 18%, transparent)', color: 'var(--warning, #f59e0b)' }
  if (variant === 'accent') return { ...base, background: 'var(--accent-soft)', color: 'var(--accent)' }
  if (variant === 'thread') return { ...base, background: 'color-mix(in srgb, var(--accent) 14%, transparent)', color: 'var(--accent)' }
  if (variant === 'ok')     return { ...base, background: 'color-mix(in srgb, #10b981 16%, transparent)', color: '#10b981' }
  return { ...base, background: 'color-mix(in srgb, var(--text-muted) 15%, transparent)', color: 'var(--text-muted)' }
}

export function popoverItemStyle(active) {
  return {
    display: 'flex', width: '100%', alignItems: 'center',
    padding: '5px 8px', borderRadius: 4,
    border: 'none', cursor: 'pointer', fontFamily: 'inherit',
    background: active ? 'var(--accent-soft)' : 'transparent',
    color: active ? 'var(--accent)' : 'var(--text)',
    fontSize: 12, textAlign: 'left',
  }
}
