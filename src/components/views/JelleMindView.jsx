// JelleMindView (v4 — drie kolommen + regels-browser).
//
// Layout:
//   ┌─────── Jelle ───────┐ ┌──── Legal Mind ────┐ ┌────── Skills ──────┐
//   │ [Voorstellen|Lessons]│ │[Voorstellen|Lessons]│ │[Voorstellen|Lessons]│
//   │ ...cards...          │ │  ...cards...        │ │  ...cards...        │
//   └──────────────────────┘ └─────────────────────┘ └─────────────────────┘
//
//   ╔══════════════ Regels per onderwerp (browser) ═════════════╗
//   ║ filter per lesson_type + mind_scope, toggle inactief,      ║
//   ║ database-readout met edit/retire-acties                    ║
//   ╚════════════════════════════════════════════════════════════╝
//
//   ╔══════════════════════ Signalen-feed ══════════════════════╗
//   ║ chronologische lijst, geen scope-filter (signalen zijn ruw)║
//   ╚════════════════════════════════════════════════════════════╝
//
// Op smal scherm (< 980px) vallen de kolommen onder elkaar via auto-fit grid.
//
// Backend: jellemind_signals / jellemind_lesson_proposals / jellemind_lessons
// + RPC's submit_jellemind_decision (met p_mind_scope_override) /
//   retire_jellemind_lesson / edit_jellemind_lesson / trigger_jellemind_run.

import { useEffect, useState, useCallback, useMemo, useRef } from 'react'
import { supabase } from '../../lib/supabase'

// ============================================================
// Drie scopes — DB-key, UI-label, accent
// ============================================================

const SCOPES = [
  { key: 'jelle',     label: 'Jelle',      accent: '#8b5cf6', tagline: 'Persoonlijke voorkeur — toon, stijl, communicatie.' },
  { key: 'legalmind', label: 'Legal Mind', accent: '#06b6d4', tagline: 'Organisatie-waarheid — geldt voor iedereen.' },
  { key: 'skill',     label: 'Skills',     accent: '#10b981', tagline: 'Procesinstructie aan agents — wat moet een skill doen.' },
]

const SCOPE_BY_KEY = Object.fromEntries(SCOPES.map(s => [s.key, s]))

const LESSON_TYPES = [
  { key: 'tone',         label: 'Toon',          color: '#f59e0b' },
  { key: 'terminology',  label: 'Terminologie',  color: '#06b6d4' },
  { key: 'format',       label: 'Format',        color: '#10b981' },
  { key: 'preference',   label: 'Voorkeur',      color: '#8b5cf6' },
  { key: 'workflow',     label: 'Workflow',      color: '#ec4899' },
]

function lessonTypeMeta(key) {
  return LESSON_TYPES.find(t => t.key === key) || { key, label: key, color: '#6b7280' }
}

function fmtRelative(iso) {
  if (!iso) return '—'
  const d = new Date(iso)
  const diff = (Date.now() - d.getTime()) / 1000
  if (diff < 60) return 'net'
  if (diff < 3600) return `${Math.floor(diff / 60)} min`
  if (diff < 86400) return `${Math.floor(diff / 3600)} u`
  if (diff < 604800) return `${Math.floor(diff / 86400)} d`
  return d.toLocaleDateString('nl-NL', { day: '2-digit', month: 'short' })
}

function fmtAppliesTo(arr) {
  if (!arr || arr.length === 0) return 'alle agents'
  if (arr.includes('*')) return 'alle agents'
  return arr.join(', ')
}

// ============================================================
// Data hook — fetch alle proposals + lessons in één keer
// ============================================================

