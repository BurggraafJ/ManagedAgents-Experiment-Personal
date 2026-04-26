import { useState, useMemo, useEffect, useRef, useCallback } from 'react'
import { supabase } from '../../lib/supabase'

// =====================================================================
// TasksView — centrale taak-inbox v1
// =====================================================================
// Eén tabblad voor alle taken — handmatig gevangen, uit Fireflies,
// uit mail of uit voice. AI-skill (task-organizer) clustert ze in
// projecten en zet deadlines/prioriteiten.
//
// Layout:
//   [Quick capture]                      [AI herindelen]
//   [Vandaag] [Deze week] [Inbox] [Project ▾] [Backlog]
//   [Project-strip met counts]
//   [Tasklist]
//
// Mutaties gaan direct via supabase (RLS staat authenticated all toe).
// =====================================================================

const AGENT = 'task-organizer'

const STATUS_LABEL = {
  open:    'open',
  done:    'klaar',
  blocked: 'geblokt',
  snoozed: 'uitgesteld',
  dropped: 'gedropt',
}
const STATUS_PILL = {
  open:    '',
  done:    's-success',
  blocked: 's-warning',
  snoozed: 's-idle',
  dropped: 's-idle',
}

const PRIORITY_LABEL = {
  low:    'laag',
  normal: 'normaal',
  high:   'hoog',
  urgent: 'urgent',
}
const PRIORITY_PILL = {
  low:    's-idle',
  normal: '',
  high:   's-warning',
  urgent: 's-error',
}

const EFFORT_LABEL = {
  quick:  '⚡ quick',
  medium: 'medium',
  deep:   'deep work',
}

const SOURCE_LABEL = {
  manual:    'handmatig',
  fireflies: 'Fireflies',
  email:     'mail',
  slack:     'Slack',
  voice:     'spraak',
  agent:     'agent',
  other:     'overig',
}

// =====================================================================

export default function TasksView({ data }) {
  const projects = useMemo(
    () => (data.taskProjects || []).slice().sort((a, b) => (a.sort_order ?? 100) - (b.sort_order ?? 100)),
    [data.taskProjects]
  )
  const tasks = data.tasks || []

  const [filter, setFilter] = useState('today') // today | week | inbox | project | backlog | all | done
  const [activeProject, setActiveProject] = useState(null) // project_id when filter = 'project'
  const [viewDate, setViewDate] = useState(() => ymd(startOfDay(new Date()))) // dag bij filter='today'
  const [search, setSearch] = useState('')

  // Reset viewDate naar vandaag wanneer je terugkomt op de today-filter.
  const pickFilter = useCallback((next) => {
    setFilter(next)
    if (next === 'today') setViewDate(ymd(startOfDay(new Date())))
  }, [])

  const stats = useMemo(() => computeStats(tasks), [tasks])

  // Filter tasks based on active filter
  const visible = useMemo(() => {
    let list = tasks
    const today = startOfDay(new Date())
    const weekEnd = addDays(today, 7)

    if (filter === 'today') {
      // viewDate kan vandaag zijn (= isToday-logica met overdue) of een toekomstige dag.
      const todayIso = ymd(today)
      if (viewDate === todayIso) {
        list = list.filter(t => isToday(t, today))
      } else {
        list = list.filter(t => isOnDate(t, viewDate))
      }
    } else if (filter === 'week') {
      list = list.filter(t => isThisWeek(t, today, weekEnd))
    } else if (filter === 'inbox') {
      list = list.filter(t => !t.project_id && t.status !== 'done' && t.status !== 'dropped')
    } else if (filter === 'project') {
      list = list.filter(t => t.project_id === activeProject && t.status !== 'done' && t.status !== 'dropped')
    } else if (filter === 'backlog') {
      list = list.filter(t => t.status === 'open' && !t.do_date && !t.deadline)
    } else if (filter === 'done') {
      list = list.filter(t => t.status === 'done')
    } else if (filter === 'all') {
      // alles, behalve dropped
      list = list.filter(t => t.status !== 'dropped')
    }

    if (search.trim()) {
      const q = search.trim().toLowerCase()
      list = list.filter(t =>
        (t.title || '').toLowerCase().includes(q) ||
        (t.notes || '').toLowerCase().includes(q) ||
        (t.tags || []).some(tag => tag.toLowerCase().includes(q))
      )
    }

    return sortTasks(list)
  }, [tasks, filter, activeProject, search, viewDate])

  // "Mogelijk al klaar" candidates: filled door task-organizer skill
  const candidates = useMemo(
    () => tasks.filter(t =>
      t.completion_candidate &&
      !t.completion_rejected &&
      t.status !== 'done' &&
      t.status !== 'dropped'
    ),
    [tasks]
  )

  return (
    <div className="stack" style={{ gap: 'var(--s-5)' }}>
      <FilterBar
        active={filter}
        onSelect={pickFilter}
        stats={stats}
      />

      <ProjectStrip
        projects={projects}
        tasks={tasks}
        activeProject={filter === 'project' ? activeProject : null}
        onPick={(pid) => { setFilter('project'); setActiveProject(pid) }}
      />

      <section>
        <div className="section__head">
          <h2 className="section__title">
            {titleForFilter(filter, projects, activeProject, viewDate)}
            {visible.length > 0 && <span className="section__count">{visible.length}</span>}
          </h2>
          <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
            <input
              className="input"
              placeholder="zoeken…"
              value={search}
              onChange={e => setSearch(e.target.value)}
              style={{ width: 200 }}
            />
            <ReorganizeButton />
          </div>
        </div>

        {filter === 'today' && (
          <DaySwitcher viewDate={viewDate} onPick={setViewDate} tasks={tasks} />
        )}

        <TaskList
          tasks={visible}
          projects={projects}
        />
      </section>

      {candidates.length > 0 && <CompletionCandidates tasks={candidates} />}

      <QuickCapture projects={projects} />

      <ProjectsAdmin projects={projects} tasks={tasks} />

      <StatsStripFooter
        stats={stats}
        active={filter}
        onSelect={pickFilter}
      />
    </div>
  )
}

