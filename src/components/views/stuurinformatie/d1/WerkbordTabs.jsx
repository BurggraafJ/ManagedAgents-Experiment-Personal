import { useState } from 'react'
import WorkTable from '../../../ui/WorkTable'
import { getal, euroKort, bereik, datumKort } from './format'

const MAX_REGELS = 100

/**
 * Het werkbord van D1: vier lijsten waar Jay morgenochtend mee aan de slag kan.
 *
 * De tabs komen uit `v_d1_werkbord_tellers` en niet uit een lijst in deze
 * component. Dat is met opzet: een lijst die leeg is levert nul regels in
 * `v_d1_werkbord`, en zou de tab dan uit beeld verdwijnen, dan zag je het
 * verschil niet tussen "opgeruimd" en "niet gemeten". Nu staat er
 * "Verlopen beslisdatum 0" — een gemeten nul.
 *
 * Elke regel draagt een eigenaar en een deeplink naar HubSpot; dat is de hele
 * bedoeling van een werkbord (per-dashboard.md: "een werkbord eindigt in een
 * handeling, niet in een inzicht").
 */
export default function WerkbordTabs({ werkbordTellers, werkbord }) {
  const tabs = werkbordTellers || []
  const [actief, setActief] = useState(null)
  const huidig = actief || tabs[0]?.lijst
  const tab = tabs.find(t => t.lijst === huidig)
  const rijen = (werkbord || []).filter(r => r.lijst === huidig)

  if (tabs.length === 0) return null

  const kolommen = [
    {
      key: 'dealname',
      label: 'Deal',
      breedte: 'minmax(180px, 1.6fr)',
      klasse: 'wt__naam',
      render: r => (
        <>
          {r.dealname || '(zonder naam)'}
          <span className="wt__meta"> · {r.fase_label || r.stage_label || '—'}</span>
        </>
      ),
    },
    {
      key: 'reden',
      label: 'Wat ontbreekt',
      breedte: 'minmax(200px, 1.8fr)',
      klasse: 'wt__zacht',
      render: r => r.reden || '—',
    },
    {
      key: 'eigenaar',
      label: 'Eigenaar',
      breedte: 'minmax(120px, .9fr)',
      render: r => r.eigenaar || <span className="wt__letop">zonder eigenaar</span>,
    },
    {
      key: 'beslisdatum',
      label: 'Beslisdatum',
      breedte: '110px',
      klasse: 'wt__zacht',
      render: r => r.beslisdatum
        ? datumKort(r.beslisdatum)
        : <span className="wt__leegwaarde">geen</span>,
    },
    {
      key: 'waarde',
      label: 'Bodem – plafond',
      breedte: 'minmax(130px, 1fr)',
      klasse: 'wt__zacht',
      render: r => bereik(r.mrr_bodem, r.mrr_plafond, euroKort)
        || <span className="wt__leegwaarde">niet te waarderen</span>,
    },
    {
      key: 'dagen_open',
      label: 'Dagen open',
      breedte: '92px',
      klasse: 'wt__getal',
      render: r => getal(r.dagen_open),
    },
    {
      key: 'hubspot_url',
      label: 'HubSpot',
      breedte: '80px',
      klasse: 'wt__link',
      render: r => <a href={r.hubspot_url} target="_blank" rel="noreferrer">openen ↗</a>,
    },
  ]

  return (
    <section className="d1-blok d1-wb">
      <header className="d1-blok__kop">
        <div>
          <h3 className="d1-blok__titel">Werkbord</h3>
          <p className="d1-blok__intro">
            Eén deal kan op meerdere lijsten staan — het zijn vier handelingen, geen vier categorieën.
            Voor het aantal déals met een blokkerende fout staat het getal in de datastatus hieronder.
          </p>
        </div>
        <div className="d1-wb__tabs" role="tablist">
          {tabs.map(t => (
            <button
              key={t.lijst}
              type="button"
              role="tab"
              aria-selected={huidig === t.lijst}
              className={`d1-tab${huidig === t.lijst ? ' is-actief' : ''}${t.aantal === 0 ? ' is-schoon' : ''}`}
              onClick={() => setActief(t.lijst)}
              title={t.toelichting || undefined}
            >
              {t.lijst_label}
              <span className="d1-tab__telling">{getal(t.aantal)}</span>
            </button>
          ))}
        </div>
      </header>

      {tab?.toelichting && <p className="d1-wb__definitie">{tab.toelichting}</p>}

      <WorkTable
        kolommen={kolommen}
        rijen={rijen}
        sleutel={r => `${r.lijst}-${r.deal_id}`}
        maximum={MAX_REGELS}
        leegTekst={`Geen deals op deze lijst. “${tab?.lijst_label || 'Deze lijst'}” staat op nul — dat is een gemeten nul, geen ontbrekende meting.`}
      />
    </section>
  )
}
