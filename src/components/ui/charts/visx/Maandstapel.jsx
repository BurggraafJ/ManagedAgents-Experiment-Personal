import { Group } from '@visx/group'
import { Bar, Line } from '@visx/shape'
import { scaleBand, scaleLinear } from '@visx/scale'
import { netteTop } from './useMaat'
import './visx.css'

/**
 * Maandstapel — één stapel per periode: onder = fase 3 (oranje), boven = fase
 * 1–2 (neutraal grijs), en een laatste kolom `?` als stippel-omtrek voor deals
 * zonder datum. Waarden boven de stapel, gridlines, as. Design ronde 4/5,
 * kaart Landt het? (forecast op beslisdatum).
 *
 * Elk segment is apart hoverbaar (fase-hover, expliciet Jelle) en de hele
 * kolom is de klik-snede (maand → sink).
 *
 * Props:
 *   kolommen  [{ key, label, onder, boven, soort: 'maand'|'geen'|'later', titel? }]
 *   breedte, hoogte · gekozen · onKies(kolom) · onHover(e, kolom, segment) · onLeave
 *   fmt       (waarde) => string
 */
export default function Maandstapel({
  kolommen = [], breedte, hoogte, gekozen = null, onKies = null, onHover = null, onLeave = null, fmt = v => String(v),
}) {
  if (!breedte || !hoogte || hoogte < 60 || kolommen.length === 0) return null
  const padL = 28, padR = 8, padT = 16, padB = 22
  const pw = breedte - padL - padR, ph = hoogte - padT - padB
  const top = netteTop(Math.max(...kolommen.map(k => (Number(k.onder) || 0) + (Number(k.boven) || 0))))
  const x = scaleBand({ domain: kolommen.map(k => k.key), range: [padL, padL + pw], paddingInner: 0.4, paddingOuter: 0.2 })
  const y = scaleLinear({ domain: [0, top], range: [padT + ph, padT] })
  const bw = Math.min(30, x.bandwidth())
  const smal = x.step() < 36

  return (
    <svg className="vx" width={breedte} height={hoogte} role="img" aria-label="forecast per maand">
      {[0, top / 2, top].map(t => (
        <Group key={t}>
          <Line from={{ x: padL, y: y(t) }} to={{ x: padL + pw, y: y(t) }} className="vx-grid" />
          <text x={padL - 7} y={y(t) + 3.5} textAnchor="end" className="vx-axnum">{Number.isInteger(t) ? t : t.toFixed(1).replace('.', ',')}</text>
        </Group>
      ))}
      {kolommen.map(k => {
        const onder = Number(k.onder) || 0, boven = Number(k.boven) || 0
        const bx = x(k.key) + (x.bandwidth() - bw) / 2, cx = bx + bw / 2
        const gek = gekozen !== null && gekozen === k.key
        const klik = onKies ? { onClick: () => onKies(k), tabIndex: 0, role: 'button', onKeyDown: e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onKies(k) } } } : {}
        const hov = seg => (onHover ? { onMouseMove: e => onHover(e, k, seg), onMouseLeave: onLeave, onFocus: e => onHover(e, k, seg), onBlur: onLeave } : {})
        const segKlasse = `vx-seg${onKies ? ' is-klikbaar' : ''}${gek ? ' is-gekozen' : ''}`
        const totaal = onder + boven
        if (k.soort === 'geen') {
          return (
            <Group key={k.key}>
              <rect x={bx} y={y(totaal)} width={bw} height={Math.max(2, y(0) - y(totaal))} rx={2} className={`f-omtrek ${segKlasse}`} {...klik} {...hov('geen')} aria-label={k.titel || `${k.label} · ${fmt(totaal)}`} />
              <text x={cx} y={y(totaal) - 5} textAnchor="middle" className="vx-val vx-n500" pointerEvents="none">{fmt(totaal)}</text>
              <text x={cx} y={padT + ph + 15} textAnchor="middle" className="vx-axlab vx-n500">?</text>
            </Group>
          )
        }
        return (
          <Group key={k.key}>
            {onder > 0 && <Bar x={bx} y={y(onder)} width={bw} height={y(0) - y(onder)} rx={2} className={`f-orange ${segKlasse}`} {...klik} {...hov('f3')} aria-label={`${k.label} · fase 3 · ${fmt(onder)}`} />}
            {boven > 0 && <Bar x={bx} y={y(totaal)} width={bw} height={y(onder) - y(totaal)} rx={2} className={`f-grijs ${segKlasse}`} {...klik} {...hov('f12')} aria-label={`${k.label} · fase 1–2 · ${fmt(boven)}`} />}
            {totaal === 0 && <rect x={bx} y={y(0) - 2} width={bw} height={2} className={`f-nul ${segKlasse}`} {...klik} {...hov('leeg')} aria-label={`${k.label} · 0`} />}
            <text x={cx} y={y(totaal) - 5} textAnchor="middle" className={`vx-val ${totaal === 0 ? 'vx-n400' : ''}`} pointerEvents="none">{fmt(totaal)}</text>
            <text x={cx} y={padT + ph + 15} textAnchor="middle" className={`vx-axlab ${smal ? 'vx-axlab--sm' : ''}`}>{smal && k.soort === 'later' ? '4m+' : k.label}</text>
          </Group>
        )
      })}
      <Line from={{ x: padL, y: y(0) }} to={{ x: padL + pw, y: y(0) }} className="vx-as" />
    </svg>
  )
}
