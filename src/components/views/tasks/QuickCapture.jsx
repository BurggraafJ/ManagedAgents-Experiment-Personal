import { useState, useMemo, useRef, useCallback } from 'react'
import { supabase } from '../../../lib/supabase'
import {
  PRIORITY_LABEL,
  PRIORITY_PILL,
  formatDate,
  addDays,
} from '../../../lib/tasks'

export default function QuickCapture({ projects }) {
  const [open, setOpen] = useState(false)
  const [text, setText] = useState('')
  const [projectId, setProjectId] = useState('')
  const [busy, setBusy] = useState(false)
  const [hint, setHint] = useState(null)
  const [focused, setFocused] = useState(false)
  const inputRef = useRef(null)

  const expand = () => { setOpen(true); setTimeout(() => inputRef.current?.focus(), 50) }
  const preview = useMemo(() => parseInlineMeta(text), [text])

  const submit = useCallback(async (e) => {
    e?.preventDefault?.()
    const title = text.trim()
    if (!title || busy) return
    setBusy(true)
    setHint(null)
    try {
      const parsed = parseInlineMeta(title)
      const row = {
        title: parsed.title,
        notes: null,
        priority: parsed.priority || 'normal',
        deadline: parsed.deadline || null,
        do_date: parsed.do_date || null,
        tags: parsed.tags,
        source: 'manual',
        project_id: projectId || null,
        ai_processed: !!projectId,
      }
      const { error } = await supabase.from('tasks').insert(row)
      if (error) throw error
      setText('')
      setProjectId('')
      setHint({ kind: 'ok', msg: parsed.note || '✓ gevangen — task-organizer pikt hem op bij de volgende run.' })
      setTimeout(() => setHint(null), 2400)
      inputRef.current?.focus()
    } catch (err) {
      setHint({ kind: 'err', msg: err.message || 'Mislukt' })
    } finally {
      setBusy(false)
    }
  }, [text, projectId, busy])

  const showPreview = focused && text.trim().length >= 2 &&
    (preview.deadline || preview.do_date || preview.priority || preview.tags.length > 0)

  if (!open) {
    return (
      <section style={{ border: '1px solid var(--border)', borderRadius: 8 }}>
        <button
          type="button"
          onClick={expand}
          style={{
            width: '100%', display: 'flex', alignItems: 'center', gap: 10,
            padding: '10px 14px', background: 'transparent', border: 'none',
            cursor: 'pointer', textAlign: 'left', color: 'var(--text)',
          }}
        >
          <span style={{ fontSize: 12, color: 'var(--text-faint)', width: 12 }}>▸</span>
          <span style={{ fontWeight: 500 }}>✚ Vang een taak</span>
          <span className="muted" style={{ fontSize: 11, marginLeft: 'auto' }}>klik om te openen</span>
        </button>
      </section>
    )
  }

  return (
    <section
      style={{
        border: '1px solid var(--border)', borderRadius: 8,
        background: 'rgba(124,138,255,0.04)', padding: 'var(--s-5)',
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 10 }}>
        <button type="button" onClick={() => setOpen(false)}
          className="btn btn--ghost" style={{ padding: '2px 8px', fontSize: 11 }} title="Inklappen">▾</button>
        <span style={{ fontWeight: 600, fontSize: 14 }}>✚ Vang een taak</span>
        <span className="muted" style={{ fontSize: 11, marginLeft: 'auto' }}>
          tip: <code>→ vrijdag</code>, <code>!urgent</code>, <code>#tag</code>, <code>vandaag</code>
        </span>
      </div>

      <form onSubmit={submit} style={{ display: 'flex', gap: 8, alignItems: 'stretch', flexWrap: 'wrap' }}>
        <input
          ref={inputRef} className="input"
          value={text} onChange={e => setText(e.target.value)}
          onFocus={() => setFocused(true)}
          onBlur={() => setTimeout(() => setFocused(false), 150)}
          placeholder="wat wil je niet vergeten?"
          style={{ flex: 1, minWidth: 280, fontSize: 16, padding: '10px 14px', borderRadius: 8 }}
        />
        <select
          className="input" value={projectId}
          onChange={e => setProjectId(e.target.value)}
          style={{ width: 200, padding: '10px 12px', borderRadius: 8 }}
          title="Laat leeg om de AI te laten clusteren"
        >
          <option value="">✨ laat AI clusteren</option>
          {projects.map(p => (
            <option key={p.id} value={p.id}>{p.icon ? p.icon + ' ' : ''}{p.name}</option>
          ))}
        </select>
        <button
          type="submit" className="btn btn--accent"
          disabled={!text.trim() || busy}
          style={{ padding: '10px 18px', borderRadius: 8, fontWeight: 600 }}
        >
          {busy ? 'bezig…' : 'vangen ↵'}
        </button>
      </form>

      {showPreview && (
        <div style={{
          display: 'flex', gap: 6, flexWrap: 'wrap', alignItems: 'center',
          marginTop: 8, fontSize: 12, color: 'var(--text-faint)',
        }}>
          <span>→</span>
          <span style={{ color: 'var(--text)', fontWeight: 500 }}>{preview.title || text}</span>
          {preview.deadline && <span className="pill s-warning" style={{ padding: '2px 8px' }}>📅 {formatDate(preview.deadline)}</span>}
          {preview.do_date  && !preview.deadline && <span className="pill" style={{ padding: '2px 8px' }}>▶ {formatDate(preview.do_date)}</span>}
          {preview.priority && <span className={`pill ${PRIORITY_PILL[preview.priority] || ''}`} style={{ padding: '2px 8px' }}>{PRIORITY_LABEL[preview.priority]}</span>}
          {preview.tags.map(t => <span key={t} style={{ color: 'var(--accent)' }}>#{t}</span>)}
        </div>
      )}

      {hint && (
        <div style={{ fontSize: 12, marginTop: 8,
          color: hint.kind === 'err' ? 'var(--error)' : 'var(--accent)',
        }}>{hint.msg}</div>
      )}
    </section>
  )
}

function parseInlineMeta(text) {
  let title = text
  let deadline = null, do_date = null, priority = null
  const tags = []
  let note = null

  const prio = title.match(/(?:^|\s)!(urgent|high|low|normal)\b/i)
  if (prio) { priority = prio[1].toLowerCase(); title = title.replace(prio[0], '').trim() }

  title = title.replace(/(?:^|\s)#([a-z0-9_-]+)/gi, (_, t) => { tags.push(t.toLowerCase()); return '' }).trim()

  const arrow = title.match(/(?:→|=>|deadline:?|voor)\s+([a-z0-9- ]+?)(?:\s|$)/i)
  if (arrow) {
    const parsed = parseDutchDate(arrow[1].trim())
    if (parsed) {
      deadline = parsed
      title = title.replace(arrow[0], '').trim()
      note = `Deadline geparsed: ${parsed}`
    }
  }

  const todayKw = title.match(/\b(vandaag|morgen|overmorgen)\b/i)
  if (todayKw && !do_date) {
    const parsed = parseDutchDate(todayKw[1])
    if (parsed) { do_date = parsed; title = title.replace(todayKw[0], '').trim() }
  }

  return { title: title.replace(/\s{2,}/g, ' '), deadline, do_date, priority, tags, note }
}

function parseDutchDate(s) {
  if (!s) return null
  const t = s.toLowerCase().trim()
  const today = new Date(); today.setHours(0,0,0,0)
  const fmt = (d) => d.toISOString().slice(0, 10)
  if (t === 'vandaag') return fmt(today)
  if (t === 'morgen')  return fmt(addDays(today, 1))
  if (t === 'overmorgen') return fmt(addDays(today, 2))
  const days = ['zondag','maandag','dinsdag','woensdag','donderdag','vrijdag','zaterdag']
  const idx = days.indexOf(t)
  if (idx >= 0) {
    const cur = today.getDay()
    let diff = (idx - cur + 7) % 7
    if (diff === 0) diff = 7
    return fmt(addDays(today, diff))
  }
  if (/^\d{4}-\d{2}-\d{2}$/.test(t)) return t
  const m = t.match(/^(\d{1,2})[-\/](\d{1,2})(?:[-\/](\d{2,4}))?$/)
  if (m) {
    const dd = parseInt(m[1], 10), mm = parseInt(m[2], 10)
    let yy = m[3] ? parseInt(m[3], 10) : today.getFullYear()
    if (yy < 100) yy += 2000
    const d = new Date(yy, mm - 1, dd)
    return fmt(d)
  }
  return null
}
