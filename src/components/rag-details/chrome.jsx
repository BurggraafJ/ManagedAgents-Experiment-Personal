// Gedeelde chrome-componenten voor RagDetailsModal: kleine chips, stat-blokjes,
// section-headers en tab-button. Geen state, puur visueel.
//
// 2026-05-12: kleurpalette doorgetrokken naar Maestro-tokens via var(--*).
// Het modal-context heeft className='theme-maestro mcm-rag-modal' zodat de
// tokens binnen scope correct resolven (orange ipv blauw, paper ipv grey).
// Hard-coded hex blijven alleen waar de specifieke chip-kleur (groen/blauw/
// roze) bewust onderscheidend is — bv. SOURCE_COLORS — anders zou een mail-
// chip niet meer van een meeting-chip te onderscheiden zijn.

export const SOURCE_COLORS = {
  meeting:    { bg: '#fef3c7', fg: '#92400e' },
  mail:       { bg: '#dbeafe', fg: '#1e40af' },
  engagement: { bg: '#e9d5ff', fg: '#6b21a8' },
  deal:       { bg: '#bbf7d0', fg: '#166534' },
  company:    { bg: '#fce7f3', fg: '#9f1239' },
  contact:    { bg: '#fce7f3', fg: '#9f1239' },
  jira:       { bg: '#dbeafe', fg: '#1e40af' },
  event:      { bg: '#fed7aa', fg: '#9a3412' },
  lesson:     { bg: '#cffafe', fg: '#155e75' },
}

export const SOURCE_ICONS = {
  meeting: '🦟', mail: '✉', engagement: '📝', deal: '💼',
  company: '🏢', contact: '👤', jira: '🎫', event: '📅', lesson: '📚',
}

export const FACT_TYPE_COLORS = {
  decision:    { bg: '#fef3c7', fg: '#92400e' },
  commitment:  { bg: '#dcfce7', fg: '#166534' },
  date:        { bg: '#dbeafe', fg: '#1e40af' },
  price:       { bg: '#fce7f3', fg: '#9f1239' },
  agreement:   { bg: '#dcfce7', fg: '#166534' },
  objection:   { bg: '#fee2e2', fg: '#991b1b' },
  rejection:   { bg: '#fee2e2', fg: '#991b1b' },
  risk:        { bg: '#fed7aa', fg: '#9a3412' },
  name:        { bg: 'var(--paper-3, #f3f4f6)', fg: 'var(--neutral-700, #374151)' },
  question:    { bg: '#e0e7ff', fg: '#3730a3' },
  question_followup: { bg: '#e0e7ff', fg: '#3730a3' },
}

export function fmtDate(d) {
  if (!d) return '?'
  try {
    return new Date(d).toLocaleString('nl-NL', { dateStyle: 'short', timeStyle: 'short' })
  } catch { return d }
}

export function SourceChip({ source, n }) {
  const c = SOURCE_COLORS[source] || { bg: 'var(--paper-3, #f3f4f6)', fg: 'var(--neutral-700, #404040)' }
  const icon = SOURCE_ICONS[source] || '•'
  return (
    <span style={{
      display: 'inline-flex', alignItems: 'center', gap: 4,
      padding: '3px 8px', borderRadius: 6, fontSize: 11, fontWeight: 600,
      background: c.bg, color: c.fg,
    }}>
      <span>{icon}</span> {source} <span style={{ opacity: 0.6 }}>· {n}</span>
    </span>
  )
}

export function FactChip({ type }) {
  const c = FACT_TYPE_COLORS[type] || { bg: 'var(--paper-3, #f3f4f6)', fg: 'var(--neutral-700, #404040)' }
  return (
    <span style={{
      display: 'inline-block', padding: '1px 6px', borderRadius: 4,
      fontSize: 10, fontWeight: 600, background: c.bg, color: c.fg,
    }}>{type}</span>
  )
}

export function Section({ title, children }) {
  return (
    <div style={{ marginBottom: 16 }}>
      <h4 style={{
        margin: '0 0 8px 0',
        fontSize: 11,
        fontWeight: 600,
        color: 'var(--neutral-500, #737373)',
        textTransform: 'uppercase',
        letterSpacing: '0.06em',
        fontFamily: 'var(--font-sans, "Instrument Sans", sans-serif)',
      }}>
        {title}
      </h4>
      {children}
    </div>
  )
}

export function Stat({ label, value, sub }) {
  return (
    <div>
      <div style={{
        fontSize: 18,
        fontWeight: 600,
        color: 'var(--ink, #121212)',
        fontFamily: 'var(--font-sans, "Instrument Sans", sans-serif)',
        letterSpacing: '-0.012em',
      }}>{value}</div>
      <div style={{
        fontSize: 10,
        color: 'var(--neutral-500, #737373)',
        textTransform: 'uppercase',
        letterSpacing: '0.06em',
        fontFamily: 'var(--font-mono, "Geist", monospace)',
      }}>
        {label} {sub && <span style={{ opacity: 0.7 }}>{sub}</span>}
      </div>
    </div>
  )
}

export function TabButton({ active, onClick, label, sub, tone }) {
  // Active-state: oranje onderlijn + ink-zwarte tekst, conform Maestro design.
  // Tone bepaalt de sub-tekst-kleur (groen=success, mute=neutraal).
  const subColors = {
    good: 'var(--success, #16a34a)',
    mute: 'var(--neutral-500, #737373)',
  }
  const subFg = subColors[tone] || subColors.mute
  return (
    <button
      type="button"
      onClick={onClick}
      style={{
        flex: 1,
        padding: '10px 12px',
        background: 'transparent',
        border: 0,
        borderBottom: active
          ? '2px solid var(--orange, #dc6f3f)'
          : '2px solid transparent',
        cursor: 'pointer',
        fontFamily: 'var(--font-sans, "Instrument Sans", sans-serif)',
        textAlign: 'left',
        color: active ? 'var(--ink, #121212)' : 'var(--neutral-500, #737373)',
        fontWeight: active ? 600 : 500,
        letterSpacing: '-0.005em',
        transition: 'color .12s, border-color .12s',
      }}
    >
      <div style={{ fontSize: 13 }}>{label}</div>
      <div style={{
        fontSize: 10,
        color: active ? subFg : 'var(--neutral-400, #a6a6a6)',
        marginTop: 2,
        fontFamily: 'var(--font-mono, "Geist", monospace)',
      }}>{sub}</div>
    </button>
  )
}
