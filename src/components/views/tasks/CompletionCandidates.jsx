import { useState } from 'react'
import { supabase } from '../../../lib/supabase'
import { SOURCE_LABEL_DONE } from '../../../lib/tasks'

// CompletionCandidates — collapsible sectie met taken die mogelijk al klaar zijn.
export default function CompletionCandidates({ tasks }) {
  const [open, setOpen] = useState(false)
  const [busy, setBusy] = useState(false)

  const acceptOne = async (id) => {
    await supabase.from('tasks').update({ status: 'done', completion_candidate: false }).eq('id', id)
  }
  const rejectOne = async (id) => {
    await supabase.from('tasks').update({ completion_candidate: false, completion_rejected: true }).eq('id', id)
  }
  const acceptAll = async () => {
    if (!confirm(`${tasks.length} taken op klaar zetten?`)) return
    setBusy(true)
    try {
      const ids = tasks.map(t => t.id)
      await supabase.from('tasks').update({ status: 'done', completion_candidate: false }).in('id', ids)
    } finally { setBusy(false) }
  }
  const rejectAll = async () => {
    if (!confirm(`${tasks.length} taken behouden?`)) return
    setBusy(true)
    try {
      const ids = tasks.map(t => t.id)
      await supabase.from('tasks').update({ completion_candidate: false, completion_rejected: true }).in('id', ids)
    } finally { setBusy(false) }
  }

  return (
    <section style={{
      border: '1px solid var(--border)', borderRadius: 8,
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
        <span style={{ fontWeight: 500 }}>✨ Mogelijk al klaar</span>
        <span style={{
          padding: '2px 8px', borderRadius: 10, fontSize: 11, fontWeight: 600,
          background: 'rgba(124,138,255,0.15)', color: 'var(--accent)',
        }}>{tasks.length}</span>
      </button>

      {open && (
        <div style={{ padding: '4px 14px 14px 14px' }}>
          <div className="muted" style={{ fontSize: 12, marginBottom: 10 }}>
            Signalen uit andere systemen suggereren dat deze al gedaan zijn.
          </div>
          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 6, marginBottom: 10 }}>
            <button className="btn btn--ghost" onClick={rejectAll} disabled={busy}>× alles behouden</button>
            <button className="btn btn--accent" onClick={acceptAll} disabled={busy}>✓ alles klaar</button>
          </div>
          <div className="stack stack--sm" style={{ gap: 6 }}>
            {tasks.map(t => (
              <CompletionCandidateRow
                key={t.id} task={t}
                onAccept={() => acceptOne(t.id)}
                onReject={() => rejectOne(t.id)}
              />
            ))}
          </div>
        </div>
      )}
    </section>
  )
}

function CompletionCandidateRow({ task, onAccept, onReject }) {
  const [busy, setBusy] = useState(false)
  const conf = task.completion_confidence != null
    ? Math.round(task.completion_confidence * 100) : null

  return (
    <div className="card" style={{ padding: '8px 12px', display: 'flex', alignItems: 'center', gap: 10 }}>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontWeight: 500, fontSize: 13 }}>{task.title}</div>
        <div className="muted" style={{ fontSize: 11, marginTop: 3 }}>
          <span style={{ color: 'var(--accent)' }}>
            {SOURCE_LABEL_DONE[task.completion_source] || task.completion_source || 'signaal'}
          </span>
          {conf != null && <span style={{ marginLeft: 6 }}>({conf}% zeker)</span>}
          {task.completion_evidence && <span style={{ marginLeft: 6 }}>· {task.completion_evidence}</span>}
        </div>
      </div>
      {task.completion_evidence_url && (
        <a href={task.completion_evidence_url} target="_blank" rel="noreferrer" className="muted" style={{ fontSize: 11 }}>↗ bron</a>
      )}
      <button className="btn btn--ghost"
        onClick={async () => { setBusy(true); try { await onReject() } finally { setBusy(false) } }}
        disabled={busy}>× nee</button>
      <button className="btn btn--accent"
        onClick={async () => { setBusy(true); try { await onAccept() } finally { setBusy(false) } }}
        disabled={busy}>✓ klaar</button>
    </div>
  )
}
