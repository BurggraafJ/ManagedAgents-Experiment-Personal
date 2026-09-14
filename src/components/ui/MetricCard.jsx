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
 *   waarde2      optionele tweede waarde, even groot en direct onder de eerste
 *                — voor een kaart waarvan het inzicht in twee vensters zit
 *                (D10 B: "deze maand" én "in 13 maanden"; CD-review v1.175).
 *                Nooit een optelling van de eerste; het is dezelfde reeks in
 *                een ander venster.
 *   waarde2Suffix klein achter de tweede waarde
 *   leegTekst    wat er staat als waarde null is
 *   reden        uitleg bij een lege waarde
 *   vergelijking regel 2: doel, vorige week, bandbreedte
 *   basis        regel 3: de n waar het getal op rust
 *   toon         'normaal' | 'hero' | 'waarschuwing' | 'leeg'
 *   tussen       zone-2-primitief (C1/C3) tússen het getal en zijn context —
 *                de strip ís de vergelijking van het hoofdgetal, geen
 *                illustratie eronder (chart-catalogus §C1 "Zones", v1.184)
 *   kopExtra     optioneel derde element op de kopregel, ná het merk — een
 *                ContextChip die iets over de méting zegt ("⚠ blind voor
 *                H2 · H3 · H4"). Op de kopregel en niet als extra regel
 *                onderaan: zo kost hij de kaart geen hoogte en blijft de
 *                eerste blik binnen de 224 px (principes.md regel 5; D9 v1.185)
 *   children     extra regels (proxy-regel, voetnoot) onder de context
 */
export default function MetricCard({
  label,
  merk = null,
  kopExtra = null,
  waarde = null,
  waardeSuffix = null,
  waarde2 = null,
  waarde2Suffix = null,
  leegTekst = 'niet vastgelegd',
  reden = null,
  vergelijking = null,
  basis = null,
  toon = 'normaal',
  tussen = null,
  children = null,
}) {
  const leeg = waarde === null || waarde === undefined
  const klasse = leeg ? 'leeg' : toon
  // Een bedragbereik ("€ 21.085 – € 51.710") is twee keer zo lang als een
  // percentage en zou op 30 px midden in het bedrag afbreken. Lengte bepaalt
  // hier de trapgrootte, niet een aparte prop per kaart.
  const trapVoor = w => {
    const lengte = String(w).length
    return lengte > 16 ? ' mc__getal--klein' : lengte > 10 ? ' mc__getal--mid' : ''
  }
  const trap = leeg ? '' : trapVoor(waarde)
  const tweede = !leeg && waarde2 !== null && waarde2 !== undefined

  return (
    <div className={`mc mc--${klasse}`}>
      <div className="mc__kop">
        <span className="mc__label">{label}</span>
        {merk && <span className="mc__merk">{merk}</span>}
        {kopExtra}
      </div>

      <div className="mc__waarde">
        {leeg
          ? <span className="mc__leeg">{leegTekst}</span>
          : <>
              <span className={`mc__getal${trap}`}>{waarde}</span>
              {waardeSuffix && <span className="mc__suffix">{waardeSuffix}</span>}
            </>}
      </div>
      {tweede && (
        <div className="mc__waarde mc__waarde--tweede">
          <span className={`mc__getal${trapVoor(waarde2)}`}>{waarde2}</span>
          {waarde2Suffix && <span className="mc__suffix">{waarde2Suffix}</span>}
        </div>
      )}

      {leeg && reden && <p className="mc__reden">{reden}</p>}

      {tussen}

      <div className="mc__context">
        <span className="mc__vergelijking">{vergelijking || '—'}</span>
        <span className="mc__basis">{basis || 'basis onbekend'}</span>
      </div>

      {children}
    </div>
  )
}
