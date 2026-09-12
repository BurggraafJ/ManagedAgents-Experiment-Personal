import { useEffect, useState, useMemo } from 'react'
import { supabase } from '../../../../lib/supabase'
import { useUsers } from '../../../../hooks/useUsers'
import { sortUsers, userStats, inviteUser } from '../../../../lib/users'
import UserRow from './users/UserRow'
import EditUserModal from './users/EditUserModal'
import InviteModal from './users/InviteModal'
import CreateUserModal from './users/CreateUserModal'
import { useHubspotOwnerMap } from '../../../../hooks/useHubspotOwnerMap'
import Modal from '../../../ui/Modal'
import { showToast } from '../../../Toast'
import './users.css'

// Gebruikerspagina (desktop, admin-shell). Owner kan naam en rol per user
// wijzigen via directe UPDATE op user_roles (RLS-policy user_roles_owner_full
// staat dit toe). Owner kan zichzelf niet demoten (self-lockout protection,
// in EditUserModal).
//
// v1.128: helpers → lib/users.js, modals → users/ (gedeeld met de mobiele
// Gebruikers-lijst).
// v1.129 (Chrome A "Register"): kaartgrid → één tabel-kaart; de vier
// stat-tegels → één metaregel in de paginakop; het "Wat de member kan"-blok
// → één voetregel + "Wat ziet een member? →" (modal met dezelfde inhoud);
// acties rechts in de kop (ververs-icoon + inkt "Member uitnodigen").
// Data (useUsers), modals en self-lockout ongewijzigd.
// v1.131 (2FA): pill met het aantal vertrouwde apparaten per gebruiker; de
// knop "Alles intrekken" zit in EditUserModal, zodat mobiel hem ook heeft.
// v1.136: de losse "HubSpot deal-eigenaar"-tabel onder de lijst is weg. Die
// herhaalde dezelfde gebruikers een tweede keer; de koppeling is nu één kolom
// op de rij zelf (label) plus het veld in EditUserModal (control). Tabel
// hubspot_owner_map en useHubspotOwnerMap blijven ongewijzigd.
// v1.158: aanmaken ≠ uitnodigen. Twee knoppen in de kop ("Gebruiker aanmaken"
// mailt niets, "Member uitnodigen" mailt wél), twee nieuwe kolommen
// (Uitnodiging · Ingelogd) en per rij een Uitnodigen-knop voor wie nog nooit
// binnen is geweest — de knop "Opnieuw sturen" van v1.129 zit daar nu in.
// Rij-render → users/UserRow.jsx.
// v1.163: alle knoppen rustig. Geen zwarte primary meer in de kop of op de
// rij; het verschil tussen aanmaken en uitnodigen zit in de tekst, niet in
// het gewicht.

