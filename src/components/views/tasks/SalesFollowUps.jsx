import { useState } from 'react'
import { formatDate } from '../../../lib/tasks'
import styles from './tasks.module.css'

const COLS = '110px minmax(0,1fr) 130px minmax(0,2fr) 120px'

const TODO_TYPE_LABEL = {
  offerte_reminder: 'offerte herinnering',
  trial_ending:     'trial loopt af',
  stille_contact:   'stille contact',
  ovk_geen_reactie: 'ovk geen reactie',
}

export default function SalesFollowUps({ tasks }) {
  const [open, setOpen] = useState(false)

  const draftReady = tasks.filter(t => !!t.outlook_draft_id).length

  return (
    <section className={styles.salesSection} style={{ background: open ? 'rgba(124,138,255,0.04)' : 'transparent' }}>
      <button type="button" onClick={() => setOpen(o => !o)} className={styles.sectionHeaderBtn}>
        <span className={styles.sectionChevron}>{open ? '▾' : '▸'}</span>
        <span style={{ fontWeight: 500 }}>📞 Sales follow-ups</span>
        <span className={styles.salesBadge}>{tasks.length}</span>
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
            {tasks.slice(0, 30).map(t => (
              <div key={t.id} className={styles.tableRow} style={{ gridTemplateColumns: COLS }}>
                <span className="muted">{formatDate((t.created_at || '').slice(0, 10))}</span>
                <span className={styles.companyName}>
                  {t.company_name || t.title || '—'}
                </span>
                <span className={styles.typeLabel}>
                  {TODO_TYPE_LABEL[t.todo_type] || t.todo_type || '—'}
                </span>
                <span className={`muted ${styles.reasonCell}`}>
                  {t.notes || ''}
                </span>
                <span>
                  {t.outlook_draft_id
                    ? <span className={`pill s-success ${styles.pillSm}`}>✓ draft</span>
                    : <span className={`pill ${styles.pillSm}`}>{t.status || 'open'}</span>}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}
    </section>
  )
}
