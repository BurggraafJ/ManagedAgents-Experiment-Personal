import { useState } from 'react'
import { SettingsPage } from '../SettingsLayout'
import Modal from '../../../ui/Modal'
import { useUsers } from '../../../../hooks/useUsers'
import { supabase, SUPABASE_URL } from '../../../../lib/supabase'

// Multi-user · Gebruikers-pagina onder /admin/gebruikers.
// Bron: RPC list_users_for_admin() (SECURITY DEFINER, owner-only).
// Invite-flow via Edge Function `invite-user` (deploy 2026-05-22) — die
// stuurt de Supabase-invitemail en schrijft een user_roles rij (member).

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

async function callInviteFunction({ email, displayName }) {
  const { data: { session } } = await supabase.auth.getSession()
  if (!session) throw new Error('Geen actieve sessie — log opnieuw in.')

  const res = await fetch(`${SUPABASE_URL}/functions/v1/invite-user`, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${session.access_token}`,
      'Content-Type': 'application/json',
      'apikey': session.access_token,
    },
    body: JSON.stringify({ email, display_name: displayName }),
  })
  const data = await res.json().catch(() => ({}))
  if (!res.ok) {
    const msg = data?.error || data?.warning || `HTTP ${res.status}`
    throw new Error(msg)
  }
  return data
}

function InviteModal({ open, onClose, onInvited }) {
  const [email, setEmail] = useState('')
  const [displayName, setDisplayName] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState(null)
  const [notice, setNotice] = useState(null)

  function reset() {
    setEmail('')
    setDisplayName('')
    setError(null)
    setNotice(null)
    setBusy(false)
  }

  function handleClose() {
    if (busy) return
    reset()
    onClose?.()
  }

  async function handleSubmit(e) {
    e.preventDefault()
    setError(null)
    setNotice(null)
    setBusy(true)
    try {
      const result = await callInviteFunction({ email: email.trim(), displayName: displayName.trim() })
      setNotice(result.message || 'Member uitgenodigd.')
      onInvited?.()
      // Reset alleen de inputs, laat notice staan zodat de user het ziet.
      setEmail('')
      setDisplayName('')
    } catch (err) {
      setError(err.message || String(err))
    } finally {
      setBusy(false)
    }
  }

  return (
    <Modal open={open} onClose={handleClose} title="Member uitnodigen" size="md">
      <form onSubmit={handleSubmit} style={{ display: 'grid', gap: 'var(--s-3)' }}>
        <div data-type="panel-warning" style={{
          background: 'var(--warning-soft, rgba(255,167,38,0.1))',
          border: '1px solid var(--warning, #ffa726)',
          color: 'var(--text)',
          padding: 'var(--s-3)',
          borderRadius: 6,
          fontSize: 12.5,
          lineHeight: 1.5,
        }}>
          <strong>Let op — eigen data-sync ontbreekt nog.</strong> De member kan
          inloggen en ziet de gedeelde views (Administratie, Contacten, LinkedIn,
          Zoeken) + Postvak / Agenda / Taken / Kilometers / Road Notes — maar
          die laatste blijven leeg tot z'n eigen mail- en agenda-sync is opgezet.
          Per-user OAuth (Composio) is nog niet geïmplementeerd. Stem dit dus
          eerst met de member af voor je hem/haar uitnodigt.
        </div>

        <label style={{ display: 'grid', gap: 4 }}>
          <span style={{ fontSize: 12, fontWeight: 600, color: 'var(--text-muted)' }}>E-MAILADRES</span>
          <input
            type="email"
            required
            value={email}
            onChange={e => setEmail(e.target.value)}
            placeholder="collega@legal-mind.nl"
            disabled={busy}
            autoComplete="off"
            autoFocus
            style={inputStyle}
          />
        </label>

        <label style={{ display: 'grid', gap: 4 }}>
          <span style={{ fontSize: 12, fontWeight: 600, color: 'var(--text-muted)' }}>NAAM (optioneel)</span>
          <input
            type="text"
            value={displayName}
            onChange={e => setDisplayName(e.target.value)}
            placeholder="Naam Collega"
            disabled={busy}
            autoComplete="off"
            style={inputStyle}
          />
        </label>

        {notice && (
          <div style={{
            padding: 'var(--s-3)', borderRadius: 6,
            background: 'var(--success-dim, rgba(46,204,113,0.12))',
            color: 'var(--success, #2ecc71)',
            fontSize: 12.5,
          }}>{notice}</div>
        )}
        {error && (
          <div style={{
            padding: 'var(--s-3)', borderRadius: 6,
            background: 'var(--error-dim, rgba(231,76,60,0.12))',
            color: 'var(--error, #e74c3c)',
            fontSize: 12.5,
          }}>{error}</div>
        )}

        <Modal.Footer>
          <button type="button" className="btn" onClick={handleClose} disabled={busy}>
            Sluiten
          </button>
          <button type="submit" className="btn btn--accent" disabled={busy || !email.trim()}>
            {busy ? 'Uitnodigen…' : 'Verstuur invite'}
          </button>
        </Modal.Footer>
      </form>
    </Modal>
  )
}

const inputStyle = {
  width: '100%',
  padding: '9px 12px',
  borderRadius: 6,
  border: '1px solid var(--border)',
  background: 'var(--bg)',
  color: 'var(--text)',
  fontFamily: 'inherit',
  fontSize: 14,
}

export default function UsersPage() {
  const { users, loading, error, refresh } = useUsers()
  const [showInvite, setShowInvite] = useState(false)

  return (
    <SettingsPage
      title="Gebruikers"
      intro="Wie heeft toegang tot het dashboard, en met welke rol. Owners zien alle pagina's incl. admin. Members zien alleen de operationele views met hun eigen data."
      right={
        <div style={{ display: 'flex', gap: 'var(--s-2)' }}>
          <button type="button" className="set-btn" onClick={refresh} disabled={loading} title="Lijst opnieuw ophalen">
            {loading ? 'Laden…' : 'Vernieuwen'}
          </button>
          <button type="button" className="set-btn set-btn--primary" onClick={() => setShowInvite(true)}>
            + Member uitnodigen
          </button>
        </div>
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
          <div className="set-stub__hint">Klik <strong>+ Member uitnodigen</strong> om een collega toe te voegen.</div>
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
          <div className="set-panel__title">Wat de member kan en niet kan</div>
          <div className="set-panel__hint">Belangrijk om af te stemmen vóór de uitnodiging.</div>
        </div>
        <ul style={{ margin: '0 0 0 1.2em', padding: 0, lineHeight: 1.7, fontSize: 13 }}>
          <li><strong>Wel zichtbaar:</strong> Dashboard, Zoeken, Administratie (HubSpot — gedeeld), Contacten (gedeeld), LinkedIn (gedeeld), Postvak / Agenda / Taken / Kilometers / Road Notes (eigen data — leeg tot eigen sync draait).</li>
          <li><strong>Niet zichtbaar:</strong> Admin-shell (Security, Health, Intelligence, JelleMind, Legal AI, Chat), Tokens + Infrastructuur binnen Settings.</li>
          <li><strong>RLS-isolatie:</strong> de member ziet 0 rijen van jouw mail / agenda / taken / etc. — RLS filtert op <code>user_id = auth.uid()</code>.</li>
          <li><strong>Nog te bouwen:</strong> per-user Composio OAuth voor mail- en calendar-sync, anders blijven de eigen mirrors leeg. Skills schrijven momenteel default jouw UUID.</li>
        </ul>
      </div>

      <InviteModal
        open={showInvite}
        onClose={() => setShowInvite(false)}
        onInvited={refresh}
      />
    </SettingsPage>
  )
}
