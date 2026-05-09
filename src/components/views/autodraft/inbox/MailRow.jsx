import RagBadge from '../../../RagBadge'
import { isFromShareholder, formatRelative, colorWithAlpha, tagStyle } from '../../../../lib/autodraft'

export default function MailRow({ mail, categories, selected, onSelect, threadCount, isHandled, isFlagged, onToggleFlag, ragSummary }) {
  const cat = categories.find(c => c.category_key === mail.category_key)
  const isSkip = mail.suggested_action === 'skip'
  const isFlag = mail.suggested_action === 'flag'
  const isAwaiting = !!mail.__awaiting
  const isSentDraft = !!mail.__sent_draft
  const isShareholder = isFromShareholder(mail.from_email)
  // Queued-states (skill verwerkt nog) krijgen uitgegrijst + icoon. Voor amend
  // betekent dit: skill schrijft draft opnieuw op basis van Jelle's feedback.
  const queueState = String(mail.status || '').startsWith('queued_') ? mail.status.replace('queued_', '') : null
  const age = formatRelative(mail.received_at)
  const catColor = isShareholder ? '#dc2626' : (cat?.color || 'var(--border)')
  const bg = selected
    ? 'var(--accent-soft)'
    : isShareholder
      ? 'color-mix(in srgb, #dc2626 5%, var(--bg))'
      : 'var(--bg)'

  return (
    <div role="button" tabIndex={0}
      onClick={onSelect}
      onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onSelect() } }}
      style={{
        display: 'flex', flexDirection: 'row', alignItems: 'stretch',
        width: '100%', minHeight: 64, cursor: 'pointer',
        background: bg,
        borderBottom: '1px solid var(--border)',
        opacity: queueState ? 0.55 : (isHandled ? 0.55 : (isSkip ? 0.7 : 1)),
        transition: 'background 80ms',
      }}>
      <div style={{ width: 4, background: catColor, flexShrink: 0 }} title={cat?.label || 'ongecategoriseerd'} />
      <div style={{ flex: 1, padding: '10px 14px', minWidth: 0, display: 'flex', flexDirection: 'column', gap: 3 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8, fontSize: 12, alignItems: 'center' }}>
          <span style={{
            fontWeight: 500, color: 'var(--text)',
            overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
            textDecoration: isHandled ? 'line-through' : 'none',
          }}>
            {mail.from_name || mail.from_email || '—'}
          </span>
          <div style={{ display: 'flex', alignItems: 'center', gap: 4, flexShrink: 0 }}>
            {/* Ster-toggle (= pinnen). Klikbaar zonder de rij te selecteren.
                Mail verdwijnt uit Voor jou wanneer gepind, want dan zit 'ie
                in de Pin-tab — geen dubbele zichtbaarheid. */}
            {onToggleFlag && (
              <button type="button"
                onClick={e => { e.stopPropagation(); onToggleFlag(mail.mail_id, !isFlagged) }}
                aria-label={isFlagged ? 'Ster uit' : 'Pin als prioriteit'}
                title={isFlagged ? 'Ster uit (verdwijnt uit Pin)' : 'Pin als prioriteit (verdwijnt uit Voor jou)'}
                style={{
                  border: 'none', background: 'transparent', cursor: 'pointer',
                  padding: '2px 4px', fontSize: 15, lineHeight: 1,
                  color: isFlagged ? '#f59e0b' : 'var(--text-muted)',
                  opacity: isFlagged ? 1 : 0.55,
                }}>
                {isFlagged ? '★' : '☆'}
              </button>
            )}
            <span style={{ color: 'var(--text-muted)', fontSize: 11, fontVariantNumeric: 'tabular-nums' }}>
              {age}
            </span>
          </div>
        </div>
        <div style={{
          fontSize: 13, color: 'var(--text)',
          overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
          textDecoration: isHandled ? 'line-through' : 'none',
        }}>
          {mail.subject || '(geen onderwerp)'}
        </div>
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', alignItems: 'center', fontSize: 11, color: 'var(--text-muted)' }}>
          {/* 2026-05-07 — duidelijke badge voor mails die nog niet door auto-draft zijn gegaan */}
          {mail.__no_draft_yet && (
            <span
              title="Mail is binnen via mail-sync — auto-draft moet nog categoriseren en draften (5-15 min)"
              style={{
                padding: '1px 8px', borderRadius: 999, fontSize: 10, fontWeight: 600,
                background: '#dbeafe', color: '#1e40af', border: '1px solid #93c5fd',
                whiteSpace: 'nowrap',
              }}>
              💭 wacht op AI
            </span>
          )}
          {/* 2026-05-07 — agenda-relevance gate: mail wacht op agenda-check vóór drafting */}
          {mail.status === 'waiting_agenda' && (
            <span
              title="Auto-draft vond deze mail agenda-relevant — wacht op agenda-check vóór hij draft schrijft"
              style={{
                padding: '1px 8px', borderRadius: 999, fontSize: 10, fontWeight: 600,
                background: '#fef3c7', color: '#92400e', border: '1px solid #fcd34d',
                whiteSpace: 'nowrap',
              }}>
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
            <span style={{
              padding: '1px 8px', borderRadius: 999, fontSize: 10.5, fontWeight: 500,
              background: colorWithAlpha(cat.color, 0.15), color: cat.color, whiteSpace: 'nowrap',
            }}>{cat.label}</span>
          )}
          {isSkip && !isAwaiting && !isSentDraft && <span style={tagStyle('dim')}>negeer-voorstel</span>}
          {isFlag && <span style={tagStyle('warn')}>vraag</span>}
          {mail.status === 'amended' && <span style={tagStyle('accent')}>✎ herschreven</span>}
          {threadCount > 1 && (
            <span style={tagStyle('thread')} title={`Thread van ${threadCount}`}>💬 {threadCount}</span>
          )}
          {/* RAG-badge: per mail of er context-bundle is en welke breedte */}
          <RagBadge summary={ragSummary} recordType="autodraft_mail" recordId={mail.id} compact />

          {/* F.4.c — agenda-check indicator in lijst */}
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
