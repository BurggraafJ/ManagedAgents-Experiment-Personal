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

  const [filter, setFilter] = useState('today') // today | week | inbox | project | backlog | all
  const [activeProject, setActiveProject] = useState(null) // project_id when filter = 'project'
  const [search, setSearch] = useState('')

  const stats = useMemo(() => computeStats(tasks), [tasks])

  // Filter tasks based on active filter
  const visible = useMemo(() => {
    let list = tasks
    const today = startOfDay(new Date())
    const weekEnd = addDays(today, 7)

    if (filter === 'today') {
      list = list.filter(t => isToday(t, today))
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
  }, [tasks, filter, activeProject, search])

  return (
    <div className="stack" style={{ gap: 'var(--s-6)' }}>
      <QuickCapture projects={projects} />

      <StatsStrip
        stats={stats}
        active={filter}
        onSelect={setFilter}
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
            {titleForFilter(filter, projects, activeProject)}
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

        <TaskList
          tasks={visible}
          projects={projects}
        />
      </section>

      <ProjectsAdmin projects={projects} tasks={tasks} />
    </div>
  )
}

// =====================================================================
// Quick capture — type-and-go vanger
// =====================================================================

function QuickCapture({ projects }) {
  const [text, setText] = useState('')
  const [projectId, setProjectId] = useState('')   // '' = laat AI bepalen
  const [busy, setBusy] = useState(false)
  const [hint, setHint] = useState(null)
  const inputRef = useRef(null)

  const submit = useCallback(async (e) => {
    e?.preventDefault?.()
    const title = text.trim()
    if (!title || busy) return
    setBusy(true)
    setHint(null)
    try {
      // Heel simpele inline parser: "→ vrijdag" of "deadline: vrijdag"
      // Niets te magisch — task-organizer skill kan altijd later upgraden.
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
        ai_processed: !!projectId, // als jij een project kiest hoeft de AI hem niet meer te clusteren
      }
      const { error } = await supabase.from('tasks').insert(row)
      if (error) throw error
      setText('')
      setProjectId('')
      setHint({ kind: 'ok', msg: parsed.note || 'Gevangen.' })
      setTimeout(() => setHint(null), 2400)
      inputRef.current?.focus()
    } catch (err) {
      setHint({ kind: 'err', msg: err.message || 'Mislukt' })
    } finally {
      setBusy(false)
    }
  }, [text, projectId, busy])

  return (
    <section className="card" style={{ padding: 'var(--s-5)' }}>
      <form onSubmit={submit} style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
        <input
          ref={inputRef}
          className="input"
          value={text}
          onChange={e => setText(e.target.value)}
          placeholder="wat wil je niet vergeten? (tip: '… → vrijdag' of '!urgent')"
          style={{ flex: 1, minWidth: 260, fontSize: 15 }}
          autoFocus
        />
        <select
          className="input"
          value={projectId}
          onChange={e => setProjectId(e.target.value)}
          style={{ width: 200 }}
          title="Laat leeg om de AI te laten clusteren"
        >
          <option value="">— laat AI clusteren —</option>
          {projects.map(p => (
            <option key={p.id} value={p.id}>{p.icon ? p.icon + ' ' : ''}{p.name}</option>
          ))}
        </select>
        <button
          type="submit"
          className="btn btn--accent"
          disabled={!text.trim() || busy}
        >
          {busy ? 'bezig…' : 'vangen ↵'}
        </button>
      </form>
      {hint && (
        <div className="muted" style={{ fontSize: 12, marginTop: 8, color: hint.kind === 'err' ? 'var(--error)' : 'var(--accent)' }}>
          {hint.msg}
        </div>
      )}
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
// Stats strip — klikbare filterchips
// =====================================================================

function StatsStrip({ stats, active, onSelect }) {
  const cells = [
    { id: 'today',   label: 'Vandaag',     value: stats.today,    accent: true },
    { id: 'week',    label: 'Deze week',   value: stats.week },
    { id: 'inbox',   label: 'Inbox',       value: stats.inbox,    urgent: stats.inbox > 6 },
    { id: 'backlog', label: 'Backlog',     value: stats.backlog },
    { id: 'all',     label: 'Alles open',  value: stats.openTotal },
    { id: 'done',    label: 'Klaar',       value: stats.done },
  ]
  return (
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
            background: active === c.id ? 'var(--accent-bg, rgba(124,138,255,0.08))' : 'transparent',
            textAlign: 'left',
          }}
        >
          <div className="kpi__value" style={{
            fontVariantNumeric: 'tabular-nums',
            color: c.accent ? 'var(--accent)' : c.urgent ? 'var(--warning)' : 'var(--text)'
          }}>{c.value}</div>
          <div className="kpi__label">{c.label}</div>
        </button>
      ))}
    </div>
  )
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