function useMindData() {
  const [proposals, setProposals] = useState([])
  const [lessons, setLessons] = useState([])
  const [meetingMap, setMeetingMap] = useState({})  // id -> { title, date_time, meeting_url, fireflies_id }
  const [signalMap, setSignalMap] = useState({})    // id -> { signal_type, agent_name, before_text, after_text, delta_summary, occurred_at }
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)

  const load = useCallback(async () => {
    setLoading(true); setError(null)
    try {
      const [pRes, lRes] = await Promise.all([
        supabase.from('jellemind_lesson_proposals')
          .select('*')
          .eq('status', 'pending')
          .order('confidence', { ascending: false })
          .order('created_at', { ascending: false }),
        supabase.from('jellemind_lessons')
          .select('*')
          .eq('active', true)
          .order('created_at', { ascending: false }),
      ])
      if (pRes.error) throw pRes.error
      if (lRes.error) throw lRes.error
      const props = pRes.data || []
      setProposals(props)
      setLessons(lRes.data || [])

      // Verzamel bron-IDs voor batch-fetch
      const meetingIds = [...new Set(props.filter(p => p.source_meeting_id).map(p => p.source_meeting_id))]
      const signalIds = [...new Set(props.flatMap(p => p.signal_ids || []))]

      const [mRes, sRes] = await Promise.all([
        meetingIds.length
          ? supabase.from('fireflies_meetings')
              .select('id, title, date_time, meeting_url, fireflies_id, duration_min')
              .in('id', meetingIds)
          : Promise.resolve({ data: [], error: null }),
        signalIds.length
          ? supabase.from('jellemind_signals')
              .select('id, signal_type, agent_name, before_text, after_text, delta_summary, occurred_at, source_table')
              .in('id', signalIds)
          : Promise.resolve({ data: [], error: null }),
      ])
      if (mRes.error) throw mRes.error
      if (sRes.error) throw sRes.error
      setMeetingMap(Object.fromEntries((mRes.data || []).map(m => [m.id, m])))
      setSignalMap(Object.fromEntries((sRes.data || []).map(s => [s.id, s])))
    } catch (e) {
      setError(e.message)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { load() }, [load])
  return { proposals, lessons, meetingMap, signalMap, loading, error, reload: load }
}

// ============================================================
// Hoofd-component
// ============================================================

export default function JelleMindView() {
  const { proposals, lessons, meetingMap, signalMap, loading, error, reload } = useMindData()
  const [running, setRunning] = useState(false)
  const [runMessage, setRunMessage] = useState(null)

  const handleManualRun = useCallback(async () => {
    setRunning(true); setRunMessage(null)
    try {
      const { data, error } = await supabase.rpc('trigger_jellemind_run')
      if (error) throw error
      if (data?.ok) setRunMessage('Run aangevraagd — orchestrator pakt \'m op binnen 15 min.')
      else setRunMessage(data?.reason || 'Run kon niet worden aangevraagd.')
    } catch (e) {
      setRunMessage(`Fout: ${e.message}`)
    } finally {
      setRunning(false)
      setTimeout(() => setRunMessage(null), 6000)
    }
  }, [])

  // Group per scope
  const byScope = useMemo(() => {
    const out = {}
    for (const s of SCOPES) out[s.key] = { proposals: [], lessons: [] }
    for (const p of proposals) (out[p.mind_scope] || out.jelle).proposals.push(p)
    for (const l of lessons)   (out[l.mind_scope] || out.jelle).lessons.push(l)
    return out
  }, [proposals, lessons])

  const totalPending = proposals.length

  return (
    <div className="stack" style={{ gap: 'var(--s-5)' }}>
      <Header
        running={running}
        onRun={handleManualRun}
        runMessage={runMessage}
        totalPending={totalPending}
      />

      {error && (
        <div style={{ padding: 'var(--s-4)', color: '#ef4444', border: '1px solid #ef444422', borderRadius: 6 }}>
          Fout: {error}
        </div>
      )}

      {loading ? (
        <div className="muted" style={{ padding: 'var(--s-5)' }}>Laden…</div>
      ) : (
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fit, minmax(320px, 1fr))',
            gap: 'var(--s-4)',
            alignItems: 'flex-start',
          }}
        >
          {SCOPES.map(scope => (
            <ScopeColumn
              key={scope.key}
              scope={scope}
              proposals={byScope[scope.key].proposals}
              lessons={byScope[scope.key].lessons}
              meetingMap={meetingMap}
              signalMap={signalMap}
              onChanged={reload}
            />
          ))}
        </div>
      )}

      <RulesBrowser />

      <SignalsFeed />
    </div>
  )
}

// ============================================================
// Header
// ============================================================

