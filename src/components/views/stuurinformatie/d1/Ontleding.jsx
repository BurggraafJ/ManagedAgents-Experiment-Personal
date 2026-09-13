import { useState } from 'react'
import { getal, euroKort, bereik } from '../format'

const SNEDES = [
  { id: 'fase',     label: 'Fase' },
  { id: 'stage',    label: 'Stage' },
  { id: 'eigenaar', label: 'Eigenaar' },
]

/**
 * Ontleding — dezelfde 32 open deals, drie keer anders gesneden.
 *
 * De vierde knop, **Segment (kantoorgrootte), staat er bewust bij en is
 * bewust uit.** `totale_omvang` staat op een fractie van de companies en de
 * HubSpot-ETL synchroniseert maximaal 2.000 companies per ronde, dus een
 * segment-ontleding zou op een paar procent van de basis rusten. De lege plek
 * mét reden is het argument voor dat veld; hem weglaten zou de vraag elk
 * kwartaal opnieuw oproepen (bouwproces.md, Rolverdeling).
 *
 * Geen ranglijst-framing op de eigenaar-snede: dit is een werkverdeling, geen
 * scorebord (onderzoek §4.8).
 */
export default function Ontleding({ ontleding, meta }) {
  const [snede, setSnede] = useState('fase')

  const rijen = (ontleding || [])
    .filter(r => r.snede === snede)
    .sort((a, b) => (a.volgnummer - b.volgnummer) || (b.aantal - a.aantal))

  const maxAantal = Math.max(1, ...rijen.map(r => r.aantal || 0))
  const segmentDekking = meta
    ? `${getal(meta.companies_met_omvang)} van ${getal(meta.companies_zichtbaar)} companies draagt kantoorgrootte`
    : 'kantoorgrootte ontbreekt op de company'

  return (
    <section className="d1-blok d1-ont">
      <header className="d1-blok__kop">
        <div>
          <h3 className="d1-blok__titel">Ontleding</h3>
          <p className="d1-blok__intro">
            Dezelfde open deals, anders gesneden. Aantallen zijn absoluut; de euro's dekken alleen de
            deals die minimumafname, contractomvang én prijs dragen.
          </p>
        </div>
        <div className="d1-ont__tabs" role="tablist">
          {SNEDES.map(s => (
            <button
              key={s.id}
              type="button"
              role="tab"
              aria-selected={snede === s.id}
              className={`d1-tab${snede === s.id ? ' is-actief' : ''}`}
              onClick={() => setSnede(s.id)}
            >
              {s.label}
            </button>
          ))}
          <button
            type="button"
            className="d1-tab d1-tab--uit"
            disabled
            title={`Niet beschikbaar: ${segmentDekking}. De company-sync haalt bovendien maximaal 2.000 companies per ronde op.`}
          >
            Segment
            <span className="d1-tab__reden">kantoorgrootte ontbreekt</span>
          </button>
        </div>
      </header>

      <div className="d1-ont__lijst">
        {rijen.length === 0 && (
          <div className="d1-ont__leeg">Geen open deals in deze snede.</div>
        )}
        {rijen.map(r => (
          <div key={`${r.snede}-${r.sleutel}`} className={`d1-ont__rij${r.aantal ? '' : ' is-nul'}`}>
            <span className="d1-ont__label">{r.label}</span>
            <span className="d1-ont__balk">
              <span
                className="d1-ont__vulling"
                style={{ width: `${Math.round(((r.aantal || 0) / maxAantal) * 100)}%` }}
              />
            </span>
            <span className="d1-ont__aantal">{getal(r.aantal)}</span>
            <span className="d1-ont__waarde">
              {bereik(r.mrr_bodem, r.mrr_plafond, euroKort) || <span className="d1-ont__leegwaarde">geen waarde</span>}
            </span>
            <span className="d1-ont__dekking">
              {r.aantal
                ? `${getal(r.aantal_gewaardeerd)}/${getal(r.aantal)} gewaardeerd`
                : '—'}
            </span>
          </div>
        ))}
      </div>

      {snede === 'eigenaar' && (
        <p className="d1-ont__voet">
          Werkverdeling, geen ranglijst: de deals zijn niet gelijk verdeeld naar fase of omvang, dus
          een vergelijking tussen eigenaren zegt hier weinig over prestatie.
        </p>
      )}
    </section>
  )
}
