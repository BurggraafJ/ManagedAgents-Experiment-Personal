import { useMemo, useState } from 'react'
import { useUsers } from '../../../../../hooks/useUsers'
import { useModelUsage, usd, eur, maandLabel, STANDAARD_PLAFOND_EUR } from '../../../../../hooks/useModelUsage'
import { sortUsers, getInitials } from '../../../../../lib/users'
import { showToast } from '../../../../Toast'
import UsageDetail from './UsageDetail'
import UsageCapModal from './UsageCapModal'
import UsageNote from './UsageNote'
import './usage.css'

// Usage — verbruik van betaalde model-calls per regel, per maand (beslissing 5).
//
// ── Wat dit scherm NIET doet ────────────────────────────────────────────────
// Geen euro-omrekening. Het plafond staat in euro, de meting in dollar, en de
// koers staat als NULL in dash_parameters. Een percentage van het plafond zou
// dus een zelf gekozen wisselkoers zijn — een verzonnen getal in een scherm dat
// over geld gaat. Twee kolommen naast elkaar, en de reden eronder.
//
// Geen nul die "gebruikt niets" zegt terwijl hij "niet gemeten" betekent. Wie
// geen toegewezen verbruik heeft krijgt een streepje met uitleg, geen $0,00.
//
// ── v1.193 · vier wijzigingen na Jelle's doorkijk ───────────────────────────
// 1. **De gele balk is weg.** Die vertelde in proza wat de tabel nu als rijen
//    toont: hoeveel vragen op naam stonden, hoeveel van Maestro waren en hoeveel
//    er in het meetgat vielen. Twee keer hetzelfde bericht, waarvan één keer in
//    een kleur die om aandacht vraagt. De noemer is niet verdwenen — hij staat
//    als **Totaal gemeten** onder de tabel, en die telt zichtbaar op uit de
//    regels erboven.
// 2. **Maestro staat bovenaan**, niet onderaan. Hij is de grootste post (in
//    september $3,59 van $4,98) en dat hoort de eerste regel te zijn die je
//    leest, niet de voetnoot.
// 3. **De maandkiezer staat er altijd**, ook als er maar één maand gemeten is.
//    De huidige maand zit er altijd bij; "deze maand nul" is een antwoord.
// 4. **Het plafond is instelbaar** — per persoon én voor Maestro (die geen rij
//    in auth.users heeft en dus een parameter krijgt). Standaard €50, en een
//    regel die precies op de standaard staat houdt géén eigen instelling: dan
//    betekent "eigen plafond" altijd dat er bewust van is afgeweken.

