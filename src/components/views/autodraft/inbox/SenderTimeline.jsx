import { useEffect, useMemo, useState } from 'react'
import { supabase } from '../../../../lib/supabase'
import { sanitizeHtml, escapeHtml } from '../../../../lib/autodraft'
import styles from './SenderTimeline.module.css'

/**
 * SenderTimeline — cross-conversation history voor de huidige afzender.
 *
 * V9.1 (2026-05-18): data-bron omgezet van prop-merging (gecapt op 500
 * mails wereldwijd in useAutoDraft) naar dedicated RPC `get_sender_history`.
 * Inclusief uitgaande mails (jij → afzender) en clustering per thread, met
 * `thread_count` badges. Cap is nu 200 threads ipv de magere historie die
 * de 500-globale-cap opleverde.
 *
 * Twee weergavemodes (toggle bovenin):
 *   - 'cards': maand-secties met kaartjes (Outlook-achtig)
 *   - 'rail':  verticale tijdlijn met dots (visueel pakkend)
 *
 * Klik op een thread klapt de laatste mail in-place open (lazy-fetch
 * body uit mail_messages). Bij multi-mail-thread is dat de top-mail —
 * een toekomstige iteratie kan de hele chain inline tonen.
 *
 * Props:
 *   - mail: de huidige mail (geeft from_email + conversation_id voor exclude)
 *   - allMails / mailMessages: nog steeds geaccepteerd voor backward compat,
 *     niet meer gebruikt voor data (RPC pakt over).
 */
