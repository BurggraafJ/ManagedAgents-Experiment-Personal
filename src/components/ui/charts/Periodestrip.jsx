import { useCallback, useLayoutEffect, useRef, useState } from 'react'
import './periodestrip.css'

/**
 * C1 · Periodestrip — `strip-periode` (skill dashboarding v0.9.1, §C1).
 *
 * Twee varianten:
 *
 * **Compact** (default, locked): 34 px plot, waarderij onder de baan, x-as met
 * twee labels (eerste + laatste). De strip in een MetricCard of compacte kaart.
 *
 * **Hero** (v1.191, chart-catalogus §C1 "Hero-modus"): 64 px plot, waarderij
 * **boven** de staaf, x-as met **labels per periode** (W36 W37 … W47). Alleen
 * in zone 2 als primair beeld, nooit in zone 3 of 4.
 *
 * Wat de component níet doet (G5): hij telt, sorteert en aggregeert niets. De
 * schaal is `max(reeks, doel)` over exact de array die hij tekent — de enige
 * berekening die het contract toestaat.
 *
 * Props:
 *   punten    [{ key, waarde: number|null, lopend?: bool, tip, aria?, asLabel? }]
 *   doel      number|null — L1
 *   doelLabel tekst aan de lijn ("doel 6")
 *   doelTip   { kop, tekst } — hover op het normlabel
 *   asEerste  label onder de eerste periode — compact only
 *   asLaatste label onder de laatste afgeronde — compact only
 *   voetnoot  ReactNode — alleen de herkomst van het doel
 *   variant   'compact' | 'hero'
 *   onKies    (punt) => void — drill-target (G7)
 *   gekozen   de `key` van het gekozen punt
 */
const PLOT_COMPACT = 34
const PLOT_HERO = 64
const VOET = 4