function Header({ running, onRun, runMessage, totalPending }) {
  return (
    <div className="panel" style={{ padding: 'var(--s-5) var(--s-6)' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--s-4)', flexWrap: 'wrap' }}>
        <div
          style={{
            width: 44, height: 44, borderRadius: 12,
            background: 'linear-gradient(135deg, #8b5cf633 0%, #06b6d433 50%, #10b98133 100%)',
            color: '#8b5cf6',
            display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
            flexShrink: 0,
          }}
        >
          <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
            <path d="M12 2a4 4 0 0 0-4 4v1a4 4 0 0 0-2 7.5V17a3 3 0 0 0 3 3h.5"/>
            <path d="M12 2a4 4 0 0 1 4 4v1a4 4 0 0 1 2 7.5V17a3 3 0 0 1-3 3h-.5"/>
            <path d="M12 6v18"/>
          </svg>
        </div>
        <div style={{ flex: 1, minWidth: 200 }}>
          <h2 style={{ fontSize: 18, fontWeight: 700, margin: 0 }}>JelleMind</h2>
          <p className="muted" style={{ fontSize: 13, lineHeight: 1.4, marginTop: 2, marginBottom: 0 }}>
            Drie laden — <strong style={{ color: '#8b5cf6' }}>Jelle</strong> (persoonlijk),{' '}
            <strong style={{ color: '#06b6d4' }}>Legal Mind</strong> (organisatie),{' '}
            <strong style={{ color: '#10b981' }}>Skills</strong> (procesinstructies).{' '}
            {totalPending > 0
              ? <>{totalPending} {totalPending === 1 ? 'voorstel wacht' : 'voorstellen wachten'} op review.</>
              : 'Alles up-to-date.'}
          </p>
        </div>
        <button
          onClick={onRun}
          disabled={running}
          style={{
            padding: '8px 14px',
            borderRadius: 8,
            border: '1px solid var(--border)',
            background: running ? 'var(--bg-2)' : '#8b5cf6',
            color: running ? 'var(--text-muted)' : '#fff',
            fontSize: 13, fontWeight: 600,
            cursor: running ? 'wait' : 'pointer',
            display: 'inline-flex', alignItems: 'center', gap: 6,
          }}
        >
          {running ? '…' : '✨'} Draai jellemind
        </button>
      </div>
      {runMessage && (
        <div
          className="muted"
          style={{
            marginTop: 'var(--s-3)',
            fontSize: 12,
            padding: '6px 10px',
            borderRadius: 6,
            background: 'var(--bg-2)',
            border: '1px solid var(--border)',
          }}
        >
          {runMessage}
        </div>
      )}
    </div>
  )
}

// ============================================================
// Scope-kolom — header + sub-tab Voorstellen|Lessons + cards
// ============================================================

function ScopeColumn({ scope, proposals, lessons, meetingMap, signalMap, onChanged }) {
  const [tab, setTab] = useState('proposals')
  const list = tab === 'proposals' ? proposals : lessons

  return (
    <div
      className="panel"
      style={{
        padding: 0,
        overflow: 'hidden',
        borderTop: `3px solid ${scope.accent}`,
        display: 'flex', flexDirection: 'column',
      }}
    >
      <div style={{ padding: 'var(--s-4) var(--s-5)', borderBottom: '1px solid var(--border)' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <h3 style={{ margin: 0, fontSize: 15, fontWeight: 700, color: scope.accent }}>
            {scope.label}
          </h3>
          <span className="muted" style={{ fontSize: 11, marginLeft: 'auto' }}>
            {proposals.length} • {lessons.length}
          </span>
        </div>
        <p className="muted" style={{ margin: '4px 0 0 0', fontSize: 11, lineHeight: 1.4 }}>
          {scope.tagline}
        </p>

        <div style={{ display: 'flex', gap: 4, marginTop: 'var(--s-3)' }}>
          <ColumnPill
            label={`Voorstellen${proposals.length ? ` · ${proposals.length}` : ''}`}
            active={tab === 'proposals'}
            accent={scope.accent}
            onClick={() => setTab('proposals')}
          />
          <ColumnPill
            label={`Lessons${lessons.length ? ` · ${lessons.length}` : ''}`}
            active={tab === 'lessons'}
            accent={scope.accent}
            onClick={() => setTab('lessons')}
          />
        </div>
      </div>

      <div className="stack" style={{ gap: 'var(--s-3)', padding: 'var(--s-4)', minHeight: 120 }}>
        {list.length === 0 && (
          <div className="muted" style={{ fontSize: 12, padding: 'var(--s-3)', textAlign: 'center' }}>
            {tab === 'proposals' ? 'Geen open voorstellen' : 'Nog geen lessons'}
          </div>
        )}
        {tab === 'proposals' && list.map(row => (
          <ProposalCard
            key={row.id}
            row={row}
            scope={scope}
            meeting={row.source_meeting_id ? meetingMap?.[row.source_meeting_id] : null}
            signals={(row.signal_ids || []).map(id => signalMap?.[id]).filter(Boolean)}
            onDecided={onChanged}
          />
        ))}
        {tab === 'lessons' && list.map(row => (
          <LessonRow key={row.id} row={row} scope={scope} onChanged={onChanged} />
        ))}
      </div>
    </div>
  )
}

function ColumnPill({ label, active, accent, onClick }) {
  return (
    <button
      onClick={onClick}
      style={{
        padding: '4px 10px',
        borderRadius: 6,
        border: '1px solid var(--border)',
        background: active ? `color-mix(in srgb, ${accent} 15%, var(--bg-2))` : 'transparent',
        color: active ? accent : 'var(--text-muted)',
        fontSize: 11,
        fontWeight: active ? 600 : 500,
        cursor: 'pointer',
      }}
    >
      {label}
    </button>
  )
}

// ============================================================
// ProposalCard — bron-blokje + altijd-bewerkbaar veld + acties
// ============================================================
//
// lesson_text is een textarea die er net zo uitziet als de oude readonly-box,
// maar gewoon editable is. Klik erin = typen. "✓ Klopt" stuurt automatisch
// p_lesson_text_override mee als de tekst is gewijzigd.
//
// Sub-modes (alleen voor amend en move, niet meer voor edit):
//   - default  : ✓ Klopt | ↪ Verplaats | ✕ | 💬 AI-instructie
//   - amend    : textarea voor instructie-aan-LLM
//   - move     : kies andere mind-scope

function ProposalCard({ row, scope, meeting, signals, onDecided }) {
  const meta = lessonTypeMeta(row.lesson_type)
  const [busy, setBusy] = useState(false)
  const [mode, setMode] = useState('default')  // 'default' | 'amend' | 'move'
  const [editText, setEditText] = useState(row.lesson_text)
  const [amendText, setAmendText] = useState('')
  const [error, setError] = useState(null)

  const decide = useCallback(async (action, payload = {}) => {
    setBusy(true); setError(null)
    try {
      const { data, error } = await supabase.rpc('submit_jellemind_decision', {
        p_proposal_id: row.id,
        p_action: action,
        ...payload,
      })
      if (error) throw error
      if (!data?.ok) throw new Error(data?.reason || 'onbekende fout')
      onDecided()
    } catch (e) {
      setError(e.message)
      setBusy(false)
    }
  }, [row.id, onDecided])

  const isEdited = editText.trim() !== row.lesson_text.trim()

  const accept = useCallback(() => {
    const payload = isEdited ? { p_lesson_text_override: editText.trim() } : {}
    decide('accept', payload)
  }, [decide, editText, isEdited])

  const acceptToScope = useCallback((scopeKey) => {
    const payload = { p_mind_scope_override: scopeKey }
    if (isEdited) payload.p_lesson_text_override = editText.trim()
    decide('accept', payload)
  }, [decide, editText, isEdited])

  const otherScopes = SCOPES.filter(s => s.key !== row.mind_scope)

  // Auto-resize textarea op basis van scrollHeight zodat de hele tekst zichtbaar is zonder scrollen.
  const textareaRef = useRef(null)
  useEffect(() => {
    const ta = textareaRef.current
    if (!ta) return
    ta.style.height = 'auto'
    ta.style.height = ta.scrollHeight + 'px'
  }, [editText])

  return (
    <div
      style={{
        padding: 'var(--s-3) var(--s-4)',
        borderRadius: 6,
        border: '1px solid var(--border)',
        background: 'var(--bg-2)',
      }}
    >
      {/* Type-tag + meta */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 6, flexWrap: 'wrap' }}>
        <span
          style={{
            fontSize: 10, fontWeight: 600, padding: '2px 7px',
            borderRadius: 999, color: meta.color,
            background: `color-mix(in srgb, ${meta.color} 15%, var(--bg-1))`,
          }}
        >
          {meta.label}
        </span>
        <span className="muted" style={{ fontSize: 10 }}>
          voor {fmtAppliesTo(row.applies_to)} · {Math.round(row.confidence * 100)}% · {fmtRelative(row.created_at)}
        </span>
        {isEdited && (
          <span
            style={{
              fontSize: 10, fontWeight: 600, padding: '2px 7px', borderRadius: 999,
              color: scope.accent,
              background: `color-mix(in srgb, ${scope.accent} 15%, var(--bg-1))`,
              border: `1px solid ${scope.accent}55`,
            }}
            title="Je hebt de tekst aangepast — Klopt slaat de bewerkte versie op"
          >
            bewerkt
          </span>
        )}
      </div>

      {/* Bron-blokje — meeting of cluster */}
      <SourceLine row={row} meeting={meeting} signals={signals} accent={scope.accent} />

      {/* Vraag */}
      {row.proposed_question && (
        <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 6, lineHeight: 1.35 }}>
          {row.proposed_question}
        </div>
      )}

      {/* Lesson-text — altijd bewerkbaar, oogt als readonly maar is een textarea */}
      <textarea
        ref={textareaRef}
        value={editText}
        onChange={e => setEditText(e.target.value)}
        spellCheck={false}
        style={{
          width: '100%',
          fontSize: 12,
          lineHeight: 1.5,
          padding: 'var(--s-2) var(--s-3)',
          borderRadius: 4,
          background: 'var(--bg-1)',
          border: `1px solid ${isEdited ? scope.accent + '88' : 'var(--border)'}`,
          color: 'var(--text)',
          fontFamily: 'inherit',
          resize: 'vertical',
          outline: 'none',
          boxSizing: 'border-box',
          minHeight: '4.5em',
          overflow: 'hidden',  // useEffect resize't height, dus interne scrollbar niet nodig
          transition: 'border-color 0.15s',
        }}
        onFocus={e => { e.target.style.borderColor = scope.accent }}
        onBlur={e => { e.target.style.borderColor = isEdited ? scope.accent + '88' : 'var(--border)' }}
      />

      {/* Evidence */}
      {row.evidence_summary && mode === 'default' && (
        <div className="muted" style={{ fontSize: 11, marginTop: 6, lineHeight: 1.4 }}>
          <strong>Voorbeelden:</strong> {row.evidence_summary}
        </div>
      )}

      {error && (
        <div style={{ fontSize: 11, color: '#ef4444', marginTop: 'var(--s-2)' }}>{error}</div>
      )}

      {/* Actie-rijen */}
      {mode === 'amend' && (
        <div style={{ marginTop: 'var(--s-3)' }}>
          <textarea
            value={amendText}
            onChange={e => setAmendText(e.target.value)}
            placeholder="Geef een instructie aan de AI om dit voorstel te herformuleren…"
            rows={3}
            style={textareaStyle}
            autoFocus
          />
          <div style={{ display: 'flex', gap: 6, marginTop: 'var(--s-2)' }}>
            <button onClick={() => decide('amend', { p_amendment: amendText })}
              disabled={busy || amendText.trim().length < 5} style={btnPrimary(scope.accent)}>
              Stuur instructie
            </button>
            <button onClick={() => { setMode('default'); setAmendText('') }} disabled={busy} style={btnSecondary}>
              Annuleer
            </button>
          </div>
        </div>
      )}

      {mode === 'move' && (
        <div style={{ marginTop: 'var(--s-3)' }}>
          <div className="muted" style={{ fontSize: 11, marginBottom: 6 }}>
            Verplaats naar{isEdited ? ' (met je bewerkte tekst)' : ''}:
          </div>
          <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
            {otherScopes.map(s => (
              <button key={s.key}
                onClick={() => acceptToScope(s.key)}
                disabled={busy}
                style={{ ...btnSecondary, color: s.accent, fontWeight: 600, borderColor: s.accent }}>
                ✓ {s.label}
              </button>
            ))}
            <button onClick={() => setMode('default')} disabled={busy} style={btnSecondary}>
              Annuleer
            </button>
          </div>
        </div>
      )}

      {mode === 'default' && (
        <div style={{ display: 'flex', gap: 4, marginTop: 'var(--s-3)', flexWrap: 'wrap' }}>
          <button onClick={accept} disabled={busy || editText.trim().length < 5} style={btnPrimary(scope.accent)}>
            ✓ Klopt{isEdited ? ' — met deze tekst' : ''}
          </button>
          <button onClick={() => setMode('move')} disabled={busy} style={btnSecondary} title="Verplaats naar andere mind">↪</button>
          <button onClick={() => decide('reject')} disabled={busy} style={btnDanger} title="Verwerp">✕</button>
          <button onClick={() => setMode('amend')} disabled={busy} style={btnGhost} title="Stuur AI-instructie voor herformulering">
            💬
          </button>
        </div>
      )}
    </div>
  )
}

