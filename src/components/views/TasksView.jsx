import { useState, useMemo, useEffect, useRef, useCallback } from 'react'
import { supabase } from '../../lib/supabase'

// =====================================================================
// TasksView — Unified Taken (v2)
// =====================================================================
// Eén pagina voor alles wat Jelle moet doen. Voorheen verspreid over
// /taken (task-organizer) en /daily-tasks (sales-followups). De /daily-tasks
// route is verwijderd uit de sidebar; sales-rijen verschijnen hieronder
// als eigen sectie.
//
// Hoofd-layout (van boven naar beneden):
//   [Quick capture]                       [✨ AI herindelen]
//   [zoeken …]
//   🆕 Nieuw gevonden (alleen voor Jelle, met Houden / Backlog / Negeren)
//   🤝 Klant — live + ▸ Backlog
//   🔥 Hoog — live + ▸ Backlog
//   ⚙ Midden — live + ▸ Backlog
//   ⚪ Laag — live + ▸ Backlog
//   📞 Sales follow-ups (sales_todos, los read-only blok)
//   📋 Jira-overzicht (collapsed)
//   ✨ Mogelijk al klaar (collapsed)
//   📁 Projecten (collapsed)
//
// Mutaties: direct via supabase met optimistic update bij Houden/Backlog/×.
// =====================================================================

const AGENT = 'task-organizer'

const STATUS_LABEL   = { open:'open', done:'klaar', blocked:'geblokt', snoozed:'uitgesteld', dropped:'gedropt' }
const PRIORITY_LABEL = { low:'laag', normal:'normaal', high:'hoog', urgent:'urgent' }
const PRIORITY_PILL  = { low:'s-idle', normal:'', high:'s-warning', urgent:'s-error' }
const EFFORT_LABEL   = { quick:'⚡ quick', medium:'medium', deep:'deep work' }
const SOURCE_LABEL   = {
  manual:'handmatig', fireflies:'Fireflies', email:'mail', slack:'Slack',
  voice:'spraak', agent:'agent', jira:'Jira', other:'overig',
}
const JIRA_BOARD_COLOR = { Sales:'#7c8aff', Management:'#22c55e', Recruitment:'#f59e0b' }

// Mapping naar drie buckets — combineert priority + datum-urgentie zodat de
// Hoog-bucket niet leeg blijft als de skill nooit priority='high' heeft gezet.
function bucketOf(task) {
  const p = (task.priority || 'normal').toLowerCase()
  if (p === 'urgent' || p === 'high') return 'high'

  // Datum-urgentie weegt mee: overdue + vandaag + binnen 3 dagen → hoog.
  const today = new Date(); today.setHours(0,0,0,0)
  const todayIso = today.toISOString().slice(0, 10)
  const due = task.deadline || task.do_date
  if (due) {
    if (due < todayIso) return 'high' // overdue
    if (due === todayIso) return 'high' // vandaag
    const d = new Date(due); d.setHours(0,0,0,0)
    const diffDays = Math.round((d - today) / 86400000)
    if (diffDays <= 3) return 'high' // binnen 3 werkdagen
  }

  if (p === 'low') return 'low'
  // Geen datum + normal priority → laag (anders puilt midden uit).
  if (!due && p === 'normal') return 'low'
  return 'mid'
}

// Filter "is dit echt voor Jelle?" — werkt op nieuw-gevonden items.
// Streng: alleen door als er een eerstepersoons-signaal of duidelijk
// owner-signaal in de titel staat. Anders default verbergen.
function looksLikeForJelle(task) {
  const t = (task.title || '').toLowerCase()
  const n = (task.notes || '').toLowerCase()
  const haystack = t + ' ' + n

  // Expliciete Jelle-mentie of eerstepersoons-cue.
  if (/\bjelle\b/.test(haystack)) return true
  if (/\b(ik|mij|mijn|me)\b/.test(t)) return true
  if (/\b(moet ik|ga ik|zal ik|zou ik|kan ik)\b/.test(t)) return true
  if (/\b(opvolgen|terugkomen|terugbellen|stuur|opnemen|nakijken|bevestigen)\b/.test(t)) {
    // Action-werkwoord op zichzelf is niet genoeg — moet ook kort genoeg zijn.
    if (t.length <= 80) return true
  }

  // Korte action-titel zonder duidelijke andere owner.
  if (t.length <= 60 && !/\b(team|iedereen|wij|hij|zij|ze)\b/.test(t)) return true

  return false
}

// Korter maken zonder context te verliezen: knip op zin-grens, anders ellipsis.
function shortTitle(title, max = 70) {
  if (!title) return ''
  if (title.length <= max) return title
  // Eerste zin (puntkomma, dubbele punt, punt + spatie).
  const m = title.match(/^([^.!?:;]+[.!?:;])/)
  if (m && m[1].length <= max) return m[1].trim()
  // Knip op woordgrens.
  const cut = title.slice(0, max)
  const lastSpace = cut.lastIndexOf(' ')
  return (lastSpace > 30 ? cut.slice(0, lastSpace) : cut) + '…'
}

// Klant-detectie — leunt op category-veld als skill 'm zet, anders heuristiek.
function isKlant(task) {
  if (task.category === 'klant') return true
  if (task.source === 'jira' && task.jira_board === 'Sales') return true
  if (task.source === 'sales_on_road') return true
  return false
}

