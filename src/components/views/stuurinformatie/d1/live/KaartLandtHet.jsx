import Kaart from './Kaart'
import Maandstapel from '../../../../ui/charts/visx/Maandstapel'
import { useTip } from '../../../../ui/charts/visx/Tip'
import { maandKort } from '../../format'
import { faseZin, FASE_UITLEG_12 } from './labels'

/**
 * Landt het? — forecast op beslisdatum (verwachte start van de proef, nooit
 * closedate): per maand een stapel met fase 3 onder (oranje) en fase 1–2 boven
 * (grijs, indicatief), plus de `?`-kolom voor deals zonder datum. Fase 1–2 wordt
 * nooit bij fase 3 opgeteld in een getal: het is één stapel, twee segmenten.
 *
 * `periode` = 'kwartaal' toont alleen de maanden binnen het kwartaal (F1).
 */
export default function KaartLandtHet({ forecast, periode, eenheid, gekozen, onKies }) {
  const { tip, toon, verberg } = useTip()
  const per = new Map()
  for (const r of forecast || []) {
    if (periode === 'kwartaal' && r.soort === 'maand' && !r.binnen_kwartaal) continue
    if (periode === 'kwartaal' && r.soort === 'later') continue
    if (!per.has(r.bucket)) per.set(r.bucket, { bucket: r.bucket, soort: r.soort, maand_start: r.maand_start, volgnummer: r.volgnummer, f3: null, f12: null })
    per.get(r.bucket)[r.fasegroep] = r
  }
  const w = r => eenheid.kies(r, 'aantal', 'mid_licenties')
  const kolommen = [...per.values()].sort((a, b) => a.volgnummer - b.volgnummer).map(b => ({
    key: b.bucket,
    label: b.soort === 'geen' ? '?' : b.soort === 'later' ? 'later' : maandKort(b.maand_start),
    soort: b.soort,
    onder: w(b.f3), boven: w(b.f12), rij: b,
  }))

  const hover = (e, k, seg) => {
    const b = k.rij
    const naam = k.soort === 'geen' ? 'geen beslisdatum' : k.soort === 'later' ? 'later dan 4 maanden' : maandKort(b.maand_start)
    const regels = seg === 'f3'
      ? [faseZin(3), `${eenheid.fmt(w(b.f3))} ${eenheid.naam}`]
      : seg === 'f12'
        ? [`Fase 1–2 · ${FASE_UITLEG_12} · indicatief`, `${eenheid.fmt(w(b.f12))} ${eenheid.naam}`]
        : [`fase 3 ${eenheid.fmt(w(b.f3))} · fase 1–2 ${eenheid.fmt(w(b.f12))} ${eenheid.naam}`]
    toon(e, { kop: naam, regels, zin: k.soort === 'geen' ? 'zonder beslisdatum · hygiëne: datum invullen in HubSpot' : 'beslisdatum in deze maand (forecast)' })
  }

  return (
    <Kaart
      className="dl-kaart--landt"
      label="Landt het?"
      meta="per maand"
      sub={`forecast · ${eenheid.lic ? 'licenties (mid)' : 'deals'} met beslisdatum`}
      legenda={[{ swatch: 'o', tekst: 'fase 3' }, { swatch: 'g', tekst: 'fase 1–2' }, { swatch: 'q', tekst: '?' }]}
      voetExtra={`${eenheid.lic ? 'licenties (mid) op ' : ''}deals met beslisdatum · ? = geen beslisdatum`}
      tip={tip}
    >
      {m => (
        <Maandstapel
          kolommen={kolommen}
          breedte={m.breedte}
          hoogte={m.hoogte}
          gekozen={gekozen?.soort === 'maand' ? gekozen.sleutel : null}
          onKies={k => onKies({ soort: 'maand', sleutel: k.key, label: `${k.soort === 'geen' ? 'Geen beslisdatum' : k.soort === 'later' ? 'Later' : maandKort(k.rij.maand_start)} · forecast`, bucket: k.rij, maanden: [...per.values()].filter(b => b.soort === 'maand').map(b => b.bucket) })}
          onHover={hover}
          onLeave={verberg}
          fmt={eenheid.fmt}
        />
      )}
    </Kaart>
  )
}