export default function UsagePage() {
  const { users, loading: usersLoading, error: usersError } = useUsers()
  const {
    maanden, budgetByUser, koers, maestroCap,
    loading, error, forMonth, loadDetail, setUserCap, setMaestroCap,
  } = useModelUsage()
  const [maand, setMaand] = useState(null)
  const [openPersoon, setOpenPersoon] = useState(null)
  const [capRegel, setCapRegel] = useState(null)

  const actieveMaand = maand || maanden[0] || null
  const { perUser, edgePerUser, dekking } = useMemo(
    () => (actieveMaand ? forMonth(actieveMaand) : { perUser: new Map(), edgePerUser: new Map(), dekking: null }),
    [actieveMaand, forMonth],
  )

  // ── De regels van de tabel ────────────────────────────────────────────────
  // Maestro, de mensen en het meetgat zijn drie soorten regels met dezelfde
  // vorm. Ze in één lijst zetten is niet alleen korter: het dwingt af dat de
  // plafond-kolom overal hetzelfde gedraagt, en dat de voetregel uit dezelfde
  // getallen optelt als de regels erboven.
  const personen = useMemo(() => sortUsers(users).map(u => {
    const use = perUser.get(u.user_id) || null
    const eg = edgePerUser.get(u.user_id) || null
    const bud = budgetByUser.get(u.user_id) || null
    return {
      id: u.user_id,
      soort: 'persoon',
      user_id: u.user_id,
      name: u.display_name || (u.email || '').split('@')[0],
      sub: u.app_role,
      email: u.email,
      role: u.app_role,
      vragen: use?.vragen ?? 0,
      kosten: use ? Number(use.cost_usd) : null,
      // De tweede post die de rem meetelt: taalcheck, transcribe, kb-compose,
      // mail-verbeteraar, spelcheck. Apart, niet opgeteld bij de chat.
      edgeCalls: eg?.calls ?? 0,
      edgeKosten: eg ? Number(eg.cost_usd) : null,
      cap: bud ? Number(bud.monthly_cap_eur) : STANDAARD_PLAFOND_EUR,
      capExpliciet: bud?.expliciet_gezet ?? false,
      paused: bud?.paused ?? false,
    }
  }), [users, perUser, edgePerUser, budgetByUser])

  // Maestro zelf: de vragen zonder ingelogde gebruiker. Gemeten, niet geschat —
  // rag-chat schrijft `meta.caller_identified` bij elke vraag op.
  const maestro = dekking && dekking.vragen_systeem !== undefined && dekking.vragen_systeem !== null
    ? {
        id: 'maestro',
        soort: 'maestro',
        systeem: true,
        name: 'Maestro zelf',
        sub: 'cron · agents · scripts — geen ingelogde gebruiker',
        vragen: dekking.vragen_systeem,
        kosten: dekking.usd_systeem === null ? null : Number(dekking.usd_systeem),
        cap: maestroCap === null ? STANDAARD_PLAFOND_EUR : Number(maestroCap),
        capExpliciet: maestroCap !== null && Number(maestroCap) !== STANDAARD_PLAFOND_EUR,
        paused: false,
      }
    : null

  // Het meetgat: rag-chat hérkende hier een mens, maar er staat geen chat-run op
  // naam. Hoort bij niemand — ook niet bij Maestro, want dat zou er een
  // sluitende rekening van maken die niet sluit.
  const gat = dekking && dekking.vragen_gat
    ? {
        id: 'gat',
        soort: 'gat',
        name: 'Niet toe te wijzen',
        sub: 'wél een gebruiker herkend, geen chat-run met naam — meetgat',
        vragen: dekking.vragen_gat,
        kosten: dekking.usd_gat === null ? null : Number(dekking.usd_gat),
        cap: null,
        capExpliciet: false,
        paused: false,
      }
    : null

  const regels = [maestro, ...personen, gat].filter(Boolean)
  const persoonOpen = openPersoon ? personen.find(r => r.user_id === openPersoon) : null

  const busy = loading || usersLoading
  const fout = error || usersError

  async function bewaarCap(regel, waarde) {
    if (regel.soort === 'maestro') await setMaestroCap(waarde)
    else await setUserCap(regel.user_id, waarde)
    showToast({
      kind: 'success',
      message: waarde === null || Number(waarde) === STANDAARD_PLAFOND_EUR
        ? `${regel.name} volgt weer het standaardplafond van ${eur(STANDAARD_PLAFOND_EUR)}`
        : `Plafond van ${regel.name} staat op ${eur(waarde)} per maand`,
      detail: regel.soort !== 'persoon'
        ? 'Signaalwaarde: Maestro heeft geen sessie om te remmen.'
        : regel.role === 'owner'
          ? 'De owner wordt gemeten, niet geremd — beslissing 5 gaat over members.'
          : 'Wordt afgedwongen: chat en betaalde Edge Functions weigeren boven dit bedrag.',
    })
  }

  return (
    <div className="users-app">
      <header className="admin-page-head">
        <div className="admin-page-head__main">
          <h1 className="admin-page-head__title">Usage</h1>
          <p className="admin-page-head__subtitle">Betaalde model-calls per regel, per maand.</p>
          {!busy && !fout && (
            <p className="admin-page-head__meta">
              <b>{personen.length}</b> personen
              {' · '}plafond standaard <b>{eur(STANDAARD_PLAFOND_EUR)}</b> per maand
              {' · '}
              <span title="Het plafond staat in euro, de meting in dollar. De koers is bewust niet vastgelegd; zie de toelichting onder de tabel.">
                verbruik in dollar
              </span>
            </p>
          )}
        </div>
        {/* De maandkiezer staat er altijd. Hem verbergen zodra er één maand
            gemeten is laat het scherm eruitzien alsof er geen periode bestaat. */}
        {maanden.length > 0 && (
          <div className="admin-page-head__actions">
            <label className="usg-periode">
              <span className="usg-periode__lbl">Periode</span>
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
            </label>
          </div>
        )}
      </header>

      {fout && (
        <div className="users-form__notice users-form__notice--error">
          <strong>Fout bij ophalen:</strong> {fout}
        </div>
      )}

      {!fout && (
        <div className="users-card">
          <table className="users-table usg-table">
            <thead>
              <tr>
                <th>Wie</th>
                <th className="is-right" title="Chatvragen die aan deze regel gekoppeld konden worden.">Vragen</th>
                <th className="is-right" title="Geschatte kosten in dollar — zo staat het in rag_chat_query_log.">Verbruik chat</th>
                {/* v1.198 — de tweede post die de rem meetelt. Apart in beeld en
                    niet opgeteld bij de chat: het zijn twee bronnen met elk een
                    eigen dekking, en optellen verbergt welke van de twee een gat
                    heeft. */}
                <th className="is-right" title="Taalcheck, transcribe, kb-compose, mail-verbeteraar, spelcheck — uit model_usage_log.">
                  Verbruik overig
                </th>
                {/* De rem geldt voor iedereen behálve de owner, en dat staat
                    één keer in de kop. Als pil op elke rij zegt hetzelfde
                    bericht zeven keer en gaat het juist níet meer op. */}
                <th className="is-right" title="Maandplafond. Standaard €50; klik op een bedrag om het te wijzigen. Chat + overig samen worden hiertegen gehouden.">
                  Plafond
                  <span className="usg-th-sub">geldt niet voor de owner</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {regels.map(r => {
                const klikbaar = r.soort === 'persoon' && r.kosten !== null
                return (
                  <tr
                    key={r.id}
                    className={[
                      'usg-rij',
                      r.soort === 'maestro' ? 'usg-maestro' : '',
                      r.soort === 'gat' ? 'usg-gat' : '',
                      openPersoon === r.user_id ? 'is-open' : '',
                      r.soort === 'persoon' && r.kosten === null ? 'is-leeg' : '',
                    ].filter(Boolean).join(' ')}
                    onClick={() => klikbaar && setOpenPersoon(r.user_id)}
                    title={r.soort !== 'persoon'
                      ? undefined
                      : klikbaar
                        ? `De ${r.vragen} vragen van ${r.name} bekijken`
                        : 'Geen gemeten vragen van deze persoon — er valt niets open te klappen.'}
                  >
                    <td>
                      <div className="usg-person">
                        <span className={`usg-av ${r.soort === 'maestro' ? 'is-systeem' : ''} ${r.soort === 'gat' ? 'is-gat' : ''} ${r.role === 'owner' ? 'is-owner' : ''}`}>
                          {r.soort === 'maestro' ? 'M' : r.soort === 'gat' ? '?' : getInitials(r.name || r.email)}
                        </span>
                        <span className="usg-person__txt">
                          <span className="usg-person__n">{r.name}</span>
                          <span className="usg-person__m">{r.sub}</span>
                        </span>
                      </div>
                    </td>
                    <td className="is-right">
                      {r.soort === 'persoon' && r.kosten === null
                        ? <span className="usg-none" title="Geen enkele vraag van deze persoon is in deze maand gemeten.">—</span>
                        : <span className={klikbaar ? 'usg-klik' : ''}>{r.vragen}</span>}
                    </td>
                    <td className="is-right">
                      {r.soort === 'persoon' && r.kosten === null
                        ? <span className="usg-none" title="Niet gemeten — dat is iets anders dan nul.">niet gemeten</span>
                        : <b>{usd(r.kosten || 0)}</b>}
                    </td>
                    <td className="is-right">
                      {r.soort !== 'persoon'
                        ? <span className="usg-none" title="Het grootboek van de Edge Functions kent alleen personen — Maestro draait op de service-role en heeft geen sessie.">—</span>
                        : r.edgeKosten === null
                          ? <span className="usg-none" title="Nog geen betaalde Edge-Function-call van deze persoon in deze maand gemeten.">niet gemeten</span>
                          : <b title={`${r.edgeCalls} call(s)`}>{usd(r.edgeKosten)}</b>}
                    </td>
                    <td className="is-right">
                      {r.cap === null
                        ? <span className="usg-none" title="Een meetgat heeft geen plafond: deze vragen horen bij iemand, alleen weten we niet bij wie.">—</span>
                        : (
                          <button
                            type="button"
                            className="usg-capbtn"
                            onClick={e => { e.stopPropagation(); setCapRegel(r) }}
                            title={`Maandplafond van ${r.name} wijzigen (nu ${eur(r.cap)}).`}
                          >
                            {eur(r.cap)}
                            {r.paused && <span className="usg-sub usg-sub--warn">gepauzeerd</span>}
                            {!r.paused && !r.capExpliciet && <span className="usg-sub">standaard</span>}
                            {!r.paused && r.capExpliciet && <span className="usg-sub usg-sub--eigen">eigen</span>}
                          </button>
                        )}
                    </td>
                  </tr>
                )
              })}
            </tbody>

            {/* De noemer, als voetregel in plaats van als gele balk bovenaan.
                Hij komt uit dezelfde view als de regels erboven, dus het
                verschil tussen deze som en de regels is zichtbaar in plaats van
                beweerd. */}
            {dekking && (
              <tfoot>
                <tr className="usg-totaal">
                  <td>
                    <span className="usg-person__n">Totaal gemeten</span>
                    <span className="usg-person__m">
                      alle chatvragen in {maandLabel(actieveMaand)} — evalrondes niet meegeteld
                    </span>
                  </td>
                  <td className="is-right">{dekking.vragen_totaal}</td>
                  <td className="is-right"><b>{usd(dekking.usd_totaal || 0)}</b></td>
                  {/* Bewust geen som van de overig-kolom: `v_model_usage_dekking`
                      gaat alleen over de chat, dus een totaal hier zou twee
                      noemers door elkaar halen. */}
                  <td className="is-right"><span className="usg-none">—</span></td>
                  <td className="is-right"><span className="usg-none">—</span></td>
                </tr>
              </tfoot>
            )}
          </table>
        </div>
      )}

      {!fout && !busy && !dekking && (
        <p className="usg-leeg">
          Geen gemeten model-calls in {maandLabel(actieveMaand)}. Dat is een lege meting,
          geen nul — kies een andere periode om te vergelijken.
        </p>
      )}

      {persoonOpen && (
        <UsageDetail
          person={persoonOpen}
          maand={actieveMaand}
          loadDetail={loadDetail}
          onClose={() => setOpenPersoon(null)}
        />
      )}

      {capRegel && (
        <UsageCapModal
          regel={capRegel}
          onClose={() => setCapRegel(null)}
          onSave={waarde => bewaarCap(capRegel, waarde)}
        />
      )}

      <UsageNote koers={koers} />
    </div>
  )
}
