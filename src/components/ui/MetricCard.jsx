import './metric-card.css'

/**
 * MetricCard — één hoofdgetal met de drie dingen die het pas leesbaar maken:
 * een vergelijking (doel of vorige periode), de basis (n) en, waar nodig, het
 * label dat zegt hoe hard de bron is.
 *
 * Gedeeld tussen D1 en (later) D10 (skill `dashboarding`, visualisatie.md
 * "metric card" en principes.md regel 3: nooit een getal zonder context).
 *
 * Vier regels die in de component zelf zitten, zodat ze niet per bord opnieuw
 * bedacht worden:
 *
 *  1. **Een lege waarde is een lege plek, geen nul.** `waarde = null` rendert
 *     `leegTekst` in grijs plus de reden. Een nul die eigenlijk "niet gemeten"
 *     betekent, is de gevaarlijkste vorm van een dashboard.
 *  2. **Vergelijking en basis staan er altijd**, ook als ze "—" zijn. Zo valt
 *     op wanneer ze ontbreken.
 *  3. **`merk` is een bronlabel, geen prestatiekleur.** "proxy" of
 *     "ruw (HubSpot)" zegt iets over de meting, niet over hoe het gaat.
 *  4. **Geen kleur zonder norm.** `toon` kiest alleen tussen neutraal, hero
 *     (het critical number) en waarschuwing (er is een norm én die wordt niet
 *     gehaald). Nooit groen/rood op gevoel.
 *
 * Props:
 *   label        de naam van de KPI (klein, in kapitalen)
 *   merk         optioneel bronlabel — 'proxy', 'ruw (HubSpot)', …
 *   waarde       string of null; null → leegTekst
 *   waardeSuffix klein achter de waarde ("/wk", "deals")
 *   leegTekst    wat er staat als waarde null is
 *   reden        uitleg bij een lege waarde
 *   vergelijking regel 2: doel, vorige week, bandbreedte
 *   basis        regel 3: de n waar het getal op rust
 *   toon         'normaal' | 'hero' | 'waarschuwing' | 'leeg'
 *   children     extra regels (proxy-regel, voetnoot)
 */
export default function MetricCard({
  label,
  merk = null,
  waarde = null,
  waardeSuffix = null,
  leegTekst = 'niet vastgelegd',
  reden = null,
  vergelijking = null,
  basis = null,
  toon = 'normaal',
  children = null,
}) {
  const leeg = waarde === null || waarde === undefined
  const klasse = leeg ? 'leeg' : toon
  // Een bedragbereik ("€ 21.085 – € 51.710") is twee keer zo lang als een
  // percentage en zou op 30 px midden in het bedrag afbreken. Lengte bepaalt
  // hier de trapgrootte, niet een aparte prop per kaart.
  const lengte = leeg ? 0 : String(waarde).length
  const trap = lengte > 16 ? ' mc__getal--klein' : lengte > 10 ? ' mc__getal--mid' : ''

  return (
    <div className={`mc mc--${klasse}`}>
      <div className="mc__kop">
        <span className="mc__label">{label}</span>
        {merk && <span className="mc__merk">{merk}</span>}
      </div>

      <div className="mc__waarde">
        {leeg
          ? <span className="mc__leeg">{leegTekst}</span>
          : <>
              <span className={`mc__getal${trap}`}>{waarde}</span>
              {waardeSuffix && <span className="mc__suffix">{waardeSuffix}</span>}
            </>}
      </div>

      {leeg && reden && <p className="mc__reden">{reden}</p>}

      <div className="mc__context">
        <span className="mc__vergelijking">{vergelijking || '—'}</span>
        <span className="mc__basis">{basis || 'basis onbekend'}</span>
      </div>

      {children}
    </div>
  )
}
