import { SettingsPage } from '../SettingsLayout'
import { useUsers } from '../../../../hooks/useUsers'

// Multi-user · admin-only Gebruikers-tab onder Settings.
// Bron: RPC list_users_for_admin() (SECURITY DEFINER, owner-only).
// Lees-modus voor nu — toevoegen/verwijderen gebeurt via SQL totdat
// Fase 3 een invite-UI toevoegt.

function formatDate(iso) {
  if (!iso) return '—'
  try {
    return new Date(iso).toLocaleDateString('nl-NL', {
      year: 'numeric', month: 'short', day: 'numeric',
    })
  } catch { return '—' }
}

function formatDateTime(iso) {
  if (!iso) return 'nooit'
  try {
    return new Date(iso).toLocaleString('nl-NL', {
      year: 'numeric', month: 'short', day: 'numeric',
      hour: '2-digit', minute: '2-digit',
    })
  } catch { return '—' }
}

function RoleChip({ role }) {
  const isOwner = role === 'owner'
  return (
    <span
      className="set-chip"
      data-tone={isOwner ? 'accent' : 'neutral'}
      title={isOwner ? 'Owner — volledige toegang incl. admin-pagina\'s' : 'Member — standaard medewerker, geen admin-pagina\'s'}
    >
      {role}
    </span>
  )
}

export default function UsersPage() {
  const { users, loading, error, refresh } = useUsers()

  return (
    <SettingsPage
      title="Gebruikers"
      intro="Wie heeft toegang tot het dashboard, en met welke rol. Owners zien alle pagina's incl. admin. Members zien alleen de operationele views met hun eigen data."
      right={
        <button
          type="button"
          className="set-btn"
          onClick={refresh}
          disabled={loading}
          title="Lijst opnieuw ophalen"
        >
          {loading ? 'Laden…' : 'Vernieuwen'}
        </button>
      }
    >
      {error && (
        <div className="set-stub" style={{ borderColor: 'var(--error)' }}>
          <div className="set-stub__title" style={{ color: 'var(--error)' }}>Fout bij ophalen</div>
          <div className="set-stub__hint">{error}</div>
        </div>
      )}

      {!error && (users || []).length === 0 && !loading && (
        <div className="set-stub">
          <div className="set-stub__title">Geen gebruikers gevonden</div>
          <div className="set-stub__hint">Dit zou niet moeten kunnen — jij bent in elk geval ingelogd. Klik vernieuwen.</div>
        </div>
      )}

      {!error && (users || []).length > 0 && (
        <div className="set-panel">
          <table className="set-table">
            <thead>
              <tr>
                <th>E-mail</th>
                <th>Rol</th>
                <th>Naam</th>
                <th>Laatste login</th>
                <th>Aangemaakt</th>
              </tr>
            </thead>
            <tbody>
              {users.map(u => (
                <tr key={u.user_id}>
                  <td><code>{u.email}</code></td>
                  <td><RoleChip role={u.app_role} /></td>
                  <td>{u.display_name || <span style={{ color: 'var(--text-muted)' }}>—</span>}</td>
                  <td>{formatDateTime(u.last_sign_in_at)}</td>
                  <td>{formatDate(u.created_at)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <div className="set-panel" style={{ marginTop: 'var(--s-5)' }}>
        <div className="set-panel__head">
          <div className="set-panel__title">Nieuwe member toevoegen</div>
          <div className="set-panel__hint">UI-invite komt in Fase 3. Tot dan handmatig via Supabase Studio:</div>
        </div>
        <ol style={{ margin: '0 0 0 1.2em', padding: 0, lineHeight: 1.7, fontSize: 13 }}>
          <li>Supabase Studio → Authentication → Add user → email + tijdelijk wachtwoord</li>
          <li>SQL-tab:
            <pre style={{
              background: 'var(--bg-elev)', padding: 'var(--s-3)', borderRadius: 6,
              fontSize: 12, overflow: 'auto', marginTop: 6,
            }}><code>{`INSERT INTO public.user_roles (user_id, app_role, display_name)
VALUES ('NIEUWE-UUID-HIER', 'member', 'Naam Collega');`}</code></pre>
          </li>
          <li>Member krijgt uitnodigingsmail van Supabase, kan inloggen, ziet alleen gedeelde + eigen lege mirrors</li>
        </ol>
      </div>
    </SettingsPage>
  )
}
