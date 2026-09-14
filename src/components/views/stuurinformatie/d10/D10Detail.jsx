import { useMemo } from 'react'
import DetailPaneel from '../../../ui/DetailPaneel'
import WorkTable from '../../../ui/WorkTable'
import Verdeling from '../../../ui/charts/Verdeling'
import { getal, datumKort, bereik } from '../format'
import { recordsVoor, LIJSTEN, dossierVan, periodeKort } from './d10sneden'

/**
 * D10Detail — zone 4. De records achter de regel die links gekozen is.
 *
 * **Hier komt de dossierlaag terug** (Research 1 §E4): achter een regel, in
 * het paneel, vier kolommen breed. De AI-samenvatting en de eigen notitie
 * blijven op `/klantverlies/:dealId` — een deeplink, geen tweede bord.
 *
 * **Snede wanneer draagt hier C9** (v1.187, chart-catalogus §C9 "zone 4: de
 * spreiding achter één snede-regel"): de puntenrij of het histogram over exact
 * de records die de tabel eronder toont, met de mediaan uit de view en de
 * B/C-duurgrens als norm (L1, herkomst dash_parameters). Dat is de grootste
 * inhoudelijke winst op dit bord — de vraag is waar in de klantreis het
 * misgaat, en dat is een verdeling, geen getal.
 *
 * Nul lopende tekst in deze zone (woordbudget): koppen, kolommen, telegram.
 */

const LIJST_KOLOMMEN = [
  { key: 'klant', label: 'Kantoor', breedte: 'minmax(0, 1fr)', klasse: 'wt__naam', render: r => r.klant || r.dealname || '(zonder naam)' },
  { key: 'startdatum', label: 'Start', breedte: '86px', klasse: 'wt__mono', render: r => datumKort(r.startdatum) || '—' },
  { key: 'dagen', label: 'Dgn', breedte: '48px', klasse: 'wt__rechts', render: r => (r.dagen_te_gaan == null ? '—' : getal(Math.abs(r.dagen_te_gaan))) },
  { key: 'link', label: '', breedte: '20px', klasse: 'wt__ext', render: r => (r.hubspot_url ? <a href={r.hubspot_url} target="_blank" rel="noreferrer" title="Open in HubSpot">↗</a> : null) },
]

function verliesKolommen(onDossier) {
  return [
    { key: 'klant', label: 'Kantoor', breedte: 'minmax(0, 1fr)', klasse: 'wt__naam',
      render: r => (
        <button type="button" className="d10-recordlink" onClick={() => onDossier(r)}>
          {r.klant || r.dealname || '(zonder naam)'}
          {r.grensgeval && <span className="d10-grens" title="Binnen de marge van de B/C-duurgrens — één administratieve slordigheid verplaatst dit record van soort">grens</span>}
        </button>
      ) },
    { key: 'soort', label: 'Soort', breedte: '30px', klasse: 'wt__mono', render: r => r.soort },
    { key: 'verliesdatum', label: 'Verloren', breedte: '86px', klasse: 'wt__mono', render: r => datumKort(r.verliesdatum) || '—' },
    { key: 'dagen', label: 'Dgn', breedte: '48px', klasse: 'wt__rechts', render: r => (r.dagen_tot_verlies == null ? '—' : getal(r.dagen_tot_verlies)) },
    { key: 'link', label: '', breedte: '20px', klasse: 'wt__ext', render: r => (r.hubspot_url ? <a href={r.hubspot_url} target="_blank" rel="noreferrer" title="Open in HubSpot">↗</a> : null) },
  ]
}

const LEEG = 'Kies een regel links · de kantoren erachter komen hier, met dossier en HubSpot-link.'

/** A · 1 · B · 5 · C · 0 — de drie soorten náást elkaar, nooit als som. */
const splitsing = records => ['A', 'B', 'C'].map(s => `${s} ${getal(records.filter(r => r.soort === s).length)}`).join(' · ')