export default function Periodestrip({
  punten, doel = null, doelLabel = null, doelTip = null,
  asEerste = null, asLaatste = 'vorige week', voetnoot = null,
  variant = 'compact',
  onKies = null, gekozen = null,
}) {
  const isHero = variant === 'hero'
  const PLOT = isHero ? PLOT_HERO : PLOT_COMPACT

  const [hover, setHover] = useState(null)
  const [focusIdx, setFocusIdx] = useState(0)
  const wortel = useRef(null)
  const asRef = useRef(null)
  const tipRef = useRef(null)
  const slotRefs = useRef([])
  const normRef = useRef(null)
  const [tipStijl, setTipStijl] = useState(null)

  const n = punten?.length || 0

  const opToets = useCallback((e) => {
    const stap = e.key === 'ArrowRight' ? 1 : e.key === 'ArrowLeft' ? -1 : 0
    if (!stap) return
    e.preventDefault()
    const volgende = Math.min(n - 1, Math.max(0, focusIdx + stap))
    setFocusIdx(volgende)
    slotRefs.current[volgende]?.focus()
  }, [focusIdx, n])

  useLayoutEffect(() => {
    if (hover === null || !wortel.current || !tipRef.current || !asRef.current) { setTipStijl(null); return }
    const anker = hover === 'norm' ? normRef.current : slotRefs.current[hover]
    if (!anker) { setTipStijl(null); return }
    const e = wortel.current.getBoundingClientRect()
    const a = anker.getBoundingClientRect()
    const mid = a.left - e.left + a.width / 2
    const tw = tipRef.current.getBoundingClientRect().width
    const left = Math.max(0, Math.min(Math.round(mid - 18), Math.round(e.width - tw)))
    const asR = asRef.current.getBoundingClientRect()
    setTipStijl({ left, top: Math.round(asR.bottom - e.top + 3), '--c1-caret': `${Math.max(6, Math.round(mid - left - 4))}px` })
  }, [hover, n])

  if (n === 0) return null

  const waarden = punten.map(p => (p.waarde === null || p.waarde === undefined ? 0 : p.waarde))
  const max = Math.max(1, doel || 0, ...waarden)
  const px = w => Math.round((w / max) * PLOT)

  let laatst = -1
  for (let i = n - 1; i >= 0; i--) {
    if (!punten[i].lopend && punten[i].waarde !== null && punten[i].waarde !== undefined) { laatst = i; break }
  }

  const isTarget = p => !!onKies && p.waarde !== null && p.waarde !== undefined

  const klassen = (p, i) => [
    p.waarde === null || p.waarde === undefined ? 'is-gat' : p.waarde === 0 ? 'is-nul' : '',
    p.lopend ? 'is-lopend' : '',
    i === laatst ? 'is-laatst' : '',
    hover === i ? 'is-hover' : '',
    isTarget(p) ? 'is-klikbaar' : '',
    gekozen !== null && gekozen !== undefined && p.key === gekozen ? 'is-gekozen' : '',
  ].filter(Boolean).join(' ')

  const tip = hover === 'norm' ? doelTip : (hover !== null ? punten[hover]?.tip : null)
  const doelBottom = doel ? VOET + px(doel) : null

  return (
    <div className={`c1${isHero ? ' c1--hero' : ''}`} ref={wortel}>
      {/* Hero: waarderij boven de staven */}
      {isHero && (
        <div className="c1__rij c1__rij--boven" aria-hidden>
          <div className="c1__rij-in">
            {punten.map((p, i) => (
              <span
                key={p.key ?? i}
                className={`c1__cijfer ${klassen(p, i)}`}
                onMouseEnter={() => setHover(i)}
                onMouseLeave={() => setHover(null)}
                onClick={isTarget(p) ? () => onKies(p.key === gekozen ? null : p) : undefined}
              >
                {p.waarde === null || p.waarde === undefined ? '–' : p.waarde}
              </span>
            ))}
          </div>
        </div>
      )}

      <div className="c1__veld">
        <div className="c1__baan" style={isHero ? { height: `${8 + PLOT + VOET}px` } : undefined}>
          <div className="c1__plot" style={isHero ? { height: `${PLOT}px` } : undefined}>
            {punten.map((p, i) => {
              const gat = p.waarde === null || p.waarde === undefined
              const h = gat || p.waarde === 0 ? 0 : Math.max(px(p.waarde), 2)
              const label = p.aria || [p.tip?.kop, p.tip?.tekst, p.tip?.zwak].filter(Boolean).join(' · ')
              const gemeenschappelijk = {
                ref: el => { slotRefs.current[i] = el },
                className: `c1__slot ${klassen(p, i)}`,
                onMouseEnter: () => setHover(i),
                onMouseLeave: () => setHover(null),
                onFocus: () => setHover(i),
                onBlur: () => setHover(null),
              }
              const staaf = <span className="c1__staaf" style={h ? { height: `${h}px` } : undefined} />

              if (!isTarget(p)) {
                return (
                  <span key={p.key ?? i} {...gemeenschappelijk} role="img" tabIndex={0} aria-label={label}>
                    {staaf}
                  </span>
                )
              }
              return (
                <button
                  key={p.key ?? i}
                  type="button"
                  {...gemeenschappelijk}
                  tabIndex={i === focusIdx ? 0 : -1}
                  aria-pressed={p.key === gekozen}
                  aria-label={label}
                  onKeyDown={opToets}
                  onClick={() => onKies(p.key === gekozen ? null : p)}
                >
                  {staaf}
                </button>
              )
            })}
          </div>
        </div>

        {doelBottom !== null && (
          <>
            <span className="c1__doel" style={{ bottom: `${doelBottom}px` }} aria-hidden />
            <button
              type="button"
              ref={normRef}
              className="c1__norm"
              style={{ bottom: `${doelBottom}px` }}
              aria-label={doelTip ? `${doelTip.kop}. ${doelTip.tekst}` : doelLabel}
              onMouseEnter={() => setHover('norm')}
              onMouseLeave={() => setHover(null)}
              onFocus={() => setHover('norm')}
              onBlur={() => setHover(null)}
            >
              {doelLabel}
            </button>
          </>
        )}
      </div>

      {/* Compact: waarderij onder de baan */}
      {!isHero && (
        <div className="c1__rij" aria-hidden>
          <div className="c1__rij-in">
            {punten.map((p, i) => (
              <span
                key={p.key ?? i}
                className={`c1__cijfer ${klassen(p, i)}`}
                onMouseEnter={() => setHover(i)}
                onMouseLeave={() => setHover(null)}
                onClick={isTarget(p) ? () => onKies(p.key === gekozen ? null : p) : undefined}
              >
                {p.waarde === null || p.waarde === undefined ? '–' : p.waarde}
              </span>
            ))}
          </div>
        </div>
      )}

      {/* Tijdas: compact = twee labels, hero = label per periode */}
      <div className="c1__as" ref={asRef} aria-hidden>
        <div className="c1__as-in">
          {punten.map((p, i) => {
            if (isHero) {
              return (
                <span key={p.key ?? i} className="c1__as-slot c1__as-slot--elk">
                  <span>{p.asLabel || ''}</span>
                </span>
              )
            }
            return (
              <span
                key={p.key ?? i}
                className={`c1__as-slot${i === 0 ? ' is-eerste' : ''}${i === laatst ? ' is-laatst' : ''}`}
              >
                {i === 0 && asEerste && <><i /><span>{asEerste}</span></>}
                {i === laatst && i !== 0 && asLaatste && <><i /><span>{asLaatste}</span></>}
              </span>
            )
          })}
        </div>
      </div>

      {voetnoot && <div className="c1__voetnoot">{voetnoot}</div>}

      {tip && (
        <div
          ref={tipRef}
          className={`c1__tip${hover === 'norm' ? ' c1__tip--wrap' : ''}`}
          style={tipStijl || { left: 0, top: 0, visibility: 'hidden' }}
          role="tooltip"
        >
          <b>{tip.kop}</b>
          <div>{tip.tekst}{tip.zwak && <span className="c1__zwak"> · {tip.zwak}</span>}</div>
        </div>
      )}
    </div>
  )
}
