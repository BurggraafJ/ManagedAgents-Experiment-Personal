import { useMemo, useState } from 'react'
import { useUsers } from '../../../../../hooks/useUsers'
import { useModelUsage, usd, eur, maandLabel, dekkingPct } from '../../../../../hooks/useModelUsage'
import { sortUsers, getInitials } from '../../../../../lib/users'
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

const InfoIcon = (
  <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <circle cx="12" cy="12" r="9" /><path d="M12 16v-4M12 8h.01" />
  </svg>
)

export default function UsagePage() {
  const { users, loading: usersLoading, error: usersError } = useUsers()
  const { maanden, budgetByUser, koers, loading, error, forMonth } = useModelUsage()
  const [maand, setMaand] = useState(null)

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
            {usd(dekking.usd_totaal)}. De rest liep zonder ingelogde gebruiker (cron,
            agents, evals) en staat hieronder bij niemand. <b>De tabel is dus geen
            volledige rekening</b>, maar het deel dat aan een mens te koppelen is.
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
                <tr key={r.user_id}>
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
                      : r.vragen}
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
            </tbody>
          </table>
        </div>
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
          model-call en een mens die dit schema heeft. <code>claude_api_calls</code> is
          niet meegeteld: die tabel loopt sinds 19 mei 2026 niet meer vol en zou nullen
          opleveren die als "gebruikt niets" lezen.
        </p>
      </div>
    </div>
  )
}
