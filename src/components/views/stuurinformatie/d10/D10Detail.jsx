import { useMemo } from 'react'
import DetailPaneel from '../../../ui/DetailPaneel'
import WorkTable from '../../../ui/WorkTable'
import { getal, datumKort, bereik } from '../format'
import { recordsVoor, LIJSTEN, dossierVan } from './d10sneden'

/**
 * D10Detail — zone 4. De records achter de regel die links gekozen is.
 *
 * **Hier komt de dossierlaag terug** (Research 1 §E4). v1.178 haalde de
 * maandgroepen-tabel van `/klantverlies` af omdat hij over de volle breedte
 * stond en het bord onleesbaar maakte; de dossiers zelf waren daarmee ook weg.
 * Ze staan nu waar ze horen: achter een regel, in het paneel, vier kolommen
 * breed. De AI-samenvatting en de eigen notitie blijven op
 * `/klantverlies/:dealId` — dat is een deeplink, geen tweede bord.
 *
 * Twee dingen die dit paneel eerlijk houden:
 *
 *  1. **Een record zonder dossier zegt dat.** De churn-agent loopt soms achter;
 *     een lege samenvatting tonen als "geen reden" zou de achterstand van de
 *     agent als een eigenschap van de klant presenteren.
 *  2. **De voetnoot telt altijd `n van m`.** Loopt de lijst uiteen met de
 *     telling van de regel links, dan is dat zichtbaar in plaats van stil.
 */

/** Kantoor · start · dagen · HubSpot — de vier kolommen uit het ontwerplock. */
const LIJST_KOLOMMEN = [
  { key: 'klant', label: 'Kantoor', breedte: 'minmax(0, 1fr)', klasse: 'wt__naam',
    render: r => r.klant || r.dealname || '(zonder naam)' },
  { key: 'startdatum', label: 'Start', breedte: '86px', klasse: 'wt__mono',
    render: r => datumKort(r.startdatum) || '—' },
  { key: 'dagen', label: 'Dgn', breedte: '48px', klasse: 'wt__rechts',
    render: r => (r.dagen_te_gaan == null ? '—' : getal(Math.abs(r.dagen_te_gaan))) },
  { key: 'link', label: '', breedte: '20px', klasse: 'wt__ext',
    render: r => (r.hubspot_url
      ? <a href={r.hubspot_url} target="_blank" rel="noreferrer" title="Open in HubSpot">↗</a>
      : null) },
]

/** Verlies-records: dezelfde vorm, maar met de verliesdatum en het dossier. */
function verliesKolommen(dossiers, onDossier) {
  return [
    { key: 'klant', label: 'Kantoor', breedte: 'minmax(0, 1fr)', klasse: 'wt__naam',
      render: r => (
        <button type="button" className="d10-recordlink" onClick={() => onDossier(r)}>
          {r.klant || r.dealname || '(zonder naam)'}
          {r.grensgeval && <span className="d10-grens" title="Ligt binnen de marge van de B/C-duurgrens — één administratieve slordigheid verplaatst dit record van soort">grens</span>}
        </button>
      ) },
    { key: 'soort', label: 'Soort', breedte: '30px', klasse: 'wt__mono',
      render: r => r.soort },
    { key: 'verliesdatum', label: 'Verloren', breedte: '86px', klasse: 'wt__mono',
      render: r => datumKort(r.verliesdatum) || '—' },
    { key: 'dagen', label: 'Dgn', breedte: '48px', klasse: 'wt__rechts',
      render: r => (r.dagen_tot_verlies == null ? '—' : getal(r.dagen_tot_verlies)) },
    { key: 'link', label: '', breedte: '20px', klasse: 'wt__ext',
      render: r => (r.hubspot_url
        ? <a href={r.hubspot_url} target="_blank" rel="noreferrer" title="Open in HubSpot">↗</a>
        : null) },
  ]
}

const LEEG = 'Kies een regel. De kantoren erachter komen hier te staan, met een link naar HubSpot en naar het dossier.'

/** A · 1 · B · 5 · C · 0 — de drie soorten náást elkaar, nooit als som. */
function splitsing(records) {
  return ['A', 'B', 'C']
    .map(s => `${s} ${getal(records.filter(r => r.soort === s).length)}`)
    .join(' · ')
}

