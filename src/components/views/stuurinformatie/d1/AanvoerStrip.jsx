import { getal, dagMaand } from './format'

/**
 * Twaalf weken aanvoer onder het critical number.
 *
 * Bewust absolute aantallen en geen procentuele week-op-week-beweging: bij
 * cijfers van 0 tot 3 per week is "+200 %" een getal zonder betekenis
 * (principes.md regel 4, kleine aantallen).
 *
 * Drie dingen die de strip zelf regelt:
 *  • **De doellijn staat er altijd**, ook als geen enkele week hem haalt. Een
 *    reeks zonder norm laat zich altijd goedpraten.
 *  • **De lopende week is gestreept.** Hij is niet om; hem als volle staaf
 *    tekenen leest elke maandag als een instorting.
 *  • **Nul is een zichtbare streep**, geen gat: een week zonder kennismaking is
 *    een meting, geen ontbrekende week.
 */
export default function AanvoerStrip({ aanvoer, doel }) {
  if (!aanvoer || aanvoer.length === 0) return null

  const max = Math.max(1, doel || 0, ...aanvoer.map(w => w.kennismakingen || 0))
  const doelPct = doel ? Math.min(100, Math.round((doel / max) * 100)) : null

  return (
    <div className="d1-strip">
      <div className="d1-strip__plot">
        {doelPct !== null && (
          <span className="d1-strip__doel" style={{ bottom: `${doelPct}%` }} aria-hidden />
        )}
        {aanvoer.map(w => {
          const n = w.kennismakingen || 0
          const hoogte = Math.round((n / max) * 100)
          return (
            <span
              key={w.week_label}
              className={`d1-strip__staaf${w.is_huidige_week ? ' is-lopend' : ''}${n === 0 ? ' is-nul' : ''}`}
              style={{ height: `${Math.max(hoogte, 2)}%` }}
              title={`${w.week_label} (${dagMaand(w.week_start)} – ${dagMaand(w.week_eind)}): ${n} kennismakingen · ${w.nieuwe_deals} nieuwe deals${w.is_huidige_week ? ' · week loopt nog' : ''}`}
            />
          )
        })}
      </div>
      <div className="d1-strip__as">
        <span>{dagMaand(aanvoer[0]?.week_start)}</span>
        <span className="d1-strip__doel-label">
          {doel ? `doellijn ${getal(doel)}/wk` : 'geen doel'}
        </span>
        <span>deze week</span>
      </div>
    </div>
  )
}
