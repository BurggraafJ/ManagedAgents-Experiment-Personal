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

  useEffect(() => {
    if (!currentMail.conversation_id) { setThreadFull(null); return }
    let cancelled = false
    setThreadLoading(true)
    setThreadFull(null)
    ;(async () => {
      try {
        const { data } = await supabase.rpc('get_thread_messages', { p_conversation_id: currentMail.conversation_id })
        if (!cancelled) setThreadFull(Array.isArray(data) ? data : [])
      } catch { /* best-effort, valt terug op mailMessages */ }
      if (!cancelled) setThreadLoading(false)
    })()
    return () => { cancelled = true }
  }, [currentMail.conversation_id])

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
        <span className="mc-thread__time muted">{formatDateTime(mail.received_at)}</span>
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

export function SenderHistory({ mail, allMails }) {
  const senderHistory = useMemo(() => {
    if (!mail.from_email || !allMails) return []
    return allMails
      .filter(m => m.from_email === mail.from_email && m.mail_id !== mail.mail_id
              && m.conversation_id !== mail.conversation_id)
      .sort((a, b) => new Date(b.received_at) - new Date(a.received_at))
      .slice(0, 5)
  }, [mail, allMails])

  if (senderHistory.length === 0) return null

  return (
    <div className="ad-detail__sender-history">
      <strong>Eerder van {mail.from_name || mail.from_email}:</strong>{' '}
      {senderHistory.slice(0, 3).map((m, i) => {
        const status = m.status === 'sent' ? '✓' : m.status === 'ignored' ? '🗂' : m.status === 'pending' ? '⏳' : '·'
        return (
          <span key={m.mail_id} className={styles.senderHistoryItem}>
            {status} {formatRelative(m.received_at)}{i < Math.min(2, senderHistory.length - 1) ? ' · ' : ''}
          </span>
        )
      })}
      {senderHistory.length > 3 && <span> +{senderHistory.length - 3}</span>}
    </div>
  )
}
