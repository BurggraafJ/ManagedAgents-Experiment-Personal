import { useState } from 'react'
import WorkTable from '../../ui/WorkTable'
import { getal, bereik, datumKort } from '../stuurinformatie/format'

/**
 * VerliesWerkbord — de CS-kant van D10: niet wie we kwijt zijn, maar wie op het
 * punt staat te vertrekken.
 *
 * De volgorde van de vier lijsten volgt de meting, niet de gewoonte. Het
 * klassieke retentiewerkbord begint bij het verlengingsmoment; hier zitten
 * negentien van de twintig verliezen in de proef, dus beginnen de proeven
 * bovenaan. "Proef voorbij, nog geen besluit" is de scherpste lijst die dit
 * project vandaag kan maken.
 *
 * Twee dingen die de lijsten eerlijk houden:
 *
 *  1. **Een lege lijst is een gemeten nul.** De tellers staan altijd alle vier
 *     op het scherm, ook op nul, en een lege tab zegt dat met zoveel woorden.
 *     Een tab die verdwijnt omdat hij leeg is, verliest het verschil tussen
 *     "opgeruimd" en "niet gemeten".
 *  2. **Een afgeleide einddatum draagt een merk.** Tien van de zeventien
 *     proeven hebben geen `einddatum`; voor die tien is het einde berekend uit
 *     `startdatum + looptijd_proefperiode_maanden`. Dat staat als badge in de
 *     cel en niet stilletjes in dezelfde kolom als het echte veld.
 */
const LIJSTEN = [
  {
    id: 'proef_voorbij',
    label: 'Proef voorbij, nog geen besluit',
    bron: 'proeven',
    filter: r => r.status === 'verlopen',
    leeg: 'Geen enkele proef staat over zijn einddatum. Dat is de bedoeling.',
    uitleg: 'De proef is voorbij en de deal staat nog in Proeftijd. Hier valt een besluit te nemen — of het is al genomen en niet vastgelegd.',
  },
  {
    id: 'proef_bijna',
    label: 'Proef eindigt < 30 dagen',
    bron: 'proeven',
    filter: r => r.status === 'binnen_30',
    leeg: 'Geen proef eindigt binnen dertig dagen.',
    uitleg: 'Het gesprek over omzetten begint ruim vóór de einddatum, niet erop.',
  },
  {
    id: 'verleng_90',
    label: 'Verlengmoment < 90 dagen',
    bron: 'verlenging',
    filter: r => r.status === 'binnen_90',
    leeg: 'Geen contractjaar loopt binnen negentig dagen af.',
    uitleg: 'Verlengingsmoment = startdatum + 12 maanden. HubSpot kent geen verlengingsdatum; dit is een berekening op één veld.',
  },
  {
    id: 'verleng_verstreken',
    label: 'Verlengmoment verstreken',
    bron: 'verlenging',
    filter: r => r.status === 'verstreken',
    leeg: 'Bij elke actieve klant ligt het eerste contractjaar nog voor ons.',
    uitleg: 'Het eerste contractjaar is voorbij en er staat geen nieuwe datum in HubSpot. Dat is een datavraag aan CS, geen klant zonder verlenging.',
  },
]

function BronBadge({ bron }) {
  if (bron !== 'afgeleid') return null
  return <span className="d10-badge" title="Berekend uit startdatum + looptijd_proefperiode_maanden — niet ingevuld in HubSpot">afgeleid</span>
}

const KOLOMMEN_PROEF = [
  { key: 'klant', label: 'Klant', breedte: '2fr' },
  { key: 'startdatum', label: 'Gestart', breedte: '1fr', render: r => datumKort(r.startdatum) || '—' },
  {
    key: 'einddatum', label: 'Einde proef', breedte: '1.2fr',
    render: r => (
      <>{datumKort(r.einddatum) || '—'} <BronBadge bron={r.einddatum_bron} /></>
    ),
  },
  {
    key: 'dagen_te_gaan', label: 'Dagen', breedte: '0.8fr', klasse: 'wt__cel--num',
    render: r => r.dagen_te_gaan == null ? '—' : (r.dagen_te_gaan < 0 ? `${getal(-r.dagen_te_gaan)} over` : getal(r.dagen_te_gaan)),
  },
  {
    key: 'waarde', label: 'Contractwaarde p/m', breedte: '1.4fr',
    render: r => bereik(r.waarde_bodem, r.waarde_plafond) || '—',
  },
  { key: 'eigenaar', label: 'Eigenaar', breedte: '1.2fr', render: r => r.eigenaar || 'zonder eigenaar' },
  {
    key: 'link', label: '', breedte: '0.6fr',
    render: r => <a className="d10-link" href={r.hubspot_url} target="_blank" rel="noreferrer">HubSpot ↗</a>,
  },
]

const KOLOMMEN_VERLENG = [
  { key: 'klant', label: 'Klant', breedte: '2fr' },
  { key: 'startdatum', label: 'Gestart', breedte: '1fr', render: r => datumKort(r.startdatum) || '—' },
  { key: 'verlengingsmoment', label: 'Contractjaar rond', breedte: '1.2fr', render: r => datumKort(r.verlengingsmoment) || '—' },
  {
    key: 'dagen_te_gaan', label: 'Dagen', breedte: '0.8fr', klasse: 'wt__cel--num',
    render: r => r.dagen_te_gaan == null ? '—' : (r.dagen_te_gaan < 0 ? `${getal(-r.dagen_te_gaan)} over` : getal(r.dagen_te_gaan)),
  },
  {
    key: 'waarde', label: 'Contractwaarde p/m', breedte: '1.4fr',
    render: r => bereik(r.waarde_bodem, r.waarde_plafond) || '—',
  },
  { key: 'eigenaar', label: 'Eigenaar', breedte: '1.2fr', render: r => r.eigenaar || 'zonder eigenaar' },
  {
    key: 'link', label: '', breedte: '0.6fr',
    render: r => <a className="d10-link" href={r.hubspot_url} target="_blank" rel="noreferrer">HubSpot ↗</a>,
  },
]

export default function VerliesWerkbord({ proeven, verlenging }) {
  const [actief, setActief] = useState(LIJSTEN[0].id)

  const rijenVoor = (lijst) => (lijst.bron === 'proeven' ? proeven : verlenging).filter(lijst.filter)
  const huidig = LIJSTEN.find(l => l.id === actief) || LIJSTEN[0]
  const rijen = rijenVoor(huidig)

  return (
    <section className="d10-blok">
      <div className="d10-blok__kop">
        <h3 className="d10-blok__titel">Werkbord Customer Success — wie staat op het punt te vertrekken?</h3>
      </div>

      <div className="d10-tabs">
        {LIJSTEN.map(l => {
          const n = rijenVoor(l).length
          return (
            <button
              key={l.id}
              type="button"
              className={`d10-tab ${l.id === actief ? 'is-actief' : ''}`}
              onClick={() => setActief(l.id)}
            >
              {l.label}
              <span className="d10-tab__n">{getal(n)}</span>
            </button>
          )
        })}
      </div>

      <p className="d10-voetnoot d10-voetnoot--tab">{huidig.uitleg}</p>

      <WorkTable
        kolommen={huidig.bron === 'proeven' ? KOLOMMEN_PROEF : KOLOMMEN_VERLENG}
        rijen={rijen}
        sleutel={r => r.deal_id}
        leegTekst={huidig.leeg}
        maximum={20}
      />
    </section>
  )
}
