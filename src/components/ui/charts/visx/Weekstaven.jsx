import { Group } from '@visx/group'
import { Bar, Line } from '@visx/shape'
import { scaleBand, scaleLinear } from '@visx/scale'
import { PatternLines } from '@visx/pattern'
import { netteTop } from './useMaat'
import './visx.css'

/**
 * Weekstaven — C1-hero als Visx-staafreeks (Design ronde 4/5, kaart
 * Kennismakingen): gemeten weken links, de lopende week gearceerd met `nu`,
 * een gepland-band rechts (lichter vlak, stippellijn, kop "gepland") met
 * gepland-staven als subtle-vulling met oranje stippelrand, en één doellijn
 * in ink met het doel in de goot. Waarden staan bóven de staaf, weeknummers
 * zonder W op de as. Een gemeten nul is een 2 px stub met een grijze 0.
 *
 * Props:
 *   slots     [{ key, label, waarde, soort: 'gemeten'|'lopend'|'gepland', titel? }]
 *   doel      getal of null — null = geen doellijn
 *   breedte, hoogte
 *   gekozen   key van de geselecteerde staaf
 *   onKies    (slot) => void — klik schrijft naar de sink (G7)
 *   onHover   (e, slot) => void · onLeave () => void
 *   fmt       (waarde) => string voor het label boven de staaf
 */
export default function Weekstaven({
  slots = [], doel = null, breedte, hoogte,
  gekozen = null, onKies = null, onHover = null, onLeave = null, fmt = v => String(v),
}) {
  if (!breedte || !hoogte || hoogte < 60) return null
  const padL = 26, padR = doel !== null ? 46 : 12, padT = 26, padB = 30
  const pw = Math.max(10, breedte - padL - padR), ph = Math.max(10, hoogte - padT - padB)
  const top = netteTop(Math.max(doel || 0, ...slots.map(s => Number(s.waarde) || 0)))
  const x = scaleBand({ domain: slots.map(s => s.key), range: [padL, padL + pw], paddingInner: 0.38, paddingOuter: 0.19 })
  const y = scaleLinear({ domain: [0, top], range: [padT + ph, padT] })
  const bw = Math.min(26, x.bandwidth())
  const slot = pw / Math.max(1, slots.length)
  const ticks = [0, top / 2, top]
  const eersteGepland = slots.findIndex(s => s.soort === 'gepland')
  const lopend = slots.findIndex(s => s.soort === 'lopend')
  const gx = eersteGepland >= 0 ? x(slots[eersteGepland].key) - (x.step() - bw) / 2 - 2 : null

  return (
    <svg className="vx" width={breedte} height={hoogte} role="img" aria-label="kennismakingen per week">
      <PatternLines id="vx-hatch" height={6} width={6} stroke="var(--vx-n300)" strokeWidth={1.2} orientation={['diagonal']} background="var(--vx-paper-3)" />
      {gx !== null && (
        <Group>
          <rect x={gx} y={padT - 10} width={padL + pw - gx} height={ph + 10} rx={4} className="f-band" />
          <Line from={{ x: gx, y: padT - 12 }} to={{ x: gx, y: padT + ph }} stroke="var(--vx-n300)" strokeDasharray="2 3" />
          <text x={gx + (padL + pw - gx) / 2} y={padT - 14} textAnchor="middle" className="vx-axlab">gepland</text>
        </Group>
      )}
      {lopend >= 0 && (
        <rect x={x(slots[lopend].key) - (x.step() - bw) / 2 + 2} y={padT} width={x.step() - 4} height={ph} rx={3} fill="url(#vx-hatch)" />
      )}
      {ticks.map(t => (
        <Group key={t}>
          <Line from={{ x: padL, y: y(t) }} to={{ x: padL + pw, y: y(t) }} className="vx-grid" />
          <text x={padL - 8} y={y(t) + 3.5} textAnchor="end" className="vx-axnum">{Number.isInteger(t) ? t : t.toFixed(1).replace('.', ',')}</text>
        </Group>
      ))}
      {doel !== null && (
        <Group>
          <Line from={{ x: padL, y: y(doel) }} to={{ x: padL + pw, y: y(doel) }} className="vx-doellijn" />
          <text x={padL + pw + 6} y={y(doel) + 3.5} className="vx-doel">doel {doel}</text>
        </Group>
      )}
      {slots.map((s, i) => {
        const v = Number(s.waarde) || 0
        const cx = x(s.key) + bw / 2
        const h = Math.max(0, y(0) - y(v))
        const klik = onKies ? { onClick: () => onKies(s), tabIndex: 0, role: 'button', onKeyDown: e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onKies(s) } } } : {}
        const hover = onHover ? { onMouseMove: e => onHover(e, s), onMouseLeave: onLeave, onFocus: e => onHover(e, s), onBlur: onLeave } : {}
        const gek = gekozen !== null && gekozen === s.key
        const segKlasse = `vx-seg${onKies ? ' is-klikbaar' : ''}${gek ? ' is-gekozen' : ''}`
        return (
          <Group key={s.key}>
            {/* onzichtbare hit-zone over het hele slot, zodat ook een nul klikbaar is */}
            <rect x={x(s.key) - (x.step() - bw) / 2} y={padT} width={x.step()} height={ph} fill="transparent" {...klik} {...hover} aria-label={s.titel || `${s.label} · ${fmt(v)}`} />
            {v === 0
              ? <rect x={x(s.key)} y={y(0) - 2} width={bw} height={2} className={`f-nul ${segKlasse}`} pointerEvents="none" />
              : s.soort === 'gepland'
                ? <Bar x={x(s.key)} y={y(v)} width={bw} height={h} rx={3} className={`f-gepland ${segKlasse}`} pointerEvents="none" />
                : <Bar x={x(s.key)} y={y(v)} width={bw} height={h} rx={3} className={`f-orange ${s.soort === 'lopend' ? 'f-lopend' : ''} ${segKlasse}`} pointerEvents="none" />}
            <text x={cx} y={y(v) - 6} textAnchor="middle" className={`vx-val ${v === 0 ? 'vx-n400' : s.soort === 'lopend' ? 'vx-ink' : s.soort === 'gepland' ? 'vx-n500' : ''}`} pointerEvents="none">{fmt(v)}</text>
            <text x={cx} y={padT + ph + 16} textAnchor="middle" className={`vx-axlab ${s.soort === 'gepland' ? 'vx-n500' : ''} ${slot < 22 ? 'vx-axlab--sm' : ''}`}>{s.label}</text>
            {s.soort === 'lopend' && <text x={cx} y={padT + ph + 27} textAnchor="middle" className="vx-axlab vx-n500">nu</text>}
          </Group>
        )
      })}
      <Line from={{ x: padL, y: y(0) }} to={{ x: padL + pw, y: y(0) }} className="vx-as" />
    </svg>
  )
}
