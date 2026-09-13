import { useMemo } from 'react'
import { getal, euroKort, bereik, bucketLabel } from '../format'

/**
 * Forecast per maand op **beslisdatum** (`verwachte_start_pilot`), nooit op
 * closedate — 31 van de 32 open deals heeft geen bruikbare closedate.
 *
 * Vier ontwerpkeuzes die je in de vorm terugziet:
 *
 *  • **Bodem én plafond in één staaf.** Het donkere deel is de minimumafname,
 *    het lichte deel de contractomvang. Er bestaat geen enkele
 *    "pipeline-waarde": één getal zou een keuze verbergen die niemand gemaakt
 *    heeft (onderzoek §4.8).
 *  • **Fase 1–2 in een eigen, lichte staaf met het label "indicatief".** Ze
 *    mogen op dezelfde as, maar nooit in hetzelfde getal.
 *  • **"Geen datum" is een kolom, geen weglating.** Die deals hebben geen
 *    waarde op de tijdas; ze krijgen een gestreepte blokje buiten de schaal, met
 *    hun aantal. Zonder die kolom leest de forecast optimistischer dan hij is.
 *  • **Ongewogen.** Geen kanspercentages, ook niet die van HubSpot zelf.
 */
export default function ForecastBars({ forecast }) {
  const kolommen = useMemo(() => {
    const perBucket = new Map()
    for (const r of forecast || []) {
      if (!perBucket.has(r.bucket)) {
        perBucket.set(r.bucket, {
          bucket: r.bucket, soort: r.soort, maand_start: r.maand_start,
          volgnummer: r.volgnummer, binnen_kwartaal: r.binnen_kwartaal, groepen: {},
        })
      }
      perBucket.get(r.bucket).groepen[r.fasegroep] = r
    }
    return [...perBucket.values()].sort((a, b) => a.volgnummer - b.volgnummer)
  }, [forecast])

  // Schaal over alle staven heen, zodat maanden onderling vergelijkbaar zijn.
  const max = useMemo(() => Math.max(
    1, ...(forecast || []).map(r => Number(r.mrr_plafond) || 0)
  ), [forecast])

  if (kolommen.length === 0) return null

  const totaalGeen = kolommen
    .filter(k => k.soort === 'geen')
    .reduce((n, k) => n + Object.values(k.groepen).reduce((m, g) => m + (g.aantal || 0), 0), 0)

  return (
    <section className="d1-blok d1-fc">
      <header className="d1-blok__kop">
        <div>
          <h3 className="d1-blok__titel">Forecast op beslisdatum</h3>
          <p className="d1-blok__intro">
            Verwachte start van de proef, niet de afsluitdatum. Donker = minimumafname,
            licht = contractomvang; euro per maand. Ongewogen — geen kanspercentage.
          </p>
        </div>
        <div className="d1-fc__legenda">
          <span className="d1-fc__legenda-item"><i className="d1-fc__vlak d1-fc__vlak--f3" />Fase 3</span>
          <span className="d1-fc__legenda-item"><i className="d1-fc__vlak d1-fc__vlak--f12" />Fase 1–2 · indicatief</span>
          <span className="d1-fc__legenda-item"><i className="d1-fc__vlak d1-fc__vlak--onbekend" />Geen beslisdatum</span>
        </div>
      </header>

      <div className="d1-fc__grid">
        {kolommen.map(kol => (
          <div
            key={kol.bucket}
            className={`d1-fc__kolom${kol.binnen_kwartaal ? ' is-kwartaal' : ''}${kol.soort === 'geen' ? ' is-geen' : ''}`}
          >
            <div className="d1-fc__plot">
              {['f3', 'f12'].map(g => (
                <Staaf key={g} groep={g} rij={kol.groepen[g]} soort={kol.soort} max={max} />
              ))}
            </div>

            <div className="d1-fc__kop">
              {bucketLabel(kol)}
              {kol.binnen_kwartaal && <span className="d1-fc__kwartaal">dit kwartaal</span>}
            </div>

            <div className="d1-fc__cijfers">
              {['f3', 'f12'].map(g => {
                const r = kol.groepen[g]
                if (!r || !r.aantal) {
                  return <span key={g} className="d1-fc__nul">{g === 'f3' ? 'f3' : 'f1–2'} 0</span>
                }
                const eur = bereik(r.mrr_bodem, r.mrr_plafond, euroKort)
                return (
                  <span key={g} className={`d1-fc__cijfer d1-fc__cijfer--${g}`}>
                    <b>{g === 'f3' ? 'f3' : 'f1–2'} {getal(r.aantal)}</b>
                    {eur ? <> · {eur}</> : <> · geen waarde</>}
                  </span>
                )
              })}
            </div>
          </div>
        ))}
      </div>

      {totaalGeen > 0 && (
        <p className="d1-fc__voet">
          {getal(totaalGeen)} open {totaalGeen === 1 ? 'deal heeft' : 'deals hebben'} geen beslisdatum en
          staat daarmee buiten élke maandkolom. Die {totaalGeen === 1 ? 'deal' : 'deals'} staan op het
          werkbord onder “Fase 3 zonder velden”.
        </p>
      )}
    </section>
  )
}

/**
 * Eén staaf. Hoogte = plafond ten opzichte van de hoogste staaf op het bord;
 * het donkere deel binnenin is de bodem als aandeel van het eigen plafond.
 * Zonder waarde (geen prijs, of geen beslisdatum) geen hoogte maar een
 * gestreept blokje buiten de schaal — een verzonnen hoogte is een verzonnen
 * verwachting.
 */
function Staaf({ groep, rij, soort, max }) {
  const aantal = rij?.aantal || 0
  const plafond = Number(rij?.mrr_plafond) || 0
  const bodem = Number(rij?.mrr_bodem) || 0

  if (aantal === 0) {
    return <span className={`d1-fc__staaf d1-fc__staaf--leeg d1-fc__staaf--${groep}`} />
  }
  if (soort === 'geen' || plafond === 0) {
    return (
      <span
        className={`d1-fc__staaf d1-fc__staaf--onbekend d1-fc__staaf--${groep}`}
        title={`${aantal} deals zonder waardering op de tijdas`}
      >
        <span className="d1-fc__onbekend-n">{aantal}</span>
      </span>
    )
  }

  const hoogte = Math.max(4, Math.round((plafond / max) * 100))
  const deelBodem = plafond > 0 ? Math.min(100, Math.round((bodem / plafond) * 100)) : 0

  return (
    <span
      className={`d1-fc__staaf d1-fc__staaf--${groep}`}
      style={{ height: `${hoogte}%` }}
      title={`${aantal} deals · bodem ${euroKort(bodem)} · plafond ${euroKort(plafond)}`}
    >
      <span className="d1-fc__bodem" style={{ height: `${deelBodem}%` }} />
    </span>
  )
}
