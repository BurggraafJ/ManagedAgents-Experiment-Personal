import { useState, useMemo, useEffect } from 'react'
import { supabase } from '../../../../lib/supabase'
import {
  normalizeThreadMail, isInternalEmail,
  formatDateTime, formatRelative, escapeHtml, sanitizeHtml,
} from '../../../../lib/autodraft'
import styles from '../autodraft.module.css'

// =====================================================================
// OUTLOOK-CHAIN — volledige conversatie inline, oudste-onder, mijn mails accent
// =====================================================================

export default function OutlookChain({ currentMail, currentBody, allMails, mailMessages }) {
  const [threadFull, setThreadFull] = useState(null)
  const [threadLoading, setThreadLoading] = useState(false)

  // 2026-05-27 — correspondent (eerste externe partij) voor de cross-conversation
  // subject-match in get_thread_messages: vangt replies met een ander Outlook
  // conversation_id én verwerkte/verplaatste (is_deleted) mails op.
  const matchEmail = useMemo(() => {
    const cands = []
    if (currentMail.from_email) cands.push(currentMail.from_email)
    const tr = currentMail.to_recipients
    if (Array.isArray(tr)) {
      for (const x of tr) { const e = typeof x === 'string' ? x : (x?.email || x?.address || ''); if (e) cands.push(e) }
    } else if (typeof tr === 'string') {
      cands.push(tr)
    }
    for (const c of cands) {
      const m = String(c).toLowerCase().match(/[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}/i)
      const email = m ? m[0] : ''
      if (email && !email.endsWith('@legal-mind.nl')) return email
    }
    return null
  }, [currentMail.from_email, currentMail.to_recipients])

  useEffect(() => {
    if (!currentMail.conversation_id) { setThreadFull(null); return }
    let cancelled = false
    setThreadLoading(true)
    setThreadFull(null)
    ;(async () => {
      try {
        const { data } = await supabase.rpc('get_thread_messages', {
          p_conversation_id: currentMail.conversation_id,
          p_subject: currentMail.subject || null,
          p_match_email: matchEmail,
          p_anchor_date: currentMail.received_at || null,
        })
        if (!cancelled) setThreadFull(Array.isArray(data) ? data : [])
      } catch { /* best-effort, valt terug op mailMessages */ }
      if (!cancelled) setThreadLoading(false)
    })()
    return () => { cancelled = true }
  }, [currentMail.conversation_id, currentMail.subject, matchEmail, currentMail.received_at])

  const otherMessages = useMemo(() => {
    if (!currentMail.conversation_id) return []
    if (threadFull && threadFull.length > 0) {
      return threadFull
        .filter(m => m.id !== currentMail.mail_id)
        .map(normalizeThreadMail)
    }
    if (mailMessages && mailMessages.length > 0) {
      return mailMessages
        .filter(m => m.conversation_id === currentMail.conversation_id && m.id !== currentMail.mail_id)
        .map(normalizeThreadMail)
    }
    if (allMails && allMails.length > 0) {
      return allMails
        .filter(m => m.conversation_id === currentMail.conversation_id && m.mail_id !== currentMail.mail_id)
        .map(normalizeThreadMail)
    }
    return []
  }, [threadFull, mailMessages, allMails, currentMail.conversation_id, currentMail.mail_id])

  const currentNormalized = {
    id: currentMail.mail_id,
    received_at: currentMail.received_at,
    from_name: currentMail.from_name,
    from_email: currentMail.from_email,
    to_recipients: currentMail.to_recipients || null,
    body_preview: currentBody.body_preview,
    body_html: currentBody.body_html,
    body_text: currentBody.body_text,
    is_from_me: false,
    body_truncated: currentBody.body_truncated,
  }

  const allInChain = useMemo(() => {
    const list = [currentNormalized, ...otherMessages]
    return list.sort((a, b) => new Date(b.received_at) - new Date(a.received_at))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [otherMessages, currentMail.mail_id, currentBody.body_html, currentBody.body_text])

  const myCount  = allInChain.filter(m => m.is_from_me).length
  const allCount = allInChain.length

  return (
    <>
      <div className="mc-thread__divider">
        <span>{allCount} {allCount === 1 ? 'bericht' : 'berichten'} in conversatie{myCount > 0 ? ` · ${myCount} van jou` : ''}</span>
        {threadLoading && <span className={`muted ${styles.threadHeaderLoading}`}>laden…</span>}
      </div>
      {allInChain.map((m, idx) => (
        <ChainItem key={m.id} mail={m}
          isCurrent={m.id === currentMail.mail_id}
          isFirst={idx === 0} />
      ))}
    </>
  )
}

function ChainItem({ mail, isCurrent, isFirst }) {
  const fromMe = mail.is_from_me
  const fromInternal = !fromMe && isInternalEmail(mail.from_email)
  const hasFullBody = !!(mail.body_html || mail.body_text)
  const tintBg = fromMe
    ? 'color-mix(in srgb, var(--accent) 4%, var(--bg))'
    : fromInternal
      ? 'color-mix(in srgb, #8b5cf6 5%, var(--bg))'
      : 'var(--bg)'
  const itemStyle = {
    background: isCurrent ? 'color-mix(in srgb, var(--accent) 6%, var(--bg))' : tintBg,
    ...(isFirst ? { borderTop: 'none' } : {}),
  }
  return (
    <article className={`mc-thread__item${isCurrent ? ' mc-thread__item--current' : ''}${fromMe ? ' mc-thread__item--mine' : ''}`}
      style={itemStyle}>
      <header className="mc-thread__head">
        <span className="mc-thread__from">
          <strong>{fromMe ? 'Jij' : (mail.from_name || mail.from_email || '—')}</strong>
          {!fromMe && mail.from_email && (
            <span className="muted" style={{ marginLeft: 6, fontWeight: 400 }}>&lt;{mail.from_email}&gt;</span>
          )}
        </span>
        <span className="mc-thread__time muted">
          {formatDateTime(mail.received_at)}
          {mail.is_deleted && (
            <span title="Deze mail is al verwerkt/verplaatst in Outlook — daarom valt de thread uit 'In afwachting'."> · 📂 verwerkt</span>
          )}
        </span>
      </header>
      <div className="mc-thread__body">
        {hasFullBody ? (
          <div className="mc-thread__html" dangerouslySetInnerHTML={{
            __html: sanitizeHtml(mail.body_html || `<pre>${escapeHtml(mail.body_text || '')}</pre>`)
          }} />
        ) : mail.body_preview ? (
          <pre className="mc-thread__preview">{mail.body_preview}</pre>
        ) : (
          <div className={`muted ${styles.threadEmptyBody}`}>(geen inhoud opgeslagen — open Outlook voor volledige tekst)</div>
        )}
      </div>
      {mail.body_truncated && (
        <div className="mc-thread__trunc muted">⚠ Body ingekort tot 200KB — open Outlook voor de volledige mail.</div>
      )}
    </article>
  )
}

export function SenderHistory({ mail, allMails, mailMessages }) {
  // V8.4 (2026-05-13): ook mailMessages includen (niet alleen pending
  // autodraft_mails) + uitklapbaar. Voorheen miste je oudere mails van
  // dezelfde sender omdat ze al verwerkt waren en dus uit `allMails`
  // (pending-only) verdwenen. Nu union van beide bronnen, gededupliceerd
  // op email-id (mail_messages.id = autodraft_mails.mail_id).
  const [expanded, setExpanded] = useState(false)
  const senderHistory = useMemo(() => {
    if (!mail.from_email) return []
    const seen = new Set([mail.mail_id])
    const merged = []
    // Eerst pending-autodrafts (hebben status-info zoals 'sent'/'pending')
    for (const m of (allMails || [])) {
      if (m.from_email !== mail.from_email) continue
      if (seen.has(m.mail_id)) continue
      if (m.conversation_id === mail.conversation_id) continue
      seen.add(m.mail_id)
      merged.push({
        mail_id: m.mail_id,
        from_name: m.from_name,
        from_email: m.from_email,
        subject: m.subject,
        received_at: m.received_at,
        status: m.status || 'pending',
      })
    }
    // Daarna mail_messages — al-verwerkte mails (status onbekend, toon ·)
    for (const x of (mailMessages || [])) {
      if (!x?.from_email || x.from_email !== mail.from_email) continue
      if (seen.has(x.id)) continue
      if (x.conversation_id === mail.conversation_id) continue
      seen.add(x.id)
      merged.push({
        mail_id: x.id,
        from_name: x.from_name,
        from_email: x.from_email,
        subject: x.subject,
        received_at: x.received_at,
        status: x.flag_status === 'flagged' ? 'flagged' : 'archived',
      })
    }
    return merged
      .sort((a, b) => new Date(b.received_at) - new Date(a.received_at))
      .slice(0, 20)
  }, [mail, allMails, mailMessages])

  if (senderHistory.length === 0) return null
  const visible = expanded ? senderHistory : senderHistory.slice(0, 3)

  return (
    <div className="ad-detail__sender-history">
      <strong>Eerder van {mail.from_name || mail.from_email}:</strong>
      {visible.map((m) => {
        const status = m.status === 'sent' ? '✓'
          : m.status === 'ignored' ? '🗂'
          : m.status === 'pending' ? '⏳'
          : m.status === 'flagged' ? '★'
          : '·'
        return (
          <span key={m.mail_id} className={styles.senderHistoryItem} title={m.subject || ''}>
            {' '}{status} {formatRelative(m.received_at)}{m.subject ? ` — ${m.subject.slice(0, 48)}${m.subject.length > 48 ? '…' : ''}` : ''}
          </span>
        )
      })}
      {senderHistory.length > 3 && (
        <button
          type="button"
          onClick={() => setExpanded(v => !v)}
          className={styles.senderHistoryToggle}
          style={{
            border: 0,
            background: 'transparent',
            color: 'var(--accent, #dc6f3f)',
            cursor: 'pointer',
            fontSize: 'inherit',
            fontFamily: 'inherit',
            padding: '0 4px',
            marginLeft: 4,
            fontWeight: 500,
          }}
        >
          {expanded
            ? '▲ minder tonen'
            : `▼ +${senderHistory.length - 3} eerder`}
        </button>
      )}
    </div>
  )
}
