import Kaart from './Kaart'
import Bereikrijen from '../../../../ui/charts/visx/Bereikrijen'
import { useTip } from '../../../../ui/charts/visx/Tip'
import { getal } from '../../format'
import { FASE_KORT, FASE_UITLEG, faseZin, bereikKort } from './labels'

/**
 * Tijd in fase — hoe lang de open deals nú in hun fase zitten, per fase op één
 * gedeelde dagen-schaal (G2): bereikstaaf P50–P90, mediaanstreep, chip
 * "n te lang" (> 1,5 × mediaan, zelfde definitie als in de view). Alles komt
 * uit `v_d1_fase_aging`; deals zonder fasedatum staan in de voet.
 */
export default function KaartTijdInFase({ aging, eenheid, gekozen, onKies }) {
  const { tip, toon, verberg } = useTip()
  const rijen = (aging || []).map(r => ({
    key: String(r.fase),
    label: FASE_KORT[r.fase] || `Fase ${r.fase}`,
    uitleg: FASE_UITLEG[r.fase] || null,
    sub: eenheid.lic
      ? (bereikKort(r.bodem_licenties, r.plafond_licenties) || 'geen band')
      : `${getal(r.aantal)} ${r.aantal === 1 ? 'deal' : 'deals'}`,
    subKort: eenheid.lic ? '' : `${getal(r.aantal)}`,
    chip: r.te_lang > 0 ? { tekst: `${getal(r.te_lang)} te lang`, toon: 'warn' } : null,
    p50: r.mediaan_dagen ?? 0,
    p90: r.p90_dagen ?? 0,
    leeg: r.aantal === 0 ? 'geen open deals' : r.aantal_met_datum === 0 ? 'geen fasedatum' : null,
    rij: r,
  }))
  // Eén gedeelde dagen-as in drie stappen van 30 (of 60, 90, …): 0 · 30 · 60 ·
  // 90 zoals het ontwerp, en pas grover als een P90 daar overheen gaat.
  const stap = Math.max(30, Math.ceil(Math.max(...rijen.map(r => r.p90 || 0)) / 3 / 30) * 30)
  const schaalMax = stap * 3
  const ticks = [0, stap, stap * 2, stap * 3]
  const zonderDatum = (aging || []).reduce((s, r) => s + (r.zonder_fasedatum || 0), 0)

  const hover = (e, x) => {
    const r = x.rij
    toon(e, {
      kop: faseZin(r.fase),
      regels: [
        r.aantal_met_datum > 0 ? `mediaan ${r.mediaan_dagen} d · P50–P90 ${r.mediaan_dagen}–${r.p90_dagen} d` : 'geen fasedatum bekend',
        `${getal(r.aantal)} deals${r.te_lang > 0 ? ` · ${getal(r.te_lang)} te lang (> ${r.te_lang_drempel} d)` : ''}${eenheid.lic && bereikKort(r.bodem_licenties, r.plafond_licenties) ? ` · ${bereikKort(r.bodem_licenties, r.plafond_licenties)} lic` : ''}`,
      ],
      zin: 'hoe lang deals nu in deze fase zitten',
    })
  }

  return (
    <Kaart
      className="dl-kaart--aging"
      label="Tijd in fase"
      meta="dagen"
      sub={`mediaan · P50–P90 · ${eenheid.lic ? 'lic-band' : 'deals'}`}
      voet="te lang = > 1,5× mediaan"
      voetExtra={zonderDatum > 0 ? <span>{getal(zonderDatum)} zonder fasedatum · niet in mediaan/P90</span> : null}
      tip={tip}
    >
      {m => (
        <Bereikrijen
          rijen={rijen}
          schaalMax={schaalMax}
          ticks={ticks}
          breedte={m.breedte}
          hoogte={m.hoogte}
          gekozen={gekozen?.soort === 'fase' ? gekozen.sleutel : null}
          onKies={x => onKies({ soort: 'fase', sleutel: x.key, label: `${x.label} · aging`, rij: x.rij })}
          onHover={hover}
          onLeave={verberg}
        />
      )}
    </Kaart>
  )
}
