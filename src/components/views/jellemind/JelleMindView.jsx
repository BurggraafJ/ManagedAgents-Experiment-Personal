import { useState, useCallback, useMemo } from 'react'
import { supabase } from '../../../lib/supabase'
import { useMindData } from '../../../hooks/useMindData'
import { SCOPES } from '../../../lib/jellemind'
import Header from './Header'
import ScopeColumn from './ScopeColumn'
import RulesBrowser from './RulesBrowser'
import SignalsFeed from './SignalsFeed'

// JelleMindView (v4 — drie kolommen + regels-browser).
//
// Layout:
//   ┌─────── Jelle ───────┐ ┌──── Legal Mind ────┐ ┌────── Skills ──────┐
//   │ [Voorstellen|Lessons]│ │[Voorstellen|Lessons]│ │[Voorstellen|Lessons]│
//   │ ...cards...          │ │  ...cards...        │ │  ...cards...        │
//   └──────────────────────┘ └─────────────────────┘ └─────────────────────┘
//
//   ╔══════════════ Regels per onderwerp (browser) ═════════════╗
//   ╔══════════════════════ Signalen-feed ══════════════════════╗
//
// Op smal scherm (< 980px) vallen de kolommen onder elkaar via auto-fit grid.
//
// Backend: jellemind_signals / jellemind_lesson_proposals / jellemind_lessons
// + RPC's submit_jellemind_decision (met p_mind_scope_override) /
//   retire_jellemind_lesson / edit_jellemind_lesson / trigger_jellemind_run.

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
