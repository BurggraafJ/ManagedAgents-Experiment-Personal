import { useMemo } from 'react'

// SyncQueueDropdown — V8.9 (2026-05-13).
// Dropdown die hangt aan de sync-pill rechtsboven in MaestroTopbar. Toont
// Jelle's beslissingen-queue: wat staat te wachten op verwerking, wat is
// recent klaar, wat is mislukt. Pure read-out van autodraft_decisions van
// de laatste 24u — geen AI-output, alleen interactions die Jelle zelf heeft
// gestart (send / ignore / amend / spam / move-via-drag).
//
// Net als bij de administratie-pagina (akkoord → verwerkt-strookje): hier
// zie je op één plek wat er met je klikken gebeurt zonder dat je voor elke
// individuele beslissing in moet checken of de Outlook-move al gebeurd is.

const ACTION_LABELS = {
  send: { label: 'Concept klaargezet in Outlook', icon: '✉️' },
  amend: { label: 'Aangepast door AI', icon: '✏️' },
  ignore: { label: 'Verplaatst naar map', icon: '📂' },
  spam: { label: 'Naar spam', icon: '🚫' },
  flag: { label: 'Sterren-status gewijzigd', icon: '⭐' },
}

function relativeTime(iso) {
  if (!iso) return ''
  const ms = Date.now() - new Date(iso).getTime()
  if (ms < 60_000) return 'net'
  const min = Math.floor(ms / 60_000)
  if (min < 60) return `${min}m geleden`
  const hr = Math.floor(min / 60)
  if (hr < 24) return `${hr}u geleden`
  const d = Math.floor(hr / 24)
  return `${d}d geleden`
}

export default function SyncQueueDropdown({ decisions = [], mails = [], folders = [], onClose }) {
  // Lookup-maps voor subject (uit mail) en folder-label (uit folder-tree)
  const mailById = useMemo(() => {
    const m = new Map()
    for (const x of mails) m.set(x.mail_id, x)
    return m
  }, [mails])

  const folderById = useMemo(() => {
    const m = new Map()
    function walk(list) {
      for (const f of list || []) {
        if (f && f.id) m.set(f.id, f.label || f.fullPath || f.id)
        if (f && Array.isArray(f.children)) walk(f.children)
      }
    }
    walk(folders)
    return m
  }, [folders])

  const rows = useMemo(() => {
    const cutoff = Date.now() - 24 * 3600 * 1000
    return (decisions || [])
      .filter(d => d.decided_at && new Date(d.decided_at).getTime() > cutoff)
      .map(d => {
        const mail = mailById.get(d.mail_id) || null
        const folderLabel = d.target_folder ? (folderById.get(d.target_folder) || '(onbekende map)') : null
        const isFailed = d.execution_status === 'failed' || !!d.execution_error
        const isDone = !!d.executed_at && !isFailed
        const status = isFailed ? 'failed' : (isDone ? 'success' : 'pending')
        const actionInfo = ACTION_LABELS[d.action] || { label: d.action, icon: '·' }
        return {
          id: d.id,
          status,
          actionInfo,
          subject: mail?.subject || '(onbekend onderwerp)',
          fromName: mail?.from_name || mail?.from_email || null,
          folderLabel,
          decidedAt: d.decided_at,
          executedAt: d.executed_at,
          error: d.execution_error || null,
        }
      })
      .sort((a, b) => new Date(b.decidedAt) - new Date(a.decidedAt))
  }, [decisions, mailById, folderById])

  const pending = rows.filter(r => r.status === 'pending')
  const success = rows.filter(r => r.status === 'success').slice(0, 12)
  const failed  = rows.filter(r => r.status === 'failed').slice(0, 8)

  return (
    <div className="mcm-sync-queue" role="menu">
      <header className="mcm-sync-queue__head">
        <strong>Mijn beslissingen — laatste 24 uur</strong>
        <button type="button" className="mcm-sync-queue__close" onClick={onClose} aria-label="Sluiten">×</button>
      </header>

      {rows.length === 0 && (
        <div className="mcm-sync-queue__empty">
          Geen beslissingen in de afgelopen 24 uur. Klik op een mail-actie (versturen / verplaatsen / aanpassen) en je ziet 'm hier verschijnen.
        </div>
      )}

      {pending.length > 0 && (
        <SyncQueueSection
          title="Wacht op verwerking"
          count={pending.length}
          tone="pending"
          rows={pending}
        />
      )}
      {failed.length > 0 && (
        <SyncQueueSection
          title="Mislukt — check & opnieuw"
          count={failed.length}
          tone="failed"
          rows={failed}
        />
      )}
      {success.length > 0 && (
        <SyncQueueSection
          title="Onlangs verwerkt"
          count={success.length}
          tone="success"
          rows={success}
        />
      )}
    </div>
  )
}

function SyncQueueSection({ title, count, tone, rows }) {
  return (
    <section className={`mcm-sync-queue__section mcm-sync-queue__section--${tone}`}>
      <header className="mcm-sync-queue__section-head">
        <span>{title}</span>
        <span className="mcm-sync-queue__count">{count}</span>
      </header>
      <ul className="mcm-sync-queue__list">
        {rows.map(r => (
          <li key={r.id} className={`mcm-sync-queue__row mcm-sync-queue__row--${r.status}`}>
            <span className="mcm-sync-queue__icon" aria-hidden>
              {r.actionInfo.icon}
            </span>
            <div className="mcm-sync-queue__body">
              <div className="mcm-sync-queue__row-head">
                <span className="mcm-sync-queue__action">{r.actionInfo.label}</span>
                <span className="mcm-sync-queue__time">{relativeTime(r.decidedAt)}</span>
              </div>
              <div className="mcm-sync-queue__subject" title={r.subject}>
                {r.subject}
                {r.fromName && <span className="mcm-sync-queue__sender"> · {r.fromName}</span>}
              </div>
              {r.folderLabel && (
                <div className="mcm-sync-queue__meta">→ {r.folderLabel}</div>
              )}
              {r.error && (
                <div className="mcm-sync-queue__error">⚠ {r.error}</div>
              )}
            </div>
            <span className={`mcm-sync-queue__status mcm-sync-queue__status--${r.status}`} aria-hidden>
              {r.status === 'pending' ? '◷' : r.status === 'success' ? '✓' : '✕'}
            </span>
          </li>
        ))}
      </ul>
    </section>
  )
}
