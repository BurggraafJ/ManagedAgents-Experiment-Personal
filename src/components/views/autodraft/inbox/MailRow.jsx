import { useState, useRef, useEffect } from 'react'
import { supabase } from '../../../../lib/supabase'
import { isFromShareholder, formatRelative, colorWithAlpha, tagStyle, popoverItemStyle } from '../../../../lib/autodraft'
import styles from '../autodraft.module.css'
import { usePendingRewriteId } from '../maestro/MaestroContext'

// V8 (2026-05-12): RagBadge weg uit deze row — Jelle wil RAG-modal openen
// via percentage-circle in MailDetail rechts. Plus: category-chip is nu
// CLICKABLE — opent klein popover om categorie te wisselen zonder eerst
// naar de rechter MetaChips te springen.
export default function MailRow({
  mail, categories, selected, onSelect,
  threadCount, isHandled, isFlagged, onToggleFlag,
  // 2026-05-27 — optimistische categorie-wijziging via InboxPanel. Indien
  // afwezig (legacy /postvak) valt pickCategory terug op een directe RPC.
  onChangeCategory,
  // ragSummary blijft als prop staan voor backwards-compat (legacy code
  // in /postvak route gebruikt het nog). Niet meer gebruikt in render.
  ragSummary: _ragSummary,
}) {
  // Category-popover state: kleine inline popover bovenop de chip wanneer
  // Jelle erop klikt. Reuse popoverItemStyle uit lib/autodraft voor consistente
  // look met MetaChips popover (rechts in MailDetail). State + ref lokaal —
  // we hoeven dit niet naar InboxPanel te lift'en omdat de change-action via
  // direct supabase.rpc loopt (zelfde RPC als changeCategory in MailDetail).
  const [catOpen, setCatOpen] = useState(false)
  // 2026-05-27 — richting van de categorie-popover (flip omhoog wanneer er
  // onder de chip te weinig schermruimte is — fix voor 'dropdown valt buiten
  // beeld' bij mails laag in de lijst).
  const [catMenuUp, setCatMenuUp] = useState(false)
  const catWrapRef = useRef(null)
  useEffect(() => {
    if (!catOpen) return
    function onDocClick(e) {
      if (catWrapRef.current && !catWrapRef.current.contains(e.target)) setCatOpen(false)
    }
    document.addEventListener('mousedown', onDocClick)
    return () => document.removeEventListener('mousedown', onDocClick)
  }, [catOpen])
  async function pickCategory(newKey) {
    setCatOpen(false)
    // 2026-05-27 — optimistisch via InboxPanel zodat de mail meteen
    // her-bucket't (bv. naar Klant) en de chip verkleurt. Fallback = directe
    // RPC voor de legacy /postvak-route die geen onChangeCategory doorgeeft.
    if (onChangeCategory) { onChangeCategory(mail.mail_id, newKey); return }
    try {
      await supabase.rpc('set_autodraft_mail_category', {
        p_mail_id: mail.mail_id,
        p_category_key: newKey,
      })
    } catch {
      // silent — realtime channel update zou alsnog komen, of next reload
    }
  }
  // Open/sluit de categorie-popover + bepaal de klap-richting op basis van
  // beschikbare ruimte onder de chip (anti-overflow).
  function toggleCatMenu() {
    setCatOpen(v => {
      const next = !v
      if (next && catWrapRef.current) {
        const r = catWrapRef.current.getBoundingClientRect()
        setCatMenuUp((window.innerHeight - r.bottom) < 300)
      }
      return next
    })
  }

  const cat = categories.find(c => c.category_key === mail.category_key)
  const isSkip = mail.suggested_action === 'skip'
  const isFlag = mail.suggested_action === 'flag'
  const isAwaiting = !!mail.__awaiting
  const isSentDraft = !!mail.__sent_draft
  const isShareholder = isFromShareholder(mail.from_email)
  const queueState = String(mail.status || '').startsWith('queued_') ? mail.status.replace('queued_', '') : null
  // V8.9 (2026-05-14): toon "✨ Herschrijven…" badge wanneer Grok deze mail
  // synchronee rewrite — context-state ingesteld door rewriteDraftSync action.
  const pendingRewriteId = usePendingRewriteId()
  const isRewriting = pendingRewriteId && pendingRewriteId === mail.mail_id
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
      style={{
        background: bg,
        opacity,
        // V8.7 (2026-05-13): publiceer cat-color als CSS-var op de row
        // zodat Maestro-CSS een border-left kan tekenen die exact past bij
        // de categorie (mailRowColorBar als aparte div blijft ook bestaan
        // voor /postvak backwards-compat, maar Maestro overschrijft 'em).
        '--cat-color': catColor,
      }}
      title={cat?.label ? `Categorie: ${cat.label} — sleep naar een map om te verplaatsen` : 'Sleep naar een map om te verplaatsen'}
      // V8.9 (2026-05-13): drag-source. mail_id wordt geplaatst in dataTransfer
      // zodat FolderItem.onDrop weet welke mail verplaatst moet worden.
      // We zetten ook een leesbaar tekstuele plain-text fallback voor browsers
      // die de custom mime niet respecteren tijdens DnD-screenshots.
      draggable={!isHandled}
      onDragStart={(e) => {
        if (isHandled) { e.preventDefault(); return }
        try {
          e.dataTransfer.setData('application/x-mail-id', mail.mail_id)
          e.dataTransfer.setData('text/plain', `mail:${mail.mail_id}`)
          e.dataTransfer.effectAllowed = 'move'
        } catch {}
      }}
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
                aria-label={isFlagged ? 'Unpin' : 'Pin bovenaan'}
                title={isFlagged ? 'Unpin — verdwijnt uit Pinned-sectie' : 'Pin — verschijnt bovenaan in Pinned-sectie'}
                className={styles.mailRowFlagBtn}
                style={{
                  color: isFlagged ? '#6d28d9' : 'var(--text-muted)',
                  opacity: isFlagged ? 1 : 0.55,
                }}
              >
                {/* Pin-icoon (Lucide-stijl SVG). Synct met Outlook flag_status
                    via mail-sync-etl-v2 (inbound) + auto-draft-execute (outbound). */}
                <svg viewBox="0 0 24 24" width="14" height="14"
                     fill={isFlagged ? 'currentColor' : 'none'}
                     stroke="currentColor" strokeWidth="1.8"
                     strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                  <path d="M12 17v5" />
                  <path d="M9 10.76a2 2 0 0 1-1.11 1.79l-1.78.9A2 2 0 0 0 5 15.24V16a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1v-.76a2 2 0 0 0-1.11-1.79l-1.78-.9A2 2 0 0 1 15 10.76V7a1 1 0 0 1 1-1 2 2 0 0 0 0-4H8a2 2 0 0 0 0 4 1 1 0 0 1 1 1z" />
                </svg>
              </button>
            )}
            <span className={styles.mailRowAge}>{age}</span>
          </div>
        </div>
        <div className={`${styles.mailRowSubject} ${isHandled ? styles.mailRowSubjectHandled : ''}`}>
          {mail.subject || '(geen onderwerp)'}
        </div>
        {/* Body-preview als snippet onder subject. Mockup-conform (.row-snippet).
            Alleen renderen als preview bestaat én niet handled — handled lines
            gaan strike-through en zijn al moeilijk leesbaar. */}
        {mail.body_preview && !isHandled && (
          <div className={styles.mailRowSnippet}>{mail.body_preview}</div>
        )}
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
          {/* V8.9 (2026-05-14): synchrone rewrite-badge — pulse-animatie tijdens
              de Grok-call. Komt vóór de queue-based amend-badge zodat-ie wint
              wanneer beide actief zijn (sync overrult heartbeat-queue). */}
          {isRewriting && <span className="mc-mailrow-rewriting" title="Grok herschrijft de draft nu (sync)…">✨ Herschrijven…</span>}
          {!isRewriting && queueState === 'amend' && <span style={tagStyle('accent')} title="Skill schrijft draft opnieuw op je feedback">✎ herschrijven…</span>}
          {queueState === 'send' && <span style={tagStyle('accent')} title="Wacht op plaatsen in Outlook">📧 in wachtrij</span>}
          {queueState === 'ignore' && <span style={tagStyle('dim')} title="Wacht op verplaatsing">📂 in wachtrij</span>}
          {queueState === 'spam' && <span style={tagStyle('warn')} title="Wacht op spam-actie">⛔ in wachtrij</span>}
          {isHandled && <span style={tagStyle('dim')} title="Al verplaatst of beantwoord in Outlook">✓ afgehandeld</span>}
          {isAwaiting && <span style={tagStyle('warn')} title="Wachtend op reactie">⏳ {mail.days_waiting}d</span>}
          {isSentDraft && <span style={tagStyle('accent')} title="Draft staat in Outlook, nog niet verstuurd">📤 draft</span>}
          {/* V8: category-chip is nu CLICKABLE. Klik opent inline popover met
              alle actieve categorieën. Stop-propagation om row-select te
              voorkomen. */}
          <span
            ref={catWrapRef}
            className={styles.relWrap}
            onClick={e => e.stopPropagation()}
          >
            <button
              type="button"
              className={styles.mailRowCatChip}
              style={{
                background: cat ? colorWithAlpha(cat.color, 0.15) : 'var(--paper-2, #fafaf8)',
                color: cat ? cat.color : 'var(--neutral-500, #737373)',
                border: '0',
                cursor: 'pointer',
                fontFamily: 'inherit',
              }}
              title={cat ? `Categorie: ${cat.label} — klik om te wisselen` : 'Categorie kiezen'}
              onClick={toggleCatMenu}
            >
              {cat ? cat.label : '— categorie —'}
              <span style={{ marginLeft: 4, fontSize: 9, opacity: 0.65 }}>▾</span>
            </button>
            {catOpen && (
              <div className={styles.metaPopover}
                style={{
                  minWidth: 200,
                  maxHeight: 'min(300px, 60vh)',
                  overflowY: 'auto',
                  ...(catMenuUp
                    ? { top: 'auto', bottom: 'calc(100% + 4px)' }
                    : { top: 'calc(100% + 4px)' }),
                }}>
                <button
                  type="button"
                  onClick={() => pickCategory('')}
                  style={popoverItemStyle(!mail.category_key)}
                >
                  — niet gecategoriseerd —
                </button>
                {categories.filter(c => c.active !== false).map(c => (
                  <button
                    key={c.category_key}
                    type="button"
                    onClick={() => pickCategory(c.category_key)}
                    style={popoverItemStyle(c.category_key === mail.category_key)}
                  >
                    <span className={styles.metaCatDotInline} style={{ background: c.color || 'var(--text-muted)' }} />
                    {c.label}
                  </button>
                ))}
              </div>
            )}
          </span>
          {isSkip && !isAwaiting && !isSentDraft && <span style={tagStyle('dim')}>negeer-voorstel</span>}
          {isFlag && <span style={tagStyle('warn')}>vraag</span>}
          {mail.status === 'amended' && <span style={tagStyle('accent')}>✎ herschreven</span>}
          {threadCount > 1 && (
            <span style={tagStyle('thread')} title={`Thread van ${threadCount}`}>💬 {threadCount}</span>
          )}
          {/* V8: RagBadge weg — klik nu op de percentage-circle in MailDetail
              rechtsboven om de RAG-modal te openen. */}

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
