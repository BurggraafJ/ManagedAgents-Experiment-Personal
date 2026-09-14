import './verdeling.css'

/**
 * C9 · Spreiding met mediaan — `verdeling` (skill dashboarding v0.9.1, chart-catalogus §C9).
 *
 * Hoe is dit verdeeld — en verbergt het gemiddelde een uitschieter? Voor
 * doorlooptijden, proefduur, tijd tot verlies. Drie staten, gekozen op n:
 *
 *   n < 8    geen beeld — de lijst zelf is de verdeling (L5 in woorden)
 *   n < 30   **puntenrij** (strip plot) met de mediaan als streep
 *   n ≥ 30   **histogram** met vaste bucketbreedte
 *
 * Nooit alleen een gemiddelde, geen boxplot onder n = 30 (kwartielen op twaalf
 * waarnemingen zijn schijnnauwkeurig). x = de eenheid, nul-basis, 3–5 ticks.
 * Mediaan als verticale streep met label (`--bs-ink`); punten of buckets
 * voorbij de norm in `--bs-orange`; L1 alleen bij een vastgelegde norm, mét
 * herkomst in het label.
 *
 * Wat de component rekent, en niets meer (G5): de x-schaal en de buckets over
 * exact de waarden die hij tekent. De **mediaan komt uit de view** en wordt niet
 * hier berekend — hij is hetzelfde getal als in de rij ernaast.
 *
 * Geen artboard voor C9 (design-slot 3 is leeg): maten uit het maatcontract —
 * chart-hoogte diagnose 160 px, één reeks.
 *
 * Props:
 *   waarden      getallen uit de records die het paneel toont (null wordt overgeslagen)
 *   mediaan      uit de view (v_d*.duur_mediaan)
 *   eenheid      'dagen' | 'maanden' | '€'
 *   norm         vastgelegde grens (L1) of null
 *   normLabel    herkomst van de norm ("B/C-grens · dash_parameters")
 *   onderschrift ReactNode: mediaan én bereik in woorden, uit de view
 *   titel        aria-label voor het beeld
 */
const TICK_STAPPEN = [1, 2, 5, 7, 10, 14, 30, 50, 60, 90, 100, 180, 200, 365, 500, 730, 1000]

function nette(stap) {
  return TICK_STAPPEN.find(s => s >= stap) || Math.ceil(stap / 1000) * 1000
}

export default function Verdeling({
  waarden = [], mediaan = null, eenheid = 'dagen', norm = null, normLabel = null, onderschrift = null, titel = 'verdeling',
}) {
  const xs = (waarden || []).map(Number).filter(v => Number.isFinite(v))
  const n = xs.length

  if (n < 8) {
    return (
      <div className="c9 c9--l5">
        {n === 0 ? 'geen duurmeting achter deze regel' : `${n} waarnemingen — de lijst hieronder is de verdeling`}
        {onderschrift && <span className="c9__onderschrift">{onderschrift}</span>}
      </div>
    )
  }

  const ruwMax = Math.max(...xs, norm || 0, mediaan || 0)
  const stap = nette(ruwMax / 4)
  const xmax = Math.max(stap, Math.ceil(ruwMax / stap) * stap)
  const ticks = []
  for (let t = 0; t <= xmax; t += stap) ticks.push(t)
  // Nul-basis: een negatieve waarde tekent op nul, de echte waarde staat in de tooltip.
  const pct = v => `${Math.round((Math.max(0, v) / xmax) * 1000) / 10}%`
  const histogram = n >= 30

  let buckets = null
  let bucketMax = 1
  if (histogram) {
    const breedte = nette(xmax / 10)
    const aantal = Math.ceil(xmax / breedte)
    buckets = Array.from({ length: aantal }, (_, i) => ({ van: i * breedte, tot: (i + 1) * breedte, n: 0 }))
    for (const v of xs) {
      // Een negatieve duur (verliesdatum vóór de aanmaak: een datumfout in de
      // bron) valt in de eerste bucket in plaats van buiten de array.
      const i = Math.max(0, Math.min(aantal - 1, Math.floor(v / breedte)))
      buckets[i].n += 1
    }
    bucketMax = Math.max(1, ...buckets.map(b => b.n))
  }

  return (
    <figure className="c9" role="img" aria-label={`${titel}: ${n} waarnemingen${mediaan !== null ? `, mediaan ${mediaan} ${eenheid}` : ''}`}>
      <div className="c9__plot">
        {norm !== null && norm !== undefined && (
          <span className="c9__norm" style={{ left: pct(norm) }}>
            <span className="c9__norm-label">{normLabel || 'norm'} {norm}</span>
          </span>
        )}
        {mediaan !== null && mediaan !== undefined && (
          <span className="c9__mediaan" style={{ left: pct(mediaan) }}>
            <span className="c9__mediaan-label">mediaan {Math.round(mediaan)}</span>
          </span>
        )}

        {histogram ? (
          <div className="c9__buckets">
            {buckets.map(b => (
              <span
                key={b.van}
                className={`c9__bucket${norm !== null && b.van >= norm ? ' is-buiten' : ''}`}
                style={{ left: pct(b.van), width: pct(b.tot - b.van) }}
                title={`${b.van}–${b.tot} ${eenheid}: ${b.n}`}
              >
                {b.n > 0 && <i style={{ height: `${Math.round((b.n / bucketMax) * 100)}%` }} />}
              </span>
            ))}
          </div>
        ) : (
          <div className="c9__punten">
            {xs.map((v, i) => (
              <span
                key={i}
                className={`c9__punt${norm !== null && v > norm ? ' is-buiten' : ''}`}
                /* Gelijke waarden liggen anders op elkaar: een vaste
                   verschuiving per index maakt ze telbaar zonder ruis. */
                style={{ left: pct(v), top: `${50 + ((i % 5) - 2) * 14}%` }}
                title={`${v} ${eenheid}`}
              />
            ))}
          </div>
        )}
      </div>

      <div className="c9__as">
        {/* De eenheid staat één keer, aan de laatste tick — niet in elke cel. */}
        {ticks.map((t, i) => (
          <span key={t} className={`c9__tick${i === ticks.length - 1 ? ' c9__tick--laatste' : ''}`} style={{ left: pct(t) }}>
            {t}{i === ticks.length - 1 ? ` ${eenheid}` : ''}
          </span>
        ))}
      </div>

      {onderschrift && <figcaption className="c9__onderschrift">{onderschrift}</figcaption>}
    </figure>
  )
}
