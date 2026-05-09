import { useState, useMemo } from 'react'
import styles from './zoeken.module.css'
import { JELLEMIND_SCOPE_META, fmtPct } from '../../../lib/rag'

// JelleMindGroup — collapsible source-groep voor JelleMind-regels uit RAG-search.
// Sinds JelleMind Activation (2026-05-04): rag-search retourneert ook
// `knowledge_lessons[]` uit context-build.
export default function JelleMindGroup({ lessons, defaultOpen = true }) {
  const [open, setOpen] = useState(defaultOpen)
  const byScope = useMemo(() => {
    const out = new Map()
    for (const l of lessons) {
      const key = l.mind_scope || 'jelle'
      if (!out.has(key)) out.set(key, [])
      out.get(key).push(l)
    }
    return out
  }, [lessons])
  const avgSim = lessons.length === 0
    ? 0
    : lessons.reduce((s, l) => s + (l.similarity ?? 0), 0) / lessons.length
  if (lessons.length === 0) return null
  return (
    <div className="card" style={{ padding: 0, overflow: 'hidden', borderRadius: 6, borderLeft: '3px solid #8b5cf6' }}>
      <button
        type="button"
        onClick={() => setOpen(o => !o)}
        className={styles.toggleHeader}
        style={{ borderBottom: open ? '1px solid var(--border)' : 'none' }}
      >
        <span style={{ fontSize: 14, color: 'var(--text-muted)', minWidth: 14 }}>
          {open ? '▾' : '▸'}
        </span>
        <span style={{ fontSize: 16, color: '#8b5cf6' }}>✦</span>
        <span style={{ fontSize: 14, fontWeight: 600, color: 'var(--text)' }}>JelleMind-regels</span>
        <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>
          · {lessons.length} regel{lessons.length === 1 ? '' : 's'} ({byScope.size} scope{byScope.size === 1 ? '' : 's'})
        </span>
        <span style={{ flex: 1 }} />
        <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>gem {fmtPct(avgSim)}</span>
      </button>
      {open && (
        <div className="stack" style={{ gap: 'var(--s-3)', padding: 'var(--s-4)' }}>
          {[...byScope.entries()].map(([scope, items]) => {
            const meta = JELLEMIND_SCOPE_META[scope] || JELLEMIND_SCOPE_META.jelle
            return (
              <div key={scope}>
                <div
                  className={styles.scopeHeader}
                  style={{ borderBottom: `1px solid ${meta.accent}33` }}
                >
                  <span className={styles.scopeLabel} style={{ color: meta.accent }}>{meta.label}</span>
                  <span className="muted" style={{ fontSize: 11 }}>{items.length}</span>
                </div>
                <div className="stack" style={{ gap: 'var(--s-2)' }}>
                  {items.map(l => <LessonRow key={l.id} lesson={l} />)}
                </div>
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}

function LessonRow({ lesson }) {
  const [expanded, setExpanded] = useState(false)
  return (
    <div className={styles.lessonRow} onClick={() => setExpanded(e => !e)}>
      <div className={styles.lessonBody}>
        <div className={styles.lessonText}>{lesson.lesson_text}</div>
        <span className="muted" style={{ fontSize: 11, fontVariantNumeric: 'tabular-nums', flexShrink: 0 }}>
          {fmtPct(lesson.similarity)}
        </span>
      </div>
      {expanded && (
        <div className="stack" style={{ gap: 4, marginTop: 8 }}>
          {lesson.evidence_summary && (
            <div className="muted" style={{ fontSize: 11, lineHeight: 1.4 }}>
              <strong>Voorbeelden:</strong> {lesson.evidence_summary}
            </div>
          )}
          {lesson.applies_to && lesson.applies_to.length > 0 && (
            <div className="muted" style={{ fontSize: 11 }}>
              <strong>Geldt voor:</strong> {lesson.applies_to.includes('*') ? 'alle agents' : lesson.applies_to.join(', ')}
            </div>
          )}
          <div className="muted" style={{ fontSize: 10, fontFamily: 'var(--mono)' }}>
            id: {lesson.id}
          </div>
        </div>
      )}
    </div>
  )
}
