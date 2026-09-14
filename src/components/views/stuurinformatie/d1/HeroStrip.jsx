import AanvoerStrip from './AanvoerStrip'
import MetricPairs, { MetricPair } from '../../../ui/MetricPairs'
import { getal, decimaal, dagMaand } from '../format'
import './hero-strip.css'

/**
 * HeroStrip — Optie B: getal + suffix linksboven, drie metric-vakjes
 * rechtsboven, C1-strip full-width eronder. Vervangt de MetricCard-hero
 * in D1Antwoord (design-lock 2026-09-14).
 *
 * De metric-vakjes komen uit de gedeelde MetricPairs-primitief
 * (v1.198, bib-rollout). De HeroStrip levert de data, MetricPairs
 * dwingt het blokpatroon af.
 */
export default function HeroStrip({
  kop,
  aanvoer,
  doel,
  onKiesWeek,
  gekozenWeek,
}) {
  if (!kop) return null

  const km = kop.kennismakingen ?? null
  const onderDoel = km !== null && doel !== null && km < doel

  const doelSuffix = doel === null
    ? 'vorige week · geen doel'
    : <>vorige week{km !== null && <> · <b>{
      km > doel ? `${getal(km - doel)} boven doel`
        : km === doel ? 'gehaald'
          : `${getal(doel - km)} onder doel`
    }</b></>}</>

  const gem4wk = decimaal(kop.km_gemiddeld_4wk)
  const onderRaw = wekenOnderDoelRaw(aanvoer, doel)
  const netto = nettoStand(aanvoer, doel)

  return (
    <div className={`hs ${onderDoel ? 'hs--warn' : ''}`}>
      <div className="hs__top">
        <div className="hs__getal-blok">
          <span className="hs__label">Aanvoer · kennismakingen</span>
          <span className="hs__getal">{km === null ? '–' : km}</span>
          <span className="hs__suffix">{doelSuffix}</span>
        </div>

        <MetricPairs toon={onderDoel ? 'warn' : 'warm'} className="hs__metrics">
          {gem4wk !== null && (
            <MetricPair label="gem. 4 wk" waarde={gem4wk} />
          )}
          {onderRaw && (
            <MetricPair label="onder doel" waarde={`${onderRaw.onder} / ${onderRaw.totaal} wk`} />
          )}
          {netto !== null && (
            <MetricPair label="netto" waarde={`${netto > 0 ? '+' : ''}${getal(netto)}`} />
          )}
        </MetricPairs>
      </div>

      <div className="hs__strip">
        <AanvoerStrip
          aanvoer={aanvoer}
          doel={doel}
          kop={kop}
          onKiesWeek={onKiesWeek}
          gekozenWeek={gekozenWeek}
        />
      </div>

      <span
        className="hs__basis"
        title={`week ${dagMaand(kop.week_start)} – ${dagMaand(kop.week_eind)} · ${getal(kop.km_gevuld)} van ${getal(kop.km_noemer)} deals draagt een kennismakingsdatum; de rest telt niet mee`}
      >
        {getal(kop.km_gevuld)} van {getal(kop.km_noemer)} deals met datum
      </span>
    </div>
  )
}

function wekenOnderDoelRaw(aanvoer, doel) {
  if (!doel || !aanvoer || aanvoer.length === 0) return null
  const volledig = aanvoer.filter(w => !w.is_huidige_week)
  if (volledig.length === 0) return null
  const onder = volledig.filter(w => (w.kennismakingen || 0) < doel).length
  return { onder, totaal: volledig.length }
}

function nettoStand(aanvoer, doel) {
  if (!doel || !aanvoer || aanvoer.length === 0) return null
  const volledig = aanvoer.filter(w => !w.is_huidige_week)
  if (volledig.length === 0) return null
  const totaal = volledig.reduce((s, w) => s + (w.kennismakingen || 0), 0)
  return totaal - doel * volledig.length
}