// ============================================================
// SourceLine — laat per voorstel zien waar het vandaan komt
// ============================================================

const SIGNAL_LABEL_SHORT = {
  proposal_amended:  'voorstel bewerkt',
  autodraft_amended: 'mail bewerkt',
  task_edited:       'taak bewerkt',
  direct_feedback:   'directe feedback',
  note_rewritten:    'notitie herschreven',
}

function SourceLine({ row, meeting, signals, accent }) {
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

  // Meeting-bron
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

  // Cluster-bron
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

// ============================================================
// LessonRow — edit + retire
// ============================================================

function LessonRow({ row, scope, onChanged }) {
  const meta = lessonTypeMeta(row.lesson_type)
  const [editing, setEditing] = useState(false)
  const [text, setText] = useState(row.lesson_text)
  const [appliesTo, setAppliesTo] = useState((row.applies_to || []).join(', '))
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState(null)

  const save = useCallback(async () => {
    setBusy(true); setError(null)
    try {
      const arr = appliesTo.split(',').map(s => s.trim()).filter(Boolean)
      const { data, error } = await supabase.rpc('edit_jellemind_lesson', {
        p_lesson_id: row.id,
        p_lesson_text: text,
        p_applies_to: arr.length ? arr : null,
      })
      if (error) throw error
      if (!data?.ok) throw new Error(data?.reason || 'kon niet opslaan')
      setEditing(false); onChanged()
    } catch (e) { setError(e.message) } finally { setBusy(false) }
  }, [row.id, text, appliesTo, onChanged])

  const retire = useCallback(async () => {
    if (!confirm('Deze lesson retiren? Hij wordt inactief gemaakt — niet verwijderd.')) return
    setBusy(true); setError(null)
    try {
      const { data, error } = await supabase.rpc('retire_jellemind_lesson', {
        p_lesson_id: row.id, p_reason: 'manual retire vanuit dashboard',
      })
      if (error) throw error
      if (!data?.ok) throw new Error(data?.reason || 'kon niet retiren')
      onChanged()
    } catch (e) { setError(e.message); setBusy(false) }
  }, [row.id, onChanged])

  return (
    <div
      style={{
        padding: 'var(--s-3) var(--s-4)',
        borderRadius: 6,
        border: '1px solid var(--border)',
        background: 'var(--bg-2)',
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 6, flexWrap: 'wrap' }}>
        <span
          style={{
            fontSize: 10, fontWeight: 600, padding: '2px 7px', borderRadius: 999,
            color: meta.color, background: `color-mix(in srgb, ${meta.color} 15%, var(--bg-1))`,
          }}
        >
          {meta.label}
        </span>
        <span className="muted" style={{ fontSize: 10 }}>
          voor {fmtAppliesTo(row.applies_to)} · {fmtRelative(row.created_at)}
          {row.times_applied > 0 && ` · ${row.times_applied}× toegepast`}
        </span>
        <div style={{ marginLeft: 'auto', display: 'flex', gap: 2 }}>
          <button onClick={() => setEditing(e => !e)} disabled={busy} style={btnGhost}>
            {editing ? '↩' : '✎'}
          </button>
          <button onClick={retire} disabled={busy} style={{ ...btnGhost, color: '#ef4444' }}>🗑</button>
        </div>
      </div>

      {editing ? (
        <div className="stack" style={{ gap: 'var(--s-2)' }}>
          <textarea value={text} onChange={e => setText(e.target.value)} rows={3} style={textareaStyle} />
          <input value={appliesTo} onChange={e => setAppliesTo(e.target.value)}
            placeholder="* of comma-list (auto-draft, daily-admin)"
            style={{
              padding: '6px 8px', borderRadius: 6, border: '1px solid var(--border)',
              background: 'var(--bg-1)', color: 'var(--text)', fontSize: 11,
            }}
          />
          <div style={{ display: 'flex', gap: 6 }}>
            <button onClick={save} disabled={busy || text.length < 5} style={btnPrimary(scope.accent)}>Opslaan</button>
            <button onClick={() => setEditing(false)} disabled={busy} style={btnSecondary}>Annuleer</button>
          </div>
        </div>
      ) : (
        <div style={{ fontSize: 12, lineHeight: 1.5, whiteSpace: 'pre-wrap' }}>
          {row.lesson_text}
        </div>
      )}

      {error && <div style={{ fontSize: 11, color: '#ef4444', marginTop: 4 }}>{error}</div>}
    </div>
  )
}

// ============================================================
// RulesBrowser — alle regels per onderwerp (database-readout)
// ============================================================
// Filterbaar per lesson_type én mind_scope. Toont default alleen
// actieve lessons; toggle om retired/inactieve mee te tonen.
// Doel: Jelle kan inzien wat er in de DB staat en valideren.

function RulesBrowser() {
  const [allLessons, setAllLessons] = useState([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState(null)
  const [collapsed, setCollapsed] = useState(true)
  const [typeFilter, setTypeFilter] = useState('all')
  const [scopeFilter, setScopeFilter] = useState('all')
  const [showInactive, setShowInactive] = useState(false)
  const [search, setSearch] = useState('')

  const load = useCallback(async () => {
    setLoading(true); setError(null)
    let q = supabase.from('jellemind_lessons').select('*').order('created_at', { ascending: false })
    if (!showInactive) q = q.eq('active', true)
    const { data, error } = await q
    if (error) setError(error.message)
    else setAllLessons(data || [])
    setLoading(false)
  }, [showInactive])

  useEffect(() => { if (!collapsed) load() }, [load, collapsed])

  const filtered = useMemo(() => {
    const needle = search.trim().toLowerCase()
    return allLessons.filter(l => {
      if (typeFilter !== 'all' && l.lesson_type !== typeFilter) return false
      if (scopeFilter !== 'all' && l.mind_scope !== scopeFilter) return false
      if (needle) {
        const hay = `${l.lesson_text} ${l.evidence_summary || ''} ${(l.applies_to || []).join(' ')}`.toLowerCase()
        if (!hay.includes(needle)) return false
      }
      return true
    })
  }, [allLessons, typeFilter, scopeFilter, search])

  // Group per onderwerp voor leesbaarheid
  const byType = useMemo(() => {
    const out = new Map()
    for (const t of LESSON_TYPES) out.set(t.key, [])
    for (const l of filtered) {
      if (!out.has(l.lesson_type)) out.set(l.lesson_type, [])
      out.get(l.lesson_type).push(l)
    }
    return out
  }, [filtered])

  const counts = useMemo(() => {
    const total = allLessons.length
    const active = allLessons.filter(l => l.active).length
    const inactive = total - active
    return { total, active, inactive }
  }, [allLessons])

  return (
    <div className="panel" style={{ padding: 0, overflow: 'hidden' }}>
      <button
        onClick={() => setCollapsed(c => !c)}
        style={{
          width: '100%', padding: 'var(--s-4) var(--s-5)',
          background: 'transparent', border: 'none',
          display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer',
          color: 'var(--text)',
        }}
      >
        <span style={{ fontSize: 13, fontWeight: 600 }}>
          {collapsed ? '▶' : '▼'} Regels per onderwerp
        </span>
        <span className="muted" style={{ fontSize: 11 }}>
          inkijk in de database — filter per onderwerp en scope, toggle inactieve regels
        </span>
        {!collapsed && (
          <span className="muted" style={{ marginLeft: 'auto', fontSize: 11 }}>
            {filtered.length} van {showInactive ? counts.total : counts.active}
            {showInactive && counts.inactive > 0 && ` · ${counts.inactive} inactief`}
          </span>
        )}
      </button>

      {!collapsed && (
        <div style={{ borderTop: '1px solid var(--border)', padding: 'var(--s-4) var(--s-5)' }}>
          {/* Filter-rij */}
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 'var(--s-3)', alignItems: 'center', marginBottom: 'var(--s-4)' }}>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4 }}>
              <FilterPill label="Alle onderwerpen" active={typeFilter === 'all'} onClick={() => setTypeFilter('all')} />
              {LESSON_TYPES.map(t => (
                <FilterPill
                  key={t.key}
                  label={t.label}
                  accent={t.color}
                  active={typeFilter === t.key}
                  onClick={() => setTypeFilter(t.key)}
                />
              ))}
            </div>
            <div style={{ width: 1, height: 18, background: 'var(--border)' }} />
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4 }}>
              <FilterPill label="Alle minds" active={scopeFilter === 'all'} onClick={() => setScopeFilter('all')} />
              {SCOPES.map(s => (
                <FilterPill
                  key={s.key}
                  label={s.label}
                  accent={s.accent}
                  active={scopeFilter === s.key}
                  onClick={() => setScopeFilter(s.key)}
                />
              ))}
            </div>
            <div style={{ width: 1, height: 18, background: 'var(--border)' }} />
            <input
              type="text"
              value={search}
              onChange={e => setSearch(e.target.value)}
              placeholder="Zoek in tekst…"
              style={{
                padding: '5px 10px', borderRadius: 6, border: '1px solid var(--border)',
                background: 'var(--bg-1)', color: 'var(--text)', fontSize: 12, minWidth: 160,
              }}
            />
            <label style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 11, color: 'var(--text-muted)' }}>
              <input
                type="checkbox"
                checked={showInactive}
                onChange={e => setShowInactive(e.target.checked)}
              />
              ook inactief
            </label>
            <button
              onClick={load}
              disabled={loading}
              style={{ ...btnSecondary, fontSize: 11, marginLeft: 'auto' }}
              title="Opnieuw laden uit database"
            >
              {loading ? '…' : '↻'} Refresh
            </button>
          </div>

          {error && (
            <div style={{ fontSize: 12, color: '#ef4444', marginBottom: 'var(--s-3)' }}>Fout: {error}</div>
          )}
          {loading && allLessons.length === 0 && (
            <div className="muted" style={{ padding: 'var(--s-4)', textAlign: 'center' }}>Laden…</div>
          )}
          {!loading && filtered.length === 0 && (
            <div className="muted" style={{ padding: 'var(--s-4)', textAlign: 'center', fontSize: 12 }}>
              Geen regels die aan deze filters voldoen.
            </div>
          )}

          {/* Lijst — gegroepeerd per onderwerp */}
          <div className="stack" style={{ gap: 'var(--s-4)' }}>
            {[...byType.entries()].map(([typeKey, rows]) => {
              if (rows.length === 0) return null
              const meta = lessonTypeMeta(typeKey)
              return (
                <div key={typeKey}>
                  <div style={{
                    display: 'flex', alignItems: 'center', gap: 8, marginBottom: 'var(--s-2)',
                    paddingBottom: 4, borderBottom: `1px solid ${meta.color}33`,
                  }}>
                    <span style={{
                      fontSize: 11, fontWeight: 700, color: meta.color, textTransform: 'uppercase',
                      letterSpacing: 0.5,
                    }}>{meta.label}</span>
                    <span className="muted" style={{ fontSize: 11 }}>{rows.length}</span>
                  </div>
                  <div className="stack" style={{ gap: 'var(--s-2)' }}>
                    {rows.map(l => (
                      <RuleRow key={l.id} lesson={l} onChanged={load} />
                    ))}
                  </div>
                </div>
              )
            })}
          </div>
        </div>
      )}
    </div>
  )
}

