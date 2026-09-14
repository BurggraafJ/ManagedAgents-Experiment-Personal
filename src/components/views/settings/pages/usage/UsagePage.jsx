import { useMemo, useState } from 'react'
import { useUsers } from '../../../../../hooks/useUsers'
import { useModelUsage, usd, eur, maandLabel, dekkingPct } from '../../../../../hooks/useModelUsage'
import { sortUsers, getInitials } from '../../../../../lib/users'
import UsageDetail from './UsageDetail'
import './usage.css'

// Usage — verbruik van betaalde model-calls per persoon (beslissing 5).
//
// Het scherm is met opzet klein: één maand, één tabel, en bovenaan de zin die
// alle cijfers eronder relativeert. Jelle vroeg om "eenvoudig overzicht
// activiteit — niet complex", en dat valt hier samen met wat eerlijk is: er is
// vandaag te weinig telemetrie om meer te beweren.
//
// ── Wat dit scherm NIET doet ────────────────────────────────────────────────
// Geen euro-omrekening. Het plafond staat in euro, de meting in dollar, en de
// koers staat als NULL in dash_parameters. Een percentage van het plafond zou
// dus een zelf gekozen wisselkoers zijn — een verzonnen getal in een scherm dat
// over geld gaat. Twee kolommen naast elkaar, en de reden erbij.
//
// Geen totaal per persoon dat doet alsof het compleet is. De dekkingsregel
// staat bovenaan, niet in een voetnoot: in september is 12 % van de vragen aan
// een mens toe te wijzen.
//
// Geen nul die "gebruikt niets" zegt terwijl hij "niet gemeten" betekent. Wie
// geen toegewezen verbruik heeft krijgt een streepje met uitleg, geen $0,00.
//
// ── v1.192 · twee toevoegingen ──────────────────────────────────────────────
// 1. **Maestro staat in de tabel**, onder een eigen kopregel, met wat hij écht
//    verbruikte: de vragen waarbij rag-chat geen ingelogde gebruiker zag (cron,
//    agents, scripts). Dat is meting, geen schatting — `caller_identified` staat
//    in de meta van elke vraag. Wat er NIET in zit staat er als aparte regel
//    onder: de model-calls buiten rag-chat (taalcheck, transcribe, kb-compose,
//    de Claude-routines) worden nergens meer geteld sinds claude_api_calls op
//    2026-05-19 stilviel. Die regel zegt *niet gemeten*, nooit €0 — een nul die
//    "we weten het niet" betekent is de duurste leugen op een kostenpagina.
// 2. **Klik op een persoon** en je ziet zijn vragen, niet alleen zijn totaal
//    (UsageDetail.jsx).

const InfoIcon = (
  <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <circle cx="12" cy="12" r="9" /><path d="M12 16v-4M12 8h.01" />
  </svg>
)

