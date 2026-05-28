import { sanitizeHtml, escapeHtml } from '../../../../../lib/autodraft'
import styles from '../SenderTimeline.module.css'
import { TYPES } from './timelineHelpers'

// Type-badge per item (mail/event/note) — kleur + icoon uit TYPES-mapping.
export function TypeBadge({ type }) {
  const cfg = TYPES[type] || TYPES.incoming
  return (
    <span className={`${styles.badge} ${styles.typeBadge} ${styles[cfg.cls]}`}>
      <span className={styles.typeBadgeIcon}>{cfg.icon}</span>{cfg.label}
    </span>
  )
}

// Chevron-icoon dat 90° draait op open-state — herbruikt voor section-headers
// en item-cards.
export function Chev({ open, className }) {
  return (
    <svg className={`${styles.chev} ${open ? styles.chevOpen : ''} ${className || ''}`}
      viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor"
      strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <polyline points="6 9 12 15 18 9"/>
    </svg>
  )
}

// AttributionBadge — rendert alleen iets als het item attribution-data heeft
// (= CompanyTimeline-context). In SenderTimeline-context returns null.
export function AttributionBadge({ thread, event }) {
  const via = thread?.latest_via_email || event?.attribution_emails?.[0]
  const others = thread?.attribution_emails || event?.attribution_emails
  if (!via) return null
  const localPart = via.split('@')[0]
  const extra = others && others.length > 1 ? ` +${others.length - 1}` : ''
  return (
    <span className={`${styles.badge} ${styles.attributionBadge}`}
      title={others?.length > 1 ? `Betrokken: ${others.join(', ')}` : `Via ${via}`}>
      ↩ via {localPart}{extra}
    </span>
  )
}

// Body-block voor mail-rendering. HTML wordt sanitized, anders escaped plain
// text. Fallback op preview-tekst als geen body opgeslagen.
export function BodyBlock({ body, fallbackPreview }) {
  if (!body) return <div className={`${styles.body} ${styles.bodyLoading}`}>Body laden…</div>
  if (body._error) return <div className={`${styles.body} ${styles.bodyEmpty}`}>⚠ Kon body niet ophalen.</div>
  const hasHtml = !!body.body_html
  const hasText = !!body.body_text
  const preview = body.body_preview || fallbackPreview
  if (!hasHtml && !hasText && !preview) {
    return <div className={`${styles.body} ${styles.bodyEmpty}`}>(geen inhoud opgeslagen — open Outlook voor volledige tekst)</div>
  }
  return (
    <div className={styles.body} onClick={(e) => e.stopPropagation()}>
      {hasHtml
        ? <div className={styles.bodyHtml} dangerouslySetInnerHTML={{ __html: sanitizeHtml(body.body_html) }} />
        : hasText
          ? <pre className={styles.bodyPre} dangerouslySetInnerHTML={{ __html: escapeHtml(body.body_text) }} />
          : <pre className={styles.bodyPre}>{preview}</pre>}
      {body.body_truncated && (
        <div className={styles.bodyTrunc}>⚠ Body ingekort tot 200KB — open Outlook voor de volledige mail.</div>
      )}
    </div>
  )
}
