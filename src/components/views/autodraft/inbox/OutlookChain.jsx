import { useState, useMemo, useEffect } from 'react'
import { supabase } from '../../../../lib/supabase'
import {
  normalizeThreadMail,
  formatDateTime, escapeHtml, sanitizeHtml,
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
      {allInChain.map(m => (
        <ChainItem key={m.id} mail={m} isCurrent={m.id === currentMail.mail_id} />
      ))}
    </>
  )
}

function ChainItem({ mail, isCurrent }) {
  const fromMe = mail.is_from_me
  const hasFullBody = !!(mail.body_html || mail.body_text)
  // V1.40: kleur-codering volledig via CSS-classes (mc-thread__item--mine /
  // --current / hun combinaties) in autodraft-maestro.css. Geen inline-style
  // meer — voorkomt vechten met de !important-override block die we hebben
  // weggesneden.
  return (
    <article className={`mc-thread__item${isCurrent ? ' mc-thread__item--current' : ''}${fromMe ? ' mc-thread__item--mine' : ''}`}>
      <header className="mc-thread__head">
        <span className="mc-thread__from">
          <strong>{fromMe ? 'Jij' : (mail.from_name || mail.from_email || '—')}</strong>
          {!fromMe && mail.from_email && (
            <span className={`muted ${styles.threadFromMuted}`}>&lt;{mail.from_email}&gt;</span>
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

