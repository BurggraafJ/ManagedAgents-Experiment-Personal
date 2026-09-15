import { getal, dagMaand } from '../format'
import { weekNr } from './AanvoerStrip'

/**
 * BewegingStrip — pipeline-beweging per week: nieuw · gewonnen · verloren.
 *
 * Een compacte gestapelde balk per week, groen boven de nul (nieuw), oranje
 * onder (verloren), en een teller voor gewonnen. Dezelfde twaalf weken als de
 * aanvoerstrip, zelfde venster als `v_d1_beweging_week`.
 *
 * De strip rekent niet: de drie tellingen komen uit de view. Het enige dat hier
 * gebeurt is de schaal bepalen (het hoogste weekgetal) en de staven tekenen.
 */
export default function BewegingStrip({ beweging }) {
  if (!beweging || beweging.length === 0) return null

  const max = Math.max(
    1,
    ...beweging.map(w => Math.max(w.nieuw || 0, w.verloren || 0)),
  )

  return (
    <div className="bws">
      <span className="bws__label">Beweging</span>
      <div className="bws__rij">
        {beweging.map(w => {
          const nr = weekNr(w.week_label)
          const nieuw = w.nieuw || 0
          const gew = w.gewonnen || 0
          const verl = w.verloren || 0
          const netto = nieuw + gew - verl
          const tip = [
            `Week ${nr} · ${dagMaand(w.week_start)} – ${dagMaand(w.week_eind)}`,
            `${getal(nieuw)} nieuw · ${getal(gew)} gewonnen · ${getal(verl)} verloren`,
            `netto ${netto >= 0 ? '+' : ''}${getal(netto)}`,
          ].join('\n')

          return (
            <div
              key={w.week_label}
              className={`bws__week${w.is_huidige_week ? ' bws__week--lopend' : ''}`}
              title={tip}
            >
              <div className="bws__staaf">
                {nieuw > 0 && (
                  <span
                    className="bws__bar bws__bar--nieuw"
                    style={{ height: `${(nieuw / max) * 100}%` }}
                  />
                )}
                {verl > 0 && (
                  <span
                    className="bws__bar bws__bar--verl"
                    style={{ height: `${(verl / max) * 100}%` }}
                  />
                )}
              </div>
              {gew > 0 && <span className="bws__won">{gew}</span>}
              <span className="bws__as">{nr}</span>
            </div>
          )
        })}
      </div>
      <span className="bws__legenda">
        <span className="bws__leg-dot bws__leg-dot--nieuw" /> nieuw
        <span className="bws__leg-dot bws__leg-dot--verl" /> verloren
        <span className="bws__leg-dot bws__leg-dot--won" /> gewonnen
      </span>
    </div>
  )
}