export default function SenderTimeline({ mail /*, allMails, mailMessages */ }) {
  const [mode, setMode] = useState('cards')
  const [openIds, setOpenIds] = useState(() => new Set())
  const [bodies, setBodies] = useState({})

  // Threads uit RPC
  const [threads, setThreads] = useState([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState(null)

  // ===== Fetch threads via RPC =====
  useEffect(() => {
    if (!mail.from_email) {
      setThreads([])
      return
    }
    let cancelled = false
    setLoading(true)
    setError(null)
    async function run() {
      try {
        const { data, error: rpcErr } = await supabase.rpc('get_sender_history', {
          p_from_email: mail.from_email,
          p_exclude_conversation_id: mail.conversation_id || null,
        })
        if (cancelled) return
        if (rpcErr) {
          setError(rpcErr.message || 'RPC failed')
          setThreads([])
        } else {
          setThreads(Array.isArray(data) ? data : [])
        }
      } catch (e) {
        if (!cancelled) {
          setError(e.message || String(e))
          setThreads([])
        }
      }
      if (!cancelled) setLoading(false)
    }
    run()
    return () => { cancelled = true }
  }, [mail.from_email, mail.conversation_id])

  // ===== Groepering per maand =====
  const grouped = useMemo(() => {
    const groups = new Map()
    for (const t of threads) {
      if (!t.latest_received_at) continue
      const d = new Date(t.latest_received_at)
      const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
      if (!groups.has(key)) {
        const label = d.toLocaleString('nl-NL', { month: 'long', year: 'numeric' })
        groups.set(key, {
          key,
          label: label.charAt(0).toUpperCase() + label.slice(1),
          items: [],
        })
      }
      groups.get(key).items.push(t)
    }
    return Array.from(groups.values())
  }, [threads])

  function toggleOpen(mailId) {
    setOpenIds(prev => {
      const next = new Set(prev)
      if (next.has(mailId)) next.delete(mailId)
      else next.add(mailId)
      return next
    })
  }

  // Lazy body-fetch voor open threads
  useEffect(() => {
    const toFetch = Array.from(openIds).filter(id => !bodies[id])
    if (toFetch.length === 0) return
    let cancelled = false
    async function run() {
      for (const id of toFetch) {
        try {
          const { data } = await supabase
            .from('mail_messages')
            .select('body_html, body_text, body_preview, body_truncated')
            .eq('id', id)
            .maybeSingle()
          if (cancelled) return
          setBodies(prev => ({ ...prev, [id]: data || { _empty: true } }))
        } catch {
          if (!cancelled) setBodies(prev => ({ ...prev, [id]: { _error: true } }))
        }
      }
    }
    run()
    return () => { cancelled = true }
  }, [openIds, bodies])

  // ===== Counts voor header =====
  const totalThreads = threads.length
  const totalMails = useMemo(
    () => threads.reduce((sum, t) => sum + (t.thread_count || 1), 0),
    [threads]
  )
  const monthsCount = grouped.length

  // ===== Render-takken =====
  if (loading) {
    return (
      <div className={styles.empty}>
        <LoadingGraphic />
        <div className={styles.emptyTitle}>Tijdlijn ophalen…</div>
        <div className={styles.emptySub}>We zoeken naar eerdere conversaties met deze afzender.</div>
      </div>
    )
  }
  if (error) {
    return (
      <div className={styles.empty}>
        <ErrorGraphic />
        <div className={styles.emptyTitle}>Kon de tijdlijn niet ophalen</div>
        <div className={styles.emptySub}>
          De backend gaf een fout. Probeer het opnieuw of meld 'm bij Jelle.
        </div>
        <code className={styles.emptyError}>{error}</code>
      </div>
    )
  }
  if (threads.length === 0) {
    return (
      <div className={styles.empty}>
        <EmptyGraphic />
        <div className={styles.emptyTitle}>Nog geen eerdere contact-historie</div>
        <div className={styles.emptySub}>
          Met <strong>{mail.from_name || mail.from_email}</strong> is dit{' '}
          (buiten de huidige conversatie) de eerste keer dat we mail in de database hebben —
          ook geen uitgaande mails van jou naar dit adres.
        </div>
      </div>
    )
  }

  return (
    <div className={styles.wrap}>
      <div className={styles.head}>
        <div className={styles.headInfo}>
          <span className={styles.headName}>{mail.from_name || mail.from_email}</span>
          {mail.from_name && mail.from_email && (
            <span className={styles.headEmail}>{mail.from_email}</span>
          )}
          <span className={styles.headStats}>
            {totalThreads} {totalThreads === 1 ? 'conversatie' : 'conversaties'}
            {' · '}
            {totalMails} {totalMails === 1 ? 'mail totaal' : 'mails totaal'}
            {' · '}
            {monthsCount} {monthsCount === 1 ? 'maand' : 'maanden'}
            {' · huidige thread niet meegerekend'}
          </span>
        </div>
        <StyleToggle mode={mode} setMode={setMode} />
      </div>

      {mode === 'cards' ? (
        <CardsView grouped={grouped} openIds={openIds} bodies={bodies} toggleOpen={toggleOpen} />
      ) : (
        <RailView grouped={grouped} openIds={openIds} bodies={bodies} toggleOpen={toggleOpen} />
      )}
    </div>
  )
}

// =============================================================================
// Sub-components
// =============================================================================

function StyleToggle({ mode, setMode }) {
  return (
    <div className={styles.toggleGroup} role="tablist" aria-label="Tijdlijn-stijl">
      <button
        type="button"
        role="tab"
        aria-selected={mode === 'cards'}
        className={`${styles.toggleBtn} ${mode === 'cards' ? styles.toggleBtnActive : ''}`}
        onClick={() => setMode('cards')}
        title="Maandkopjes met kaartjes per thread"
      >
        <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
          <rect x="3" y="4" width="18" height="5" rx="1"/>
          <rect x="3" y="11" width="18" height="5" rx="1"/>
          <rect x="3" y="18" width="18" height="3" rx="1"/>
        </svg>
        Kaartjes
      </button>
      <button
        type="button"
        role="tab"
        aria-selected={mode === 'rail'}
        className={`${styles.toggleBtn} ${mode === 'rail' ? styles.toggleBtnActive : ''}`}
        onClick={() => setMode('rail')}
        title="Verticale tijdlijn met dots"
      >
        <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
          <line x1="6" y1="3" x2="6" y2="21"/>
          <circle cx="6" cy="7" r="2" fill="currentColor"/>
          <circle cx="6" cy="13" r="2" fill="currentColor"/>
          <circle cx="6" cy="19" r="2" fill="currentColor"/>
          <line x1="10" y1="7" x2="20" y2="7"/>
          <line x1="10" y1="13" x2="20" y2="13"/>
          <line x1="10" y1="19" x2="20" y2="19"/>
        </svg>
        Tijdlijn
      </button>
    </div>
  )
}

function CardsView({ grouped, openIds, bodies, toggleOpen }) {
  return (
    <>
      {grouped.map(group => (
        <section key={group.key} className={styles.section}>
          <header className={styles.sectionHead}>
            <h3 className={styles.sectionTitle}>{group.label}</h3>
            <span className={styles.sectionCount}>
              {group.items.length} {group.items.length === 1 ? 'thread' : 'threads'}
            </span>
          </header>
          <div className={styles.cardList}>
            {group.items.map(thread => (
              <Card
                key={thread.conversation_id}
                thread={thread}
                isOpen={openIds.has(thread.latest_mail_id)}
                body={bodies[thread.latest_mail_id]}
                onClick={() => toggleOpen(thread.latest_mail_id)}
              />
            ))}
          </div>
        </section>
      ))}
    </>
  )
}

function RailView({ grouped, openIds, bodies, toggleOpen }) {
  return (
    <>
      {grouped.map(group => (
        <section key={group.key} className={styles.railSection}>
          <header className={styles.railSectionHead}>
            <h3 className={styles.sectionTitle}>{group.label}</h3>
            <span className={styles.sectionCount}>
              {group.items.length} {group.items.length === 1 ? 'thread' : 'threads'}
            </span>
          </header>
          <div className={styles.rail}>
            {group.items.map(thread => (
              <RailItem
                key={thread.conversation_id}
                thread={thread}
                isOpen={openIds.has(thread.latest_mail_id)}
                body={bodies[thread.latest_mail_id]}
                onClick={() => toggleOpen(thread.latest_mail_id)}
              />
            ))}
          </div>
        </section>
      ))}
    </>
  )
}

function Card({ thread, isOpen, body, onClick }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`${styles.card} ${isOpen ? styles.cardOpen : ''}`}
      aria-expanded={isOpen}
    >
      <div className={styles.cardTop}>
        <span className={styles.cardDate}>{formatDayShort(thread.latest_received_at)}</span>
        <DirectionBadge thread={thread} />
        {thread.thread_count > 1 && (
          <span className={styles.badge} title={`${thread.incoming_count} ontvangen · ${thread.outgoing_count} verzonden`}>
            {thread.thread_count} in thread
          </span>
        )}
        {thread.latest_flag_status === 'flagged' && (
          <span className={`${styles.badge} ${styles.badgeFlagged}`}>★</span>
        )}
        {thread.latest_has_attachments && (
          <span className={styles.badge} title="Bevat bijlagen">📎</span>
        )}
        <Chev open={isOpen} />
      </div>
      <div className={styles.cardSubject}>{thread.latest_subject || '(geen onderwerp)'}</div>
      {thread.latest_body_preview && !isOpen && (
        <div className={styles.cardPreview}>{thread.latest_body_preview}</div>
      )}
      {isOpen && <BodyBlock body={body} fallbackPreview={thread.latest_body_preview} />}
    </button>
  )
}