// Eén rij geldt als "live" als 'ie open is en niet expliciet in backlog.
function isLive(task) {
  if (task.status === 'done' || task.status === 'dropped') return false
  if (task.is_newly_found) return false // zit in eigen sectie
  if (task.in_backlog) return false
  return true
}
function isInBacklog(task) {
  if (task.status !== 'open' && task.status !== 'snoozed' && task.status !== 'blocked') return false
  if (task.is_newly_found) return false
  return !!task.in_backlog
}

// =====================================================================

export default function TasksView({ data }) {
  const projects = useMemo(
    () => (data.taskProjects || []).slice().sort((a, b) => (a.sort_order ?? 100) - (b.sort_order ?? 100)),
    [data.taskProjects]
  )
  const tasks = data.tasks || []
  const autodraftMails = data.autodraftMails || []
  const salesTodos = data.salesTodos || []

  const [search, setSearch] = useState('')

  // Klant-mails die nu in Postvak op actie wachten — bron-of-truth voor dedup.
  // Definitie: autodraft_mails met klant_*-categorie en geen 'done'/'dismissed'-status.
  const klantMailsPending = useMemo(
    () => autodraftMails.filter(m =>
      (m.category_key || '').startsWith('klant_') &&
      m.status !== 'done' &&
      m.status !== 'dismissed'
    ),
    [autodraftMails]
  )

  // Filter taken op zoekterm — werkt op alle secties tegelijk.
  const matchesSearch = useCallback((t) => {
    if (!search.trim()) return true
    const q = search.trim().toLowerCase()
    return (t.title || '').toLowerCase().includes(q)
        || (t.notes || '').toLowerCase().includes(q)
        || (t.tags || []).some(tag => tag.toLowerCase().includes(q))
  }, [search])

  // -- Bucketing --------------------------------------------------------
  const buckets = useMemo(() => {
    const out = {
      klant: { live: [], backlog: [] },
      high:  { live: [], backlog: [] },
      mid:   { live: [], backlog: [] },
      low:   { live: [], backlog: [] },
    }
    for (const t of tasks) {
      if (!matchesSearch(t)) continue
      if (t.status === 'done' || t.status === 'dropped') continue
      if (t.is_newly_found) continue
      // Jira en sales-todos hebben hun eigen sectie — niet hier dubbel laten zien.
      // Sales (jira_board='Sales') laten we WEL doorlopen want die rekenen we als Klant.
      if (t.source === 'jira' && t.jira_board !== 'Sales') continue

      const lane = isKlant(t) ? 'klant' : bucketOf(t)
      if (t.in_backlog) out[lane].backlog.push(t)
      else out[lane].live.push(t)
    }
    for (const lane of Object.keys(out)) {
      out[lane].live    = sortTasks(out[lane].live)
      out[lane].backlog = sortTasks(out[lane].backlog)
    }
    return out
  }, [tasks, matchesSearch])

  // -- Newly-found met streng "voor Jelle"-filter + Postvak-dedup -------
  // Twee buckets: passing (door alle filters), suppressed (verborgen, achter
  // 'alles tonen'-toggle). Pas zo zien we vol vertrouwen alleen items die
  // duidelijk voor Jelle zijn, maar kunnen we de rest nog reviewen.
  const newlyFoundAll = useMemo(() => {
    return tasks.filter(t => t.is_newly_found && t.status !== 'dropped' && matchesSearch(t))
  }, [tasks, matchesSearch])

  const newlyFoundPassing = useMemo(() => {
    return newlyFoundAll.filter(t => {
      if (t.dedup_signal) return false
      if (!looksLikeForJelle(t)) return false
      // Postvak-dedup: open klant-mail met >=60% woordoverlap → verbergen.
      const title = (t.title || '').toLowerCase()
      const notes = (t.notes || '').toLowerCase()
      const haystack = title + ' ' + notes
      const matchesPendingMail = klantMailsPending.some(m => {
        const subj = (m.subject || '').toLowerCase()
        if (!subj || subj.length < 8) return false
        const words = subj.split(/[^\p{L}\p{N}]+/u).filter(w => w.length >= 4)
        if (words.length === 0) return false
        const hits = words.filter(w => haystack.includes(w)).length
        return hits / words.length >= 0.6
      })
      return !matchesPendingMail
    })
  }, [newlyFoundAll, klantMailsPending])

  const newlyFoundSuppressed = useMemo(
    () => newlyFoundAll.filter(t => !newlyFoundPassing.includes(t)),
    [newlyFoundAll, newlyFoundPassing]
  )

  // -- Andere secties ---------------------------------------------------
  const candidates = useMemo(
    () => tasks.filter(t =>
      t.completion_candidate && !t.completion_rejected &&
      t.status !== 'done' && t.status !== 'dropped'
    ),
    [tasks]
  )

  // Jira behalve Sales (Sales-jira gaat naar Klant-lane).
  const jiraTasks = useMemo(
    () => tasks.filter(t =>
      t.source === 'jira' && t.jira_board !== 'Sales' &&
      t.status !== 'done' && t.status !== 'dropped'
    ),
    [tasks]
  )

  // Sales-todos in eigen sectie — losse tabel, read-only weergave.
  const salesActive = useMemo(
    () => salesTodos.filter(t => t.status !== 'completed' && t.status !== 'dismissed'),
    [salesTodos]
  )

  // -- Counts voor de header-strip --------------------------------------
  const totalLive = buckets.klant.live.length + buckets.high.live.length
                  + buckets.mid.live.length   + buckets.low.live.length

  return (
    <div className="stack" style={{ gap: 'var(--s-5)' }}>
      <TopActionBar
        search={search}
        onSearch={setSearch}
        totalLive={totalLive}
      />

      {(newlyFoundPassing.length > 0 || newlyFoundSuppressed.length > 0) && (
        <NewlyFoundSection
          passing={newlyFoundPassing}
          suppressed={newlyFoundSuppressed}
        />
      )}

      <PriorityLane
        id="klant"
        title="Klant"
        icon="🤝"
        accent="#7c8aff"
        live={buckets.klant.live}
        backlog={buckets.klant.backlog}
        projects={projects}
        defaultOpen
      />
      <PriorityLane
        id="high"
        title="Hoog"
        icon="🔥"
        accent="#ef4444"
        live={buckets.high.live}
        backlog={buckets.high.backlog}
        projects={projects}
        defaultOpen
      />
      <PriorityLane
        id="mid"
        title="Midden"
        icon="⚙"
        accent="#f59e0b"
        live={buckets.mid.live}
        backlog={buckets.mid.backlog}
        projects={projects}
        defaultOpen
      />
      <PriorityLane
        id="low"
        title="Laag"
        icon="○"
        accent="#94a3b8"
        live={buckets.low.live}
        backlog={buckets.low.backlog}
        projects={projects}
      />

      {salesActive.length > 0 && <SalesFollowUps todos={salesActive} />}

      {jiraTasks.length > 0 && <JiraOverview tasks={jiraTasks} />}

      {candidates.length > 0 && <CompletionCandidates tasks={candidates} />}

      <QuickCapture projects={projects} />

      <ProjectsAdmin projects={projects} tasks={tasks} />
    </div>
  )
}

