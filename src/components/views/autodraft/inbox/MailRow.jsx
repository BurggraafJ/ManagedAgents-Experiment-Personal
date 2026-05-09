import RagBadge from '../../../RagBadge'
import { isFromShareholder, formatRelative, colorWithAlpha, tagStyle } from '../../../../lib/autodraft'
import styles from '../autodraft.module.css'

export default function MailRow({ mail, categories, selected, onSelect, threadCount, isHandled, isFlagged, onToggleFlag, ragSummary }) {
  const cat = categories.find(c => c.category_key === mail.category_key)
  const isSkip = mail.suggested_action === 'skip'
  const isFlag = mail.suggested_action === 'flag'
  const isAwaiting = !!mail.__awaiting
  const isSentDraft = !!mail.__sent_draft
  const isShareholder = isFromShareholder(mail.from_email)
  const queueState = String(mail.status || '').startsWith('queued_') ? mail.status.replace('queued_', '') : null
  const age = formatRelative(mail.received_at)
  const catColor = isShareholder ? '#dc2626' : (cat?.color || 'var(--border)')
  const bg = selected
    ? 'var(--accent-soft)'
    : isShareholder
      ? 'color-mix(in srgb, #dc2626 5%, var(--bg))'
      : 'var(--bg)'
  const opacity = queueState ? 0.55 : (isHandled ? 0.55 : (isSkip ? 0.7 : 1))

  return (
    <div
      role="button"
      tabIndex={0}
      onClick={onSelect}
      onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onSelect() } }}
      className={styles.mailRowOuter}
      style={{ background: bg, opacity }}
    >
      <div className={styles.mailRowColorBar} style={{ background: catColor }} title={cat?.label || 'ongecategoriseerd'} />
      <div className={styles.mailRowContent}>
        <div className={styles.mailRowHeader}>
          <span className={`${styles.mailRowFrom} ${isHandled ? styles.mailRowFromHandled : ''}`}>
            {mail.from_name || mail.from_email || '—'}
          </span>
          <div className={styles.mailRowMetaRight}>
            {onToggleFlag && (
              <button
                type="button"
                onClick={e => { e.stopPropagation(); onToggleFlag(mail.mail_id, !isFlagged) }}
                aria-label={isFlagged ? 'Ster uit' : 'Pin als prioriteit'}
                title={isFlagged ? 'Ster uit (verdwijnt uit Pin)' : 'Pin als prioriteit (verdwijnt uit Voor jou)'}
                className={styles.mailRowFlagBtn}
                style={{
                  color: isFlagged ? '#f59e0b' : 'var(--text-muted)',
                  opacity: isFlagged ? 1 : 0.55,
                }}
              >
                {isFlagged ? '★' : '☆'}
              </button>
            )}
            <span className={styles.mailRowAge}>{age}</span>
          </div>
        </div>
        <div className={`${styles.mailRowSubject} ${isHandled ? styles.mailRowSubjectHandled : ''}`}>
          {mail.subject || '(geen onderwerp)'}
        </div>
        <div className={styles.mailRowTags}>
          {mail.__no_draft_yet && (
            <span
              title="Mail is binnen via mail-sync — auto-draft moet nog categoriseren en draften (5-15 min)"
              className={`${styles.mailRowBadge} ${styles.mailRowBadgeWaitAi}`}
            >
              💭 wacht op AI
            </span>
          )}
          {mail.status === 'waiting_agenda' && (
            <span
              title="Auto-draft vond deze mail agenda-relevant — wacht op agenda-check vóór hij draft schrijft"
              className={`${styles.mailRowBadge} ${styles.mailRowBadgeWaitAgenda}`}
            >
              📅 wacht op agenda
            </span>
          )}
          {queueState === 'amend' && <span style={tagStyle('accent')} title="Skill schrijft draft opnieuw op je feedback">✎ herschrijven…</span>}
          {queueState === 'send' && <span style={tagStyle('accent')} title="Wacht op plaatsen in Outlook">📧 in wachtrij</span>}
          {queueState === 'ignore' && <span style={tagStyle('dim')} title="Wacht op verplaatsing">📂 in wachtrij</span>}
          {queueState === 'spam' && <span style={tagStyle('warn')} title="Wacht op spam-actie">⛔ in wachtrij</span>}
          {isHandled && <span style={tagStyle('dim')} title="Al verplaatst of beantwoord in Outlook">✓ afgehandeld</span>}
          {isAwaiting && <span style={tagStyle('warn')} title="Wachtend op reactie">⏳ {mail.days_waiting}d</span>}
          {isSentDraft && <span style={tagStyle('accent')} title="Draft staat in Outlook, nog niet verstuurd">📤 draft</span>}
          {cat && (
            <span
              className={styles.mailRowCatChip}
              style={{ background: colorWithAlpha(cat.color, 0.15), color: cat.color }}
            >
              {cat.label}
            </span>
          )}
          {isSkip && !isAwaiting && !isSentDraft && <span style={tagStyle('dim')}>negeer-voorstel</span>}
          {isFlag && <span style={tagStyle('warn')}>vraag</span>}
          {mail.status === 'amended' && <span style={tagStyle('accent')}>✎ herschreven</span>}
          {threadCount > 1 && (
            <span style={tagStyle('thread')} title={`Thread van ${threadCount}`}>💬 {threadCount}</span>
          )}
          <RagBadge summary={ragSummary} recordType="autodraft_mail" recordId={mail.id} compact />

          {mail.agenda_check_result?.verdict === 'ok' && (mail.agenda_check_result.slots_in_draft?.length > 0) && (
            <span style={tagStyle('ok')} title="Agenda gecheckt — datum past">🟢 agenda</span>
          )}
          {mail.agenda_check_result?.verdict === 'conflict' && (
            <span style={tagStyle('warn')}
              title={`Agenda-conflict: ${mail.agenda_check_result.conflicts?.[0]?.detail || 'zie detail'}`}>
              🔴 conflict
            </span>
          )}
        </div>
      </div>
    </div>
  )
}
