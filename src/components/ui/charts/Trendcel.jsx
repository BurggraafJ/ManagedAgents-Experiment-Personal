import './trendcel.css'

/**
 * C3 · Trendcel — `spark-cel` (skill dashboarding v0.9.1, §C3, locked).
 *
 * Acht weekstanden naast een getal in een lijstrij: de delta is het bericht,
 * de spark is het bijwoord. Slot 8 is vandaag, slot k de stand op dezelfde
 * weekdag (8 − k) weken eerder. Elke rij schaalt op zijn eigen maximum — de
 * enige toegestane uitzondering op G2, en de voetnoot van het paneel zegt dat.
 *
 * De component rekent niets anders dan `laatste − vorige` en de eigen schaal
 * over exact de acht posities die hij tekent (G5). De view levert de acht
 * posities: `v_d9_trend.reeks_week[8]` met NULL voor "geen meting".
 *
 * Zolang er geen snapshots zijn staat er "reeks start" met de datum in de
 * tooltip. Er wordt bewust géén vlakke lijn getekend: dat zou suggereren dat
 * er niets beweegt, en dat is een ander bericht dan "we meten nog niet".
 *
 * Props:
 *   reeksWeek  number|null[] — de acht weekstanden, oud → nieuw. Korter dan 8
 *              wordt links aangevuld (een jonge reeks staat rechts, tegen de
 *              delta, en is daardoor zichtbaar jong).
 *   vanaf      datum van de eerste snapshot (voor de L5-tooltip).
 *   meetbaar   false → "n.v.t.", geen cel.
 *   richting   'minder_is_goed' (hygiëne: ▲ krijgt warn-ink) | 'neutraal'
 *              (▲ en ▼ beide ink).
 *   kop        titel in de tooltip ("H4 · Geen volgende stap gepland").
 *   variant    'cel' (lijstrij) | 'kaart' (zone 2: delta als zin).
 */
const SLOTS = 8
const HOOGTE = 14

function datumLabel(d, plusDagen = 0) {
  if (!d) return null
  const x = new Date(d)
  if (Number.isNaN(x.getTime())) return null
  x.setDate(x.getDate() + plusDagen)
  return x.toLocaleDateString('nl-NL', { day: '2-digit', month: 'short' }).replace('.', '')
}

function Tip({ kop, regel, zwak }) {
  return (
    <span className="c3__tip" role="tooltip">
      <b>{kop}</b>
      <div>{regel}{zwak && <span className="c3__zwak"> · {zwak}</span>}</div>
    </span>
  )
}

export default function Trendcel({
  reeksWeek, vanaf = null, meetbaar = true, richting = 'minder_is_goed', kop = null, variant = 'cel',
}) {
  if (!meetbaar) return <span className="c3 c3--leeg c3--nvt">n.v.t.</span>

  const ruw = Array.isArray(reeksWeek) ? reeksWeek.slice(-SLOTS) : []
  const slots = [...Array(Math.max(0, SLOTS - ruw.length)).fill(null), ...ruw]
    .map(v => (v === null || v === undefined ? null : Number(v)))
  const gemeten = slots.filter(v => v !== null)

  // L5 · reeks start. Minder dan twee weekstanden is geen reeks.
  if (gemeten.length < 2) {
    const eerste = datumLabel(vanaf) || 'de eerste dagsnapshot'
    const vergelijk = datumLabel(vanaf, 7)
    return (
      <span
        className="c3 c3--leeg"
        role="img"
        aria-label={`Nog geen reeks: eerste dagsnapshot ${eerste}${vergelijk ? `, eerste weekvergelijking ${vergelijk}` : ''}.`}
      >
        reeks start
        <Tip
          kop="Nog geen reeks"
          regel={<>eerste dagsnapshot {eerste} (cron 07:45 NL){vergelijk && <> · eerste weekvergelijking {vergelijk}</>}</>}
          zwak="tot dan geen lijn — ook geen vlakke"
        />
      </span>
    )
  }

  const eersteIdx = slots.findIndex(v => v !== null)
  const max = Math.max(1, ...gemeten)
  const min = Math.min(...gemeten)
  const maxIdx = slots.lastIndexOf(max)
  const wkTerug = SLOTS - 1 - maxIdx

  const laatste = slots[SLOTS - 1]
  const vorige = slots[SLOTS - 2]
  const delta = laatste !== null && vorige !== null ? laatste - vorige : null

  const deltaKlasse = delta === null ? 'is-onbekend' : delta === 0 ? 'is-gelijk' : delta > 0 ? 'is-op' : 'is-af'
  const deltaKort = delta === null ? '—' : delta === 0 ? 'gelijk' : `${delta > 0 ? '▲' : '▼'} ${Math.abs(delta)}`
  const deltaZin = delta === null
    ? 'vorige week geen meting'
    : delta === 0 ? 'gelijk aan vorige week'
      : `${Math.abs(delta)} ${delta < 0 ? 'minder' : 'meer'} dan vorige week`

  const tipKop = [kop, `${gemeten.length} weekstanden`, `hoogste ${max} (${wkTerug === 0 ? 'vandaag' : `${wkTerug} wk terug`})`, `laagste ${min}`]
    .filter(Boolean).join(' · ')

  return (
    <span
      className={`c3${richting === 'neutraal' ? ' c3--neutraal' : ''}${variant === 'kaart' ? ' c3--kaart' : ''}`}
      role="img"
      aria-label={`${tipKop}. ${deltaZin}; eigen schaal, niet vergelijkbaar met andere rijen.`}
    >
      <span className="c3__spark" aria-hidden>
        {slots.map((v, i) => {
          const klasse = v === null ? (i < eersteIdx ? 'is-voor' : 'is-gat') : v === 0 ? 'is-nul' : ''
          const h = v ? Math.max(2, Math.round((v / max) * HOOGTE)) : 0
          return (
            <span key={i} className={`c3__slot ${klasse}`}>
              <span className="c3__staaf" style={h ? { height: `${h}px` } : undefined} />
            </span>
          )
        })}
      </span>
      <span className={`c3__delta ${deltaKlasse}`} aria-hidden>
        {variant === 'kaart'
          ? (delta === null ? 'vorige week geen meting' : <><b>{deltaKort}</b> t.o.v. vorige week</>)
          : deltaKort}
      </span>
      <Tip
        kop={tipKop}
        regel={delta !== null && delta > 0 && richting !== 'neutraal'
          ? <span className="c3__opw">{deltaZin}</span>
          : deltaZin}
        zwak="eigen schaal, niet vergelijkbaar met andere rijen"
      />
    </span>
  )
}
