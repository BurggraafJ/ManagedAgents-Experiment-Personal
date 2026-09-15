import { useCallback, useState } from 'react'

/**
 * Tip — de gedeelde hover-tooltip van de Visx-charts (D1-LIVE-INTERACTION.md,
 * principe 1): *wat is dit* in één zin plus de getallen van deze snede.
 *
 * Eén component voor alle kaarten, zodat hover op een staaf, een band, een
 * stapel of een slice hetzelfde leest. De tip staat absoluut binnen de kaart
 * (de kaart is `position: relative`) en volgt de muis; alleen `left`/`top` zijn
 * inline — dat zijn data-gedreven maten, geen styling (CLAUDE.md conventie).
 *
 * `useTip()` levert de state en twee handlers:
 *   toon(e, inhoud)  — inhoud = { kop, regels: [string], zin }
 *   verberg()
 * De positie wordt gemeten t.o.v. het dichtstbijzijnde `[data-tipanker]`, zodat
 * een SVG- en een HTML-segment dezelfde rekensom delen.
 *
 * Hover en klik delen dezelfde snede-sleutel (principe 3): wat de tip zegt is
 * wat een klik in het detailpaneel uitvouwt. Geen hover-hand zonder sink (G7)
 * — de aanroeper zet `cursor: pointer` alleen op segmenten met een onKies.
 */
export function useTip() {
  const [tip, setTip] = useState(null)

  const toon = useCallback((e, inhoud) => {
    const anker = e.currentTarget?.closest?.('[data-tipanker]')
    if (!anker) return
    const r = anker.getBoundingClientRect()
    const x = (e.clientX ?? r.left) - r.left
    const y = (e.clientY ?? r.top) - r.top
    setTip({ x, y, breedte: r.width, ...inhoud })
  }, [])

  const verberg = useCallback(() => setTip(null), [])

  return { tip, toon, verberg }
}

export default function Tip({ tip }) {
  if (!tip) return null
  // Rechts van de muis, tenzij hij dan uit de kaart valt; dan links ervan.
  const naarLinks = tip.breedte && tip.x > tip.breedte - 190
  const stijl = {
    top: Math.max(4, tip.y - 8),
    ...(naarLinks ? { right: Math.max(4, tip.breedte - tip.x + 12) } : { left: tip.x + 14 }),
  }
  return (
    <div className="vx-tip" role="tooltip" style={stijl}>
      {tip.kop && <div className="vx-tip__kop">{tip.kop}</div>}
      {(tip.regels || []).filter(Boolean).map((r, i) => (
        <div key={i} className="vx-tip__regel">{r}</div>
      ))}
      {tip.zin && <div className="vx-tip__zin">{tip.zin}</div>}
    </div>
  )
}