export default function D10Detail({ data, snede, periode, gekozen, onDossier }) {
  const records = useMemo(() => recordsVoor(snede, gekozen, data, periode), [snede, gekozen, data, periode])

  if (!gekozen) return <DetailPaneel leegTekst={LEEG} />

  // ── De twee vragen die vandaag niet te beantwoorden zijn ───────────────────
  if (gekozen.soort === 'leeg') {
    const dekking = data.meta?.companies_zichtbaar
      ? `${getal(data.meta.companies_met_omvang)} van ${getal(data.meta.companies_zichtbaar)} kantoren`
      : 'een fractie van de mirror'
    return (
      <DetailPaneel
        titel="Niet te maken · 2 lijsten"
        sub={<>twee bronnen die er niet zijn · geen keuze op dit bord</>}
        voet={<>Beide ook achter <b>Wat ontbreekt</b> in de vertrouwensregel.</>}
      >
        <div className="d10-leegplek">
          <span className="d10-leegplek__kop">Segment · kantoorgrootte</span>
          <p><code>totale_omvang</code> op {dekking} · zelfde gat als op D1 · één veld, drie borden</p>
        </div>
        <div className="d10-leegplek">
          <span className="d10-leegplek__kop">Early-warning · dalend gebruik</span>
          <p>gebruiksdata nergens ontsloten · de lege plek is het argument voor de koppeling</p>
        </div>
      </DetailPaneel>
    )
  }

  // ── Een CS-lijst: levende deals, geen dossier ─────────────────────────────
  if (snede === 'wie') {
    const lijst = LIJSTEN.find(l => l.id === gekozen.id)
    return (
      <DetailPaneel
        titel={`${gekozen.naam} · ${getal(records.length)} ${records.length === 1 ? 'kantoor' : 'kantoren'}`}
        sub={<>eigenaar <b>CS</b> · <b>↗</b> HubSpot · lopende deals, geen dossier · stand van vandaag</>}
        voet={<>{getal(records.length)} van {getal(gekozen.n)} getoond · {lijst?.dagenTekst}{gekozen.id.startsWith('proef') && ' · afgeleide einddatum gemerkt'}</>}
      >
        <WorkTable
          kolommen={LIJST_KOLOMMEN}
          rijen={records}
          sleutel={r => r.deal_id}
          leegTekst={lijst?.leeg || 'Deze lijst is leeg — dat is een gemeten nul.'}
          rijTitel={r => [
            r.eigenaar || 'zonder eigenaar',
            r.einddatum ? `einde ${datumKort(r.einddatum)}` : null,
            r.einddatum_bron === 'afgeleid' ? 'einddatum afgeleid uit startdatum + looptijd' : null,
            r.verlengingsmoment ? `contractjaar rond ${datumKort(r.verlengingsmoment)}` : null,
            bereik(r.waarde_bodem, r.waarde_plafond) ? `${bereik(r.waarde_bodem, r.waarde_plafond)} per maand` : null,
          ].filter(Boolean).join(' · ')}
        />
      </DetailPaneel>
    )
  }

  // ── Verlies-records: hier hángt het dossier achter ─────────────────────────
  const zonderDossier = records.filter(r => !dossierVan(r, data.dossiers)).length
  const grens = records.filter(r => r.grensgeval).length
  const venster = periodeKort(periode)

  // C9 alleen achter een duurregel; de norm (L1) geldt voor B en C, want A
  // meet een andere grondslag (aanmaak → verliesstage) dan de B/C-duurgrens.
  const k = snede === 'wanneer' ? gekozen.kop : null
  const norm = k && k.soort !== 'A' && data.meta?.duurgrens_dagen != null ? Number(data.meta.duurgrens_dagen) : null

  return (
    <DetailPaneel
      titel={`${gekozen.naam} · ${getal(records.length)} ${records.length === 1 ? 'record' : 'records'}`}
      sub={<>{venster} · klik het kantoor voor het dossier · <b>↗</b> HubSpot</>}
      voet={
        <>
          {/* Een maand draagt drie soorten en dus geen enkele noemer; de
              splitsing staat uitgeschreven — een totaal zou de optelling zijn
              die dit bord verbiedt. */}
          {snede === 'trend'
            ? <>{getal(records.length)} records · {splitsing(records)}</>
            : snede === 'wanneer'
              ? <>{getal(records.length)} {venster} · {getal(k?.totaal)} in totaal</>
              : <>{getal(records.length)} van {getal(gekozen.noemer ?? gekozen.n ?? records.length)} getoond</>}
          {zonderDossier > 0 && <> · {getal(zonderDossier)} zonder dossier</>}
          {grens > 0 && <> · {getal(grens)} op de B/C-grens</>}
          {' '}· dossier op <b>/klantverlies/:dealId</b>
        </>
      }
    >
      {k && (
        <Verdeling
          waarden={records.map(r => r.dagen_tot_verlies).filter(v => v != null)}
          mediaan={k.duur_mediaan}
          eenheid="dagen"
          norm={norm}
          normLabel="B/C-grens · dash_parameters"
          titel={`tijd tot verlies ${k.soort}`}
          onderschrift={
            k.duur_mediaan == null
              ? <>{getal(k.totaal)} records zonder duur · <b>{k.duur_grondslag}</b></>
              : <><b>mediaan {getal(Math.round(k.duur_mediaan))} dagen</b> · bereik {getal(k.duur_min)}–{getal(k.duur_max)} · gem. {getal(Math.round(k.duur_gemiddeld))} · {k.duur_grondslag}{k.grensgevallen > 0 && <> · <b>{getal(k.grensgevallen)}</b> op de grens</>}</>
          }
        />
      )}
      <WorkTable
        kolommen={verliesKolommen(onDossier)}
        rijen={records}
        sleutel={r => r.deal_id}
        leegTekst="Geen records achter deze regel in dit venster."
        rijTitel={r => {
          const d = dossierVan(r, data.dossiers)
          return [r.soort_label, r.duur_grondslag, r.datum_bron ? `verliesdatum uit ${r.datum_bron}` : null,
            d?.churn_summary ? d.churn_summary.slice(0, 220) : 'nog geen AI-samenvatting'].filter(Boolean).join(' · ')
        }}
      />
    </DetailPaneel>
  )
}
