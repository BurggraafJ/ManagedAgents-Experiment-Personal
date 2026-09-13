import { getal, dagMaand } from '../format'

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
 *
 * De regel "11 van 12 weken onder doel" wordt hier geteld en niet in een view.
 * Dat is de enige telling op dit bord die de component zelf doet, en met opzet
 * in dít bestand: `wekenOnderDoel` loopt over exact dezelfde array die hier als
 * staven getekend wordt, dus een afwijking is met het blote oog te zien. Een
 * telling in een view zou over een andere populatie kunnen gaan dan de grafiek
 * eronder — dát is de fout die een bord niet mag maken.
 *
 * De lopende week telt niet mee: hij is niet om, en een onvolledige week als
 * "onder doel" tellen maakt de reeks elke maandag somberder dan hij is.
 */
export function wekenOnderDoel(aanvoer, doel) {
  if (!doel || !aanvoer || aanvoer.length === 0) return null
  const volledig = aanvoer.filter(w => !w.is_huidige_week)
  if (volledig.length === 0) return null
  const onder = volledig.filter(w => (w.kennismakingen || 0) < doel).length
  // Kort gehouden: deze regel deelt zijn breedte met het vierweeks gemiddelde,
  // en een tweede regel in de herokaart kost de eerste blik z'n hoogtebudget.
  return `${onder} van ${volledig.length} weken onder doel`
}

export default function AanvoerStrip({ aanvoer, doel, kop = null }) {
  if (!aanvoer || aanvoer.length === 0) return null

  const max = Math.max(1, doel || 0, ...aanvoer.map(w => w.kennismakingen || 0))
  const doelPct = doel ? Math.min(100, Math.round((doel / max) * 100)) : null

  // De proxy is niet van het bord verdwenen maar van de kaart: tot 13-09 was
  // "nieuwe deals per week" het critical number, en twee reeksen die elkaar
  // opvolgen mogen nooit stil in elkaar overlopen. Hij staat nu in de tooltip
  // van de strip plus als gebeurtenis in `events_annotaties` — niet meer als
  // vaste vierde alinea op het getal dat de week stuurt.
  const proxy = kop
    ? `Tot 13-09-2026 was "nieuwe deals per week" het critical number: ${getal(kop.nieuwe_deals) ?? '—'} die week, ${getal(kop.nieuw_4wk) ?? '—'} over vier weken. Blijft meelopen tot beide reeksen elkaar bevestigen.`
    : undefined

  return (
    <div className="d1-strip" title={proxy}>
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
        <span>vorige week</span>
      </div>
    </div>
  )
}
