import './work-table.css'

/**
 * WorkTable — de tabelvorm van een werklijst: een aantal regels waar iemand
 * vandaag iets mee moet, elk met een eigenaar en een deeplink.
 *
 * Gedeeld tussen D1 en (later) D10 (skill `dashboarding`, visualisatie.md
 * "werkbord"). Drie regels zitten in de component:
 *
 *  1. **Leeg is een geldige uitkomst.** Een werklijst zonder rijen is een
 *     geslaagde week, geen kapotte tabel — vandaar een eigen, rustige tekst in
 *     plaats van een lege kop.
 *  2. **Elke regel draagt een eigenaar.** Ontbreekt die, dan staat er
 *     "zonder eigenaar" en niet een leeg vakje: dat is zelf het signaal.
 *  3. **De lijst is afkapbaar en zegt dat dan.** Zwijgend de eerste N tonen
 *     maakt een lange lijst kort zonder dat iemand het merkt.
 *
 * Props:
 *   kolommen  [{ key, label, klasse?, render?(rij) }]
 *   rijen     de regels
 *   sleutel   (rij, i) => string — React-key
 *   leegTekst wat er staat bij nul rijen
 *   maximum   toon hoogstens zoveel regels (0 = alles)
 */
export default function WorkTable({
  kolommen,
  rijen = [],
  sleutel = (_r, i) => String(i),
  leegTekst = 'Geen regels — deze lijst is leeg.',
  maximum = 0,
}) {
  if (rijen.length === 0) {
    return <div className="wt wt--leeg">{leegTekst}</div>
  }

  const zichtbaar = maximum > 0 ? rijen.slice(0, maximum) : rijen
  const kolomBreedtes = kolommen.map(k => k.breedte || '1fr').join(' ')

  return (
    <div className="wt">
      <div className="wt__head" style={{ gridTemplateColumns: kolomBreedtes }}>
        {kolommen.map(k => <span key={k.key}>{k.label}</span>)}
      </div>
      {zichtbaar.map((rij, i) => (
        <div
          key={sleutel(rij, i)}
          className="wt__rij"
          style={{ gridTemplateColumns: kolomBreedtes }}
        >
          {kolommen.map(k => (
            <span key={k.key} className={k.klasse ? `wt__cel ${k.klasse}` : 'wt__cel'}>
              {k.render ? k.render(rij) : (rij[k.key] ?? '—')}
            </span>
          ))}
        </div>
      ))}
      {maximum > 0 && rijen.length > maximum && (
        <div className="wt__afgekapt">
          {rijen.length - maximum} regels niet getoond — de lijst is afgekapt op {maximum}.
        </div>
      )}
    </div>
  )
}
