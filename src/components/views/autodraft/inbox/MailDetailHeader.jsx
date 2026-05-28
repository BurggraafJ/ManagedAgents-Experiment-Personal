import { useEffect, useRef, useState } from 'react'
import styles from '../autodraft.module.css'
import {
  findMyPosition, recipientsToString, formatDateTime, confTone,
} from '../../../../lib/autodraft'
import ReasoningCollapsible from './ReasoningCollapsible'
import RagDetailsModal from '../../../RagDetailsModal'

// Header van MailDetail: afzender + onderwerp + ontvangers + percentage-circle
// (open RAG-modal) + 3-puntjes-menu (Tijdlijn/Houden) + reasoning + attachment-
// + awaiting/sent-draft-banners + skip-banner. Pure presentatie — alle modal-
// state komt van props.
export default function MailDetailHeader({
  mail, isAwaiting, isSentDraft, isReadOnly, isSkipSuggested,
  collapsed, setCollapsed,
  onOpenTimeline, onOpenKeep,
}) {
  const [ragModalOpen, setRagModalOpen] = useState(false)
  const [headDotsOpen, setHeadDotsOpen] = useState(false)
  const headDotsRef = useRef(null)
  useEffect(() => {
    if (!headDotsOpen) return
    function onDocClick(e) {
      if (headDotsRef.current && !headDotsRef.current.contains(e.target)) setHeadDotsOpen(false)
    }
    document.addEventListener('mousedown', onDocClick)
    return () => document.removeEventListener('mousedown', onDocClick)
  }, [headDotsOpen])

  // jsonb-velden uit Postgres kunnen object i.p.v. string zijn — direct
  // renderen in JSX triggert React error #31. safe() garandeert string.
  const safe = (v) => {
    if (v == null) return ''
    if (typeof v === 'string' || typeof v === 'number') return String(v)
    try { return JSON.stringify(v) } catch { return '[unrenderable]' }
  }

  const toStr = recipientsToString(mail.to_recipients)
  const ccStr = recipientsToString(mail.cc_recipients)
  const bccStr = recipientsToString(mail.bcc_recipients)
  const myPos = findMyPosition(mail.to_recipients, mail.cc_recipients, mail.bcc_recipients)
  const youBadge = (active) => active ? <span className={styles.detailRecipientYou}>jij</span> : null

  return (
    <>
      {mail.status === 'amended' && (
        <div className="ad-detail__amended-banner">
          ✎ Dit is een herschreven versie op basis van je vorige aanpassingsvoorstel.
        </div>
      )}
      {mail.status === 'queued_amend' && (
        <div className={styles.detailQueuedAmend}>
          <strong>✎ Skill schrijft draft opnieuw…</strong>
          {' '}<span className={styles.detailQueuedAmendNote}>
            Je feedback staat in de wachtrij. Volgende run (binnen 10 min) krijg je een nieuwe draft. Mail blijft hier zichtbaar tot het klaar is.
          </span>
        </div>
      )}
      {(mail.status === 'queued_send' || mail.status === 'queued_ignore' || mail.status === 'queued_spam') && (
        <div className={styles.detailQueuedAction}>
          ⏳ <strong>Actie staat in de wachtrij.</strong>{' '}
          {mail.status === 'queued_send'
            ? <>Instant-trigger maakt de Outlook-draft normaal binnen seconden. Bij Composio-uitval valt 't terug op de lokale orchestrator (binnen 30 min). Daarna verschijnt de groene "concept geplaatst"-banner.</>
            : <>Skill verwerkt 'm bij de eerstvolgende run (binnen 30 min).</>}
        </div>
      )}

      <div className="ad-detail__head">
        <div className="ad-detail__head-text">
          <div className="ad-detail__head-meta">
            <strong>{safe(mail.from_name) || '—'}</strong>{' '}
            <span className="muted">&lt;{safe(mail.from_email) || '—'}&gt;</span>
            <span className={`muted ${styles.detailHeadDate}`}>· {formatDateTime(mail.received_at)}</span>
          </div>
          <div className="ad-detail__head-subject">{safe(mail.subject) || '(geen onderwerp)'}</div>
        </div>
        {/* Percentage-circle blijft een <div> (voor de conic-gradient styling)
            maar krijgt onClick + role=button. Een <button>-conversie zou de
            ring-CSS killen. */}
        <div
          role={mail.id ? 'button' : undefined}
          tabIndex={mail.id ? 0 : undefined}
          title={`Confidence: ${Math.round((mail.confidence || 0) * 100)}% — klik voor RAG-detail (inkomende chunks + uitgaand gebruik)`}
          className={`${styles.detailConfWrap} ${mail.id ? styles.detailConfClickable : ''}`}
          data-pct={Math.round((mail.confidence || 0) * 100)}
          data-tone={confTone(mail.confidence)}
          onClick={() => { if (mail.id) setRagModalOpen(true) }}
          onKeyDown={(e) => {
            if (mail.id && (e.key === 'Enter' || e.key === ' ')) {
              e.preventDefault()
              setRagModalOpen(true)
            }
          }}
        >
          <span className={styles.detailConfCircle} style={{
            color: confTone(mail.confidence) === 'high' ? '#4ade80' : confTone(mail.confidence) === 'mid' ? 'var(--accent)' : 'var(--text-muted)',
          }}>
            {Math.round((mail.confidence || 0) * 100)}%
          </span>
        </div>
        {ragModalOpen && mail.id && (
          <RagDetailsModal
            recordType="autodraft_mail"
            recordId={mail.id}
            onClose={() => setRagModalOpen(false)}
          />
        )}
        <span ref={headDotsRef} className="ad-detail__head-dots-wrap">
          <button
            type="button"
            className="ad-detail__head-dots"
            onClick={() => setHeadDotsOpen(v => !v)}
            title="Meer acties — tijdlijn & houden"
            aria-haspopup="menu"
            aria-expanded={headDotsOpen}
          >
            <svg viewBox="0 0 24 24" width="16" height="16" fill="currentColor" aria-hidden="true">
              <circle cx="5" cy="12" r="1.6"/>
              <circle cx="12" cy="12" r="1.6"/>
              <circle cx="19" cy="12" r="1.6"/>
            </svg>
          </button>
          {headDotsOpen && (
            <div className="ad-detail__head-dots-menu" role="menu">
              <button
                type="button"
                role="menuitem"
                className="ad-detail__head-dots-item"
                onClick={() => { setHeadDotsOpen(false); onOpenTimeline() }}
              >
                <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                  <circle cx="12" cy="12" r="10"/>
                  <polyline points="12 6 12 12 16 14"/>
                </svg>
                <span>Tijdlijn</span>
                <span className="ad-detail__head-dots-sub">Eerder van deze afzender</span>
              </button>
              <button
                type="button"
                role="menuitem"
                className="ad-detail__head-dots-item"
                onClick={() => { setHeadDotsOpen(false); onOpenKeep() }}
              >
                <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                  <path d="M3 3h18v18H3z"/>
                  <path d="M9 9h6v6H9z"/>
                </svg>
                <span>Houden</span>
                <span className="ad-detail__head-dots-sub">Wat is er met deze mail gedaan</span>
              </button>
            </div>
          )}
        </span>
      </div>

      {(toStr || ccStr || bccStr) && (
        <div className={styles.detailRecipientsBlock}>
          {toStr && <div className={styles.detailRecipientRow}><span className={styles.detailRecipientLabel}>Aan:</span> {toStr}{youBadge(myPos === 'to')}</div>}
          {ccStr && <div className={styles.detailRecipientRow}><span className={styles.detailRecipientLabel}>Cc:</span> {ccStr}{youBadge(myPos === 'cc')}</div>}
          {bccStr && <div className={styles.detailRecipientRow}><span className={styles.detailRecipientLabel}>Bcc:</span> {bccStr}{youBadge(myPos === 'bcc')}</div>}
        </div>
      )}

      {mail.suggested_reasoning && <ReasoningCollapsible reasoning={safe(mail.suggested_reasoning)} />}

      {mail.has_attachments && (
        <div className={`ad-attachments-hint muted ${styles.detailAttachmentTop}`}>
          📎 Mail bevat bijlagen — niet zichtbaar in dashboard, open Outlook indien nodig.
        </div>
      )}

      {isAwaiting && (
        <div className={styles.detailAwaitingBlock}>
          ⏳ <strong>Wachtend op reactie sinds {mail.days_waiting} {mail.days_waiting === 1 ? 'dag' : 'dagen'}</strong>
          {' '}— jij hebt gemaild, er is nog geen antwoord binnen op deze thread.
        </div>
      )}

      {isSentDraft && (
        <div className={styles.detailSentDraftBlock}>
          📤 <strong>Draft geplaatst{mail.days_since_placed != null ? ` ${mail.days_since_placed === 0 ? 'vandaag' : `${mail.days_since_placed} ${mail.days_since_placed === 1 ? 'dag' : 'dagen'} geleden`}` : ''}</strong>
          {' '}— concept staat in Outlook. Klik daar op verzenden, dan verdwijnt 'ie automatisch hier.
        </div>
      )}

      {!isReadOnly && isSkipSuggested && (
        <div className="ad-detail__skip-banner">
          <span>🗂️ Skill stelt voor: <strong>negeren en archiveren</strong>.</span>
          <button type="button" onClick={() => setCollapsed(v => !v)} className={styles.detailSkipToggleBtn}>
            {collapsed ? 'toch draft tonen' : 'weer inklappen'}
          </button>
        </div>
      )}
    </>
  )
}