export default function D10Detail({ data, snede, gekozen, onDossier }) {
  const records = useMemo(() => recordsVoor(snede, gekozen, data), [snede, gekozen, data])

  if (!gekozen) return <DetailPaneel leegTekst={LEEG} />

  // ── De twee vragen die vandaag niet te beantwoorden zijn ───────────────────
  // Ze krijgen een paneel en geen tooltip: een lege plek is het argument voor
  // de bron, en dat argument heeft ruimte nodig om gelezen te worden.
  if (gekozen.soort === 'leeg') {
    const dekking = data.meta?.companies_zichtbaar
      ? `${getal(data.meta.companies_met_omvang)} van ${getal(data.meta.companies_zichtbaar)} kantoren`
      : 'een fractie van de mirror'

    return (
      <DetailPaneel
        titel="Niet te maken · 2 lijsten"
        sub={<>geen van beide ontbreekt door een keuze op dít bord — het zijn twee bronnen die er niet zijn</>}
        voet={<>Beide staan ook achter <b>Wat ontbreekt</b> in de vertrouwensregel hieronder.</>}
      >
        <div className="d10-leegplek">
          <span className="d10-leegplek__kop">Segment · kantoorgrootte</span>
          <p>
            Segmentatie vraagt <code>totale_omvang</code> op de company, en dat veld staat op {dekking}.
            Dezelfde lege plek staat op het pipelinebord — één veld, drie borden.
          </p>
        </div>
        <div className="d10-leegplek">
          <span className="d10-leegplek__kop">Early-warning · dalend gebruik</span>
          <p>
            Een lijst van klanten met dalend gebruik vraagt gebruiksdata, en die is in dit project
            nergens ontsloten. De lijst blijft als lege plek staan: dat is het argument voor de
            koppeling, niet een reden om de vraag te verbergen.
          </p>
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
        sub={<>eigenaar <b>CS</b> · <b>↗</b> gaat naar HubSpot · deze deals lopen nog, er is geen dossier</>}
        voet={
          <>
            {getal(records.length)} van {getal(gekozen.n)} getoond · {lijst?.dagenTekst}.
            {gekozen.id.startsWith('proef') && ' Een afgeleide einddatum staat als zodanig gemerkt.'}
          </>
        }
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

  return (
    <DetailPaneel
      titel={`${gekozen.naam} · ${getal(records.length)} ${records.length === 1 ? 'record' : 'records'}`}
      sub={<>klik het kantoor voor het dossier · <b>↗</b> gaat naar HubSpot</>}
      voet={
        <>
          {/* Een maand draagt drie soorten en dus geen enkele noemer: A is
              pipeline, B is proef, C is churn. De splitsing staat er daarom
              uitgeschreven — een totaal zou hier de optelling zijn die dit bord
              verbiedt. Een reden- of duurregel heeft wél één noemer, en die
              komt uit de view. */}
          {snede === 'trend'
            ? <>{getal(records.length)} records · {splitsing(records)}</>
            : <>{getal(records.length)} van {getal(gekozen.noemer ?? gekozen.n ?? records.length)} getoond</>}
          {zonderDossier > 0 && <> · {getal(zonderDossier)} zonder dossier</>}
          {grens > 0 && <> · {getal(grens)} op de B/C-grens</>}
          . Dossier met AI-samenvatting en eigen notitie op <b>/klantverlies/:dealId</b> — als
          deeplink, niet als tweede bord.
        </>
      }
    >
      <WorkTable
        kolommen={verliesKolommen(data.dossiers, onDossier)}
        rijen={records}
        sleutel={r => r.deal_id}
        leegTekst="Geen records achter deze regel."
        rijTitel={r => {
          const d = dossierVan(r, data.dossiers)
          return [
            r.soort_label,
            r.duur_grondslag,
            r.datum_bron ? `verliesdatum uit ${r.datum_bron}` : null,
            d?.churn_summary ? d.churn_summary.slice(0, 220) : 'nog geen AI-samenvatting',
          ].filter(Boolean).join(' · ')
        }}
      />
    </DetailPaneel>
  )
}
