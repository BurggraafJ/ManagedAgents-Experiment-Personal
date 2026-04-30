// Mind-view (v2) — generieke component voor JelleMind / SkillMind / LegalMind.
// Drie aparte sidebar-tabs delen deze component via een `scope` prop.
//
// Scopes:
//   - 'jelle'     → persoonlijke voorkeuren (toon, stijl, communicatie)
//   - 'skill'     → procesinstructies aan agents (workflow, dependencies)
//   - 'legalmind' → organisatie-waarheid (klanten, processen, feiten)
//
// Backend: jellemind_signals / jellemind_lesson_proposals / jellemind_lessons
// + RPC's submit_jellemind_decision (met p_mind_scope_override),
//   retire_jellemind_lesson, edit_jellemind_lesson, trigger_jellemind_run.

import { useEffect, useState, useCallback, useMemo } from 'react'
import { supabase } from '../../lib/supabase'

// ============================================================
// Scope-config — per mind-scope eigen accent, titel, intro
// ============================================================

const SCOPE_CONFIG = {
  jelle: {
    accent: '#8b5cf6', // paars
    label: 'JelleMind',
    headline: 'JelleMind',
    intro: 'Persoonlijke voorkeuren — toon, stijl en communicatie van Jelle. Agent leert van jouw correcties bij andere agents en stelt voorzichtige voorkeur-regels voor.',
    emptyProposals: 'Geen open voorstellen — JelleMind heeft nog geen nieuwe persoonlijke voorkeuren gevonden.',
    emptyLessons: 'Nog geen lessons. Pas wanneer je een Jelle-voorstel accepteert verschijnt hier een rij.',
    icon: (
      <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
        <path d="M12 2a4 4 0 0 0-4 4v1a4 4 0 0 0-2 7.5V17a3 3 0 0 0 3 3h.5"/>
        <path d="M12 2a4 4 0 0 1 4 4v1a4 4 0 0 1 2 7.5V17a3 3 0 0 1-3 3h-.5"/>
        <path d="M12 6v18"/>
      </svg>
    ),
  },
  skill: {
    accent: '#10b981', // groen
    label: 'SkillMind',
    headline: 'SkillMind',
    intro: 'Procesinstructies aan agents — workflows, dependencies en do\'s & don\'ts. Wat moet een skill eerst checken, automatisch aanmaken of nooit teruggeven aan jou.',
    emptyProposals: 'Geen open voorstellen — geen nieuwe skill-procesinstructies gedetecteerd.',
    emptyLessons: 'Nog geen lessons. Pas wanneer je een skill-voorstel accepteert verschijnt hier een rij.',
    icon: (
      <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
        <circle cx="12" cy="12" r="3"/>
        <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 1 1-4 0v-.09a1.65 1.65 0 0 0-1-1.51 1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 1 1 0-4h.09a1.65 1.65 0 0 0 1.51-1 1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 1 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 1 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/>
      </svg>
    ),
  },
  legalmind: {
    accent: '#06b6d4', // cyaan
    label: 'LegalMind',
    headline: 'LegalMind',
    intro: 'Organisatie-waarheid — feiten over Legal Mind die voor iedereen gelden. Klanten, processen, terminologie, prijzen, namen-mappings. Geldig voor team én agents.',
    emptyProposals: 'Geen open voorstellen — geen nieuwe organisatie-feiten gedetecteerd.',
    emptyLessons: 'Nog geen lessons. Pas wanneer je een LegalMind-voorstel accepteert verschijnt hier een rij.',
    icon: (
      <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
        <path d="M3 21h18"/>
        <path d="M5 21V10l7-5 7 5v11"/>
        <path d="M9 21v-6h6v6"/>
      </svg>
    ),
  },
}

const SCOPE_LABELS = {
  jelle: 'JelleMind',
  skill: 'SkillMind',
  legalmind: 'LegalMind',
}

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
// Hoofd-component
// ============================================================

