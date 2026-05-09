import { useState } from 'react'
import { SALES_TYPE_LABEL, formatShortDateTime } from '../../../lib/tasks'

// SalesFollowUps — read-only sectie van sales_todos.
export default function SalesFollowUps({ todos }) {
  const [open, setOpen] = useState(false)

  const draftReady = todos.filter(t => t.status === 'draft_ready').length

  return (
    <section style={{
      border: '1px solid var(--border)',
      borderRadius: 8,
      background: open ? 'rgba(124,138,255,0.04)' : 'transparent',
    }}>
      <button
        type="button"
        onClick={() => setOpen(o => !o)}
        style={{
          width: '100%', display: 'flex', alignItems: 'center', gap: 10,
          padding: '10px 14px', background: 'transparent', border: 'none',
          cursor: 'pointer', textAlign: 'left', color: 'var(--text)',
        }}
      >
        <span style={{ fontSize: 12, color: 'var(--text-faint)', width: 12 }}>{open ? '▾' : '▸'}</span>
        <span style={{ fontWeight: 500 }}>📞 Sales follow-ups</span>
        <span style={{
          padding: '2px 8px', borderRadius: 10, fontSize: 11, fontWeight: 600,
          background: 'rgba(124,138,255,0.15)', color: 'var(--accent)',
        }}>{todos.length}</span>
        {draftReady > 0 && <span className="pill s-success" style={{ padding: '2px 8px', fontSize: 11 }}>{draftReady} draft klaar</span>}
        <span className="muted" style={{ fontSize: 11, marginLeft: 'auto' }}>
          drafts wachten in Outlook-map "Sales Agent"
        </span>
      </button>

      {open && (
        <div style={{ padding: '4px 14px 14px 14px' }}>
          <div className="muted" style={{ fontSize: 12, marginBottom: 10 }}>
            Open deals die actie vragen (offerte-reminders, trial-einde, stille contacts).
            De skill zet drafts klaar in Outlook; deze tabel is read-only.
          </div>
          <div className="card" style={{ padding: 0, overflow: 'hidden' }}>
            <div style={{
              display: 'grid',
              gridTemplateColumns: '110px minmax(0,1fr) 130px minmax(0,2fr) 120px',
              gap: 10, padding: '6px 12px', fontSize: 10, fontWeight: 600,
              textTransform: 'uppercase', letterSpacing: 0.6,
              color: 'var(--text-faint)', borderBottom: '1px solid var(--border)',
              background: 'rgba(124,138,255,0.03)',
            }}>
              <span>Wanneer</span><span>Bedrijf</span><span>Type</span><span>Reden</span><span>Status</span>
            </div>
            {todos.slice(0, 30).map(t => (
              <div key={t.id} style={{
                display: 'grid',
                gridTemplateColumns: '110px minmax(0,1fr) 130px minmax(0,2fr) 120px',
                gap: 10, alignItems: 'center', padding: '8px 12px',
                borderBottom: '1px solid var(--border)',
                fontSize: 12,
              }}>
                <span className="muted">{formatShortDateTime(t.created_at)}</span>
                <span style={{ fontWeight: 500, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {t.company_name || t.deal_name || '—'}
                </span>
                <span style={{ color: 'var(--accent)', fontSize: 11 }}>
                  {SALES_TYPE_LABEL[t.todo_type || t.type] || t.todo_type || t.type || '—'}
                </span>
                <span className="muted" style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {t.reason || ''}
                </span>
                <span>
                  {t.status === 'draft_ready'
                    ? <span className="pill s-success" style={{ padding: '2px 8px', fontSize: 11 }}>✓ draft</span>
                    : t.status === 'error'
                      ? <span className="pill s-error" style={{ padding: '2px 8px', fontSize: 11 }}>fout</span>
                      : <span className="pill" style={{ padding: '2px 8px', fontSize: 11 }}>{t.status || 'pending'}</span>}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}
    </section>
  )
}