function RailItem({ thread, isOpen, body, onClick }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`${styles.railItem} ${isOpen ? styles.railItemOpen : ''}`}
      aria-expanded={isOpen}
    >
      <div className={styles.railTop}>
        <span className={styles.cardDate}>{formatDayShort(thread.latest_received_at)}</span>
        <DirectionBadge thread={thread} />
        {thread.thread_count > 1 && (
          <span className={styles.badge} title={`${thread.incoming_count} ontvangen · ${thread.outgoing_count} verzonden`}>
            {thread.thread_count} in thread
          </span>
        )}
        {thread.latest_flag_status === 'flagged' && (
          <span className={`${styles.badge} ${styles.badgeFlagged}`}>★</span>
        )}
        {thread.latest_has_attachments && (
          <span className={styles.badge} title="Bevat bijlagen">📎</span>
        )}
        <Chev open={isOpen} />
      </div>
      <div className={styles.railSubject}>{thread.latest_subject || '(geen onderwerp)'}</div>
      {thread.latest_body_preview && !isOpen && (
        <div className={styles.railPreview}>{thread.latest_body_preview}</div>
      )}
      {isOpen && <BodyBlock body={body} fallbackPreview={thread.latest_body_preview} />}
    </button>
  )
}

function BodyBlock({ body, fallbackPreview }) {
  if (!body) {
    return <div className={`${styles.body} ${styles.bodyLoading}`}>Body laden…</div>
  }
  if (body._error) {
    return <div className={`${styles.body} ${styles.bodyEmpty}`}>⚠ Kon body niet ophalen.</div>
  }
  const hasHtml = !!body.body_html
  const hasText = !!body.body_text
  const preview = body.body_preview || fallbackPreview

  if (!hasHtml && !hasText && !preview) {
    return (
      <div className={`${styles.body} ${styles.bodyEmpty}`}>
        (geen inhoud opgeslagen — open Outlook voor volledige tekst)
      </div>
    )
  }

  return (
    <div className={styles.body} onClick={(e) => e.stopPropagation()}>
      {hasHtml ? (
        <div
          className={styles.bodyHtml}
          dangerouslySetInnerHTML={{ __html: sanitizeHtml(body.body_html) }}
        />
      ) : hasText ? (
        <pre
          className={styles.bodyPre}
          dangerouslySetInnerHTML={{ __html: escapeHtml(body.body_text) }}
        />
      ) : (
        <pre className={styles.bodyPre}>{preview}</pre>
      )}
      {body.body_truncated && (
        <div className={styles.bodyTrunc}>
          ⚠ Body ingekort tot 200KB — open Outlook voor de volledige mail.
        </div>
      )}
    </div>
  )
}

