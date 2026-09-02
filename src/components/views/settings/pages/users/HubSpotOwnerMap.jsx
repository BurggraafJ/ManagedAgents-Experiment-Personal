import { useState } from 'react'
import { showToast } from '../../../../Toast'
import { useHubspotOwnerMap } from '../../../../../hooks/useHubspotOwnerMap'

// HubSpotOwnerMap — kleine mapping-tabel onder de gebruikerslijst in
// Organisatie › Gebruikers: welke Maestro-gebruiker is welke HubSpot
// deal-owner.
//
// HubSpot zelf blijft één org-brede mirror; dit koppelt alleen de identiteit,
// zodat de app bij een deal kan zeggen "van Jelle" i.p.v. een owner-id. Geen
// per-user HubSpot-koppeling en geen tweede sync.
//
// Eén owner hoort bij één gebruiker (unique-constraint op hubspot_owner_map),
// dus een owner die al gekoppeld is, verschijnt niet meer in andermans
// dropdown. Schrijven is owner-only via RLS.
//
// v1.134: nieuw.
export default function HubSpotOwnerMap({ users }) {
  const { owners, byUser, takenBy, loading, error, setOwnerFor, ownerLabel } = useHubspotOwnerMap()
  const [savingFor, setSavingFor] = useState(null)

  async function onPick(userId, ownerId) {
    setSavingFor(userId)
    const res = await setOwnerFor(userId, ownerId)
    setSavingFor(null)
    if (!res.ok) { showToast({ kind: 'error', message: res.error }); return }
    showToast({
      kind: 'success',
      message: ownerId ? `Gekoppeld aan ${ownerLabel(ownerId)}` : 'Koppeling verwijderd',
    })
  }

  const linked = users.filter(u => byUser[u.user_id]).length

  return (
    <section className="admin-ownermap">
      <header className="admin-ownermap__head">
        <div>
          <h2 className="admin-ownermap__title">HubSpot deal-eigenaar</h2>
          <p className="admin-ownermap__sub">
            Welke HubSpot-eigenaar hoort bij welke gebruiker. De app gebruikt dit om deals aan een
            gebruiker toe te schrijven — HubSpot blijft één gedeelde koppeling voor de hele organisatie.
          </p>
        </div>
        <span className="admin-ownermap__meta">
          {loading ? 'laden…' : `${linked} van ${users.length} gekoppeld`}
        </span>
      </header>

      {error && <div className="admin-banner admin-banner--err">Kon de owner-map niet laden: {error}</div>}

      <div className="admin-table-wrap">
        <table className="admin-table">
          <thead>
            <tr>
              <th>Gebruiker</th>
              <th>HubSpot-eigenaar</th>
            </tr>
          </thead>
          <tbody>
            {users.map(u => {
              const current = byUser[u.user_id] || ''
              const name = u.display_name || u.email?.split('@')[0] || 'Onbekend'
              return (
                <tr key={u.user_id}>
                  <td>
                    <div className="admin-ownermap__user">{name}</div>
                    <div className="admin-ownermap__mail">{u.email}</div>
                  </td>
                  <td>
                    <select
                      className="admin-ownermap__select"
                      value={current}
                      disabled={loading || savingFor === u.user_id}
                      onChange={e => onPick(u.user_id, e.target.value)}
                      aria-label={`HubSpot-eigenaar voor ${name}`}
                    >
                      <option value="">— niet gekoppeld —</option>
                      {owners
                        // owners die al aan iemand ánders hangen: verbergen
                        .filter(o => !takenBy[o.hubspot_owner_id] || takenBy[o.hubspot_owner_id] === u.user_id)
                        .map(o => (
                          <option key={o.hubspot_owner_id} value={o.hubspot_owner_id}>
                            {ownerLabel(o.hubspot_owner_id)}{o.email ? ` · ${o.email}` : ''}{o.active === false ? ' (inactief)' : ''}
                          </option>
                        ))}
                    </select>
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>

      <p className="admin-footnote">
        De eigenaren komen uit de HubSpot-mirror (hubspot_users) en verversen mee met de sync. Eén eigenaar
        kan aan één gebruiker hangen; al gekoppelde eigenaren staan niet meer in de lijst van een ander.
      </p>
    </section>
  )
}
