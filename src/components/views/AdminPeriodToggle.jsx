import { useNavigate, useLocation } from 'react-router-dom'

// Toggle Huidig ↔ Toekomst voor de Administratie-pagina. Zit bovenin beide
// views zodat Jelle altijd kan switchen zonder via de sidebar te hoeven.
// Routes:
//   /administratie           → Huidig (bestaande Daily Admin)
//   /administratie/toekomst  → Toekomst (nieuwe Future-view)
export default function AdminPeriodToggle() {
  const nav = useNavigate()
  const loc = useLocation()
  const isFuture = loc.pathname.startsWith('/administratie/toekomst')

  return (
    <div
      role="tablist"
      aria-label="Periode"
      style={{
        display: 'inline-flex',
        gap: 0,
        padding: 3,
        background: 'var(--surface-2, #f3f3f5)',
        border: '1px solid var(--border, rgba(0,0,0,0.08))',
        borderRadius: 8,
        fontSize: 12,
      }}
    >
      <Tab
        active={!isFuture}
        onClick={() => nav('/administratie')}
        label="Admin"
        hint="Inbox + voorstellen die actie vragen — alle daily-admin én daily-admin-future voorstellen"
      />
      <Tab
        active={isFuture}
        onClick={() => nav('/administratie/toekomst')}
        label="Toekomst"
        hint="Tabel-overzicht van aankomende externe afspraken (28d vooruit)"
      />
    </div>
  )
}

function Tab({ active, onClick, label, hint }) {
  return (
    <button
      type="button"
      role="tab"
      aria-selected={active}
      onClick={onClick}
      title={hint}
      style={{
        appearance: 'none',
        border: 'none',
        background: active ? 'var(--surface, #fff)' : 'transparent',
        color: active ? 'var(--text)' : 'var(--text-muted, #6b6b73)',
        fontWeight: active ? 600 : 500,
        padding: '6px 14px',
        borderRadius: 6,
        cursor: 'pointer',
        boxShadow: active ? '0 1px 2px rgba(0,0,0,0.06)' : 'none',
        transition: 'background 120ms, color 120ms',
      }}
    >
      {label}
    </button>
  )
}
