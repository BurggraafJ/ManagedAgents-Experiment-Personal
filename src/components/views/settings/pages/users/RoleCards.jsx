// Rol als twee keuzekaarten (A Rust). Gedeeld door desktop + mobiele
// EditUserModal: de mock vervangt de <select>, gedrag blijft 1:1 (self-lockout
// via disabled + VAST-badge + amberregel).

const LockIcon = (
  <svg viewBox="0 0 24 24" width="10" height="10" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <rect x="5" y="11" width="14" height="10" rx="2" />
    <path d="M8 11V8a4 4 0 0 1 8 0v3" />
  </svg>
)

const ROLES = [
  {
    value: 'member',
    title: 'Member',
    description: 'Standaard medewerker. Ziet de gedeelde views, geen admin en geen tokens.',
  },
  {
    value: 'owner',
    title: 'Owner',
    description: 'Volledige toegang incl. admin (Security · Health · Gebruikers) en Tokens + Infrastructuur.',
  },
]

export default function RoleCards({ value, onChange, locked = false, disabled = false, idPrefix = 'edit-role' }) {
  return (
    <div className="users-roles" role="radiogroup" aria-label="Rol">
      {ROLES.map(r => {
        const on = value === r.value
        const isLockedChoice = locked
        return (
          <button
            key={r.value}
            type="button"
            id={`${idPrefix}-${r.value}`}
            role="radio"
            aria-checked={on}
            className={`users-role-card${on ? ' is-on' : ''}${isLockedChoice ? ' is-locked' : ''}`}
            onClick={() => { if (!disabled && !locked) onChange?.(r.value) }}
            disabled={disabled || locked}
          >
            <span className="users-role-card__radio" aria-hidden>
              {on && <span className="users-role-card__radio-in" />}
            </span>
            <span className="users-role-card__txt">
              <span className="users-role-card__title">
                {r.title}
                {locked && on && (
                  <span className="users-role-card__vast">{LockIcon} VAST</span>
                )}
              </span>
              <span className="users-role-card__desc">{r.description}</span>
            </span>
          </button>
        )
      })}
      {locked && (
        <p className="users-role-card__selfnote">
          {LockIcon}
          <span>Je kunt je eigen rol niet wijzigen — dat zou je uitsluiten.</span>
        </p>
      )}
    </div>
  )
}