function FilterPill({ label, active, accent, onClick }) {
  const tint = accent || '#8b5cf6'
  return (
    <button
      onClick={onClick}
      style={{
        padding: '4px 10px',
        borderRadius: 999,
        border: `1px solid ${active ? tint : 'var(--border)'}`,
        background: active ? `color-mix(in srgb, ${tint} 18%, var(--bg-2))` : 'transparent',
        color: active ? tint : 'var(--text-muted)',
        fontSize: 11, fontWeight: active ? 600 : 500, cursor: 'pointer',
      }}
    >
      {label}
    </button>
  )
}

function RuleRow({ lesson, onChanged }) {
  const meta = lessonTypeMeta(lesson.lesson_type)
  const scope = SCOPE_BY_KEY[lesson.mind_scope] || SCOPES[0]
  const [expanded, setExpanded] = useState(false)
  const [editing, setEditing] = useState(false)
  const [text, setText] = useState(lesson.lesson_text)
  const [appliesTo, setAppliesTo] = useState((lesson.applies_to || []).join(', '))
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState(null)

  const save = useCallback(async () => {
    setBusy(true); setError(null)
    try {
      const arr = appliesTo.split(',').map(s => s.trim()).filter(Boolean)
      const { data, error } = await supabase.rpc('edit_jellemind_lesson', {
        p_lesson_id: lesson.id,
        p_lesson_text: text,
        p_applies_to: arr.length ? arr : null,
      })
      if (error) throw error
      if (!data?.ok) throw new Error(data?.reason || 'kon niet opslaan')
      setEditing(false); onChanged()
    } catch (e) { setError(e.message) } finally { setBusy(false) }
  }, [lesson.id, text, appliesTo, onChanged])

  const retire = useCallback(async () => {
    if (!confirm('Deze regel retiren? Hij wordt inactief gemaakt — niet verwijderd.')) return
    setBusy(true); setError(null)
    try {
      const { data, error } = await supabase.rpc('retire_jellemind_lesson', {
        p_lesson_id: lesson.id, p_reason: 'manual retire vanuit regels-browser',
      })
      if (error) throw error
      if (!data?.ok) throw new Error(data?.reason || 'kon niet retiren')
      onChanged()
    } catch (e) { setError(e.message); setBusy(false) }
  }, [lesson.id, onChanged])

  const isInactive = !lesson.active
  return (
    <div
      style={{
        padding: 'var(--s-3) var(--s-4)',
        borderRadius: 6,
        border: '1px solid var(--border)',
        background: isInactive ? 'transparent' : 'var(--bg-2)',
        opacity: isInactive ? 0.62 : 1,
      }}
    >
      <div
        style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap', cursor: 'pointer' }}
        onClick={() => setExpanded(e => !e)}
      >
        <span
          style={{
            fontSize: 10, fontWeight: 700, padding: '2px 7px',
            borderRadius: 4, color: scope.accent,
            background: `color-mix(in srgb, ${scope.accent} 15%, var(--bg-1))`,
            border: `1px solid ${scope.accent}55`,
          }}
        >{scope.label}</span>
        <span
          style={{
            fontSize: 10, fontWeight: 600, padding: '2px 7px',
            borderRadius: 999, color: meta.color,
            background: `color-mix(in srgb, ${meta.color} 15%, var(--bg-1))`,
          }}
        >{meta.label}</span>
        <span style={{ flex: 1, minWidth: 200, fontSize: 12, lineHeight: 1.45 }}>
          {lesson.lesson_text.length > 130 && !expanded
            ? `${lesson.lesson_text.slice(0, 130)}…`
            : lesson.lesson_text}
        </span>
        <span className="muted" style={{ fontSize: 10, fontVariantNumeric: 'tabular-nums' }}>
          {fmtAppliesTo(lesson.applies_to)}
          {lesson.times_applied > 0 && ` · ${lesson.times_applied}×`}
          {isInactive && ' · inactief'}
        </span>
      </div>

      {expanded && (
        <div className="stack" style={{ gap: 'var(--s-2)', marginTop: 'var(--s-3)', paddingLeft: 4 }}>
          {editing ? (
            <>
              <textarea value={text} onChange={e => setText(e.target.value)} rows={3} style={textareaStyle} />
              <input
                value={appliesTo}
                onChange={e => setAppliesTo(e.target.value)}
                placeholder="* of comma-list (auto-draft, daily-admin)"
                style={{
                  padding: '6px 8px', borderRadius: 6, border: '1px solid var(--border)',
                  background: 'var(--bg-1)', color: 'var(--text)', fontSize: 11,
                }}
              />
              <div style={{ display: 'flex', gap: 6 }}>
                <button onClick={save} disabled={busy || text.length < 5} style={btnPrimary(scope.accent)}>Opslaan</button>
                <button onClick={() => { setEditing(false); setText(lesson.lesson_text) }} disabled={busy} style={btnSecondary}>Annuleer</button>
              </div>
            </>
          ) : (
            <>
              {lesson.evidence_summary && (
                <div className="muted" style={{ fontSize: 11, lineHeight: 1.4 }}>
                  <strong>Voorbeelden:</strong> {lesson.evidence_summary}
                </div>
              )}
              <div className="muted" style={{ fontSize: 10, fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace' }}>
                id: {lesson.id} · scope: {lesson.mind_scope} · type: {lesson.lesson_type}
                {lesson.embedding_model && ` · model: ${lesson.embedding_model}`}
              </div>
              <div className="muted" style={{ fontSize: 10 }}>
                aangemaakt: {new Date(lesson.created_at).toLocaleString('nl-NL')}
                {lesson.last_applied_at && ` · laatst toegepast: ${fmtRelative(lesson.last_applied_at)}`}
                {lesson.times_contradicted > 0 && ` · ${lesson.times_contradicted}× tegengesproken`}
              </div>
              {isInactive && (
                <div style={{ fontSize: 11, color: '#ef4444' }}>
                  <strong>Inactief sinds {lesson.retired_at ? new Date(lesson.retired_at).toLocaleDateString('nl-NL') : '—'}.</strong>
                  {lesson.retired_reason && ` Reden: ${lesson.retired_reason}`}
                </div>
              )}
              {!isInactive && (
                <div style={{ display: 'flex', gap: 6, marginTop: 4 }}>
                  <button onClick={() => setEditing(true)} disabled={busy} style={btnSecondary}>✎ Bewerken</button>
                  <button onClick={retire} disabled={busy} style={btnDanger}>🗑 Retiren</button>
                </div>
              )}
            </>
          )}
          {error && <div style={{ fontSize: 11, color: '#ef4444' }}>{error}</div>}
        </div>
      )}
    </div>
  )
}

// ============================================================
// Signalen-feed (geen scope-filter, gedeeld over alle minds)
// ============================================================

const SIGNAL_TYPE_LABEL = {
  proposal_amended:  { label: 'Proposal bewerkt', color: '#06b6d4' },
  autodraft_amended: { label: 'Mail bewerkt',     color: '#f59e0b' },
  task_edited:       { label: 'Taak bewerkt',     color: '#10b981' },
  direct_feedback:   { label: 'Direct feedback',  color: '#ec4899' },
  note_rewritten:    { label: 'Notitie herschreven', color: '#8b5cf6' },
  other:             { label: 'Overig',           color: '#6b7280' },
}

function SignalsFeed() {
  const [rows, setRows] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const [showProcessed, setShowProcessed] = useState(false)
  const [collapsed, setCollapsed] = useState(true)

  const load = useCallback(async () => {
    setLoading(true)
    let q = supabase
      .from('jellemind_signals')
      .select('*')
      .order('occurred_at', { ascending: false })
      .limit(50)
    if (!showProcessed) q = q.eq('processed', false)
    const { data, error } = await q
    if (error) setError(error.message)
    else setRows(data || [])
    setLoading(false)
  }, [showProcessed])

  useEffect(() => { if (!collapsed) load() }, [load, collapsed])

  const newCount = rows.filter(r => !r.processed).length

  return (
    <div className="panel" style={{ padding: 0, overflow: 'hidden' }}>
      <button
        onClick={() => setCollapsed(c => !c)}
        style={{
          width: '100%', padding: 'var(--s-4) var(--s-5)',
          background: 'transparent', border: 'none',
          display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer',
          color: 'var(--text)',
        }}
      >
        <span style={{ fontSize: 13, fontWeight: 600 }}>
          {collapsed ? '▶' : '▼'} Signalen-feed
        </span>
        <span className="muted" style={{ fontSize: 11 }}>
          ruwe correcties die JelleMind heeft geoogst — gedeeld over alle scopes
        </span>
        {!collapsed && (
          <label
            onClick={e => e.stopPropagation()}
            style={{ marginLeft: 'auto', display: 'inline-flex', alignItems: 'center', gap: 4, fontSize: 11, color: 'var(--text-muted)' }}
          >
            <input
              type="checkbox"
              checked={showProcessed}
              onChange={e => setShowProcessed(e.target.checked)}
            />
            ook verwerkte tonen
          </label>
        )}
      </button>

      {!collapsed && (
        <>
          {loading && <div className="muted" style={{ padding: 'var(--s-4)' }}>Signalen laden…</div>}
          {error && <div style={{ padding: 'var(--s-4)', color: '#ef4444' }}>Fout: {error}</div>}
          {!loading && !error && rows.length === 0 && (
            <div className="muted" style={{ padding: 'var(--s-5)', textAlign: 'center' }}>
              Geen signalen — JelleMind heeft nog niets geoogst, of alle signalen zijn verwerkt.
            </div>
          )}
          {rows.map((row, idx) => (
            <SignalRow key={row.id} row={row} isLast={idx === rows.length - 1} />
          ))}
        </>
      )}
    </div>
  )
}

function SignalRow({ row, isLast }) {
  const meta = SIGNAL_TYPE_LABEL[row.signal_type] || SIGNAL_TYPE_LABEL.other
  const [expanded, setExpanded] = useState(false)
  return (
    <div
      style={{
        padding: 'var(--s-3) var(--s-4)',
        borderTop: '1px solid var(--border)',
        borderBottom: isLast ? '1px solid var(--border)' : 'none',
        cursor: 'pointer',
        background: row.processed ? 'transparent' : 'color-mix(in srgb, var(--bg-2) 50%, transparent)',
      }}
      onClick={() => setExpanded(e => !e)}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 12, flexWrap: 'wrap' }}>
        <span style={{ minWidth: 56, color: 'var(--text-muted)', fontVariantNumeric: 'tabular-nums' }}>
          {fmtRelative(row.occurred_at)}
        </span>
        <span
          style={{
            fontSize: 10, fontWeight: 600, padding: '2px 8px',
            borderRadius: 999, color: meta.color,
            background: `color-mix(in srgb, ${meta.color} 15%, var(--bg-2))`,
          }}
        >
          {meta.label}
        </span>
        <span className="muted" style={{ fontSize: 11 }}>· {row.agent_name}</span>
        <span style={{ flex: 1, minWidth: 100, fontSize: 12 }}>
          {row.delta_summary || '—'}
        </span>
        {!row.processed && <span style={{ fontSize: 10, color: '#8b5cf6' }}>nieuw</span>}
      </div>

      {expanded && (
        <div className="stack" style={{ gap: 'var(--s-2)', marginTop: 'var(--s-3)', paddingLeft: 64 }}>
          {row.before_text && (
            <div>
              <div className="muted" style={{ fontSize: 10, marginBottom: 2 }}>Voor:</div>
              <pre style={preStyle}>{row.before_text.slice(0, 400)}</pre>
            </div>
          )}
          {row.after_text && (
            <div>
              <div className="muted" style={{ fontSize: 10, marginBottom: 2 }}>Na:</div>
              <pre style={preStyle}>{row.after_text.slice(0, 400)}</pre>
            </div>
          )}
          <div className="muted" style={{ fontSize: 10 }}>
            bron: {row.source_table} / {row.source_id}
          </div>
        </div>
      )}
    </div>
  )
}

