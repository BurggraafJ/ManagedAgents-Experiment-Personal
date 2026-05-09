import { useState } from 'react'
import { SALES_TYPE_LABEL, formatShortDateTime } from '../../../lib/tasks'
import styles from './tasks.module.css'

const COLS = '110px minmax(0,1fr) 130px minmax(0,2fr) 120px'

export default function SalesFollowUps({ todos }) {
  const [open, setOpen] = useState(false)

  const draftReady = todos.filter(t => t.status === 'draft_ready').length

  return (
    <section className={styles.salesSection} style={{ background: open ? 'rgba(124,138,255,0.04)' : 'transparent' }}>
      <button type="button" onClick={() => setOpen(o => !o)} className={styles.sectionHeaderBtn}>
        <span className={styles.sectionChevron}>{open ? '▾' : '▸'}</span>
        <span style={{ fontWeight: 500 }}>📞 Sales follow-ups</span>
        <span className={styles.salesBadge}>{todos.length}</span>
        {draftReady > 0 && <span className={`pill s-success ${styles.pillSm}`}>{draftReady} draft klaar</span>}
        <span className={`muted ${styles.headerDesc}`}>
          drafts wachten in Outlook-map "Sales Agent"
        </span>
      </button>

      {open && (
        <div className={styles.sectionBody}>
          <div className={`muted ${styles.sectionHint}`}>
            Open deals die actie vragen (offerte-reminders, trial-einde, stille contacts).
            De skill zet drafts klaar in Outlook; deze tabel is read-only.
          </div>
          <div className="card" style={{ padding: 0, overflow: 'hidden' }}>
            <div className={styles.tableHeader} style={{ gridTemplateColumns: COLS }}>
              <span>Wanneer</span><span>Bedrijf</span><span>Type</span><span>Reden</span><span>Status</span>
            </div>
            {todos.slice(0, 30).map(t => (
              <div key={t.id} className={styles.tableRow} style={{ gridTemplateColumns: COLS }}>
                <span className="muted">{formatShortDateTime(t.created_at)}</span>
                <span className={styles.companyName}>
                  {t.company_name || t.deal_name || '—'}
                </span>
                <span className={styles.typeLabel}>
                  {SALES_TYPE_LABEL[t.todo_type || t.type] || t.todo_type || t.type || '—'}
                </span>
                <span className={`muted ${styles.reasonCell}`}>
                  {t.reason || ''}
                </span>
                <span>
                  {t.status === 'draft_ready'
                    ? <span className={`pill s-success ${styles.pillSm}`}>✓ draft</span>
                    : t.status === 'error'
                      ? <span className={`pill s-error ${styles.pillSm}`}>fout</span>
                      : <span className={`pill ${styles.pillSm}`}>{t.status || 'pending'}</span>}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}
    </section>
  )
}