export default function MindView({ scope = 'jelle' }) {
  const cfg = SCOPE_CONFIG[scope] || SCOPE_CONFIG.jelle
  const [tab, setTab] = useState('proposals')
  const [running, setRunning] = useState(false)
  const [runMessage, setRunMessage] = useState(null)

  const handleManualRun = useCallback(async () => {
    setRunning(true)
    setRunMessage(null)
    try {
      const { data, error } = await supabase.rpc('trigger_jellemind_run')
      if (error) throw error
      if (data?.ok) {
        setRunMessage('Run aangevraagd — orchestrator pakt \'m op binnen 15 min.')
      } else {
        setRunMessage(data?.reason || 'Run kon niet worden aangevraagd.')
      }
    } catch (e) {
      setRunMessage(`Fout: ${e.message}`)
    } finally {
      setRunning(false)
      setTimeout(() => setRunMessage(null), 6000)
    }
  }, [])

  return (
    <div className="stack" style={{ gap: 'var(--s-5)' }}>
      <Header cfg={cfg} running={running} onRun={handleManualRun} runMessage={runMessage} />
      <Tabs value={tab} onChange={setTab} accent={cfg.accent} />
      {tab === 'proposals' && <ProposalsTab scope={scope} cfg={cfg} />}
      {tab === 'lessons'   && <LessonsTab   scope={scope} cfg={cfg} />}
      {tab === 'signals'   && <SignalsTab   accent={cfg.accent} />}
    </div>
  )
}

// Backward-compat: default export blijft bestaan, plus named alias.
export { MindView }

// ============================================================
// Header
// ============================================================