const Icon = (paths, size = 14) => (
  <svg viewBox="0 0 24 24" width={size} height={size} fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">{paths}</svg>
)
const MailIcon    = Icon(<><path d="M4 6l8 6 8-6" /><rect x="3" y="5" width="18" height="14" rx="2" /></>)
const UserAddIcon = Icon(<><path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2" /><circle cx="9" cy="7" r="4" /><path d="M19 8v6" /><path d="M22 11h-6" /></>)
const RefreshIcon = Icon(<><path d="M21 12a9 9 0 1 1-3-6.7" /><path d="M21 3v6h-6" /></>, 15)
const ShieldIcon  = Icon(<path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />)

// Zelfde inhoud als het oude "Wat de member kan en niet kan"-blok, nu op
// aanvraag achter de voetregel-link in plaats van als essay onder de lijst.
function MemberInfoModal({ open, onClose }) {
  return (
    <Modal open={open} onClose={onClose} title="Wat ziet een member?" size="md" className="users-modal">
      <ul className="users-info__list">
        <li><strong>Wel zichtbaar:</strong> Dashboard · Zoeken · Administratie (HubSpot — gedeeld) · Contacten · Postvak / Agenda (eigen, na Connectors-koppeling) · Taken (in-app Mijn taken).</li>
        <li><strong>Niet zichtbaar:</strong> Organisatie (Gebruikers · Health · Security · Skills · Intelligence · Legal AI) en Tokens + Infrastructuur in Settings.</li>
        <li><strong>RLS-isolatie:</strong> de member ziet 0 rijen van jouw mail / agenda / taken / etc. — alles filtert op <code>user_id = auth.uid()</code>.</li>
        <li><strong>Postvak / Agenda:</strong> na inloggen Instellingen → Connectors → Koppelen (Microsoft). Skills die namens de member schrijven moeten nog user_id-bewust zijn.</li>
      </ul>
      <Modal.Footer>
        <button type="button" className="btn" onClick={onClose}>Sluiten</button>
      </Modal.Footer>
    </Modal>
  )
}

export default function UsersPage() {
  const { users, loading, error, refresh } = useUsers()
  // Eén hook-instantie voor de hele pagina; rij-labels en de modal krijgen 'm
  // via props (pre-flight-regel 4).
  const ownerMap = useHubspotOwnerMap()
  const [currentUserId, setCurrentUserId] = useState(null)
  const [showInvite, setShowInvite] = useState(false)
  const [createFor, setCreateFor] = useState(null)
  const [showInfo, setShowInfo] = useState(false)
  const [editing, setEditing] = useState(null)
  const [inviting, setInviting] = useState(null)

  useEffect(() => {
    supabase.auth.getUser().then(({ data }) => setCurrentUserId(data?.user?.id || null))
  }, [])

  const sorted = useMemo(() => sortUsers(users), [users])
  const stats = useMemo(() => userStats(sorted), [sorted])
  // Schrijven op hubspot_owner_map is owner-only (RLS). De UI volgt dat, zodat
  // een member geen control ziet die tóch zou falen.
  const isOwner = useMemo(
    () => sorted.some(u => u.user_id === currentUserId && u.app_role === 'owner'),
    [sorted, currentUserId],
  )

  // De enige plek in deze pagina waar een mail de deur uit gaat: één klik van
  // de owner op Uitnodigen / Opnieuw sturen.
  async function handleInvite(user) {
    setInviting(user.user_id)
    try {
      await inviteUser(user)
      showToast({ kind: 'success', message: `Uitnodiging verstuurd naar ${user.email}` })
      refresh()
    } catch (err) {
      showToast({ kind: 'error', message: 'Uitnodigen mislukt', detail: err.message || String(err) })
    } finally {
      setInviting(null)
    }
  }

  return (
    <div className="users-app">
      <header className="admin-page-head">
        <div className="admin-page-head__main">
          <h1 className="admin-page-head__title">Gebruikers</h1>
          <p className="admin-page-head__subtitle">Wie mag erin en met welke rol.</p>
          {stats.total > 0 && (
            <p className="admin-page-head__meta">
              <b>{stats.total}</b> gebruiker{stats.total === 1 ? '' : 's'}
              {' · '}{stats.owners} owner{stats.owners === 1 ? '' : 's'}
              {' · '}{stats.members} member{stats.members === 1 ? '' : 's'}
              {stats.live > 0 && <>{' · '}<span className="is-ok">{stats.live} live</span></>}
              {stats.notInvited > 0 && <>{' · '}<span className="is-warn">{stats.notInvited} nog niet uitgenodigd</span></>}
              {stats.invitedNotLoggedIn > 0 && <>{' · '}<span className="is-warn">{stats.invitedNotLoggedIn} wacht op activatie</span></>}
            </p>
          )}
        </div>
        <div className="admin-page-head__actions">
          <button
            type="button"
            className={`admin-iconbtn ${loading ? 'is-busy' : ''}`}
            onClick={refresh}
            disabled={loading}
            aria-label="Vernieuwen"
            title="Vernieuwen"
          >
            {RefreshIcon}
          </button>
          {/* Allebei rustig: twee gelijkwaardige handelingen, en een zwarte
              knop naast de zachte A-Rust-kaart schreeuwt. Het verschil zit in
              de tekst, niet in het gewicht. */}
          <button
            type="button"
            className="admin-btn"
            onClick={() => setCreateFor('')}
            title="Zet het account klaar zonder mail te versturen"
          >
            {UserAddIcon} Gebruiker aanmaken
          </button>
          <button
            type="button"
            className="admin-btn"
            onClick={() => setShowInvite(true)}
            title="Stuur de uitnodigingsmail naar een bestaande gebruiker"
          >
            {MailIcon} Member uitnodigen
          </button>
        </div>
      </header>

      {error && (
        <div className="users-form__notice users-form__notice--error">
          <strong>Fout bij ophalen:</strong> {error}
        </div>
      )}

      {!error && sorted.length === 0 && !loading && (
        <div className="users-empty">
          <p className="users-empty__title">Geen gebruikers gevonden</p>
          <p className="users-empty__hint">Klik <strong>Gebruiker aanmaken</strong> om een collega klaar te zetten; de uitnodiging stuur je daarna.</p>
        </div>
      )}

      {!error && sorted.length > 0 && (
        <div className="users-card">
          <table className="users-table">
            <thead>
              <tr>
                <th>Gebruiker</th>
                <th>Rol</th>
                <th>Status</th>
                <th title="Is er ooit een uitnodigingsmail verstuurd? Aanmaken doet dat niet — dat is een aparte knop.">Uitnodiging</th>
                <th title="Eerste en laatste login. Een aangemaakt account dat nooit is uitgenodigd heeft hier niets.">Ingelogd</th>
                <th title="Welke HubSpot deal-eigenaar bij deze gebruiker hoort. Wijzigen via Bewerken.">HubSpot</th>
                <th className="is-right"><span className="sr-only">Acties</span></th>
              </tr>
            </thead>
            <tbody>
              {sorted.map(u => (
                <UserRow
                  key={u.user_id}
                  user={u}
                  isSelf={u.user_id === currentUserId}
                  onEdit={setEditing}
                  onInvite={handleInvite}
                  inviting={inviting}
                  ownerId={ownerMap.byUser[u.user_id] || ''}
                  ownerLabel={ownerMap.ownerLabel}
                  ownerLoading={ownerMap.loading}
                />
              ))}
            </tbody>
          </table>
        </div>
      )}

      <p className="admin-footnote">
        {ShieldIcon}
        <span>
          Aanmaken verstuurt niets; pas Uitnodigen stuurt een mail met een
          set-wachtwoord-link. Members zien Organisatie niet en geen
          Tokens/Infra.{' '}
          <button type="button" className="admin-linkbtn" onClick={() => setShowInfo(true)}>Wat ziet een member? →</button>
        </span>
      </p>

      <InviteModal
        open={showInvite}
        onClose={() => setShowInvite(false)}
        onInvited={refresh}
        onCreateFirst={(email) => { setShowInvite(false); setCreateFor(email) }}
      />
      <CreateUserModal
        open={createFor !== null}
        initialEmail={createFor || ''}
        onClose={() => setCreateFor(null)}
        onCreated={refresh}
      />
      <EditUserModal
        open={!!editing}
        user={editing}
        currentUserId={currentUserId}
        onClose={() => setEditing(null)}
        onSaved={refresh}
        ownerMap={ownerMap}
        canEditOwner={isOwner}
      />
      <MemberInfoModal open={showInfo} onClose={() => setShowInfo(false)} />
    </div>
  )
}
