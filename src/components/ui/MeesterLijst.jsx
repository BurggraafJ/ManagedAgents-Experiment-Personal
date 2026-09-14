import './bord-shell.css'

/**
 * MeesterLijst — zone 3, de ontleding. Eén blok met een snede-kiezer, nooit
 * meerdere ontledingsblokken onder elkaar (skill `dashboarding`,
 * visualisatie.md; Research 1 §B "één blok, meerdere sneden").
 *
 * Drie dingen zitten in de component en niet in het bord:
 *
 *  1. **De lijst scrollt in zichzelf.** `bs-paneel__body` heeft zijn eigen
 *     overflow; de pagina blijft staan. Een rij die half zichtbaar is, is het
 *     enige eerlijke signaal dat er meer is.
 *  2. **De vaste strook scrollt nooit weg.** Wat een bord eerlijk houdt — de
 *     schone checks, de ingeklapte ⛔-groep — staat in `slot` en blijft in
 *     beeld. Een lege plek die je moet zoeken telt niet als lege plek.
 *  3. **Eén voetnoot per snede, niet per rij.** `voet` is de enige plek voor
 *     lopende tekst in deze zone (≤ 25 woorden).
 */
export default function MeesterLijst({
  titel,
  snede = null,
  kolomkoppen = [],
  children,
  slot = null,
  voet = null,
}) {
  return (
    <section className="bs-paneel" data-zone="master">
      <div className="bs-paneel__kop">
        <span className="bs-paneel__titel">{titel}</span>
        {snede}
        {kolomkoppen.length > 0 && (
          <div className="bs-paneel__kop-r">
            {kolomkoppen.map(k => <span key={k} className="bs-paneel__kolomkop">{k}</span>)}
          </div>
        )}
      </div>

      <div className="bs-paneel__body">{children}</div>

      {slot && <div className="bs-paneel__slot">{slot}</div>}
      {voet && <div className="bs-paneel__voet">{voet}</div>}
    </section>
  )
}

/** Groepskop in de lijst: de naam van de groep en waar hij uit bestaat. */
export function MeesterGroep({ naam, tel = null }) {
  return (
    <div className="bs-groep">
      <span className="bs-groep__naam">{naam}</span>
      {tel && <span className="bs-groep__tel">{tel}</span>}
    </div>
  )
}

/**
 * Eén selecteerbare regel. `n` is het getal, `nTekst` vervangt het waar er
 * geen getal is (een niet-meetbare check toont nooit een nul — dat is de
 * gevaarlijkste vorm van een dashboard).
 */
export function MeesterRij({
  code = null,
  naam,
  sub = null,
  n = null,
  nTekst = null,
  trend = null,
  gekozen = false,
  onClick,
  titel = undefined,
}) {
  return (
    <button
      type="button"
      className={`bs-rij bs-rij--check${gekozen ? ' is-gekozen' : ''}`}
      onClick={onClick}
      aria-pressed={gekozen}
      title={titel}
    >
      <span className="bs-rij__code">{code}</span>
      {/* Naam en grondslag in één flexkolom: een <span> is inline, en zonder
          deze kolom plakt de subregel achter de naam. Een telling zonder
          noemer is niet te wegen — daarom staat hij in de rij en niet pas in
          het detailpaneel. */}
      <span className="bs-rij__cel">
        <span className="bs-rij__naam">{naam}</span>
        {sub && <span className="bs-rij__sub">{sub}</span>}
      </span>
      <span className={`bs-rij__n${n === 0 ? ' bs-rij__n--nul' : ''}`}>
        {nTekst ?? (n === null || n === undefined ? '—' : n.toLocaleString('nl-NL'))}
        {/* Onder 1000 px valt de trendkolom weg en staat de delta als tweede
            regel onder het getal (C3 · mobiel). Eén van beide is zichtbaar,
            nooit allebei — de CSS in trendcel.css kiest. */}
        {trend && <span className="bs-rij__n-trend">{trend}</span>}
      </span>
      <span className="bs-rij__trend">{trend}</span>
      <span className="bs-rij__caret" aria-hidden>▸</span>
    </button>
  )
}
