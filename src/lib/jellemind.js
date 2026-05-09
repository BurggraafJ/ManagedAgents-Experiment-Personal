// Pure helpers + constants + style tokens voor JelleMindView.

export const SCOPES = [
  { key: 'jelle',     label: 'Jelle',      accent: '#8b5cf6', tagline: 'Persoonlijke voorkeur — toon, stijl, communicatie.' },
  { key: 'legalmind', label: 'Legal Mind', accent: '#06b6d4', tagline: 'Organisatie-waarheid — geldt voor iedereen.' },
  { key: 'skill',     label: 'Skills',     accent: '#10b981', tagline: 'Procesinstructie aan agents — wat moet een skill doen.' },
]

export const SCOPE_BY_KEY = Object.fromEntries(SCOPES.map(s => [s.key, s]))

export const LESSON_TYPES = [
  { key: 'tone',         label: 'Toon',          color: '#f59e0b' },
  { key: 'terminology',  label: 'Terminologie',  color: '#06b6d4' },
  { key: 'format',       label: 'Format',        color: '#10b981' },
  { key: 'preference',   label: 'Voorkeur',      color: '#8b5cf6' },
  { key: 'workflow',     label: 'Workflow',      color: '#ec4899' },
]

export function lessonTypeMeta(key) {
  return LESSON_TYPES.find(t => t.key === key) || { key, label: key, color: '#6b7280' }
}

export function fmtRelative(iso) {
  if (!iso) return '—'
  const d = new Date(iso)
  const diff = (Date.now() - d.getTime()) / 1000
  if (diff < 60) return 'net'
  if (diff < 3600) return `${Math.floor(diff / 60)} min`
  if (diff < 86400) return `${Math.floor(diff / 3600)} u`
  if (diff < 604800) return `${Math.floor(diff / 86400)} d`
  return d.toLocaleDateString('nl-NL', { day: '2-digit', month: 'short' })
}

export function fmtAppliesTo(arr) {
  if (!arr || arr.length === 0) return 'alle agents'
  if (arr.includes('*')) return 'alle agents'
  return arr.join(', ')
}

export const SIGNAL_LABEL_SHORT = {
  proposal_amended:  'voorstel bewerkt',
  autodraft_amended: 'mail bewerkt',
  task_edited:       'taak bewerkt',
  direct_feedback:   'directe feedback',
  note_rewritten:    'notitie herschreven',
}

export const SIGNAL_TYPE_LABEL = {
  proposal_amended:  { label: 'Proposal bewerkt', color: '#06b6d4' },
  autodraft_amended: { label: 'Mail bewerkt',     color: '#f59e0b' },
  task_edited:       { label: 'Taak bewerkt',     color: '#10b981' },
  direct_feedback:   { label: 'Direct feedback',  color: '#ec4899' },
  note_rewritten:    { label: 'Notitie herschreven', color: '#8b5cf6' },
  other:             { label: 'Overig',           color: '#6b7280' },
}

// Style tokens
export const btnPrimary = (accent) => ({
  padding: '5px 10px', borderRadius: 6, border: '1px solid var(--border)',
  background: accent, color: '#fff', fontSize: 11, fontWeight: 600, cursor: 'pointer',
})
export const btnSecondary = {
  padding: '5px 10px', borderRadius: 6, border: '1px solid var(--border)',
  background: 'var(--bg-1)', color: 'var(--text)', fontSize: 11, fontWeight: 500, cursor: 'pointer',
}
export const btnDanger = {
  padding: '5px 10px', borderRadius: 6, border: '1px solid var(--border)',
  background: 'var(--bg-1)', color: '#ef4444', fontSize: 11, fontWeight: 600, cursor: 'pointer',
}
export const btnGhost = {
  padding: '3px 6px', borderRadius: 4, border: '1px solid transparent',
  background: 'transparent', color: 'var(--text-muted)',
  fontSize: 11, cursor: 'pointer',
}
export const textareaStyle = {
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
export const preStyle = {
  margin: 0, padding: 'var(--s-2) var(--s-3)',
  borderRadius: 4, background: 'var(--bg-2)',
  border: '1px solid var(--border)',
  fontSize: 11, lineHeight: 1.4,
  whiteSpace: 'pre-wrap', wordBreak: 'break-word',
  fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
}