// =====================================================================
// Quick capture — type-and-go vanger
// =====================================================================

function QuickCapture({ projects }) {
  const [open, setOpen] = useState(false) // standaard ingeklapt — taken zijn de hoofd-focus
  const [text, setText] = useState('')
  const [projectId, setProjectId] = useState('')   // '' = laat AI bepalen
  const [busy, setBusy] = useState(false)
  const [hint, setHint] = useState(null)
  const [focused, setFocused] = useState(false)
  const inputRef = useRef(null)

  // Auto-focus input zodra je opent.
  const expand = () => {
    setOpen(true)
    setTimeout(() => inputRef.current?.focus(), 50)
  }

  // Live-parser: laat zien wat we straks zouden opslaan.
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

  // Ingeklapt: één regel met "+ Vang een taak" header.
  if (!open) {
    return (
      <section style={{ border: '1px solid var(--border)', borderRadius: 8 }}>
        <button
          type="button"
          onClick={expand}
          style={{
            width: '100%',
            display: 'flex',
            alignItems: 'center',
            gap: 10,
            padding: '10px 14px',
            background: 'transparent',
            border: 'none',
            cursor: 'pointer',
            textAlign: 'left',
            color: 'var(--text)',
          }}
        >
          <span style={{ fontSize: 12, color: 'var(--text-faint)', width: 12 }}>▸</span>
          <span style={{ fontWeight: 500 }}>✚ Vang een taak</span>
          <span className="muted" style={{ fontSize: 11, marginLeft: 'auto' }}>
            klik om te openen
          </span>
        </button>
      </section>
    )
  }

  // Uitgeklapt: volledig formulier.
  return (
    <section
      style={{
        border: '1px solid var(--border)',
        borderRadius: 8,
        background: 'rgba(124,138,255,0.04)',
        padding: 'var(--s-5)',
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 10 }}>
        <button
          type="button"
          onClick={() => setOpen(false)}
          className="btn btn--ghost"
          style={{ padding: '2px 8px', fontSize: 11 }}
          title="Inklappen"
        >▾</button>
        <span style={{ fontWeight: 600, fontSize: 14 }}>✚ Vang een taak</span>
        <span className="muted" style={{ fontSize: 11, marginLeft: 'auto' }}>
          tip: <code>→ vrijdag</code>, <code>!urgent</code>, <code>#tag</code>, <code>vandaag</code>
        </span>
      </div>

      <form onSubmit={submit} style={{ display: 'flex', gap: 8, alignItems: 'stretch', flexWrap: 'wrap' }}>
        <input
          ref={inputRef}
          className="input"
          value={text}
          onChange={e => setText(e.target.value)}
          onFocus={() => setFocused(true)}
          onBlur={() => setTimeout(() => setFocused(false), 150)}
          placeholder="wat wil je niet vergeten?"
          style={{
            flex: 1,
            minWidth: 280,
            fontSize: 16,
            padding: '10px 14px',
            borderRadius: 8,
          }}
        />
        <select
          className="input"
          value={projectId}
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
          type="submit"
          className="btn btn--accent"
          disabled={!text.trim() || busy}
          style={{ padding: '10px 18px', borderRadius: 8, fontWeight: 600 }}
        >
          {busy ? 'bezig…' : 'vangen ↵'}
        </button>
      </form>

      {showPreview && (
        <div style={{
          display: 'flex',
          gap: 6,
          flexWrap: 'wrap',
          alignItems: 'center',
          marginTop: 8,
          fontSize: 12,
          color: 'var(--text-faint)',
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
        <div style={{
          fontSize: 12,
          marginTop: 8,
          color: hint.kind === 'err' ? 'var(--error)' : 'var(--accent)',
        }}>
          {hint.msg}
        </div>
      )}
    </section>
  )
}

// =====================================================================
// FilterBar — bovenaan, compact (geen grote kpi-kaarten meer hier)
// =====================================================================

function FilterBar({ active, onSelect, stats }) {
  const items = [
    { id: 'today',   label: 'Vandaag',     count: stats.today,    accent: true },
    { id: 'week',    label: 'Deze week',   count: stats.week },
    { id: 'inbox',   label: 'Inbox',       count: stats.inbox,    urgent: stats.inbox > 6 },
    { id: 'backlog', label: 'Backlog',     count: stats.backlog },
    { id: 'all',     label: 'Alles',       count: stats.openTotal },
    { id: 'done',    label: 'Klaar',       count: stats.done },
  ]
  return (
    <div style={{
      display: 'flex',
      gap: 6,
      flexWrap: 'wrap',
      alignItems: 'center',
      padding: '4px 0',
      borderBottom: '1px solid var(--border)',
      paddingBottom: 12,
    }}>
      {items.map(item => {
        const isActive = active === item.id
        return (
          <button
            key={item.id}
            type="button"
            onClick={() => onSelect(item.id)}
            className="pill"
            style={{
              cursor: 'pointer',
              padding: '6px 14px',
              fontSize: 13,
              fontWeight: isActive ? 600 : 500,
              borderColor: isActive ? 'var(--accent)' : 'var(--border)',
              background: isActive ? 'rgba(124,138,255,0.12)' : 'transparent',
              color: isActive ? 'var(--accent)' : 'var(--text)',
            }}
          >
            {item.label}
            {item.count > 0 && (
              <span
                style={{
                  marginLeft: 8,
                  fontSize: 11,
                  fontWeight: 600,
                  color: isActive
                    ? 'var(--accent)'
                    : item.urgent
                      ? 'var(--warning)'
                      : 'var(--text-faint)',
                }}
              >
                {item.count}
              </span>
            )}
          </button>
        )
      })}
    </div>
  )
}

// =====================================================================
// DaySwitcher — chips voor Vandaag/Morgen/Overmorgen + ±1-pijlen + datepicker
// =====================================================================

function DaySwitcher({ viewDate, onPick, tasks }) {
  const today = startOfDay(new Date())
  const presets = [
    { label: 'Vandaag',     iso: ymd(today) },
    { label: 'Morgen',      iso: ymd(addDays(today, 1)) },
    { label: 'Overmorgen',  iso: ymd(addDays(today, 2)) },
  ]

  // Voeg de aankomende werkdag-namen toe (tot 5 dagen vooruit, geen weekend dubbel)
  const dayNamesNL = ['zo','ma','di','wo','do','vr','za']
  for (let i = 3; i <= 6; i++) {
    const d = addDays(today, i)
    presets.push({ label: dayNamesNL[d.getDay()], iso: ymd(d) })
  }

  // Counts per dag (open taken on or before that date)
  const counts = useMemo(() => {
    const c = {}
    for (const p of presets) c[p.iso] = 0
    for (const t of tasks) {
      if (t.status === 'done' || t.status === 'dropped') continue
      const d = t.do_date || t.deadline
      if (!d) continue
      if (c[d] !== undefined) c[d]++
    }
    return c
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tasks])

  const stepDay = (delta) => {
    const cur = new Date(viewDate)
    cur.setDate(cur.getDate() + delta)
    onPick(ymd(cur))
  }

  return (
    <div style={{
      display: 'flex',
      gap: 6,
      alignItems: 'center',
      flexWrap: 'wrap',
      marginBottom: 10,
      padding: '8px 0',
    }}>
      <button
        className="btn btn--ghost"
        onClick={() => stepDay(-1)}
        title="Vorige dag"
        style={{ padding: '4px 10px' }}
      >‹</button>

      {presets.map(p => {
        const isActive = viewDate === p.iso
        const n = counts[p.iso] || 0
        return (
          <button
            key={p.iso}
            type="button"
            onClick={() => onPick(p.iso)}
            className="pill"
            style={{
              cursor: 'pointer',
              padding: '4px 12px',
              fontSize: 12,
              fontWeight: isActive ? 600 : 500,
              borderColor: isActive ? 'var(--accent)' : 'var(--border)',
              background: isActive ? 'rgba(124,138,255,0.12)' : 'transparent',
              color: isActive ? 'var(--accent)' : 'var(--text)',
            }}
          >
            {p.label}
            {n > 0 && <span style={{ marginLeft: 6, fontSize: 10, color: 'var(--text-faint)' }}>{n}</span>}
          </button>
        )
      })}

      <button
        className="btn btn--ghost"
        onClick={() => stepDay(1)}
        title="Volgende dag"
        style={{ padding: '4px 10px' }}
      >›</button>

      <input
        type="date"
        value={viewDate}
        onChange={e => onPick(e.target.value)}
        className="input"
        style={{ marginLeft: 6, padding: '4px 8px', fontSize: 12, width: 140 }}
      />
    </div>
  )
}

// =====================================================================
// StatsStripFooter — onderaan, compact, niet afleidend
// =====================================================================

function StatsStripFooter({ stats, active, onSelect }) {
  const cells = [
    { id: 'today',   label: 'Vandaag',     value: stats.today,    accent: true },
    { id: 'week',    label: 'Deze week',   value: stats.week },
    { id: 'inbox',   label: 'Inbox',       value: stats.inbox,    urgent: stats.inbox > 6 },
    { id: 'backlog', label: 'Backlog',     value: stats.backlog },
    { id: 'all',     label: 'Alles open',  value: stats.openTotal },
    { id: 'done',    label: 'Klaar',       value: stats.done },
  ]
  return (
    <section style={{ marginTop: 'var(--s-5)' }}>
      <div className="muted" style={{ fontSize: 11, textTransform: 'uppercase', letterSpacing: 1, marginBottom: 8 }}>
        Stats
      </div>
      <div className="grid grid--kpi" style={{ gridTemplateColumns: 'repeat(6, minmax(0,1fr))' }}>
        {cells.map(c => (
          <button
            key={c.id}
            type="button"
            onClick={() => onSelect(c.id)}
            className="kpi"
            style={{
              cursor: 'pointer',
              border: active === c.id ? '1px solid var(--accent)' : '1px solid var(--border)',
              background: active === c.id ? 'rgba(124,138,255,0.06)' : 'transparent',
              textAlign: 'left',
              padding: '10px 12px',
            }}
          >
            <div className="kpi__value" style={{
              fontSize: 22,
              fontVariantNumeric: 'tabular-nums',
              color: c.accent ? 'var(--accent)' : c.urgent ? 'var(--warning)' : 'var(--text)',
            }}>{c.value}</div>
            <div className="kpi__label" style={{ fontSize: 11 }}>{c.label}</div>
          </button>
        ))}
      </div>
    </section>
  )
}

// Parse "… → vrijdag", "!urgent", "#tag" etc. uit titel.
function parseInlineMeta(text) {
  let title = text
  let deadline = null
  let do_date = null
  let priority = null
  const tags = []
  let note = null

  // !urgent / !high / !low
  const prio = title.match(/(?:^|\s)!(urgent|high|low|normal)\b/i)
  if (prio) {
    priority = prio[1].toLowerCase()
    title = title.replace(prio[0], '').trim()
  }

  // #tag
  title = title.replace(/(?:^|\s)#([a-z0-9_-]+)/gi, (_, t) => { tags.push(t.toLowerCase()); return '' }).trim()

  // → date  of  deadline: date
  const arrow = title.match(/(?:→|=>|deadline:?|voor)\s+([a-z0-9- ]+?)(?:\s|$)/i)
  if (arrow) {
    const parsed = parseDutchDate(arrow[1].trim())
    if (parsed) {
      deadline = parsed
      title = title.replace(arrow[0], '').trim()
      note = `Deadline geparsed: ${parsed}`
    }
  }

  // "vandaag" of "morgen" zonder pijl → do_date
  const todayKw = title.match(/\b(vandaag|morgen|overmorgen)\b/i)
  if (todayKw && !do_date) {
    const parsed = parseDutchDate(todayKw[1])
    if (parsed) {
      do_date = parsed
      title = title.replace(todayKw[0], '').trim()
    }
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
  // ISO
  if (/^\d{4}-\d{2}-\d{2}$/.test(t)) return t
  // dd-mm or dd/mm
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

// =====================================================================
// Project strip — quick filter per project
// =====================================================================

function ProjectStrip({ projects, tasks, activeProject, onPick }) {
  const counts = useMemo(() => {
    const c = {}
    for (const t of tasks) {
      if (t.status === 'done' || t.status === 'dropped') continue
      const key = t.project_id || '_inbox'
      c[key] = (c[key] || 0) + 1
    }
    return c
  }, [tasks])

  if (!projects.length) return null

  return (
    <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
      <span className="muted" style={{ fontSize: 12 }}>Projecten:</span>
      {projects.map(p => {
        const isActive = activeProject === p.id
        const n = counts[p.id] || 0
        return (
          <button
            key={p.id}
            type="button"
            onClick={() => onPick(p.id)}
            className="pill"
            style={{
              cursor: 'pointer',
              borderColor: isActive ? p.color || 'var(--accent)' : 'var(--border)',
              background: isActive ? (p.color || 'var(--accent)') + '22' : 'transparent',
              color: 'var(--text)',
              padding: '4px 10px',
            }}
            title={p.description || ''}
          >
            {p.icon && <span style={{ marginRight: 4 }}>{p.icon}</span>}
            {p.name}
            {n > 0 && <span className="muted" style={{ marginLeft: 6, fontSize: 11 }}>{n}</span>}
          </button>
        )
      })}
    </div>
  )
}

// =====================================================================
// Task list + row editor
// =====================================================================

// Eén grid-template, zo lijnen alle rijen netjes uit op kolommen.
//   ☐ | titel + notes | project | tags | prioriteit | datum | bron
const TASKROW_COLS = '24px minmax(0, 1fr) 160px 140px 80px 100px 64px'

function TaskList({ tasks, projects }) {
  if (!tasks.length) {
    return (
      <div className="empty">
        Niets hier — vang er een in via "Vang een taak" onderaan, of laat de AI projecten herindelen.
      </div>
    )
  }
  return (
    <div className="card" style={{ padding: 0, overflow: 'hidden' }}>
      {/* Kolomheader */}
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: TASKROW_COLS,
          gap: 10,
          padding: '8px 12px',
          fontSize: 10,
          fontWeight: 600,
          textTransform: 'uppercase',
          letterSpacing: 0.6,
          color: 'var(--text-faint)',
          borderBottom: '1px solid var(--border)',
          background: 'rgba(124,138,255,0.03)',
        }}
      >
        <span></span>
        <span>Taak</span>
        <span>Project</span>
        <span>Tags</span>
        <span>Prio</span>
        <span>Datum</span>
        <span>Bron</span>
      </div>

      <div>
        {tasks.map((t, i) => (
          <TaskRow
            key={t.id}
            task={t}
            projects={projects}
            isLast={i === tasks.length - 1}
          />
        ))}
      </div>
    </div>
  )
}

function TaskRow({ task, projects, isLast }) {
  const [open, setOpen] = useState(false)
  const project = projects.find(p => p.id === task.project_id) || null
  const overdue = isOverdue(task)
  const dueToday = isDueToday(task)

  const toggleDone = useCallback(async (e) => {
    e?.stopPropagation?.()
    const next = task.status === 'done' ? 'open' : 'done'
    await supabase.from('tasks').update({ status: next }).eq('id', task.id)
  }, [task.id, task.status])

  const dateCell = task.deadline
    ? { label: (overdue ? '⚠ ' : '') + formatDate(task.deadline),
        cls: overdue ? 's-error' : dueToday ? 's-warning' : '' }
    : task.do_date
      ? { label: '▶ ' + formatDate(task.do_date),
          cls: dueToday ? 's-warning' : '' }
      : null

  return (
    <div style={{ borderBottom: isLast ? 'none' : '1px solid var(--border)' }}>
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: TASKROW_COLS,
          gap: 10,
          alignItems: 'center',
          padding: '10px 12px',
          cursor: 'pointer',
          background: open ? 'rgba(124,138,255,0.04)' : 'transparent',
        }}
        onClick={() => setOpen(o => !o)}
      >
        {/* col 1: checkbox */}
        <input
          type="checkbox"
          checked={task.status === 'done'}
          onChange={toggleDone}
          onClick={e => e.stopPropagation()}
          style={{ margin: 0 }}
        />

        {/* col 2: titel + notes (truncate) */}
        <div style={{ minWidth: 0 }}>
          <div style={{
            color: task.status === 'done' ? 'var(--text-faint)' : 'var(--text)',
            textDecoration: task.status === 'done' ? 'line-through' : 'none',
            fontWeight: 500,
            fontSize: 14,
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            whiteSpace: 'nowrap',
          }}>
            {task.title}
          </div>
          {task.notes && !open && (
            <div className="muted" style={{
              fontSize: 12,
              marginTop: 2,
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              whiteSpace: 'nowrap',
            }}>{task.notes}</div>
          )}
        </div>

        {/* col 3: project */}
        <div style={{ minWidth: 0 }}>
          {project ? (
            <span
              className="pill"
              style={{
                padding: '2px 8px',
                fontSize: 11,
                background: (project.color || '#7c8aff') + '22',
                borderColor: 'transparent',
                display: 'inline-flex',
                alignItems: 'center',
                gap: 4,
                maxWidth: '100%',
                overflow: 'hidden',
                textOverflow: 'ellipsis',
                whiteSpace: 'nowrap',
              }}
              title={project.name}
            >
              {project.icon && <span>{project.icon}</span>}
              <span style={{ overflow: 'hidden', textOverflow: 'ellipsis' }}>{project.name}</span>
            </span>
          ) : (
            <span className="muted" style={{ fontSize: 11, fontStyle: 'italic' }}>—</span>
          )}
        </div>

        {/* col 4: tags */}
        <div style={{
          minWidth: 0,
          fontSize: 11,
          color: 'var(--accent)',
          overflow: 'hidden',
          textOverflow: 'ellipsis',
          whiteSpace: 'nowrap',
        }}>
          {(task.tags || []).slice(0, 3).map(tag => (
            <span key={tag} style={{ marginRight: 6 }}>#{tag}</span>
          ))}
          {(!task.tags || task.tags.length === 0) && <span className="muted">—</span>}
        </div>

        {/* col 5: prioriteit */}
        <div>
          {task.priority && task.priority !== 'normal' ? (
            <span className={`pill ${PRIORITY_PILL[task.priority] || ''}`} style={{ padding: '2px 8px', fontSize: 11 }}>
              {PRIORITY_LABEL[task.priority]}
            </span>
          ) : (
            <span className="muted" style={{ fontSize: 11 }}>—</span>
          )}
        </div>

        {/* col 6: datum */}
        <div>
          {dateCell ? (
            <span className={`pill ${dateCell.cls}`} style={{ padding: '2px 8px', fontSize: 11 }}>
              {dateCell.label}
            </span>
          ) : (
            <span className="muted" style={{ fontSize: 11 }}>—</span>
          )}
        </div>

        {/* col 7: bron */}
        <div style={{ fontSize: 11, color: 'var(--text-faint)', textAlign: 'right' }}>
          {task.source !== 'manual' ? (
            <span title={task.source_url || task.source_ref || ''}>
              {SOURCE_LABEL[task.source] || task.source}
            </span>
          ) : (
            <span className="muted">·</span>
          )}
        </div>
      </div>

      {open && (
        <div style={{ padding: '4px 12px 12px 12px', background: 'rgba(124,138,255,0.04)' }}>
          <TaskEditor task={task} projects={projects} onClose={() => setOpen(false)} />
        </div>
      )}
    </div>
  )
}

function TaskEditor({ task, projects, onClose }) {
  const [draft, setDraft] = useState({
    title:    task.title || '',
    notes:    task.notes || '',
    project_id: task.project_id || '',
    priority: task.priority || 'normal',
    effort:   task.effort || '',
    deadline: task.deadline || '',
    do_date:  task.do_date  || '',
    tags:     (task.tags || []).join(' '),
    status:   task.status || 'open',
  })
  const [busy, setBusy] = useState(false)

  const save = async () => {
    setBusy(true)
    try {
      const patch = {
        title: draft.title.trim(),
        notes: draft.notes.trim() || null,
        project_id: draft.project_id || null,
        priority: draft.priority,
        effort: draft.effort || null,
        deadline: draft.deadline || null,
        do_date:  draft.do_date  || null,
        status:   draft.status,
        tags: draft.tags.trim()
          ? draft.tags.trim().split(/\s+/).map(s => s.replace(/^#/, '').toLowerCase()).filter(Boolean)
          : [],
        ai_processed: true, // user touched it manually
      }
      await supabase.from('tasks').update(patch).eq('id', task.id)
      onClose?.()
    } finally {
      setBusy(false)
    }
  }

  const drop = async () => {
    if (!confirm('Taak weggooien?')) return
    await supabase.from('tasks').update({ status: 'dropped' }).eq('id', task.id)
    onClose?.()
  }

  const reopen = async () => {
    await supabase.from('tasks').update({ ai_processed: false }).eq('id', task.id)
  }

  return (
    <div style={{
      borderTop: '1px solid var(--border)',
      marginTop: 10,
      paddingTop: 10,
      display: 'grid',
      gridTemplateColumns: '1fr 1fr',
      gap: 10,
    }}>
      <label className="stack stack--xs" style={{ gridColumn: '1 / -1' }}>
        <span className="muted" style={{ fontSize: 11 }}>Titel</span>
        <input className="input" value={draft.title} onChange={e => setDraft({ ...draft, title: e.target.value })} />
      </label>
      <label className="stack stack--xs" style={{ gridColumn: '1 / -1' }}>
        <span className="muted" style={{ fontSize: 11 }}>Notities</span>
        <textarea
          className="input"
          rows={3}
          value={draft.notes}
          onChange={e => setDraft({ ...draft, notes: e.target.value })}
        />
      </label>
      <label className="stack stack--xs">
        <span className="muted" style={{ fontSize: 11 }}>Project</span>
        <select className="input" value={draft.project_id} onChange={e => setDraft({ ...draft, project_id: e.target.value })}>
          <option value="">— geen —</option>
          {projects.map(p => <option key={p.id} value={p.id}>{p.icon} {p.name}</option>)}
        </select>
      </label>
      <label className="stack stack--xs">
        <span className="muted" style={{ fontSize: 11 }}>Status</span>
        <select className="input" value={draft.status} onChange={e => setDraft({ ...draft, status: e.target.value })}>
          {Object.entries(STATUS_LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
        </select>
      </label>
      <label className="stack stack--xs">
        <span className="muted" style={{ fontSize: 11 }}>Prioriteit</span>
        <select className="input" value={draft.priority} onChange={e => setDraft({ ...draft, priority: e.target.value })}>
          {Object.entries(PRIORITY_LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
        </select>
      </label>
      <label className="stack stack--xs">
        <span className="muted" style={{ fontSize: 11 }}>Effort</span>
        <select className="input" value={draft.effort} onChange={e => setDraft({ ...draft, effort: e.target.value })}>
          <option value="">—</option>
          {Object.entries(EFFORT_LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
        </select>
      </label>
      <label className="stack stack--xs">
        <span className="muted" style={{ fontSize: 11 }}>Doe-datum</span>
        <input className="input" type="date" value={draft.do_date} onChange={e => setDraft({ ...draft, do_date: e.target.value })} />
      </label>
      <label className="stack stack--xs">
        <span className="muted" style={{ fontSize: 11 }}>Deadline</span>
        <input className="input" type="date" value={draft.deadline} onChange={e => setDraft({ ...draft, deadline: e.target.value })} />
      </label>
      <label className="stack stack--xs" style={{ gridColumn: '1 / -1' }}>
        <span className="muted" style={{ fontSize: 11 }}>Tags (spatie-gescheiden)</span>
        <input className="input" value={draft.tags} onChange={e => setDraft({ ...draft, tags: e.target.value })} placeholder="bv. opvolg klant-x" />
      </label>

      {task.ai_reasoning && (
        <div className="muted" style={{ gridColumn: '1 / -1', fontSize: 11, fontStyle: 'italic', borderLeft: '2px solid var(--accent)', paddingLeft: 8 }}>
          AI: {task.ai_reasoning}
        </div>
      )}
      {task.source_url && (
        <div style={{ gridColumn: '1 / -1', fontSize: 11 }}>
          <a href={task.source_url} target="_blank" rel="noreferrer" className="muted">↗ bron</a>
        </div>
      )}

      <div style={{ gridColumn: '1 / -1', display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
        <button className="btn btn--ghost" onClick={reopen} title="Markeer voor AI-herindeling">↻ AI opnieuw</button>
        <button className="btn btn--ghost" onClick={drop} style={{ color: 'var(--error)' }}>weggooien</button>
        <button className="btn btn--ghost" onClick={onClose}>annuleer</button>
        <button className="btn btn--accent" onClick={save} disabled={busy}>{busy ? '…' : 'opslaan'}</button>
      </div>
    </div>
  )
}

// =====================================================================
// AI re-organise button
// =====================================================================

function ReorganizeButton() {
  const [state, setState] = useState('idle') // idle | submitting | ok | err
  const [msg, setMsg] = useState(null)

  const trigger = async () => {
    if (state === 'submitting') return
    setState('submitting')
    setMsg(null)
    try {
      // Markeer alle open taken voor herindeling.
      await supabase.from('tasks').update({ ai_processed: false }).neq('status', 'done').neq('status', 'dropped')
      // Vraag de orchestrator om de skill nu te draaien.
      const { data, error } = await supabase.rpc('request_run_now', { agent: AGENT })
      if (error) throw error
      if (data?.ok) {
        setState('ok')
        setMsg(data.status === 'already_requested'
          ? 'Aanvraag stond al open — wacht op orchestrator.'
          : 'Skill aangevraagd — orchestrator pakt hem bij volgende poll op.')
      } else {
        setState('err'); setMsg(data?.reason || 'mislukt')
      }
    } catch (err) {
      setState('err'); setMsg(err.message || 'mislukt')
    } finally {
      setTimeout(() => { setState('idle'); setMsg(null) }, 5000)
    }
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 4 }}>
      <button
        className="btn btn--ghost"
        onClick={trigger}
        disabled={state === 'submitting'}
        title="Markeer alles voor herindeling en draai task-organizer-skill"
      >
        ✨ AI herindelen
      </button>
      {msg && (
        <div className="muted" style={{ fontSize: 11, color: state === 'err' ? 'var(--error)' : 'var(--accent)' }}>{msg}</div>
      )}
    </div>
  )
}

// =====================================================================
// Projects admin (klein blok onderaan)
// =====================================================================

function ProjectsAdmin({ projects, tasks }) {
  const [adding, setAdding] = useState(false)
  const [name, setName]     = useState('')
  const [icon, setIcon]     = useState('')
  const [hint, setHint]     = useState('')
  const [busy, setBusy]     = useState(false)

  const add = async () => {
    if (!name.trim() || busy) return
    setBusy(true)
    try {
      await supabase.from('task_projects').insert({
        name: name.trim(),
        icon: icon.trim() || null,
        ai_match_hint: hint.trim() || null,
        sort_order: 100 + (projects.length || 0),
      })
      setName(''); setIcon(''); setHint(''); setAdding(false)
    } finally {
      setBusy(false)
    }
  }

  const counts = useMemo(() => {
    const c = {}
    for (const t of tasks) {
      if (t.status === 'done' || t.status === 'dropped') continue
      if (t.project_id) c[t.project_id] = (c[t.project_id] || 0) + 1
    }
    return c
  }, [tasks])

  return (
    <section>
      <div className="section__head">
        <h2 className="section__title">Projecten</h2>
        <button className="btn btn--ghost" onClick={() => setAdding(a => !a)}>
          {adding ? '× annuleer' : '+ nieuw project'}
        </button>
      </div>

      {adding && (
        <div className="card" style={{ padding: 'var(--s-4)', marginBottom: 8 }}>
          <div style={{ display: 'grid', gridTemplateColumns: '60px 1fr', gap: 8 }}>
            <input className="input" placeholder="🌱" value={icon} onChange={e => setIcon(e.target.value)} />
            <input className="input" placeholder="Naam" value={name} onChange={e => setName(e.target.value)} />
          </div>
          <textarea
            className="input"
            placeholder="AI match hint — wat hoort bij dit project? (bv. 'klanten / sales / pipeline')"
            value={hint}
            onChange={e => setHint(e.target.value)}
            rows={2}
            style={{ marginTop: 8, width: '100%' }}
          />
          <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 8 }}>
            <button className="btn btn--accent" onClick={add} disabled={!name.trim() || busy}>
              {busy ? '…' : 'aanmaken'}
            </button>
          </div>
        </div>
      )}

      <div className="stack stack--sm">
        {projects.map(p => (
          <ProjectAdminRow key={p.id} project={p} count={counts[p.id] || 0} />
        ))}
      </div>
    </section>
  )
}

function ProjectAdminRow({ project, count }) {
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState({
    name: project.name,
    icon: project.icon || '',
    color: project.color || '#7c8aff',
    ai_match_hint: project.ai_match_hint || '',
    description: project.description || '',
    deadline: project.deadline || '',
    status: project.status || 'active',
  })

  const save = async () => {
    await supabase.from('task_projects').update({
      name: draft.name.trim(),
      icon: draft.icon || null,
      color: draft.color || null,
      ai_match_hint: draft.ai_match_hint || null,
      description: draft.description || null,
      deadline: draft.deadline || null,
      status: draft.status,
    }).eq('id', project.id)
    setEditing(false)
  }

  if (!editing) {
    return (
      <div className="card" style={{ padding: '10px 12px', display: 'flex', alignItems: 'center', gap: 10 }}>
        <span style={{ fontSize: 18 }}>{project.icon || '·'}</span>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontWeight: 500 }}>{project.name}</div>
          {project.ai_match_hint && (
            <div className="muted" style={{ fontSize: 11, marginTop: 2 }}>{project.ai_match_hint}</div>
          )}
        </div>
        <span className="muted" style={{ fontSize: 12 }}>{count} open</span>
        {project.status === 'archived' && <span className="pill s-idle">archief</span>}
        <button className="btn btn--ghost" onClick={() => setEditing(true)}>bewerk</button>
      </div>
    )
  }

  return (
    <div className="card" style={{ padding: 12 }}>
      <div style={{ display: 'grid', gridTemplateColumns: '60px 80px 1fr 120px', gap: 8, marginBottom: 8 }}>
        <input className="input" value={draft.icon}  onChange={e => setDraft({ ...draft, icon: e.target.value })}  placeholder="emoji" />
        <input className="input" value={draft.color} onChange={e => setDraft({ ...draft, color: e.target.value })} placeholder="#7c8aff" />
        <input className="input" value={draft.name}  onChange={e => setDraft({ ...draft, name: e.target.value })} />
        <select className="input" value={draft.status} onChange={e => setDraft({ ...draft, status: e.target.value })}>
          <option value="active">actief</option>
          <option value="archived">archief</option>
        </select>
      </div>
      <textarea
        className="input"
        rows={2}
        value={draft.ai_match_hint}
        onChange={e => setDraft({ ...draft, ai_match_hint: e.target.value })}
        placeholder="AI match hint — wat valt onder dit project?"
        style={{ marginBottom: 8, width: '100%' }}
      />
      <input
        className="input"
        type="date"
        value={draft.deadline}
        onChange={e => setDraft({ ...draft, deadline: e.target.value })}
        style={{ marginBottom: 8 }}
      />
      <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
        <button className="btn btn--ghost" onClick={() => setEditing(false)}>annuleer</button>
        <button className="btn btn--accent" onClick={save}>opslaan</button>
      </div>
    </div>
  )
}

// =====================================================================
// "Mogelijk al klaar" — kandidaten gevuld door task-organizer skill
// =====================================================================

const SOURCE_LABEL_DONE = {
  autodraft:       'Mail (AutoDraft)',
  draft_events:    'Mail-drafts',
  sales_todos:     'Sales TODO',
  linkedin:        'LinkedIn',
  agent_proposals: 'Daily Admin',
  hubspot:         'HubSpot',
  sales_on_road:   'Road Notes',
  km_trips:        'Kilometerregistratie',
  fireflies:       'Fireflies',
  agent_runs:      'Skill-run',
  other:           'Anders',
}

function CompletionCandidates({ tasks }) {
  const [open, setOpen] = useState(false) // standaard ingeklapt — niet afleidend
  const [busy, setBusy] = useState(false)

  const acceptOne = async (id) => {
    await supabase.from('tasks').update({
      status: 'done',
      completion_candidate: false,
    }).eq('id', id)
  }

  const rejectOne = async (id) => {
    await supabase.from('tasks').update({
      completion_candidate: false,
      completion_rejected: true,
    }).eq('id', id)
  }

  const acceptAll = async () => {
    if (busy) return
    if (!confirm(`${tasks.length} taken op klaar zetten?`)) return
    setBusy(true)
    try {
      const ids = tasks.map(t => t.id)
      await supabase.from('tasks').update({
        status: 'done',
        completion_candidate: false,
      }).in('id', ids)
    } finally { setBusy(false) }
  }

  const rejectAll = async () => {
    if (busy) return
    if (!confirm(`${tasks.length} taken behouden ("nee, moet ik nog doen")?`)) return
    setBusy(true)
    try {
      const ids = tasks.map(t => t.id)
      await supabase.from('tasks').update({
        completion_candidate: false,
        completion_rejected: true,
      }).in('id', ids)
    } finally { setBusy(false) }
  }

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
          width: '100%',
          display: 'flex',
          alignItems: 'center',
          gap: 10,
          padding: '10px 14px',
          background: 'transparent',
          border: 'none',
          cursor: 'pointer',
          textAlign: 'left',
          color: 'var(--text)',
        }}
      >
        <span style={{ fontSize: 12, color: 'var(--text-faint)', width: 12 }}>
          {open ? '▾' : '▸'}
        </span>
        <span style={{ fontWeight: 500 }}>✨ Mogelijk al klaar</span>
        <span style={{
          padding: '2px 8px',
          borderRadius: 10,
          fontSize: 11,
          fontWeight: 600,
          background: 'rgba(124,138,255,0.15)',
          color: 'var(--accent)',
        }}>{tasks.length}</span>
        <span className="muted" style={{ fontSize: 11, marginLeft: 'auto' }}>
          {open ? '' : 'klik om te bekijken'}
        </span>
      </button>

      {open && (
        <div style={{ padding: '4px 14px 14px 14px' }}>
          <div className="muted" style={{ fontSize: 12, marginBottom: 10 }}>
            Signalen uit andere systemen (mail, sales, LinkedIn, HubSpot) suggereren dat deze al gedaan zijn. Bekijk per stuk en bevestig.
          </div>

          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 6, marginBottom: 10 }}>
            <button className="btn btn--ghost" onClick={rejectAll} disabled={busy} title="Allemaal behouden — moest ik echt nog doen">× alles behouden</button>
            <button className="btn btn--accent" onClick={acceptAll} disabled={busy} title="Allemaal afvinken — bevestigt dat ze klaar zijn">✓ alles klaar</button>
          </div>

          <div className="stack stack--sm" style={{ gap: 6 }}>
            {tasks.map(t => (
              <CompletionCandidateRow
                key={t.id}
                task={t}
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
    ? Math.round(task.completion_confidence * 100)
    : null

  return (
    <div className="card" style={{ padding: '8px 12px', display: 'flex', alignItems: 'center', gap: 10 }}>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontWeight: 500, fontSize: 14 }}>{task.title}</div>
        <div className="muted" style={{ fontSize: 11, marginTop: 3 }}>
          <span style={{ color: 'var(--accent)' }}>
            {SOURCE_LABEL_DONE[task.completion_source] || task.completion_source || 'signaal'}
          </span>
          {conf != null && <span style={{ marginLeft: 6 }}>({conf}% zeker)</span>}
          {task.completion_evidence && <span style={{ marginLeft: 6 }}>· {task.completion_evidence}</span>}
        </div>
      </div>
      {task.completion_evidence_url && (
        <a href={task.completion_evidence_url} target="_blank" rel="noreferrer" className="muted" style={{ fontSize: 11 }}>
          ↗ bron
        </a>
      )}
      <button
        className="btn btn--ghost"
        onClick={async () => { setBusy(true); try { await onReject() } finally { setBusy(false) } }}
        disabled={busy}
        title="Nee, dat moest ik nog doen"
      >
        × nee
      </button>
      <button
        className="btn btn--accent"
        onClick={async () => { setBusy(true); try { await onAccept() } finally { setBusy(false) } }}
        disabled={busy}
        title="Ja, is al klaar"
      >
        ✓ klaar
      </button>
    </div>
  )
}

// =====================================================================
// Helpers
// =====================================================================

function startOfDay(d) { const x = new Date(d); x.setHours(0,0,0,0); return x }
function addDays(d, n) { const x = new Date(d); x.setDate(x.getDate() + n); return x }
function ymd(d) { return d.toISOString().slice(0, 10) }

function isToday(t, today) {
  if (t.status === 'done' || t.status === 'dropped') return false
  if (t.snooze_until && new Date(t.snooze_until) > today) return false
  const y = ymd(today)
  if (t.do_date === y) return true
  if (t.deadline === y) return true
  if (t.deadline && t.deadline < y) return true // overdue
  return false
}

// "Wat staat er op deze specifieke dag?" — voor de DaySwitcher.
// Geen overdue-toevoeging (die hoort alleen bij Vandaag).
function isOnDate(t, isoDate) {
  if (t.status === 'done' || t.status === 'dropped') return false
  return t.do_date === isoDate || t.deadline === isoDate
}

function isThisWeek(t, today, weekEnd) {
  if (t.status === 'done' || t.status === 'dropped') return false
  const yToday = ymd(today)
  const yEnd   = ymd(weekEnd)
  if (t.do_date && t.do_date >= yToday && t.do_date < yEnd)   return true
  if (t.deadline && t.deadline >= yToday && t.deadline < yEnd) return true
  if (t.deadline && t.deadline < yToday) return true // overdue valt ook in week-bucket
  return false
}

function isOverdue(t) {
  if (!t.deadline || t.status === 'done' || t.status === 'dropped') return false
  return new Date(t.deadline) < startOfDay(new Date())
}
function isDueToday(t) {
  const y = ymd(startOfDay(new Date()))
  return t.deadline === y || t.do_date === y
}

function computeStats(tasks) {
  const today = startOfDay(new Date())
  const weekEnd = addDays(today, 7)
  let s = { today: 0, week: 0, inbox: 0, backlog: 0, openTotal: 0, done: 0 }
  for (const t of tasks) {
    if (t.status === 'done') { s.done++; continue }
    if (t.status === 'dropped') continue
    s.openTotal++
    if (isToday(t, today)) s.today++
    if (isThisWeek(t, today, weekEnd)) s.week++
    if (!t.project_id) s.inbox++
    if (t.status === 'open' && !t.do_date && !t.deadline) s.backlog++
  }
  return s
}

// Sortering: overdue eerst, dan vandaag, dan op deadline/do_date, dan op priority, dan nieuw → oud.
function sortTasks(list) {
  const today = ymd(startOfDay(new Date()))
  const prioRank = { urgent: 0, high: 1, normal: 2, low: 3 }
  return list.slice().sort((a, b) => {
    const aOver = a.deadline && a.deadline < today && a.status !== 'done'
    const bOver = b.deadline && b.deadline < today && b.status !== 'done'
    if (aOver !== bOver) return aOver ? -1 : 1
    const aDate = a.do_date || a.deadline || '9999-99-99'
    const bDate = b.do_date || b.deadline || '9999-99-99'
    if (aDate !== bDate) return aDate.localeCompare(bDate)
    const aP = prioRank[a.priority || 'normal']
    const bP = prioRank[b.priority || 'normal']
    if (aP !== bP) return aP - bP
    return new Date(b.created_at) - new Date(a.created_at)
  })
}

function titleForFilter(filter, projects, activeProject, viewDate) {
  if (filter === 'today') {
    if (!viewDate) return 'Vandaag'
    const today = ymd(startOfDay(new Date()))
    if (viewDate === today) return 'Vandaag'
    if (viewDate === ymd(addDays(startOfDay(new Date()), 1))) return 'Morgen'
    if (viewDate === ymd(addDays(startOfDay(new Date()), 2))) return 'Overmorgen'
    return new Date(viewDate).toLocaleDateString('nl-NL', { weekday: 'long', day: 'numeric', month: 'long' })
  }
  if (filter === 'week')    return 'Deze week'
  if (filter === 'inbox')   return 'Inbox — wachten op AI-clustering'
  if (filter === 'backlog') return 'Backlog — geen datum, geen project'
  if (filter === 'all')     return 'Alle open taken'
  if (filter === 'done')    return 'Afgevinkt'
  if (filter === 'project') {
    const p = projects.find(x => x.id === activeProject)
    return p ? `${p.icon || ''} ${p.name}` : 'Project'
  }
  return 'Taken'
}

function formatDate(iso) {
  if (!iso) return ''
  const d = new Date(iso)
  const today = startOfDay(new Date())
  const tom   = addDays(today, 1)
  const yIso  = ymd(today)
  const tIso  = ymd(tom)
  if (iso === yIso) return 'vandaag'
  if (iso === tIso) return 'morgen'
  return d.toLocaleDateString('nl-NL', { day: '2-digit', month: 'short' })
}

function truncate(s, n) {
  if (!s) return ''
  return s.length > n ? s.slice(0, n - 1) + '…' : s
}