function Header({ cfg, running, onRun, runMessage }) {
  return (
    <div className="panel" style={{ padding: 'var(--s-5) var(--s-6)' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--s-4)', flexWrap: 'wrap' }}>
        <div
          style={{
            width: 44, height: 44, borderRadius: 12,
            background: `color-mix(in srgb, ${cfg.accent} 20%, var(--bg-2))`,
            color: cfg.accent,
            display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
            flexShrink: 0,
          }}
        >
          {cfg.icon}
        </div>
        <div style={{ flex: 1, minWidth: 200 }}>
          <h2 style={{ fontSize: 18, fontWeight: 700, margin: 0 }}>{cfg.headline}</h2>
          <p className="muted" style={{ fontSize: 13, lineHeight: 1.4, marginTop: 2, marginBottom: 0 }}>
            {cfg.intro}
          </p>
        </div>
        <button
          onClick={onRun}
          disabled={running}
          style={{
            padding: '8px 14px',
            borderRadius: 8,
            border: '1px solid var(--border)',
            background: running ? 'var(--bg-2)' : cfg.accent,
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
// Tabs
// ============================================================

function Tabs({ value, onChange, accent }) {
  const items = [
    { id: 'proposals', label: 'Voorstellen' },
    { id: 'lessons',   label: 'Bibliotheek' },
    { id: 'signals',   label: 'Signalen-feed' },
  ]
  return (
    <div style={{ display: 'flex', gap: 6, borderBottom: '1px solid var(--border)', paddingBottom: 0 }}>
      {items.map(item => {
        const active = value === item.id
        return (
          <button
            key={item.id}
            onClick={() => onChange(item.id)}
            style={{
              padding: '8px 14px',
              border: 'none',
              borderBottom: active ? `2px solid ${accent}` : '2px solid transparent',
              background: 'transparent',
              color: active ? 'var(--text)' : 'var(--text-muted)',
              fontSize: 13,
              fontWeight: active ? 600 : 500,
              cursor: 'pointer',
              marginBottom: -1,
            }}
          >
            {item.label}
          </button>
        )
      })}
    </div>
  )
}

// ============================================================
// Tab 1 — Voorstellen (gefilterd op mind_scope)
// ============================================================

function ProposalsTab({ scope, cfg }) {
  const [rows, setRows] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)

  const load = useCallback(async () => {
    setLoading(true)
    const { data, error } = await supabase
      .from('jellemind_lesson_proposals')
      .select('*')
      .eq('status', 'pending')
      .eq('mind_scope', scope)
      .order('confidence', { ascending: false })
      .order('created_at', { ascending: false })
    if (error) setError(error.message)
    else setRows(data || [])
    setLoading(false)
  }, [scope])

  useEffect(() => { load() }, [load])

  if (loading) return <div className="muted" style={{ padding: 'var(--s-5)' }}>Voorstellen laden…</div>
  if (error) return <div style={{ padding: 'var(--s-5)', color: '#ef4444' }}>Fout: {error}</div>

  return (
    <div className="stack" style={{ gap: 'var(--s-4)' }}>
      <div className="muted" style={{ fontSize: 12 }}>
        {rows.length === 0
          ? cfg.emptyProposals
          : `${rows.length} ${rows.length === 1 ? 'voorstel' : 'voorstellen'} klaar voor review (cap 5 per dag, alle scopes samen).`}
      </div>
      {rows.map(row => (
        <ProposalCard key={row.id} row={row} cfg={cfg} onDecided={load} />
      ))}
    </div>
  )
}

function ProposalCard({ row, cfg, onDecided }) {
  const meta = lessonTypeMeta(row.lesson_type)
  const [busy, setBusy] = useState(false)
  const [showAmend, setShowAmend] = useState(false)
  const [amendText, setAmendText] = useState('')
  const [showScopeMove, setShowScopeMove] = useState(false)
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

  // Andere scopes dan de huidige — voor "verplaats naar"-actie bij accept.
  const otherScopes = Object.keys(SCOPE_CONFIG).filter(s => s !== row.mind_scope)

  return (
    <div className="panel" style={{ padding: 'var(--s-5) var(--s-6)' }}>
      <div style={{ display: 'flex', alignItems: 'flex-start', gap: 'var(--s-4)', flexWrap: 'wrap' }}>
        <div style={{ flex: 1, minWidth: 200 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6, flexWrap: 'wrap' }}>
            <span
              style={{
                fontSize: 11, fontWeight: 600, padding: '2px 8px',
                borderRadius: 999, color: meta.color,
                background: `color-mix(in srgb, ${meta.color} 15%, var(--bg-2))`,
              }}
            >
              {meta.label}
            </span>
            <span className="muted" style={{ fontSize: 11 }}>
              · voor {fmtAppliesTo(row.applies_to)} · {Math.round(row.confidence * 100)}% zeker · {fmtRelative(row.created_at)}
            </span>
          </div>
          {row.proposed_question && (
            <div style={{ fontSize: 14, fontWeight: 600, marginBottom: 8 }}>
              {row.proposed_question}
            </div>
          )}
          <div
            style={{
              fontSize: 13, lineHeight: 1.5,
              padding: 'var(--s-3) var(--s-4)',
              borderRadius: 6,
              background: 'var(--bg-2)',
              border: '1px solid var(--border)',
              fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
              whiteSpace: 'pre-wrap',
            }}
          >
            {row.lesson_text}
          </div>
          {row.evidence_summary && (
            <div className="muted" style={{ fontSize: 12, marginTop: 8, lineHeight: 1.4 }}>
              <strong>Voorbeelden:</strong> {row.evidence_summary}
            </div>
          )}
        </div>
      </div>

      {error && (
        <div style={{ fontSize: 12, color: '#ef4444', marginTop: 'var(--s-3)' }}>{error}</div>
      )}

      {showAmend ? (
        <div style={{ marginTop: 'var(--s-4)' }}>
          <textarea
            value={amendText}
            onChange={e => setAmendText(e.target.value)}
            placeholder={`Wat moet er anders? Bv. 'in plaats van altijd "je", schrijf "u" wanneer de tegenpartij ook "u" gebruikt'`}
            rows={3}
            style={textareaStyle}
          />
          <div style={{ display: 'flex', gap: 8, marginTop: 'var(--s-3)' }}>
            <button
              onClick={() => decide('amend', { p_amendment: amendText })}
              disabled={busy || amendText.trim().length < 5}
              style={btn(cfg.accent).primary}
            >
              Stuur aanpassing
            </button>
            <button
              onClick={() => { setShowAmend(false); setAmendText('') }}
              disabled={busy}
              style={btnSecondary}
            >
              Annuleer
            </button>
          </div>
        </div>
      ) : showScopeMove ? (
        <div style={{ marginTop: 'var(--s-4)' }}>
          <div className="muted" style={{ fontSize: 12, marginBottom: 8 }}>
            Hoort dit eigenlijk in een andere mind? Kies dan welke en accepteer:
          </div>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            {otherScopes.map(s => (
              <button
                key={s}
                onClick={() => decide('accept', { p_mind_scope_override: s })}
                disabled={busy}
                style={{ ...btnSecondary, color: SCOPE_CONFIG[s].accent, fontWeight: 600 }}
              >
                ✓ Accepteer als {SCOPE_LABELS[s]}
              </button>
            ))}
            <button
              onClick={() => setShowScopeMove(false)}
              disabled={busy}
              style={btnSecondary}
            >
              Annuleer
            </button>
          </div>
        </div>
      ) : (
        <div style={{ display: 'flex', gap: 8, marginTop: 'var(--s-4)', flexWrap: 'wrap' }}>
          <button onClick={() => decide('accept')} disabled={busy} style={btn(cfg.accent).primary}>✓ Klopt</button>
          <button onClick={() => decide('reject')} disabled={busy} style={btnDanger}>✕ Klopt niet</button>
          <button onClick={() => setShowAmend(true)} disabled={busy} style={btnSecondary}>✎ Pas aan</button>
          <button onClick={() => setShowScopeMove(true)} disabled={busy} style={btnSecondary} title="Hoort dit beter in een andere mind?">
            ↪ Andere mind
          </button>
        </div>
      )}
    </div>
  )
}

// ============================================================
// Tab 2 — Bibliotheek (gefilterd op mind_scope)
// ============================================================

function LessonsTab({ scope, cfg }) {
  const [rows, setRows] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const [filterType, setFilterType] = useState('all')
  const [includeRetired, setIncludeRetired] = useState(false)

  const load = useCallback(async () => {
    setLoading(true)
    let q = supabase
      .from('jellemind_lessons')
      .select('*')
      .eq('mind_scope', scope)
      .order('created_at', { ascending: false })
    if (!includeRetired) q = q.eq('active', true)
    const { data, error } = await q
    if (error) setError(error.message)
    else setRows(data || [])
    setLoading(false)
  }, [scope, includeRetired])

  useEffect(() => { load() }, [load])

  const filtered = useMemo(() => {
    if (filterType === 'all') return rows
    return rows.filter(r => r.lesson_type === filterType)
  }, [rows, filterType])

  return (
    <div className="stack" style={{ gap: 'var(--s-4)' }}>
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
        <div className="muted" style={{ fontSize: 12 }}>
          {rows.length} {rows.length === 1 ? 'lesson' : 'lessons'}
          {includeRetired ? ' (incl. retired)' : ' actief'}
        </div>
        <div style={{ display: 'flex', gap: 4, marginLeft: 'auto' }}>
          <select
            value={filterType}
            onChange={e => setFilterType(e.target.value)}
            style={selectStyle}
          >
            <option value="all">Alle types</option>
            {LESSON_TYPES.map(t => (
              <option key={t.key} value={t.key}>{t.label}</option>
            ))}
          </select>
          <label style={{ display: 'inline-flex', alignItems: 'center', gap: 4, fontSize: 12, color: 'var(--text-muted)', padding: '0 8px' }}>
            <input
              type="checkbox"
              checked={includeRetired}
              onChange={e => setIncludeRetired(e.target.checked)}
            />
            retired tonen
          </label>
        </div>
      </div>

      {loading && <div className="muted" style={{ padding: 'var(--s-5)' }}>Lessons laden…</div>}
      {error && <div style={{ padding: 'var(--s-5)', color: '#ef4444' }}>Fout: {error}</div>}
      {!loading && !error && filtered.length === 0 && (
        <div className="muted" style={{ padding: 'var(--s-5)', textAlign: 'center' }}>
          {cfg.emptyLessons}
        </div>
      )}
      {filtered.map(row => (
        <LessonRow key={row.id} row={row} cfg={cfg} onChanged={load} />
      ))}
    </div>
  )
}

function LessonRow({ row, cfg, onChanged }) {
  const meta = lessonTypeMeta(row.lesson_type)
  const [editing, setEditing] = useState(false)
  const [text, setText] = useState(row.lesson_text)
  const [appliesTo, setAppliesTo] = useState((row.applies_to || []).join(', '))
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState(null)

  const save = useCallback(async () => {
    setBusy(true); setError(null)
    try {
      const arr = appliesTo
        .split(',')
        .map(s => s.trim())
        .filter(Boolean)
      const { data, error } = await supabase.rpc('edit_jellemind_lesson', {
        p_lesson_id: row.id,
        p_lesson_text: text,
        p_applies_to: arr.length ? arr : null,
      })
      if (error) throw error
      if (!data?.ok) throw new Error(data?.reason || 'kon niet opslaan')
      setEditing(false)
      onChanged()
    } catch (e) {
      setError(e.message)
    } finally { setBusy(false) }
  }, [row.id, text, appliesTo, onChanged])

  const retire = useCallback(async () => {
    if (!confirm('Deze lesson retiren? Hij wordt inactief gemaakt — niet verwijderd.')) return
    setBusy(true); setError(null)
    try {
      const { data, error } = await supabase.rpc('retire_jellemind_lesson', {
        p_lesson_id: row.id,
        p_reason: 'manual retire vanuit dashboard',
      })
      if (error) throw error
      if (!data?.ok) throw new Error(data?.reason || 'kon niet retiren')
      onChanged()
    } catch (e) {
      setError(e.message); setBusy(false)
    }
  }, [row.id, onChanged])

  return (
    <div
      className="panel"
      style={{
        padding: 'var(--s-4) var(--s-5)',
        opacity: row.active ? 1 : 0.55,
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap', marginBottom: 6 }}>
        <span
          style={{
            fontSize: 11, fontWeight: 600, padding: '2px 8px', borderRadius: 999,
            color: meta.color, background: `color-mix(in srgb, ${meta.color} 15%, var(--bg-2))`,
          }}
        >
          {meta.label}
        </span>
        <span className="muted" style={{ fontSize: 11 }}>
          voor {fmtAppliesTo(row.applies_to)} · {fmtRelative(row.created_at)}
          {row.times_applied > 0 && ` · ${row.times_applied}× toegepast`}
          {row.times_contradicted > 0 && ` · ${row.times_contradicted}× tegengesproken`}
          {!row.active && ' · retired'}
        </span>
        {row.active && (
          <div style={{ marginLeft: 'auto', display: 'flex', gap: 4 }}>
            <button onClick={() => setEditing(e => !e)} disabled={busy} style={btnGhost}>
              {editing ? '↩' : '✎'}
            </button>
            <button onClick={retire} disabled={busy} style={{ ...btnGhost, color: '#ef4444' }}>
              🗑
            </button>
          </div>
        )}
      </div>

      {editing ? (
        <div className="stack" style={{ gap: 'var(--s-3)' }}>
          <textarea
            value={text}
            onChange={e => setText(e.target.value)}
            rows={3}
            style={textareaStyle}
          />
          <input
            value={appliesTo}
            onChange={e => setAppliesTo(e.target.value)}
            placeholder="* (alle agents) of comma-list: auto-draft, daily-admin"
            style={{
              padding: 'var(--s-2) var(--s-3)',
              borderRadius: 6, border: '1px solid var(--border)',
              background: 'var(--bg-2)', color: 'var(--text)', fontSize: 12,
            }}
          />
          <div style={{ display: 'flex', gap: 8 }}>
            <button onClick={save} disabled={busy || text.length < 5} style={btn(cfg.accent).primary}>Opslaan</button>
            <button onClick={() => setEditing(false)} disabled={busy} style={btnSecondary}>Annuleer</button>
          </div>
        </div>
      ) : (
        <div style={{ fontSize: 13, lineHeight: 1.5, whiteSpace: 'pre-wrap' }}>
          {row.lesson_text}
        </div>
      )}

      {row.evidence_summary && !editing && (
        <div className="muted" style={{ fontSize: 11, marginTop: 6, lineHeight: 1.4 }}>
          {row.evidence_summary}
        </div>
      )}

      {error && <div style={{ fontSize: 12, color: '#ef4444', marginTop: 6 }}>{error}</div>}
    </div>
  )
}

// ============================================================
// Tab 3 — Signalen-feed (geen scope-filter — signalen zijn ruwe data)
// ============================================================

function SignalsTab({ accent }) {
  const [rows, setRows] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const [showProcessed, setShowProcessed] = useState(false)

  const load = useCallback(async () => {
    setLoading(true)
    let q = supabase
      .from('jellemind_signals')
      .select('*')
      .order('occurred_at', { ascending: false })
      .limit(100)
    if (!showProcessed) q = q.eq('processed', false)
    const { data, error } = await q
    if (error) setError(error.message)
    else setRows(data || [])
    setLoading(false)
  }, [showProcessed])

  useEffect(() => { load() }, [load])

  return (
    <div className="stack" style={{ gap: 'var(--s-4)' }}>
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
        <div className="muted" style={{ fontSize: 12 }}>
          {rows.length} signalen {showProcessed ? '(alle)' : '(onverwerkt)'} — gedeeld over alle minds
        </div>
        <label style={{ marginLeft: 'auto', display: 'inline-flex', alignItems: 'center', gap: 4, fontSize: 12, color: 'var(--text-muted)' }}>
          <input
            type="checkbox"
            checked={showProcessed}
            onChange={e => setShowProcessed(e.target.checked)}
          />
          ook verwerkte tonen
        </label>
      </div>

      {loading && <div className="muted" style={{ padding: 'var(--s-5)' }}>Signalen laden…</div>}
      {error && <div style={{ padding: 'var(--s-5)', color: '#ef4444' }}>Fout: {error}</div>}
      {!loading && !error && rows.length === 0 && (
        <div className="muted" style={{ padding: 'var(--s-5)', textAlign: 'center' }}>
          Geen signalen — JelleMind heeft nog niets geoogst, of alle signalen zijn verwerkt.
        </div>
      )}

      <div className="panel" style={{ padding: 0, overflow: 'hidden' }}>
        {rows.map((row, idx) => (
          <SignalRow key={row.id} row={row} isLast={idx === rows.length - 1} accent={accent} />
        ))}
      </div>
    </div>
  )
}

const SIGNAL_TYPE_LABEL = {
  proposal_amended:  { label: 'Proposal bewerkt', color: '#06b6d4' },
  autodraft_amended: { label: 'Mail bewerkt',     color: '#f59e0b' },
  task_edited:       { label: 'Taak bewerkt',     color: '#10b981' },
  direct_feedback:   { label: 'Direct feedback',  color: '#ec4899' },
  note_rewritten:    { label: 'Notitie herschreven', color: '#8b5cf6' },
  other:             { label: 'Overig',           color: '#6b7280' },
}

function SignalRow({ row, isLast, accent }) {
  const meta = SIGNAL_TYPE_LABEL[row.signal_type] || SIGNAL_TYPE_LABEL.other
  const [expanded, setExpanded] = useState(false)
  return (
    <div
      style={{
        padding: 'var(--s-3) var(--s-4)',
        borderBottom: isLast ? 'none' : '1px solid var(--border)',
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
        {!row.processed && <span style={{ fontSize: 10, color: accent }}>nieuw</span>}
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

const btn = (accent) => ({
  primary: {
    padding: '6px 12px', borderRadius: 6, border: '1px solid var(--border)',
    background: accent, color: '#fff', fontSize: 12, fontWeight: 600, cursor: 'pointer',
  },
})
const btnSecondary = {
  padding: '6px 12px', borderRadius: 6, border: '1px solid var(--border)',
  background: 'var(--bg-2)', color: 'var(--text)', fontSize: 12, fontWeight: 500, cursor: 'pointer',
}
const btnDanger = {
  padding: '6px 12px', borderRadius: 6, border: '1px solid var(--border)',
  background: 'var(--bg-2)', color: '#ef4444', fontSize: 12, fontWeight: 600, cursor: 'pointer',
}
const btnGhost = {
  padding: '4px 8px', borderRadius: 4, border: '1px solid transparent',
  background: 'transparent', color: 'var(--text-muted)',
  fontSize: 12, cursor: 'pointer',
}
const selectStyle = {
  padding: '4px 8px', borderRadius: 6, border: '1px solid var(--border)',
  background: 'var(--bg-2)', color: 'var(--text)', fontSize: 12,
}
const textareaStyle = {
  width: '100%',
  padding: 'var(--s-3) var(--s-4)',
  borderRadius: 6,
  border: '1px solid var(--border)',
  background: 'var(--bg-2)',
  color: 'var(--text)',
  fontSize: 13,
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
