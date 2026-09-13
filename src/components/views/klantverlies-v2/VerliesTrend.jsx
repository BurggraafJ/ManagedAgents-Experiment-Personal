import { getal, maandJaar, datumKort } from '../stuurinformatie/format'

/**
 * VerliesTrend — dertien maanden, drie reeksen **naast** elkaar.
 *
 * Niet gestapeld, en dat is geen smaak: de D10-pagina schetst een gestapelde
 * grafiek, maar stapelen laat de lezer optellen wat dit bord verbiedt op te
 * tellen, en `visualisatie.md` verbiedt gestapelde vlakken bij kleine n
 * sowieso. Drie dunne staafjes per maand houden A, B en C uit elkaar en laten
 * tegelijk zien dat ze op een heel andere schaal leven.
 *
 * Twee dingen die de grafiek eerlijk houden:
 *
 *  1. **Alle dertien maanden staan er**, ook de maanden zonder verlies. Die
 *     nullen komen uit de view (39 rijen, altijd) en niet uit een group-by die
 *     lege maanden weglaat — anders leest een goede maand als een gat.
 *  2. **Gebeurtenissen staan op de tijdas.** Zonder de markering bij oktober
 *     2025 leest die maand als de slechtste van het jaar, terwijl het een
 *     opruimronde was: 27 deals uit het eerste kwartaal van 2025 gingen toen
 *     alsnog naar een verliesstage (mediane leeftijd 223 dagen tegen 35–80 in
 *     de maanden erna). Dat is de goedkoopste vorm van "waarom" die er bestaat
 *     (principes.md regel 15).
 */
const REEKSEN = [
  { soort: 'A', label: 'A · Prospectverlies' },
  { soort: 'B', label: 'B · Proef niet omgezet' },
  { soort: 'C', label: 'C · Opzegging (churn)' },
]

export default function VerliesTrend({ maandreeks, annotaties = [] }) {
  if (!maandreeks || maandreeks.length === 0) return null

  // Groeperen is geen rekenen: de view levert 13 × 3 rijen, dit zet ze naast
  // elkaar in de volgorde waarin ze getekend worden.
  const maanden = []
  const index = new Map()
  for (const r of maandreeks) {
    if (!index.has(r.maand_key)) {
      index.set(r.maand_key, { maand: r.maand, maand_key: r.maand_key, huidig: r.is_huidige_maand, per: {} })
      maanden.push(index.get(r.maand_key))
    }
    index.get(r.maand_key).per[r.soort] = r
  }

  const max = Math.max(1, ...maandreeks.map(r => r.aantal || 0))

  const markeringPerMaand = new Map()
  for (const a of annotaties) {
    const key = String(a.datum).slice(0, 7)
    if (index.has(key)) markeringPerMaand.set(key, a)
  }

  return (
    <section className="d10-blok">
      <div className="d10-blok__kop">
        <h3 className="d10-blok__titel">Dertien maanden, drie soorten náást elkaar</h3>
        <div className="d10-legenda">
          {REEKSEN.map(r => (
            <span key={r.soort} className="d10-legenda__item">
              <i className={`d10-legenda__vlak d10-legenda__vlak--${r.soort.toLowerCase()}`} />
              {r.label}
            </span>
          ))}
        </div>
      </div>

      <div className="d10-trend">
        {maanden.map((m, i) => {
          const mark = markeringPerMaand.get(m.maand_key)
          // Op een telefoon passen dertien maandlabels niet naast elkaar. Alle
          // dertien stáven blijven staan — de reeks inkorten op schermbreedte
          // zou de meting laten afhangen van het apparaat — maar alleen elke
          // derde maand krijgt daar een label, geteld vanaf rechts zodat de
          // lopende maand er altijd een heeft.
          const tick = (maanden.length - 1 - i) % 3 === 0
          return (
            <div key={m.maand_key} className={`d10-trend__kolom ${m.huidig ? 'is-huidig' : ''} ${tick ? 'is-tick' : ''}`}>
              <div className="d10-trend__staven">
                {REEKSEN.map(r => {
                  const rij = m.per[r.soort]
                  const n = rij?.aantal || 0
                  return (
                    <span
                      key={r.soort}
                      className={`d10-trend__staaf d10-trend__staaf--${r.soort.toLowerCase()} ${n === 0 ? 'is-nul' : ''}`}
                      style={{ height: `${n === 0 ? 2 : Math.max(4, (n / max) * 100)}%` }}
                      title={`${r.label} · ${maandJaar(m.maand)} · ${n}${rij?.duur_mediaan != null ? ` · mediaan ${getal(rij.duur_mediaan)} dagen` : ''}`}
                    >
                      {n > 0 && <b className="d10-trend__waarde">{n}</b>}
                    </span>
                  )
                })}
              </div>
              <span className="d10-trend__as">{maandJaar(m.maand)}</span>
              {mark && (
                <span className="d10-trend__markering" title={`${datumKort(mark.datum)} — ${mark.gebeurtenis}`}>▲</span>
              )}
            </div>
          )
        })}
      </div>

      {markeringPerMaand.size > 0 && (
        <ul className="d10-markeringen">
          {[...markeringPerMaand.entries()].map(([key, a]) => (
            <li key={key}>
              <span className="d10-markeringen__punt">▲</span>
              <span>
                <b className="d10-markeringen__datum">{datumKort(a.datum)}</b> — {a.gebeurtenis}
                {a.toelichting && <span className="d10-markeringen__uitleg"> {a.toelichting}</span>}
              </span>
            </li>
          ))}
        </ul>
      )}

      <p className="d10-voetnoot">
        De hoogste staaf is {getal(max)}. De drie reeksen worden nooit opgeteld: A telt
        prospects, B telt proeven en C telt opzeggingen — drie populaties, één tijdas.
      </p>
    </section>
  )
}