export default function UsagePage() {
  const { users, loading: usersLoading, error: usersError } = useUsers()
  const { maanden, budgetByUser, koers, loading, error, forMonth, loadDetail } = useModelUsage()
  const [maand, setMaand] = useState(null)
  const [openPersoon, setOpenPersoon] = useState(null)

  const actieveMaand = maand || maanden[0] || null
  const { perUser, dekking } = useMemo(
    () => (actieveMaand ? forMonth(actieveMaand) : { perUser: new Map(), dekking: null }),
    [actieveMaand, forMonth],
  )

  const rows = useMemo(() => sortUsers(users).map(u => {
    const use = perUser.get(u.user_id) || null
    const bud = budgetByUser.get(u.user_id) || null
    return {
      user_id: u.user_id,
      name: u.display_name || (u.email || '').split('@')[0],
      email: u.email,
      role: u.app_role,
      vragen: use?.vragen ?? 0,
      kosten: use ? Number(use.cost_usd) : null,
      cap: bud ? Number(bud.monthly_cap_eur) : null,
      capExpliciet: bud?.expliciet_gezet ?? false,
      paused: bud?.paused ?? false,
    }
  }), [users, perUser, budgetByUser])

  const totaalToegewezen = rows.reduce((n, r) => n + (r.kosten || 0), 0)
  const metVerbruik = rows.filter(r => r.kosten !== null).length
  const pct = dekkingPct(dekking)

  // Maestro zelf: de vragen zonder ingelogde gebruiker. Vóór v1.192 zat dit in
  // "de rest"; nu is het een rij, want het is de grootste post.
  const maestro = dekking && dekking.vragen_systeem !== undefined
    ? { vragen: dekking.vragen_systeem, kosten: dekking.usd_systeem === null ? null : Number(dekking.usd_systeem) }
    : null
  // En het gat: herkend, niet vastgelegd. Hoort bij niemand, ook niet bij
  // Maestro — vandaar een eigen regel in plaats van een optelling.
  const gat = dekking && dekking.vragen_gat
    ? { vragen: dekking.vragen_gat, kosten: dekking.usd_gat === null ? null : Number(dekking.usd_gat) }
    : null

  const persoonOpen = openPersoon ? rows.find(r => r.user_id === openPersoon) : null

  const busy = loading || usersLoading
  const fout = error || usersError

  return (
    <div className="users-app">
      <header className="admin-page-head">
        <div className="admin-page-head__main">
          <h1 className="admin-page-head__title">Usage</h1>
          <p className="admin-page-head__subtitle">Betaalde model-calls per persoon, per maand.</p>
          {!busy && !fout && (
            <p className="admin-page-head__meta">
              <b>{rows.length}</b> personen
              {' · '}<b>{metVerbruik}</b> met toegewezen verbruik
              {' · '}<b>{usd(totaalToegewezen)}</b> toegewezen deze maand
            </p>
          )}
        </div>
        {maanden.length > 1 && (
          <div className="admin-page-head__actions">
            <select
              className="usg-select"
              value={actieveMaand || ''}
              onChange={e => setMaand(e.target.value)}
              aria-label="Maand"
            >
              {maanden.map(m => (
                <option key={m} value={m}>{maandLabel(m)}</option>
              ))}
            </select>
          </div>
        )}
      </header>

      {fout && (
        <div className="users-form__notice users-form__notice--error">
          <strong>Fout bij ophalen:</strong> {fout}
        </div>
      )}

      {/* De noemer. Dit is de belangrijkste regel van het scherm en hij staat
          daarom bovenaan, niet in een voetnoot. */}
      {!fout && dekking && (
        <div className={`usg-dekking ${pct !== null && pct < 50 ? 'is-thin' : ''}`}>
          {InfoIcon}
          <span>
            <b>{dekking.vragen_toegewezen} van de {dekking.vragen_totaal} vragen</b> in{' '}
            {maandLabel(actieveMaand)} zijn aan een persoon toe te wijzen
            {pct !== null && <> ({pct}%)</>} — {usd(dekking.usd_toegewezen || 0)} van{' '}
            {usd(dekking.usd_totaal)}.
            {maestro && <> Daarnaast <b>{maestro.vragen}</b> vragen ({usd(maestro.kosten || 0)})
              zonder ingelogde gebruiker: dat is <b>Maestro zelf</b>, en dat staat als
              eigen rij in de tabel.</>}
            {gat && <> De laatste <b>{gat.vragen}</b> ({usd(gat.kosten || 0)}) hadden wél
              een herkende gebruiker maar geen chat-run op naam — een meetgat, geen
              verbruik van niemand.</>}
            {' '}<b>De tabel is dus geen volledige rekening</b>, maar de drie stukken
            waarin dit schema de kosten kan uitsplitsen.
          </span>
        </div>
      )}

      {!fout && !busy && !dekking && (
        <div className="usg-dekking">
          {InfoIcon}
          <span>Geen gemeten model-calls in deze periode. Dat is een lege meting, geen nul.</span>
        </div>
      )}

      {!fout && (
        <div className="users-card">
          <table className="users-table usg-table">
            <thead>
              <tr>
                <th>Persoon</th>
                <th className="is-right" title="Chatvragen die aan deze persoon gekoppeld konden worden.">Vragen</th>
                <th className="is-right" title="Geschatte kosten in dollar — zo staat het in rag_chat_query_log.">Verbruik</th>
                {/* "Wordt niet afgedwongen" geldt voor iedereen en staat daarom
                    één keer in de kop. Als pil op elke rij zegt hetzelfde
                    bericht zeven keer en gaat het juist níet meer op. */}
                <th className="is-right" title="Maandplafond uit user_model_budget. Default €50, staat in euro.">
                  Plafond
                  <span className="usg-th-sub">wordt niet afgedwongen</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {rows.map(r => (
                <tr
                  key={r.user_id}
                  className={`usg-rij ${openPersoon === r.user_id ? 'is-open' : ''} ${r.kosten === null ? 'is-leeg' : ''}`}
                  onClick={() => r.kosten !== null && setOpenPersoon(openPersoon === r.user_id ? null : r.user_id)}
                  title={r.kosten === null
                    ? 'Geen gemeten vragen van deze persoon — er valt niets open te klappen.'
                    : `De ${r.vragen} vragen van ${r.name} bekijken`}
                >
                  <td>
                    <div className="usg-person">
                      <span className={`usg-av ${r.role === 'owner' ? 'is-owner' : ''}`}>
                        {getInitials(r.name || r.email)}
                      </span>
                      <span className="usg-person__txt">
                        <span className="usg-person__n">{r.name}</span>
                        <span className="usg-person__m">{r.role}</span>
                      </span>
                    </div>
                  </td>
                  <td className="is-right">
                    {r.kosten === null
                      ? <span className="usg-none" title="Geen enkele vraag van deze persoon is in deze maand gemeten.">—</span>
                      : <span className="usg-klik">{r.vragen}</span>}
                  </td>
                  <td className="is-right">
                    {r.kosten === null
                      ? <span className="usg-none" title="Niet gemeten — dat is iets anders dan nul.">niet gemeten</span>
                      : <b>{usd(r.kosten)}</b>}
                  </td>
                  <td className="is-right">
                    {r.cap === null
                      ? <span className="usg-none">—</span>
                      : <>
                          {eur(r.cap)}
                          {r.paused && <span className="usg-sub usg-sub--warn" title="Deze persoon staat op pauze in user_model_budget.">gepauzeerd</span>}
                          {!r.paused && !r.capExpliciet && <span className="usg-sub" title="Er staat geen eigen rij in user_model_budget; dit is de standaard uit de view.">standaard</span>}
                        </>}
                  </td>
                </tr>
              ))}

              {/* ── Maestro ──────────────────────────────────────────────────
                  Naast de personen, niet ertussen: dit is geen gebruiker en
                  heeft geen plafond. Het getal is gemeten (caller_identified =
                  false in de vraag-meta), niet geschat. */}
              {maestro && (
                <tr className="usg-rij usg-maestro">
                  <td>
                    <div className="usg-person">
                      <span className="usg-av is-systeem" aria-hidden="true">M</span>
                      <span className="usg-person__txt">
                        <span className="usg-person__n">Maestro zelf</span>
                        <span className="usg-person__m">cron · agents · scripts — geen ingelogde gebruiker</span>
                      </span>
                    </div>
                  </td>
                  <td className="is-right">{maestro.vragen}</td>
                  <td className="is-right"><b>{usd(maestro.kosten || 0)}</b></td>
                  <td className="is-right">
                    <span className="usg-none" title="Maestro is geen persoon; het plafond uit beslissing 5 geldt per member.">n.v.t.</span>
                  </td>
                </tr>
              )}

              {/* Het meetgat. Hoort bij niemand — ook niet bij Maestro, want
                  rag-chat hérkende hier wél een mens. Bij Maestro optellen zou
                  een sluitende rekening maken die niet sluit. */}
              {gat && (
                <tr className="usg-rij usg-gat">
                  <td>
                    <div className="usg-person">
                      <span className="usg-av is-gat" aria-hidden="true">?</span>
                      <span className="usg-person__txt">
                        <span className="usg-person__n">Niet toe te wijzen</span>
                        <span className="usg-person__m">wél een gebruiker herkend, geen chat-run met naam — meetgat</span>
                      </span>
                    </div>
                  </td>
                  <td className="is-right">{gat.vragen}</td>
                  <td className="is-right">{usd(gat.kosten || 0)}</td>
                  <td className="is-right"><span className="usg-none">—</span></td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      )}

      {/* De doorkijk. Onder de tabel, zodat de rij waarop je klikte zichtbaar
          blijft — dat is de vergelijking waarvoor je hem opent. */}
      {persoonOpen && (
        <UsageDetail
          person={persoonOpen}
          maand={actieveMaand}
          loadDetail={loadDetail}
          onClose={() => setOpenPersoon(null)}
        />
      )}

      {/* Waarom er geen percentage van het plafond staat. */}
      <div className="usg-note">
        <p>
          <strong>Verbruik staat in dollar, het plafond in euro.</strong> De koers
          (<code>model_budget_usd_per_eur</code> in <code>dash_parameters</code>) is bewust
          leeg gelaten. Zolang die leeg is rekent dit scherm niets om en toont het geen
          percentage van het plafond — dat zou een zelf gekozen wisselkoers zijn.
          {koers === null && ' Vul de parameter om beide kolommen in één munt te krijgen.'}
        </p>
        <p>
          <strong>Het plafond remt vandaag niets.</strong> <code>user_model_budget</code> staat
          op {eur(50)} per persoon per maand, maar geen enkele Edge Function leest hem —
          de zes die betaalde model-calls doen hebben geen rolcheck en geen budgetcheck
          (GAP-3). Deze pagina rapporteert; ze begrenst niet.
        </p>
        <p>
          <strong>Bron.</strong> <code>rag_chat_query_log.est_cost_usd</code> via{' '}
          <code>agent_chat_runs.caller_user_id</code> — de enige koppeling tussen een
          model-call en een mens die dit schema heeft. De rij <b>Maestro zelf</b> komt uit
          dezelfde tabel: het zijn de vragen waarbij rag-chat geen ingelogde gebruiker zag
          (<code>meta.caller_identified = false</code>).
        </p>
        <p>
          <strong>Wat hier NIET in zit, en dus nergens staat.</strong> Alle betaalde
          model-calls búiten de chat — taalcheck, transcribe, kb-compose, de
          Claude-routines van de agents — worden sinds <b>19 mei 2026</b> niet meer
          geteld: <code>claude_api_calls</code> stopte toen met vollopen (253 rijen, geen
          <code> user_id</code>). Die kosten bestaan wel en staan op geen enkele regel
          hierboven. Er staat daarom nergens een <b>€0</b> voor: een nul die "we meten het
          niet" betekent is op een kostenpagina de duurste leugen die je kunt tonen.
        </p>
      </div>
    </div>
  )
}