// Richting-badge: per thread bepalen of het overwegend in/uit/twee-richtings is
function DirectionBadge({ thread }) {
  const { incoming_count = 0, outgoing_count = 0, latest_is_from_me } = thread
  // Two-way: zowel inkomend als uitgaand
  if (incoming_count > 0 && outgoing_count > 0) {
    return <span className={`${styles.badge} ${styles.badgeArchived}`} title={`${incoming_count} ontvangen · ${outgoing_count} verzonden`}>↔ Heen-en-weer</span>
  }
  if (latest_is_from_me || outgoing_count > 0) {
    return <span className={`${styles.badge} ${styles.badgeSent}`}>→ Jij stuurde</span>
  }
  return <span className={`${styles.badge} ${styles.badgePending}`}>← Ontvangen</span>
}

function Chev({ open }) {
  return (
    <svg
      className={`${styles.chev} ${open ? styles.chevOpen : ''}`}
      viewBox="0 0 24 24" width="14" height="14"
      fill="none" stroke="currentColor" strokeWidth="2"
      strokeLinecap="round" strokeLinejoin="round"
      aria-hidden="true"
    >
      <polyline points="6 9 12 15 18 9"/>
    </svg>
  )
}

function formatDayShort(iso) {
  if (!iso) return ''
  return new Date(iso).toLocaleString('nl-NL', {
    weekday: 'short', day: '2-digit', month: 'short',
  })
}

// =============================================================================
// State-graphics — inline SVG zodat we geen externe assets nodig hebben en
// kleuren via currentColor / CSS-variabelen kunnen sturen.
// =============================================================================