function TaskList({ tasks, projects }) {
  if (!tasks.length) {
    return (
      <div className="empty">
        Niets hier — vang er een in via het veld bovenaan, of laat de AI projecten herindelen.
      </div>
    )
  }
  return (
    <div className="stack stack--sm" style={{ gap: 6 }}>
      {tasks.map(t => <TaskRow key={t.id} task={t} projects={projects} />)}
    </div>
  )
}

function TaskRow({ task, projects }) {
  const [open, setOpen] = useState(false)
  const project = projects.find(p => p.id === task.project_id) || null
  const overdue = isOverdue(task)
  const dueToday = isDueToday(task)

  const toggleDone = useCallback(async (e) => {
    e?.stopPropagation?.()
    const next = task.status === 'done' ? 'open' : 'done'
    await supabase.from('tasks').update({ status: next }).eq('id', task.id)
  }, [task.id, task.status])

  return (
    <div className="card" style={{ padding: '8px 12px' }}>
      <div
        style={{ display: 'flex', alignItems: 'center', gap: 10, cursor: 'pointer' }}
        onClick={() => setOpen(o => !o)}
      >
        <input
          type="checkbox"
          checked={task.status === 'done'}
          onChange={toggleDone}
          onClick={e => e.stopPropagation()}
          style={{ flexShrink: 0 }}
        />

        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{
            color: task.status === 'done' ? 'var(--text-faint)' : 'var(--text)',
            textDecoration: task.status === 'done' ? 'line-through' : 'none',
            fontWeight: 500,
            fontSize: 14,
          }}>
            {task.title}
          </div>
          {task.notes && !open && (
            <div className="muted" style={{ fontSize: 12, marginTop: 2 }}>{truncate(task.notes, 100)}</div>
          )}
        </div>

        <div style={{ display: 'flex', gap: 6, alignItems: 'center', flexShrink: 0, fontSize: 11 }}>
          {project && (
            <span className="pill" style={{
              padding: '2px 8px',
              background: (project.color || '#7c8aff') + '22',
              borderColor: 'transparent',
            }}>
              {project.icon && <span style={{ marginRight: 3 }}>{project.icon}</span>}
              {project.name}
            </span>
          )}
          {(task.tags || []).slice(0, 3).map(tag => (
            <span key={tag} className="muted" style={{ fontSize: 11 }}>#{tag}</span>
          ))}
          {task.priority && task.priority !== 'normal' && (
            <span className={`pill ${PRIORITY_PILL[task.priority] || ''}`} style={{ padding: '2px 8px' }}>
              {PRIORITY_LABEL[task.priority]}
            </span>
          )}
          {task.deadline && (
            <span className={`pill ${overdue ? 's-error' : dueToday ? 's-warning' : ''}`} style={{ padding: '2px 8px' }}>
              {overdue ? '⚠ ' : ''}{formatDate(task.deadline)}
            </span>
          )}
          {task.do_date && !task.deadline && (
            <span className={`pill ${dueToday ? 's-warning' : ''}`} style={{ padding: '2px 8px' }} title="Doe-datum">
              ▶ {formatDate(task.do_date)}
            </span>
          )}
          {task.source !== 'manual' && (
            <span className="muted" title={task.source_url || task.source_ref || ''}>{SOURCE_LABEL[task.source] || task.source}</span>
          )}
        </div>
      </div>

      {open && <TaskEditor task={task} projects={projects} onClose={() => setOpen(false)} />}
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

function titleForFilter(filter, projects, activeProject) {
  if (filter === 'today')   return 'Vandaag'
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
