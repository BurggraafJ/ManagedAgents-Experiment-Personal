import { Group } from '@visx/group'
import { Bar, Line } from '@visx/shape'
import { scaleBand, scaleLinear } from '@visx/scale'
import { netteTop } from './useMaat'
import './visx.css'

/**
 * InUit — divergerende staven rond een ink-nul-as: **in** (nieuw) boven de as
 * in oranje, **uit** eronder als één stapel van gewonnen (orange-deep) en
 * verloren (neutraal grijs). Waarden boven resp. onder de staaf. Design ronde
 * 4/5, kaart Beweging.
 *
 * Elk segment is apart hoverbaar en klikbaar: de sink krijgt week + soort
 * (`Week W36 · beweging · verloren`).
 *
 * Props:
 *   weken    [{ key, label, nieuw, gewonnen, verloren, titel? }]
 *   breedte, hoogte · gekozen (`${key}:${soort}`) · onKies(week, soort)
 *   onHover(e, week, soort) · onLeave · fmt
 */
export default function InUit({
  weken = [], breedte, hoogte, gekozen = null, onKies = null, onHover = null, onLeave = null, fmt = v => String(v),
}) {
  if (!breedte || !hoogte || hoogte < 60 || weken.length === 0) return null
  const padL = 30, padR = 8, padT = 14, padB = 24
  const pw = breedte - padL - padR, ph = hoogte - padT - padB
  const maxIn = netteTop(Math.max(...weken.map(w => Number(w.nieuw) || 0)))
  const maxUit = netteTop(Math.max(...weken.map(w => (Number(w.gewonnen) || 0) + (Number(w.verloren) || 0))))
  // Eén as, twee helften: de nul-as ligt op de verhouding in : uit.
  const yTop = Math.max(1, maxIn), yBot = Math.max(1, maxUit)
  const y = scaleLinear({ domain: [-yBot, yTop], range: [padT + ph, padT] })
  const y0 = y(0)
  const x = scaleBand({ domain: weken.map(w => w.key), range: [padL, padL + pw], paddingInner: 0.5, paddingOuter: 0.25 })
  const bw = Math.min(30, x.bandwidth())
  const smal = x.step() < 30

  return (
    <svg className="vx" width={breedte} height={hoogte} role="img" aria-label="beweging per week">
      {[yTop, 0, -yBot].map(t => (
        <Group key={t}>
          <Line from={{ x: padL, y: y(t) }} to={{ x: padL + pw, y: y(t) }} className="vx-grid" />
          <text x={padL - 7} y={y(t) + 3.5} textAnchor="end" className="vx-axnum">{t > 0 ? `+${fmt(t)}` : t < 0 ? `−${fmt(-t)}` : '0'}</text>
        </Group>
      ))}
      {weken.map(w => {
        const nw = Number(w.nieuw) || 0, gw = Number(w.gewonnen) || 0, vl = Number(w.verloren) || 0
        const bx = x(w.key) + (x.bandwidth() - bw) / 2, cx = bx + bw / 2
        const seg = soort => {
          const gek = gekozen !== null && gekozen === `${w.key}:${soort}`
          return {
            className: `vx-seg${onKies ? ' is-klikbaar' : ''}${gek ? ' is-gekozen' : ''}`,
            ...(onKies ? { onClick: () => onKies(w, soort), tabIndex: 0, role: 'button', onKeyDown: e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onKies(w, soort) } } } : {}),
            ...(onHover ? { onMouseMove: e => onHover(e, w, soort), onMouseLeave: onLeave, onFocus: e => onHover(e, w, soort), onBlur: onLeave } : {}),
          }
        }
        return (
          <Group key={w.key}>
            {nw > 0 && (
              <>
                <Bar x={bx} y={y(nw)} width={bw} height={y0 - y(nw)} rx={2} fill="var(--vx-orange)" {...seg('nieuw')} aria-label={`${w.label} · nieuw ${fmt(nw)}`} />
                <text x={cx} y={y(nw) - 5} textAnchor="middle" className="vx-val" pointerEvents="none">{fmt(nw)}</text>
              </>
            )}
            {gw > 0 && <Bar x={bx} y={y0 + 1} width={bw} height={Math.max(1, y(-gw) - y0 - 1)} rx={2} fill="var(--vx-orange-deep)" {...seg('gewonnen')} aria-label={`${w.label} · gewonnen ${fmt(gw)}`} />}
            {vl > 0 && <Bar x={bx} y={y(-gw) + 1} width={bw} height={Math.max(1, y(-(gw + vl)) - y(-gw) - 1)} rx={2} fill="var(--vx-n400)" {...seg('verloren')} aria-label={`${w.label} · verloren ${fmt(vl)}`} />}
            {gw + vl > 0 && <text x={cx} y={y(-(gw + vl)) + 12} textAnchor="middle" className="vx-val vx-n500" pointerEvents="none">{fmt(gw + vl)}</text>}
            {nw + gw + vl === 0 && <rect x={bx} y={y0 - 1} width={bw} height={2} className="f-nul" {...seg('nieuw')} aria-label={`${w.label} · geen beweging`} />}
            <text x={cx} y={padT + ph + 15} textAnchor="middle" className={`vx-axlab ${smal ? 'vx-axlab--sm' : ''}`}>{w.label}</text>
          </Group>
        )
      })}
      <Line from={{ x: padL, y: y0 }} to={{ x: padL + pw, y: y0 }} className="vx-as--ink" strokeWidth={1} />
    </svg>
  )
}