function EmptyGraphic() {
  // Lege tijdlijn: verticale stippellijn met drie hollow dots, fade-out
  // onder. Idee: visueel "er is hier nog niets om te tonen", in dezelfde
  // taal als de rail-view zelf.
  return (
    <svg
      className={styles.graphic}
      width="140" height="140" viewBox="0 0 140 140"
      fill="none" aria-hidden="true"
    >
      <defs>
        <linearGradient id="senderTimelineFadeOut" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%"  stopColor="currentColor" stopOpacity="0.7"/>
          <stop offset="100%" stopColor="currentColor" stopOpacity="0"/>
        </linearGradient>
      </defs>
      {/* Verticale tijdlijn-as */}
      <line x1="70" y1="20" x2="70" y2="110"
        stroke="url(#senderTimelineFadeOut)" strokeWidth="2"
        strokeDasharray="3 4" strokeLinecap="round" />
      {/* Hollow dots */}
      <circle cx="70" cy="35" r="9" fill="var(--surface-1, #fff)"
        stroke="currentColor" strokeWidth="1.8" opacity="0.7"/>
      <circle cx="70" cy="65" r="9" fill="var(--surface-1, #fff)"
        stroke="currentColor" strokeWidth="1.8" opacity="0.5"/>
      <circle cx="70" cy="95" r="9" fill="var(--surface-1, #fff)"
        stroke="currentColor" strokeWidth="1.8" opacity="0.3"/>
      {/* Accent envelopje rechtsonder als hint dat het over mail gaat */}
      <g transform="translate(92, 90)" opacity="0.7">
        <rect x="0" y="0" width="32" height="22" rx="2.5"
          fill="var(--surface-2, #f5f4f0)" stroke="var(--accent, #dc6f3f)" strokeWidth="1.5"/>
        <path d="M0 3 L16 14 L32 3"
          fill="none" stroke="var(--accent, #dc6f3f)" strokeWidth="1.5"
          strokeLinejoin="round"/>
      </g>
    </svg>
  )
}

function LoadingGraphic() {
  // Drie pulsende dots in tijdlijn-stijl — synchroon met empty-state-look
  // zodat de overgang loading → content visueel zacht is.
  return (
    <svg
      className={styles.graphic}
      width="140" height="80" viewBox="0 0 140 80"
      fill="none" aria-hidden="true"
    >
      <line x1="20" y1="40" x2="120" y2="40"
        stroke="currentColor" strokeWidth="2"
        strokeDasharray="3 4" strokeLinecap="round" opacity="0.4"/>
      <circle cx="40" cy="40" r="8" fill="currentColor" opacity="0.3">
        <animate attributeName="opacity" values="0.3;0.9;0.3" dur="1.2s" repeatCount="indefinite"/>
      </circle>
      <circle cx="70" cy="40" r="8" fill="currentColor" opacity="0.3">
        <animate attributeName="opacity" values="0.3;0.9;0.3" dur="1.2s" begin="0.2s" repeatCount="indefinite"/>
      </circle>
      <circle cx="100" cy="40" r="8" fill="currentColor" opacity="0.3">
        <animate attributeName="opacity" values="0.3;0.9;0.3" dur="1.2s" begin="0.4s" repeatCount="indefinite"/>
      </circle>
    </svg>
  )
}

function ErrorGraphic() {
  // Driehoek waarschuwing — line-art, accent-kleur.
  return (
    <svg
      className={styles.graphic}
      width="120" height="120" viewBox="0 0 120 120"
      fill="none" aria-hidden="true"
    >
      <path d="M60 20 L105 95 L15 95 Z"
        fill="var(--surface-2, #f5f4f0)"
        stroke="var(--accent, #dc6f3f)" strokeWidth="2.5"
        strokeLinejoin="round"/>
      <line x1="60" y1="48" x2="60" y2="75"
        stroke="var(--accent, #dc6f3f)" strokeWidth="3" strokeLinecap="round"/>
      <circle cx="60" cy="85" r="2.5" fill="var(--accent, #dc6f3f)"/>
    </svg>
  )
}
