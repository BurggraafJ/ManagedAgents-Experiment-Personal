import { useEffect, useMemo, useState } from 'react'
import { useUsers } from '../../../../../hooks/useUsers'
import { useCapabilities } from '../../../../../hooks/useCapabilities'
import { useMailAccounts, mailboxStatus } from '../../../../../hooks/useMailAccounts'
import { buildRows, groupRows, dichteGroepen, userStatsFor, cellFor, kortenaam } from '../../../../../lib/capabilities'
import { sortUsers } from '../../../../../lib/users'
import { showToast } from '../../../../Toast'
import RechtenMatrix, { StateBox } from './RechtenMatrix'
import './rechten.css'

// Rechten — de matrix uit Design B (Jelle, 2026-09-14), op /organisatie/rechten.
//
// Wat dit scherm beantwoordt: "wie heeft hier eigenlijk toegang toe?" in één
// blik. Je leest een rij en ziet meteen wie er van de standaard afwijkt.
//
// ⚠ De vinkjes zetten `user_capabilities`, en die tabel wordt vandaag door
// NIETS gelezen behalve `has_capability()` — en `has_capability()` zit nog in
// geen enkele policy (migratie 20260914143000 is met opzet een skelet). Een
// vinkje hier verandert dus nog geen enkele RLS-uitkomst. Dat staat als eerste
// regel op het scherm, want een rechtenscherm dat doet alsof het iets afdwingt
// terwijl het dat niet doet, is gevaarlijker dan geen rechtenscherm.
//
// Twee dingen zijn bewust niet bewerkbaar:
//   • de kolom Standaard — dat is de rol-preset (role_capabilities), en die
//     hoort niet per ongeluk vanuit een kruispunt te verschuiven
//   • de kolom van de owner — has_capability geeft de owner altijd alles, en
//     je eigen Gebruikers-recht weghalen is een self-lockout. Zelfde reflex als
//     de demote-beveiliging in EditUserModal.

const WarnIcon = (
  <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d="M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0z" />
    <path d="M12 9v4M12 17h.01" />
  </svg>
)

const PRESET_ROLE = 'member'

