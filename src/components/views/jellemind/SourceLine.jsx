import { useState } from 'react'
import { SIGNAL_LABEL_SHORT, fmtRelative } from '../../../lib/jellemind'

// SourceLine — laat per voorstel zien waar het vandaan komt (meeting of signal-cluster).
export default function SourceLine({ row, meeting, signals, accent }) {
  const [open, setOpen] = useState(false)
  const isMeeting = row.source_kind === 'meeting' || row.source_meeting_id
  const isCluster = !isMeeting && (row.signal_ids || []).length > 0

  if (!isMeeting && !isCluster) {
    return null
  }

  const baseStyle = {
    fontSize: 10,
    padding: '5px 8px',
    borderRadius: 4,
    background: `color-mix(in srgb, ${accent} 8%, var(--bg-1))`,
    border: `1px solid color-mix(in srgb, ${accent} 25%, var(--border))`,
    marginBottom: 8,
    color: 'var(--text-muted)',
    lineHeight: 1.4,
  }

  if (isMeeting) {
    const title = meeting?.title || 'Meeting'
    const dt = meeting?.date_time ? new Date(meeting.date_time) : null
    const dateLabel = dt
      ? dt.toLocaleDateString('nl-NL', { day: '2-digit', month: 'short', year: 'numeric' })
      : null
    const url = meeting?.meeting_url
    return (
      <div style={baseStyle}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
          <span style={{ fontSize: 11 }}>📞</span>
          <strong style={{ color: 'var(--text)', fontSize: 11, fontWeight: 600 }}>Bron — Fireflies-meeting</strong>
          <span style={{ flex: 1, minWidth: 100 }}>
            <span style={{ color: 'var(--text)' }}>{title}</span>
            {dateLabel && <span> · {dateLabel}</span>}
            {meeting?.duration_min && <span> · {meeting.duration_min} min</span>}
          </span>
          {url && (
            <a
              href={url}
              target="_blank"
              rel="noopener noreferrer"
              style={{ fontSize: 10, color: accent, textDecoration: 'none' }}
              title="Open meeting in Fireflies"
            >
              ↗ open
            </a>
          )}
        </div>
        <div style={{ fontSize: 10, color: 'var(--text-muted)', marginTop: 3, fontStyle: 'italic' }}>
          ⚠ Eén meeting kan smal zijn — controleer of dit blijvende kennis is, niet een specifiek besluit voor één klant of deal.
        </div>
      </div>
    )
  }

  const agentNames = [...new Set(signals.map(s => s.agent_name).filter(Boolean))]
  const types = [...new Set(signals.map(s => SIGNAL_LABEL_SHORT[s.signal_type] || s.signal_type).filter(Boolean))]
  return (
    <div style={baseStyle}>
      <div
        onClick={() => setOpen(o => !o)}
        style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap', cursor: 'pointer' }}
      >
        <span style={{ fontSize: 11 }}>📝</span>
        <strong style={{ color: 'var(--text)', fontSize: 11, fontWeight: 600 }}>
          Bron — {signals.length} {signals.length === 1 ? 'correctie' : 'correcties'}
        </strong>
        <span style={{ flex: 1, minWidth: 80 }}>
          {types.length > 0 && <span>{types.join(', ')}</span>}
          {agentNames.length > 0 && <span> · in {agentNames.join(', ')}</span>}
        </span>
        <span style={{ fontSize: 10, color: accent }}>{open ? '▾ verberg' : '▸ toon'}</span>
      </div>
      {open && (
        <div className="stack" style={{ gap: 6, marginTop: 8 }}>
          {signals.slice(0, 6).map(s => (
            <div key={s.id} style={{ fontSize: 10, padding: 6, background: 'var(--bg-2)', borderRadius: 4 }}>
              <div style={{ color: 'var(--text-muted)', marginBottom: 2 }}>
                {fmtRelative(s.occurred_at)} · {s.agent_name}
                {s.signal_type && ` · ${SIGNAL_LABEL_SHORT[s.signal_type] || s.signal_type}`}
              </div>
              {s.delta_summary && (
                <div style={{ color: 'var(--text)', fontStyle: 'italic' }}>{s.delta_summary}</div>
              )}
              {s.before_text && (
                <div style={{ marginTop: 3 }}>
                  <span style={{ color: '#ef4444' }}>− </span>
                  <span style={{ color: 'var(--text-muted)' }}>{s.before_text.slice(0, 140)}{s.before_text.length > 140 ? '…' : ''}</span>
                </div>
              )}
              {s.after_text && (
                <div>
                  <span style={{ color: '#10b981' }}>+ </span>
                  <span style={{ color: 'var(--text)' }}>{s.after_text.slice(0, 140)}{s.after_text.length > 140 ? '…' : ''}</span>
                </div>
              )}
            </div>
          ))}
          {signals.length > 6 && (
            <div className="muted" style={{ fontSize: 10, textAlign: 'center' }}>
              + {signals.length - 6} meer in signalen-feed
            </div>
          )}
        </div>
      )}
    </div>
  )
}
