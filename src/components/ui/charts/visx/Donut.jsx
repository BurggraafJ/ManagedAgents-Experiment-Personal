import { Group } from '@visx/group'
import { Pie } from '@visx/shape'
import { PatternLines } from '@visx/pattern'
import './visx.css'

/**
 * Donut — Kanaal als cirkeldiagram (Design ronde 5, OPTIONS-RONDE-5 §"Waarom
 * een donut"). Slices vanaf 12 uur met de klok mee op grootte, een kleine
 * padAngle-spleet, **Onbekend als laatste slice**: 5 px uit de ring geschoven
 * langs zijn centroid, gearceerd in grijs met stippelrand — geen vierde bron,
 * wél meegeteld in de 100 % (anders klopt het centrum niet). Het centrum
 * draagt het geheel: `33 open` of `305 lic mid`.
 *
 * Kleur: lichtheidstrap binnen oranje op grootte (orange · deep · light), grijs
 * alleen voor onbekend. De aanroeper geeft `kleur` als vulklasse mee zodat de
 * legenda dezelfde swatch toont.
 *
 * Props:
 *   slices   [{ key, label, waarde, kleur: 'f-orange'|…, onbekend?: bool, titel? }]
 *            — de aanroeper sorteert (grootste eerst, onbekend achteraan)
 *   centrum  { groot, klein }
 *   maat     zijde van het vierkant (px)
 *   gekozen · onKies(slice) · onHover(e, slice) · onLeave
 */
export default function Donut({ slices = [], centrum = null, maat = 156, gekozen = null, onKies = null, onHover = null, onLeave = null }) {
  const tot = slices.reduce((s, x) => s + (Number(x.waarde) || 0), 0)
  if (!maat || tot === 0) return null
  const R = maat / 2 - 8, r = Math.round(R * 0.62), c = maat / 2, pull = 5

  return (
    <svg className="vx vx-donut" width={maat} height={maat} role="img" aria-label="verdeling per kanaal">
      <PatternLines id="vx-gathatch" height={5} width={5} stroke="var(--vx-n400)" strokeWidth={1.6} orientation={['diagonal']} background="var(--vx-card)" />
      <Group top={c} left={c}>
        <Pie
          data={slices}
          pieValue={d => Number(d.waarde) || 0}
          pieSort={null}
          pieSortValues={null}
          outerRadius={R}
          innerRadius={r}
          padAngle={0.036}
        >
          {pie => pie.arcs.map(arc => {
            const s = arc.data
            const [cx, cy] = pie.path.centroid(arc)
            const len = Math.hypot(cx, cy) || 1
            const dx = s.onbekend ? (cx / len) * pull : 0, dy = s.onbekend ? (cy / len) * pull : 0
            const gek = gekozen !== null && gekozen === s.key
            const klik = onKies ? { onClick: () => onKies(s), tabIndex: 0, role: 'button', onKeyDown: e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onKies(s) } } } : {}
            const hover = onHover ? { onMouseMove: e => onHover(e, s), onMouseLeave: onLeave, onFocus: e => onHover(e, s), onBlur: onLeave } : {}
            return (
              <path
                key={s.key}
                d={pie.path(arc) || ''}
                transform={`translate(${dx.toFixed(2)},${dy.toFixed(2)})`}
                fill={s.onbekend ? 'url(#vx-gathatch)' : undefined}
                className={`vx-seg ${s.onbekend ? 'f-gat' : s.kleur}${onKies ? ' is-klikbaar' : ''}${gek ? ' is-gekozen' : ''}`}
                aria-label={s.titel || `${s.label} · ${s.waarde} · ${Math.round(((Number(s.waarde) || 0) / tot) * 100)} %`}
                {...klik}
                {...hover}
              />
            )
          })}
        </Pie>
        {centrum && (
          <>
            <text y={2} textAnchor="middle" className="vx-donut-groot" pointerEvents="none">{centrum.groot}</text>
            <text y={15} textAnchor="middle" className="vx-donut-klein" pointerEvents="none">{centrum.klein}</text>
          </>
        )}
      </Group>
    </svg>
  )
}