export default function RechtenPage() {
  const { users, loading: usersLoading, error: usersError } = useUsers()
  const {
    caps, presetByRole, overrideByUser,
    loading: capsLoading, error: capsError, setCapabilities, resetUser,
  } = useCapabilities()
  const mail = useMailAccounts()
  const [transposed, setTransposed] = useState(false)
  const [savingKey, setSavingKey] = useState(null)

  const rows = useMemo(() => buildRows(caps), [caps])
  const groups = useMemo(() => groupRows(rows), [rows])
  const presetKeys = useMemo(
    () => presetByRole.get(PRESET_ROLE) || new Set(),
    [presetByRole],
  )

  // Welke groepen staan open. De stand komt uit GROEP_META (lib/capabilities):
  // alleen wat in aanbouw is staat open. Zodra de catalogus geladen is wordt de
  // stand één keer gezet; daarna is het de keuze van de kijker.
  const [openGroepen, setOpenGroepen] = useState(null)
  useEffect(() => {
    if (openGroepen !== null || groups.length === 0) return
    const dicht = dichteGroepen(groups)
    setOpenGroepen(new Set(groups.map(g => g.groep).filter(g => !dicht.has(g))))
  }, [groups, openGroepen])

  const open = openGroepen || new Set()
  const allesOpen = groups.length > 0 && groups.every(g => open.has(g.groep))

  function toggleGroep(groep) {
    setOpenGroepen(prev => {
      const next = new Set(prev || [])
      if (next.has(groep)) next.delete(groep)
      else next.add(groep)
      return next
    })
  }

  // Personen voor de kolommen, met hun eigen preset-set, hun afwijkingsteller
  // en de mailbox-koppeling uit beslissing 4.
  const people = useMemo(() => sortUsers(users).map(u => {
    const ov = overrideByUser.get(u.user_id) || new Map()
    const keys = presetByRole.get(u.app_role) || new Set()
    const stats = userStatsFor(rows, u.app_role, ov, keys)
    const name = u.display_name || (u.email || '').split('@')[0]
    return {
      user_id: u.user_id,
      app_role: u.app_role,
      email: u.email,
      name,
      kort: kortenaam(name),
      presetKeys: keys,
      afwijkend: stats.afwijkend,
      aan: stats.aan,
      mailbox: mailboxStatus(mail.byUser.get(u.user_id), mail.gelezen),
    }
  }), [users, overrideByUser, presetByRole, rows, mail.byUser, mail.gelezen])

  // Tellen in RIJEN, niet in losse rechten. Sinds v1.193 is de rij het
  // product-recht dat Jelle uitdeelt; "19 rechten leveren nog niets" is waar en
  // onleesbaar, "8 van de 14 rijen" is hetzelfde bericht in de eenheid waarin je
  // klikt. `rechten` blijft erbij staan zodat zichtbaar is dat de database
  // fijnmaziger is dan het scherm.
  const totals = useMemo(() => ({
    rechten: caps.length,
    rijen: rows.length,
    personen: people.length,
    afwijkingen: people.reduce((n, p) => n + p.afwijkend, 0),
    vast: rows.filter(r => !r.grantable).length,
    levertNiets: rows.filter(r => r.grantable && !r.levert_vandaag).length,
  }), [caps, rows, people])

  async function handleToggle(row, person) {
    const ov = overrideByUser.get(person.user_id) || new Map()
    const cur = cellFor(row, person.app_role, ov, person.presetKeys)
    // Half aan wordt helemaal aan — dat is de richting die niemand verrast.
    const next = cur.mixed ? true : !cur.on
    const key = `${person.user_id}:${row.id}`
    setSavingKey(key)
    try {
      await setCapabilities({
        userId: person.user_id,
        capKeys: row.caps.map(c => c.key),
        on: next,
        role: person.app_role,
      })
    } catch (err) {
      showToast({
        kind: 'error',
        message: 'Recht niet opgeslagen',
        detail: err.message || String(err),
      })
    } finally {
      setSavingKey(null)
    }
  }

  async function handleReset(person) {
    if (!person.afwijkend) return
    setSavingKey(`reset:${person.user_id}`)
    try {
      await resetUser(person.user_id)
      showToast({ kind: 'success', message: `${person.name} terug op de ${person.app_role}-standaard` })
    } catch (err) {
      showToast({ kind: 'error', message: 'Terugzetten mislukt', detail: err.message || String(err) })
    } finally {
      setSavingKey(null)
    }
  }

  const error = usersError || capsError
  const loading = usersLoading || capsLoading
  const afwijkers = people.filter(p => p.afwijkend > 0)

  return (
    <div className="users-app">
      <header className="admin-page-head">
        <div className="admin-page-head__main">
          <h1 className="admin-page-head__title">Rechten</h1>
          <p className="admin-page-head__subtitle">
            Wie mag wat. Eén rij is één recht dat je uitdeelt; de grijze kolom is de
            {' '}{PRESET_ROLE}-standaard.
          </p>
          {!loading && !error && (
            <p className="admin-page-head__meta">
              <b>{totals.rijen}</b> rijen
              {' · '}<b>{groups.length}</b> groepen, <b>{open.size}</b> open
              {' · '}<b>{totals.personen}</b> personen
              {' · '}
              {totals.afwijkingen > 0
                ? <span className="is-warn"><b>{totals.afwijkingen}</b> handmatige afwijking{totals.afwijkingen === 1 ? '' : 'en'}</span>
                : <>geen handmatige afwijkingen</>}
              {' · '}<b>{totals.vast}</b> vast (owner)
              {' · '}
              <span title="Een rij kan meerdere rechten in de database bundelen. De handhaving blijft per recht; het vinkje is de afspraak.">
                {totals.rechten} rechten eronder
              </span>
            </p>
          )}
        </div>
        <div className="admin-page-head__actions">
          <button
            type="button"
            className="admin-btn"
            onClick={() => setOpenGroepen(allesOpen ? new Set() : new Set(groups.map(g => g.groep)))}
            title={allesOpen
              ? 'Alle groepen dicht'
              : 'Alle groepen open — standaard staat alleen open wat in aanbouw is'}
          >
            {allesOpen ? 'Alles inklappen' : 'Alles uitklappen'}
          </button>
          <button
            type="button"
            className="admin-btn"
            onClick={() => setTransposed(t => !t)}
            title="Wissel de assen: rechten als rijen (standaard) of personen als rijen"
          >
            {transposed ? 'Rechten als rijen' : 'Personen als rijen'}
          </button>
        </div>
      </header>

      {/* Het belangrijkste zinnetje op deze pagina. Zolang has_capability in
          geen enkele policy zit, zet je hier een voornemen vast — geen slot. */}
      <div className="rch-warn">
        {WarnIcon}
        <span>
          <b>Deze vinkjes worden nog nergens afgedwongen.</b> Ze schrijven naar{' '}
          <code>user_capabilities</code>, en <code>has_capability()</code> zit nog in geen
          enkele policy (multi-user P0 is met opzet een skelet). De afscherming van
          vandaag is de rol: een member ziet Organisatie niet. Wat je hier zet is de
          afspraak die straks wordt aangezet — nog niet het slot.
          {totals.levertNiets > 0 && (
            <> Daarnaast staan <b>{totals.levertNiets}</b> van de {totals.rijen} rijen
            aangemerkt als <em>levert nog niets</em>: die kunnen aan staan zonder dat de
            RLS eronder er vandaag data bij geeft.</>
          )}
        </span>
      </div>

      {error && (
        <div className="users-form__notice users-form__notice--error">
          <strong>Fout bij ophalen:</strong> {error}
        </div>
      )}

      {/* Naam en terugzet-knop staan bij elkaar. Ze twee keer opsommen — één
          keer als lijst, één keer als rij knoppen — maakte de regel dubbel zo
          lang en zei niets extra's. */}
      {!error && afwijkers.length > 0 && (
        <div className="rch-bar">
          <span>Handmatig afgeweken van de standaard:</span>
          {afwijkers.map(p => (
            <span key={p.user_id} className="rch-bar__wie">
              <b>{p.name}</b> ({p.afwijkend})
              <button
                type="button"
                className="rch-linkbtn"
                disabled={savingKey === `reset:${p.user_id}`}
                onClick={() => handleReset(p)}
                title={`Alle handmatige afwijkingen van ${p.name} weghalen; hij volgt daarna weer de ${p.app_role}-standaard.`}
              >
                terugzetten
              </button>
            </span>
          ))}
        </div>
      )}

      {!error && !loading && people.length > 0 && (
        <>
          <RechtenMatrix
            rows={rows}
            groups={groups}
            people={people}
            presetRole={PRESET_ROLE}
            presetKeys={presetKeys}
            overrideByUser={overrideByUser}
            savingKey={savingKey}
            onToggle={handleToggle}
            transposed={transposed}
            openGroepen={open}
            onToggleGroep={toggleGroep}
          />
          <div className="rch-legend">
            <span className="rch-legend__i"><StateBox on /> staat aan via de rol-standaard</span>
            <span className="rch-legend__i"><StateBox on manual /> hier zelf bijgezet</span>
            <span className="rch-legend__i"><StateBox manual /> hier zelf weggehaald</span>
            <span className="rch-legend__i"><StateBox locked /> vast owner-recht, niet vinkbaar</span>
            <span className="rch-legend__i"><StateBox mixed /> bundel: sommige leden aan</span>
          </div>
        </>
      )}

      {loading && <p className="admin-page-head__meta">Rechten ophalen…</p>}
    </div>
  )
}