// ============================================================
// Shared style tokens
// ============================================================

const btnPrimary = (accent) => ({
  padding: '5px 10px', borderRadius: 6, border: '1px solid var(--border)',
  background: accent, color: '#fff', fontSize: 11, fontWeight: 600, cursor: 'pointer',
})
const btnSecondary = {
  padding: '5px 10px', borderRadius: 6, border: '1px solid var(--border)',
  background: 'var(--bg-1)', color: 'var(--text)', fontSize: 11, fontWeight: 500, cursor: 'pointer',
}
const btnDanger = {
  padding: '5px 10px', borderRadius: 6, border: '1px solid var(--border)',
  background: 'var(--bg-1)', color: '#ef4444', fontSize: 11, fontWeight: 600, cursor: 'pointer',
}
const btnGhost = {
  padding: '3px 6px', borderRadius: 4, border: '1px solid transparent',
  background: 'transparent', color: 'var(--text-muted)',
  fontSize: 11, cursor: 'pointer',
}
const textareaStyle = {
  width: '100%',
  padding: 'var(--s-2) var(--s-3)',
  borderRadius: 6,
  border: '1px solid var(--border)',
  background: 'var(--bg-1)',
  color: 'var(--text)',
  fontSize: 12,
  fontFamily: 'inherit',
  resize: 'vertical',
}
const preStyle = {
  margin: 0, padding: 'var(--s-2) var(--s-3)',
  borderRadius: 4, background: 'var(--bg-2)',
  border: '1px solid var(--border)',
  fontSize: 11, lineHeight: 1.4,
  whiteSpace: 'pre-wrap', wordBreak: 'break-word',
  fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
}
