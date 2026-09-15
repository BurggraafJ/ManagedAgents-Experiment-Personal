import { Group } from '@visx/group'
import { Bar, Line } from '@visx/shape'
import { scaleLinear } from '@visx/scale'
import './visx.css'

/**
 * Bereikrijen — drie (of meer) rijen op één gedeelde schaal (G2), elk met een
 * bereikstaaf P50–P90: oranje tot de mediaan, subtle tot P90, mediaanstreep in
 * ink. Rijkop links (label + subtekst), chip rechts ("6 te lang" in warn of
 * "ok"), onder de staaf "mediaan n d" en "P90 n d". Design ronde 4/5, kaart
 * Tijd in fase (C9-achtig / C5).
 *
 * De geselecteerde rij (sink-bron) krijgt een zacht vlak met 1 px ink-rand en
 * een ink-marker links — dezelfde grammatica als een actieve staaf of slice.
 *
 * Props:
 *   rijen      [{ key, label, sub, chip: { tekst, toon: 'warn'|'ok' }|null,
 *                 p50, p90, leeg?: string, titel?, uitleg? }]
 *              `uitleg` (fase in gewone taal) komt alleen in beeld als de rij
 *              ruim is (≥ 110 px, focus-split); in de grid blijft hij hover.
 *   schaalMax  bovengrens van de dagen-as (gedeeld over de rijen)
 *   ticks      [0, 30, 60, 90]
 *   breedte, hoogte · gekozen · onKies(rij) · onHover(e, rij) · onLeave
 */
export default function Bereikrijen({
  rijen = [], schaalMax = 90, ticks = [0, 30, 60, 90], breedte, hoogte,
  gekozen = null, onKies = null, onHover = null, onLeave = null,
}) {
  if (!breedte || !hoogte || rijen.length === 0) return null
  const padL = 12, padR = 12, padT = 6, asH = 24
  // Rijen groeien mee met de kaart, maar niet voorbij 150 px: in de focus-split
  // (v1.210) krijgt deze chart ~660 px en drie rijen over die hoogte zijn drie
  // eilanden. De svg wordt dan lager dan de kaart; de kaart centreert hem.
  const rowH = Math.min(150, Math.floor((hoogte - asH - padT) / rijen.length))
  const H = padT + rowH * rijen.length + asH
  const ruim = rowH >= 110
  const pw = breedte - padL - padR
  const x = scaleLinear({ domain: [0, schaalMax], range: [padL, padL + pw], clamp: true })
  const ay = H - 6
  const bh = ruim ? 20 : 14
  // Smalle kaart (mét sidebar): de subtekst wijkt voor de chip — `subKort`
  // ("25" i.p.v. "25 deals") als de aanroeper die meegeeft.
  const smal = breedte < 260

  return (
    <svg className={`vx${ruim ? ' vx--ruim' : ''}`} width={breedte} height={H} role="img" aria-label="tijd in fase">
      {ruim && ticks.map(t => <Line key={`g${t}`} from={{ x: x(t), y: padT }} to={{ x: x(t), y: ay - 12 }} className="vx-grid" />)}
      {rijen.map((r, i) => {
        const y0 = padT + i * rowH
        const gek = gekozen !== null && gekozen === r.key
        // Ruim: de fase-uitleg in gewone taal (r.uitleg) krijgt een eigen regel
        // onder de rijkop, en de staaf zakt mee.
        const by = y0 + (ruim && r.uitleg ? 46 : 26)
        const lo = Math.min(Number(r.p50) || 0, Number(r.p90) || 0), hi = Number(r.p90) || 0
        const klik = onKies ? { onClick: () => onKies(r), tabIndex: 0, role: 'button', onKeyDown: e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onKies(r) } } } : {}
        const hover = onHover ? { onMouseMove: e => onHover(e, r), onMouseLeave: onLeave, onFocus: e => onHover(e, r), onBlur: onLeave } : {}
        return (
          <Group key={r.key}>
            {gek && (
              <>
                <rect x={padL - 8} y={y0 - 4} width={pw + 16} height={rowH - 4} rx={8} className="vx-selectievlak" />
                <rect x={padL - 8} y={y0 + 2} width={3} height={rowH - 16} rx={1.5} className="vx-selectiemarker" />
              </>
            )}
            <rect x={padL - 8} y={y0 - 4} width={pw + 16} height={rowH - 4} fill="transparent" className={`vx-seg${onKies ? ' is-klikbaar' : ''}`} {...klik} {...hover} aria-label={r.titel || r.label} />
            <text x={padL} y={y0 + 12} pointerEvents="none">
              <tspan className="vx-rowlab">{r.label}</tspan>
              <tspan className="vx-rowsub" dx={7}>{smal && r.subKort !== undefined ? r.subKort : r.sub}</tspan>
            </text>
            {ruim && r.uitleg && <text x={padL} y={y0 + 30} className="vx-uitleg" pointerEvents="none">{r.uitleg}</text>}
            {r.chip
              ? (
                <Group left={breedte - padR} top={y0 + 2} pointerEvents="none">
                  <rect x={-(r.chip.tekst.length * 6 + 14)} y={0} width={r.chip.tekst.length * 6 + 14} height={15} rx={7.5} fill={r.chip.toon === 'warn' ? 'var(--vx-warn-bg)' : 'var(--vx-paper-3)'} />
                  <text x={-(r.chip.tekst.length * 6 + 14) / 2} y={11} textAnchor="middle" className={`vx-chip ${r.chip.toon === 'warn' ? 'vx-warn' : 'vx-n500'}`}>{r.chip.tekst}</text>
                </Group>
              )
              : <text x={breedte - padR} y={y0 + 13} textAnchor="end" className="vx-chip vx-n500" pointerEvents="none">ok</text>}
            <rect x={padL} y={by} width={pw} height={bh} rx={5} className="f-baan" pointerEvents="none" />
            {r.leeg
              ? <text x={padL + 6} y={by + 11} className="vx-rowsub" pointerEvents="none">{r.leeg}</text>
              : (
                <>
                  <Bar x={x(0)} y={by} width={Math.max(2, x(hi) - x(0))} height={bh} rx={5} className="f-orange-subtle" pointerEvents="none" />
                  <Bar x={x(0)} y={by} width={Math.max(2, x(lo) - x(0))} height={bh} rx={5} className="f-orange" pointerEvents="none" />
                  <Line from={{ x: x(r.p50), y: by - 3 }} to={{ x: x(r.p50), y: by + bh + 3 }} className="vx-mediaan" pointerEvents="none" />
                  <text x={padL} y={by + bh + (ruim ? 18 : 15)} className="vx-val vx-val--sm vx-ink" pointerEvents="none">mediaan {r.p50} d</text>
                  <text x={breedte - padR} y={by + bh + (ruim ? 18 : 15)} textAnchor="end" className="vx-val vx-val--sm vx-n500" pointerEvents="none">P90 {hi} d</text>
                </>
              )}
          </Group>
        )
      })}
      {ticks.map(t => (
        <Group key={t}>
          <Line from={{ x: x(t), y: ay - 12 }} to={{ x: x(t), y: ay - 9 }} className="vx-as" />
          <text x={x(t)} y={ay} textAnchor={t === 0 ? 'start' : t === schaalMax ? 'end' : 'middle'} className="vx-axnum">{t === 0 ? '0 d' : t}</text>
        </Group>
      ))}
      <Line from={{ x: padL, y: ay - 12 }} to={{ x: padL + pw, y: ay - 12 }} stroke="var(--vx-n300)" />
    </svg>
  )
}