// =====================================================================
// Top-bar — zoek + ✨ AI herindelen
// =====================================================================

function TopActionBar({ search, onSearch, totalLive }) {
  return (
    <div style={{
      display: 'flex',
      gap: 10,
      alignItems: 'center',
      flexWrap: 'wrap',
      paddingBottom: 8,
      borderBottom: '1px solid var(--border)',
    }}>
      <input
        className="input"
        placeholder="zoeken in titels, notes, tags…"
        value={search}
        onChange={e => onSearch(e.target.value)}
        style={{ flex: 1, minWidth: 240, maxWidth: 360 }}
      />
      <span className="muted" style={{ fontSize: 12, marginLeft: 'auto' }}>
        {totalLive} live
      </span>
      <ReorganizeButton />
    </div>
  )
}

// =====================================================================
// PriorityLane — één bucket (Klant/Hoog/Midden/Laag)
// Bevat live-rijen direct zichtbaar + ▸ Backlog ingeklapt.
// =====================================================================

function PriorityLane({ id, title, icon, accent, live, backlog, projects, defaultOpen = false }) {
  const [open, setOpen] = useState(defaultOpen || (live.length > 0))
  const [showBacklog, setShowBacklog] = useState(false)

  // Sectie verbergen wanneer er werkelijk niets in zit (geen live, geen backlog).
  if (live.length === 0 && backlog.length === 0) return null

  const totalCount = live.length + backlog.length

  return (
    <section style={{
      border: '1px solid var(--border)',
      borderLeft: `3px solid ${accent}`,
      borderRadius: 8,
      background: open ? 'rgba(124,138,255,0.03)' : 'transparent',
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
        <span style={{ fontSize: 16 }}>{icon}</span>
        <span style={{ fontWeight: 600, fontSize: 14 }}>{title}</span>
        <span style={{
          padding: '2px 8px',
          borderRadius: 10,
          fontSize: 11,
          fontWeight: 600,
          background: `${accent}22`,
          color: accent,
        }}>{live.length}</span>
        {backlog.length > 0 && (
          <span className="muted" style={{ fontSize: 11 }}>
            + {backlog.length} backlog
          </span>
        )}
        <span className="muted" style={{ fontSize: 11, marginLeft: 'auto' }}>
          {totalCount === live.length ? '' : `${totalCount} totaal`}
        </span>
      </button>

      {open && (
        <div style={{ padding: '0 12px 12px 12px' }}>
          {live.length === 0 ? (
            <div className="muted" style={{ fontSize: 12, padding: '8px 4px' }}>
              Niets live in deze bucket.
            </div>
          ) : (
            <TaskList tasks={live} projects={projects} compact />
          )}

          {backlog.length > 0 && (
            <div style={{ marginTop: 10 }}>
              <button
                type="button"
                onClick={() => setShowBacklog(s => !s)}
                style={{
                  width: '100%',
                  display: 'flex',
                  alignItems: 'center',
                  gap: 8,
                  padding: '8px 10px',
                  background: 'transparent',
                  border: '1px dashed var(--border)',
                  borderRadius: 6,
                  cursor: 'pointer',
                  color: 'var(--text-faint)',
                  fontSize: 12,
                }}
              >
                <span>{showBacklog ? '▾' : '▸'}</span>
                <span>Backlog</span>
                <span style={{
                  padding: '1px 6px',
                  borderRadius: 8,
                  fontSize: 10,
                  background: 'var(--border)',
                  color: 'var(--text-faint)',
                }}>{backlog.length}</span>
                <span style={{ marginLeft: 'auto', fontSize: 10 }}>
                  {showBacklog ? 'verbergen' : 'tonen'}
                </span>
              </button>
              {showBacklog && (
                <div style={{ marginTop: 6 }}>
                  <TaskList tasks={backlog} projects={projects} compact />
                </div>
              )}
            </div>
          )}
        </div>
      )}
    </section>
  )
}

// =====================================================================
// Task list + row + editor (hergebruik uit v1, met in_backlog-toggle erbij)
// =====================================================================

const TASKROW_COLS         = '24px minmax(0, 1fr) 160px 110px 80px 100px 90px'
const TASKROW_COLS_COMPACT = '22px minmax(0, 1fr) 130px 90px  72px 88px  76px'

function TaskList({ tasks, projects, compact }) {
  if (!tasks.length) {
    return (
      <div className="empty" style={{ padding: '8px 4px', fontSize: 12 }}>
        Niets hier.
      </div>
    )
  }
  const cols = compact ? TASKROW_COLS_COMPACT : TASKROW_COLS
  return (
    <div className="card" style={{ padding: 0, overflow: 'hidden', marginTop: compact ? 0 : 8 }}>
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: cols,
          gap: 10,
          padding: '6px 12px',
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
        <span>Bron / acties</span>
      </div>

      <div>
        {tasks.map((t, i) => (
          <TaskRow
            key={t.id}
            task={t}
            projects={projects}
            isLast={i === tasks.length - 1}
            cols={cols}
          />
        ))}
      </div>
    </div>
  )
}

function TaskRow({ task, projects, isLast, cols }) {
  const [open, setOpen] = useState(false)
  // Optimistic veldjes voor snelle UI-feedback.
  const [optimistic, setOptimistic] = useState(null)
  const t = optimistic ? { ...task, ...optimistic } : task

  const project = projects.find(p => p.id === t.project_id) || null
  const overdue = isOverdue(t)
  const dueToday = isDueToday(t)

  const toggleDone = useCallback(async (e) => {
    e?.stopPropagation?.()
    const next = t.status === 'done' ? 'open' : 'done'
    setOptimistic({ status: next })
    try {
      await supabase.from('tasks').update({ status: next }).eq('id', t.id)
    } catch {
      setOptimistic(null)
    }
  }, [t.id, t.status])

  const toggleBacklog = useCallback(async (e) => {
    e?.stopPropagation?.()
    const next = !t.in_backlog
    setOptimistic({ in_backlog: next })
    try {
      await supabase.from('tasks').update({ in_backlog: next }).eq('id', t.id)
    } catch {
      setOptimistic(null)
    }
  }, [t.id, t.in_backlog])

  const dateCell = t.deadline
    ? { label: (overdue ? '⚠ ' : '') + formatDate(t.deadline),
        cls: overdue ? 's-error' : dueToday ? 's-warning' : '' }
    : t.do_date
      ? { label: '▶ ' + formatDate(t.do_date), cls: dueToday ? 's-warning' : '' }
      : null

  return (
    <div style={{ borderBottom: isLast ? 'none' : '1px solid var(--border)' }}>
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: cols,
          gap: 10,
          alignItems: 'center',
          padding: '8px 12px',
          cursor: 'pointer',
          background: open ? 'rgba(124,138,255,0.04)' : 'transparent',
        }}
        onClick={() => setOpen(o => !o)}
      >
        <input
          type="checkbox"
          checked={t.status === 'done'}
          onChange={toggleDone}
          onClick={e => e.stopPropagation()}
          style={{ margin: 0 }}
        />

        <div style={{ minWidth: 0 }}>
          <div style={{
            color: t.status === 'done' ? 'var(--text-faint)' : 'var(--text)',
            textDecoration: t.status === 'done' ? 'line-through' : 'none',
            fontWeight: 500,
            fontSize: 13,
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            whiteSpace: 'nowrap',
          }}>
            {t.title}
            {t.category === 'klant' && (
              <span className="pill" style={{
                marginLeft: 6, padding: '1px 6px', fontSize: 10,
                background: 'rgba(124,138,255,0.15)', borderColor: 'transparent', color: 'var(--accent)',
              }}>klant</span>
            )}
          </div>
          {t.notes && !open && (
            <div className="muted" style={{
              fontSize: 11, marginTop: 2,
              overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
            }}>{t.notes}</div>
          )}
        </div>

        <div style={{ minWidth: 0 }}>
          {project ? (
            <span
              className="pill"
              style={{
                padding: '2px 8px', fontSize: 11,
                background: (project.color || '#7c8aff') + '22',
                borderColor: 'transparent',
                display: 'inline-flex', alignItems: 'center', gap: 4,
                maxWidth: '100%', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
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

        <div style={{
          minWidth: 0, fontSize: 11, color: 'var(--accent)',
          overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
        }}>
          {(t.tags || []).slice(0, 3).map(tag => (
            <span key={tag} style={{ marginRight: 6 }}>#{tag}</span>
          ))}
          {(!t.tags || t.tags.length === 0) && <span className="muted">—</span>}
        </div>

        <div>
          {t.priority && t.priority !== 'normal' ? (
            <span className={`pill ${PRIORITY_PILL[t.priority] || ''}`} style={{ padding: '2px 8px', fontSize: 11 }}>
              {PRIORITY_LABEL[t.priority]}
            </span>
          ) : (
            <span className="muted" style={{ fontSize: 11 }}>—</span>
          )}
        </div>

        <div>
          {dateCell ? (
            <span className={`pill ${dateCell.cls}`} style={{ padding: '2px 8px', fontSize: 11 }}>
              {dateCell.label}
            </span>
          ) : (
            <span className="muted" style={{ fontSize: 11 }}>—</span>
          )}
        </div>

        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'flex-end', gap: 4 }}>
          <button
            type="button"
            className="btn btn--ghost"
            onClick={toggleBacklog}
            title={t.in_backlog ? 'Terug uit backlog' : 'Naar backlog'}
            style={{ padding: '2px 6px', fontSize: 10 }}
          >
            {t.in_backlog ? '↑' : '↓'}
          </button>
          {t.source !== 'manual' ? (
            <span style={{ fontSize: 10, color: 'var(--text-faint)' }} title={t.source_url || t.source_ref || ''}>
              {SOURCE_LABEL[t.source] || t.source}
            </span>
          ) : (
            <span className="muted" style={{ fontSize: 10 }}>·</span>
          )}
        </div>
      </div>

      {open && (
        <div style={{ padding: '4px 12px 12px 12px', background: 'rgba(124,138,255,0.04)' }}>
          <TaskEditor task={t} projects={projects} onClose={() => setOpen(false)} />
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
    category: task.category || '',
    in_backlog: !!task.in_backlog,
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
        category: draft.category || null,
        in_backlog: !!draft.in_backlog,
        tags: draft.tags.trim()
          ? draft.tags.trim().split(/\s+/).map(s => s.replace(/^#/, '').toLowerCase()).filter(Boolean)
          : [],
        ai_processed: true,
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
          className="input" rows={3}
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
        <span className="muted" style={{ fontSize: 11 }}>Categorie</span>
        <select className="input" value={draft.category} onChange={e => setDraft({ ...draft, category: e.target.value })}>
          <option value="">— geen —</option>
          <option value="klant">🤝 klant</option>
        </select>
      </label>
      <label className="stack stack--xs">
        <span className="muted" style={{ fontSize: 11 }}>Effort</span>
        <select className="input" value={draft.effort} onChange={e => setDraft({ ...draft, effort: e.target.value })}>
          <option value="">—</option>
          {Object.entries(EFFORT_LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
        </select>
      </label>
      <label className="stack stack--xs" style={{ display: 'flex', flexDirection: 'row', alignItems: 'center', gap: 8 }}>
        <input
          type="checkbox"
          checked={!!draft.in_backlog}
          onChange={e => setDraft({ ...draft, in_backlog: e.target.checked })}
        />
        <span className="muted" style={{ fontSize: 11 }}>Op backlog (ingeklapt onder bucket)</span>
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
// Newly-found — strikte filter + Houden / Backlog / Negeren met optimistic UI
// =====================================================================

function NewlyFoundSection({ passing, suppressed }) {
  const [open, setOpen] = useState(true)
  const [showAll, setShowAll] = useState(false)
  // Lokaal verwijderde IDs voor optimistic update.
  const [hidden, setHidden] = useState(() => new Set())

  const passingVisible    = passing.filter(t => !hidden.has(t.id))
  const suppressedVisible = suppressed.filter(t => !hidden.has(t.id))
  const totalVisible      = showAll
    ? passingVisible.length + suppressedVisible.length
    : passingVisible.length

  if (passingVisible.length === 0 && suppressedVisible.length === 0) return null

  const hideOne = (id) => setHidden(prev => { const next = new Set(prev); next.add(id); return next })

  const mutate = (patch) => async (id) => {
    hideOne(id)
    await supabase.from('tasks').update(patch).eq('id', id)
  }
  const keepOne    = mutate({ is_newly_found: false })
  const backlogOne = mutate({ is_newly_found: false, in_backlog: true })
  const dropOne    = mutate({ is_newly_found: false, status: 'dropped' })

  const dropAllSuppressed = async () => {
    if (suppressedVisible.length === 0) return
    if (!confirm(`${suppressedVisible.length} verborgen items in één keer weggooien?`)) return
    const ids = suppressedVisible.map(t => t.id)
    setHidden(prev => { const next = new Set(prev); ids.forEach(i => next.add(i)); return next })
    await supabase.from('tasks').update({ is_newly_found: false, status: 'dropped' }).in('id', ids)
  }

  const keepAllPassing = async () => {
    if (passingVisible.length === 0) return
    const ids = passingVisible.map(t => t.id)
    setHidden(prev => { const next = new Set(prev); ids.forEach(i => next.add(i)); return next })
    await supabase.from('tasks').update({ is_newly_found: false }).in('id', ids)
  }

  return (
    <section style={{
      border: '1px solid var(--accent)',
      borderRadius: 8,
      background: 'rgba(124,138,255,0.06)',
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
        <span style={{ fontWeight: 600 }}>🆕 Nieuw gevonden</span>
        <span style={{
          padding: '2px 8px', borderRadius: 10,
          fontSize: 11, fontWeight: 600,
          background: 'var(--accent)', color: '#fff',
        }}>{passingVisible.length}</span>
        {suppressedVisible.length > 0 && (
          <span className="muted" style={{ fontSize: 11 }}>
            + {suppressedVisible.length} verborgen
          </span>
        )}
        <span className="muted" style={{ fontSize: 11, marginLeft: 'auto' }}>
          alleen taken die duidelijk voor Jelle zijn
        </span>
      </button>

      {open && (
        <div style={{ padding: '4px 14px 14px 14px' }}>
          {passingVisible.length > 0 ? (
            <>
              <div className="muted" style={{ fontSize: 12, marginBottom: 10 }}>
                Items met een duidelijk Jelle-signaal (eerstepersoons, naam, of korte actie-titel).
                Per stuk: behouden / naar backlog / weggooien.
              </div>

              <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 6, marginBottom: 10 }}>
                <button className="btn btn--accent" onClick={keepAllPassing}>✓ alles behouden</button>
              </div>

              <div className="stack stack--sm" style={{ gap: 6 }}>
                {passingVisible.map(t => (
                  <NewlyFoundRow
                    key={t.id}
                    task={t}
                    onKeep={() => keepOne(t.id)}
                    onBacklog={() => backlogOne(t.id)}
                    onDrop={() => dropOne(t.id)}
                  />
                ))}
              </div>
            </>
          ) : (
            <div className="muted" style={{ fontSize: 12, padding: '6px 0' }}>
              Niets nieuws met duidelijk Jelle-signaal.
            </div>
          )}

          {suppressedVisible.length > 0 && (
            <div style={{ marginTop: 14, paddingTop: 10, borderTop: '1px dashed var(--border)' }}>
              <button
                type="button"
                onClick={() => setShowAll(s => !s)}
                style={{
                  display: 'flex', alignItems: 'center', gap: 6,
                  background: 'transparent', border: 'none',
                  cursor: 'pointer', color: 'var(--text-faint)', fontSize: 12,
                  padding: 0,
                }}
              >
                <span>{showAll ? '▾' : '▸'}</span>
                <span>{showAll ? 'Verborgen items inklappen' : `${suppressedVisible.length} verborgen items tonen`}</span>
                <span className="muted" style={{ fontSize: 11, marginLeft: 6 }}>
                  (geen Jelle-signaal of dubbel met Postvak)
                </span>
              </button>

              {showAll && (
                <>
                  <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 6, margin: '10px 0' }}>
                    <button className="btn btn--ghost" onClick={dropAllSuppressed}>× allemaal weggooien</button>
                  </div>
                  <div className="stack stack--sm" style={{ gap: 6 }}>
                    {suppressedVisible.map(t => (
                      <NewlyFoundRow
                        key={t.id}
                        task={t}
                        suppressed
                        onKeep={() => keepOne(t.id)}
                        onBacklog={() => backlogOne(t.id)}
                        onDrop={() => dropOne(t.id)}
                      />
                    ))}
                  </div>
                </>
              )}
            </div>
          )}
        </div>
      )}
    </section>
  )
}

function NewlyFoundRow({ task, onKeep, onBacklog, onDrop, suppressed }) {
  const [busy, setBusy] = useState(false)
  const click = (fn) => async () => {
    if (busy) return
    setBusy(true)
    try { await fn() } finally { setBusy(false) }
  }
  return (
    <div className="card" style={{
      padding: '8px 12px',
      display: 'flex',
      alignItems: 'center',
      gap: 10,
      opacity: suppressed ? 0.65 : 1,
    }}>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div
          title={task.title}
          style={{
            fontWeight: 500, fontSize: 13,
            overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
          }}
        >
          {shortTitle(task.title, 70)}
        </div>
        <div className="muted" style={{ fontSize: 11, marginTop: 3, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          <span style={{ color: 'var(--accent)' }}>
            {task.source === 'fireflies' ? '🎙️ Fireflies' : SOURCE_LABEL[task.source] || task.source}
          </span>
          {task.discovered_at && <span style={{ marginLeft: 6 }}>· {formatDate(task.discovered_at.slice(0, 10))}</span>}
        </div>
      </div>
      {task.source_url && (
        <a href={task.source_url} target="_blank" rel="noreferrer" className="muted" style={{ fontSize: 11, flexShrink: 0 }}>
          ↗
        </a>
      )}
      <button className="btn btn--ghost" onClick={click(onDrop)} disabled={busy} title="Weggooien" style={{ padding: '4px 10px', fontSize: 11 }}>×</button>
      <button className="btn btn--ghost" onClick={click(onBacklog)} disabled={busy} title="Naar backlog" style={{ padding: '4px 10px', fontSize: 11 }}>↓</button>
      <button className="btn btn--accent" onClick={click(onKeep)} disabled={busy} title="Behouden als live" style={{ padding: '4px 12px', fontSize: 11 }}>✓ houden</button>
    </div>
  )
}

// =====================================================================
// SalesFollowUps — read-only sectie van sales_todos
// =====================================================================

const SALES_TYPE_LABEL = {
  offerte_reminder:    'offerte herinnering',
  trial_ending:        'trial loopt af',
  checkin:             'check-in',
  onboarding_followup: 'onboarding',
  stille_contact:      'stille contact',
  ovk_geen_reactie:    'ovk geen reactie',
  trial_einde:         'trial loopt af',
  other:               'overig',
}

function SalesFollowUps({ todos }) {
  const [open, setOpen] = useState(false)

  const draftReady = todos.filter(t => t.status === 'draft_ready').length
  const pending    = todos.filter(t => t.status === 'pending').length

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

// =====================================================================
// Quick capture (hergebruik uit v1)
// =====================================================================

function QuickCapture({ projects }) {
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

// =====================================================================
// AI re-organise button (hergebruik)
// =====================================================================

function ReorganizeButton() {
  const [state, setState] = useState('idle')
  const [msg, setMsg] = useState(null)

  const trigger = async () => {
    if (state === 'submitting') return
    setState('submitting'); setMsg(null)
    try {
      await supabase.from('tasks').update({ ai_processed: false })
        .neq('status', 'done').neq('status', 'dropped')
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
        className="btn btn--ghost" onClick={trigger}
        disabled={state === 'submitting'}
        title="Markeer alles voor herindeling en draai task-organizer-skill"
      >
        ✨ AI herindelen
      </button>
      {msg && <div className="muted" style={{ fontSize: 11, color: state === 'err' ? 'var(--error)' : 'var(--accent)' }}>{msg}</div>}
    </div>
  )
}

// =====================================================================
// Projects admin (hergebruik)
// =====================================================================

function ProjectsAdmin({ projects, tasks }) {
  const [open, setOpen] = useState(false)
  const [adding, setAdding] = useState(false)
  const [name, setName] = useState('')
  const [icon, setIcon] = useState('')
  const [hint, setHint] = useState('')
  const [busy, setBusy] = useState(false)

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
    } finally { setBusy(false) }
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
    <section style={{
      border: '1px solid var(--border)',
      borderRadius: 8,
      background: open ? 'rgba(124,138,255,0.03)' : 'transparent',
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
        <span style={{ fontWeight: 500 }}>📁 Projecten</span>
        <span className="muted" style={{ fontSize: 11 }}>{projects.length}</span>
        <span className="muted" style={{ fontSize: 11, marginLeft: 'auto' }}>
          {open ? '' : 'klik om te beheren'}
        </span>
      </button>

      {open && (
        <div style={{ padding: '4px 14px 14px 14px' }}>
          <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: 8 }}>
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
                className="input" rows={2}
                value={hint}
                onChange={e => setHint(e.target.value)}
                placeholder="AI match hint — wat hoort bij dit project?"
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
        </div>
      )}
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
        className="input" rows={2}
        value={draft.ai_match_hint}
        onChange={e => setDraft({ ...draft, ai_match_hint: e.target.value })}
        placeholder="AI match hint"
        style={{ marginBottom: 8, width: '100%' }}
      />
      <input
        className="input" type="date" value={draft.deadline}
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
// JiraOverview (hergebruik)
// =====================================================================

function JiraOverview({ tasks }) {
  const [open, setOpen] = useState(false)

  const byBoard = useMemo(() => {
    const g = {}
    for (const t of tasks) {
      const key = t.jira_board || 'Overig'
      if (!g[key]) g[key] = []
      g[key].push(t)
    }
    const today = new Date().toISOString().slice(0, 10)
    for (const k of Object.keys(g)) {
      g[k].sort((a, b) => {
        const aOver = a.deadline && a.deadline < today
        const bOver = b.deadline && b.deadline < today
        if (aOver !== bOver) return aOver ? -1 : 1
        const aD = a.deadline || '9999-99-99'
        const bD = b.deadline || '9999-99-99'
        return aD.localeCompare(bD)
      })
    }
    return g
  }, [tasks])

  const boardOrder = ['Sales', 'Management', 'Recruitment', 'Overig']
  const boards = boardOrder.filter(b => byBoard[b]?.length > 0)
    .concat(Object.keys(byBoard).filter(b => !boardOrder.includes(b)))

  const today = new Date().toISOString().slice(0, 10)
  const overdueCount = tasks.filter(t => t.deadline && t.deadline < today).length
  const backlogCount = tasks.filter(t => t.jira_in_backlog).length

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
        <span style={{ fontWeight: 500 }}>📋 Jira-overzicht</span>
        <span style={{
          padding: '2px 8px', borderRadius: 10, fontSize: 11, fontWeight: 600,
          background: 'rgba(124,138,255,0.15)', color: 'var(--accent)',
        }}>{tasks.length}</span>
        {overdueCount > 0 && (
          <span className="pill s-error" style={{ padding: '2px 8px', fontSize: 11 }}>
            ⚠ {overdueCount} verlopen
          </span>
        )}
        {backlogCount > 0 && (
          <span className="muted" style={{ fontSize: 11 }}>{backlogCount} op backlog</span>
        )}
        <span className="muted" style={{ fontSize: 11, marginLeft: 'auto' }}>
          {open ? '' : `${boards.length} board${boards.length === 1 ? '' : 's'}`}
        </span>
      </button>

      {open && (
        <div style={{ padding: '4px 14px 14px 14px' }}>
          <div className="muted" style={{ fontSize: 12, marginBottom: 10 }}>
            Open Jira-issues toegewezen aan jou (Management + Recruitment).
            Sales-issues zien je in de Klant-bucket bovenaan.
          </div>
          <div className="stack" style={{ gap: 14 }}>
            {boards.map(board => (
              <JiraBoardGroup key={board} board={board} tasks={byBoard[board]} />
            ))}
          </div>
        </div>
      )}
    </section>
  )
}

function JiraBoardGroup({ board, tasks }) {
  const color = JIRA_BOARD_COLOR[board] || '#7c8aff'
  return (
    <div>
      <div style={{
        display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6,
        padding: '4px 10px', borderLeft: `3px solid ${color}`,
        fontWeight: 600, fontSize: 13,
      }}>
        <span>{board}</span>
        <span className="muted" style={{ fontWeight: 400, fontSize: 11 }}>{tasks.length}</span>
      </div>
      <div className="stack stack--sm" style={{ gap: 4, marginLeft: 10 }}>
        {tasks.map(t => <JiraTaskRow key={t.id} task={t} color={color} />)}
      </div>
    </div>
  )
}

function JiraTaskRow({ task, color }) {
  const today = new Date().toISOString().slice(0, 10)
  const overdue = task.deadline && task.deadline < today
  const dueToday = task.deadline === today

  return (
    <div className="card" style={{
      padding: '8px 12px', display: 'grid',
      gridTemplateColumns: '90px minmax(0, 1fr) auto auto auto auto',
      alignItems: 'center', gap: 10,
    }}>
      <span className="mono" style={{ fontSize: 11, color, fontWeight: 600 }}>
        {task.source_ref || '—'}
      </span>
      <div style={{ minWidth: 0 }}>
        <div style={{
          fontWeight: 500, fontSize: 13,
          overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
        }}>{task.title}</div>
        {task.jira_status && (
          <div className="muted" style={{ fontSize: 11, marginTop: 2 }}>
            {task.jira_issue_type && <span>{task.jira_issue_type} · </span>}
            <span>{task.jira_status}</span>
          </div>
        )}
      </div>
      {task.jira_in_backlog ? (
        <span className="pill" style={{
          padding: '2px 8px', fontSize: 11,
          background: 'rgba(245,158,11,0.15)', borderColor: 'transparent', color: 'var(--warning)',
        }}>op backlog</span>
      ) : (
        <span className="pill" style={{
          padding: '2px 8px', fontSize: 11,
          background: 'rgba(34,197,94,0.12)', borderColor: 'transparent', color: '#22c55e',
        }}>actief</span>
      )}
      {task.jira_priority && (
        <span className={`pill ${task.jira_priority === 'Highest' || task.jira_priority === 'High' ? 's-warning' : ''}`}
          style={{ padding: '2px 8px', fontSize: 11 }}>
          {task.jira_priority}
        </span>
      )}
      {task.deadline ? (
        <span className={`pill ${overdue ? 's-error' : dueToday ? 's-warning' : ''}`}
          style={{ padding: '2px 8px', fontSize: 11 }}>
          {overdue ? '⚠ ' : ''}{formatDate(task.deadline)}
        </span>
      ) : (
        <span className="muted" style={{ fontSize: 11 }}>geen deadline</span>
      )}
      {task.source_url ? (
        <a href={task.source_url} target="_blank" rel="noreferrer" className="muted" style={{ fontSize: 11 }}>↗</a>
      ) : (
        <span className="muted">·</span>
      )}
    </div>
  )
}

// =====================================================================
// CompletionCandidates (hergebruik)
// =====================================================================

const SOURCE_LABEL_DONE = {
  autodraft:'Mail (AutoDraft)', draft_events:'Mail-drafts', sales_todos:'Sales TODO',
  linkedin:'LinkedIn', agent_proposals:'Daily Admin', hubspot:'HubSpot',
  sales_on_road:'Road Notes', km_trips:'Kilometerregistratie', fireflies:'Fireflies',
  agent_runs:'Skill-run', other:'Anders',
}

function CompletionCandidates({ tasks }) {
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

// =====================================================================
// Helpers
// =====================================================================

function startOfDay(d) { const x = new Date(d); x.setHours(0,0,0,0); return x }
function addDays(d, n) { const x = new Date(d); x.setDate(x.getDate() + n); return x }
function ymd(d) { return d.toISOString().slice(0, 10) }

function isOverdue(t) {
  if (!t.deadline || t.status === 'done' || t.status === 'dropped') return false
  return new Date(t.deadline) < startOfDay(new Date())
}
function isDueToday(t) {
  const y = ymd(startOfDay(new Date()))
  return t.deadline === y || t.do_date === y
}

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

function formatShortDateTime(iso) {
  if (!iso) return '—'
  return new Date(iso).toLocaleString('nl-NL', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' })
}

function truncate(s, n) {
  if (!s) return ''
  return s.length > n ? s.slice(0, n - 1) + '…' : s
}
