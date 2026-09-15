import { useEffect, useState, useMemo } from 'react'
import { Link } from 'react-router-dom'
import { supabase } from '../../../../lib/supabase'
import { useUsers } from '../../../../hooks/useUsers'
import {
  sortUsers, userStats, inviteUser,
  USER_TABS, DEFAULT_USER_TAB, bucketFor, bucketCounts,
} from '../../../../lib/users'
import UserRow from './users/UserRow'
import EditUserModal from './users/EditUserModal'
import InviteModal from './users/InviteModal'
import CreateUserModal from './users/CreateUserModal'
import { useHubspotOwnerMap } from '../../../../hooks/useHubspotOwnerMap'
import { useInviteReadiness } from '../../../../hooks/useInviteReadiness'
import InviteReadiness from './users/InviteReadiness'
import MemberInfoModal from './users/MemberInfoModal'
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

export default function UsersPage() {
  const { users, loading, error, refresh } = useUsers()
  // Eén hook-instantie voor de hele pagina; rij-labels en de modal krijgen 'm
  // via props (pre-flight-regel 4).
  const ownerMap = useHubspotOwnerMap()
  // Multi-user M2 — één instantie voor de pagina; de modal en de rij-knoppen
  // krijgen 'm via props (pre-flight-regel 4).
  const readiness = useInviteReadiness()
  const [currentUserId, setCurrentUserId] = useState(null)
  const [showInvite, setShowInvite] = useState(false)
  const [createFor, setCreateFor] = useState(null)
  const [showInfo, setShowInfo] = useState(false)
  const [editing, setEditing] = useState(null)
  const [inviting, setInviting] = useState(null)
  // v1.222 — de lijst opent op Actief. Wie uit dienst is en wie nog op een
  // uitnodiging wacht staan er niet tussen, maar zijn één tik weg; ze worden
  // niet verborgen voor de owner, alleen uit het werkbeeld gehaald.
  const [tab, setTab] = useState(DEFAULT_USER_TAB)

  useEffect(() => {
    supabase.auth.getUser().then(({ data }) => setCurrentUserId(data?.user?.id || null))
  }, [])

  const sorted = useMemo(() => sortUsers(users), [users])
  const stats = useMemo(() => userStats(sorted), [sorted])
  const counts = useMemo(() => bucketCounts(sorted), [sorted])
  const zichtbaar = useMemo(() => sorted.filter(u => bucketFor(u) === tab), [sorted, tab])
  // Schrijven op hubspot_owner_map is owner-only (RLS). De UI volgt dat, zodat
  // een member geen control ziet die tóch zou falen.
  const isOwner = useMemo(
    () => sorted.some(u => u.user_id === currentUserId && u.app_role === 'owner'),
    [sorted, currentUserId],
  )

  // De enige plek in deze pagina waar een mail de deur uit gaat: één klik van
  // de owner op Uitnodigen / Opnieuw sturen.
  async function handleInvite(user) {
    // Dezelfde poort als de modal. De rij-knop was de kortste weg naar een
    // verstuurde mail en had tot v1.198 helemaal geen controle.
    if (!readiness.magUitnodigen) {
      showToast({
        kind: 'error',
        message: 'Uitnodigen staat dicht',
        detail: readiness.error || `${readiness.rood.length} poort(en) open — zie Member uitnodigen`,
      })
      return
    }
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
              {stats.deactivated > 0 && <>{' · '}<span className="is-muted">{stats.deactivated} uit dienst</span></>}
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

      {/* Alleen tonen als er iets te melden is. Een groene regel die er elke
          dag staat leest niemand nog; een rode hoort je hier wél te zien
          zonder eerst de modal te openen. */}
      {!readiness.loading && !readiness.magUitnodigen && (
        <InviteReadiness readiness={readiness} compact />
      )}

      {!error && sorted.length === 0 && !loading && (
        <div className="users-empty">
          <p className="users-empty__title">Geen gebruikers gevonden</p>
          <p className="users-empty__hint">Klik <strong>Gebruiker aanmaken</strong> om een collega klaar te zetten; de uitnodiging stuur je daarna.</p>
        </div>
      )}

      {/* Drie bakken, één tik uit elkaar. De teller staat in de tab zelf: dat
          is het enige wat verklaart waarom Actief er zo leeg uitziet zodra de
          meeste accounts wel bestaan maar nog nooit gebruikt zijn. */}
      {!error && sorted.length > 0 && (
        <div className="users-tabs" role="tablist" aria-label="Filter gebruikers">
          {USER_TABS.map(t => (
            <button
              key={t.id}
              type="button"
              role="tab"
              aria-selected={tab === t.id}
              className={`users-tab ${tab === t.id ? 'is-active' : ''}`}
              onClick={() => setTab(t.id)}
            >
              {t.label}
              <span className="users-tab__count">{counts[t.id]}</span>
            </button>
          ))}
        </div>
      )}

      {!error && sorted.length > 0 && zichtbaar.length === 0 && (
        <div className="users-empty">
          <p className="users-empty__title">
            {tab === 'actief' && 'Niemand gebruikt de app op dit moment'}
            {tab === 'uitnodiging' && 'Niemand wacht op een uitnodiging'}
            {tab === 'gedeactiveerd' && 'Niemand staat op uit dienst'}
          </p>
          <p className="users-empty__hint">
            {tab === 'gedeactiveerd'
              ? 'Wie uit dienst gaat blijft hier staan — het account wordt niet verwijderd.'
              : 'Kijk bij de andere tabbladen; de tellers hierboven laten zien waar iedereen zit.'}
          </p>
        </div>
      )}

      {!error && zichtbaar.length > 0 && (
        <div className="users-card">
          <table className="users-table">
            <thead>
              <tr>
                <th>Gebruiker</th>
                <th>Rol</th>
                <th>Status</th>
                <th title="Is er ooit een uitnodigingsmail verstuurd? Aanmaken doet dat niet — dat is een aparte knop.">Uitnodiging</th>
                {/* v1.192: "Ingelogd" beloofde iets wat de kolom niet kon
                    waarmaken — een geminte JWT zette last_sign_in_at ook. Nu
                    staat er wat er gemeten wordt: heeft deze persoon de app
                    écht gebruikt. Zie lib/users.js → ooitGebruikt. */}
                <th title="Echte activiteit: een ververste sessie, een sessie van een browser of een gehaalde tweede factor. Een account waarvoor alleen een sessie is aangemaakt (bijvoorbeeld door een meetscript) staat hier op 'nog nooit gebruikt'.">Gebruikt</th>
                <th title="Welke HubSpot deal-eigenaar bij deze gebruiker hoort. Wijzigen via Bewerken.">HubSpot</th>
                <th className="is-right"><span className="sr-only">Acties</span></th>
              </tr>
            </thead>
            <tbody>
              {zichtbaar.map(u => (
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
          Tokens/Infra. Wie wat mag staat op{' '}
          <Link to="/organisatie/rechten">Rechten</Link>.{' '}
          <button type="button" className="admin-linkbtn" onClick={() => setShowInfo(true)}>Wat ziet een member? →</button>
        </span>
      </p>

      <InviteModal
        open={showInvite}
        onClose={() => setShowInvite(false)}
        onInvited={refresh}
        onCreateFirst={(email) => { setShowInvite(false); setCreateFor(email) }}
        readiness={readiness}
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
      {/* Conditioneel gemount: de modal haalt zijn eigen rechten-data op, en
          die drie selects hoeven niet te draaien als niemand hem opent. */}
      {showInfo && <MemberInfoModal onClose={() => setShowInfo(false)} />}
    </div>
  )
}
