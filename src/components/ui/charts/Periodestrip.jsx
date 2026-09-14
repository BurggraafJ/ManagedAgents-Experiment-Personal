import { useCallback, useLayoutEffect, useRef, useState } from 'react'
import './periodestrip.css'

/**
 * C1 · Periodestrip — `strip-periode` (skill dashboarding v0.9.1, §C1, locked).
 *
 * Eén reeks van 8–13 periodes onder één hoofdgetal, tegen een vastgelegde norm.
 * De doellijn is de enige referentie en draagt zijn eigen getal in de goot
 * rechts; de tijdas draagt alleen tijd; onder de baan staat een waarderij met
 * één getal per periode; oranje is uitsluitend een gemeten, afgeronde periode.
 *
 * Wat de component níet doet (G5): hij telt, sorteert en aggregeert niets. De
 * schaal is `max(reeks, doel)` over exact de array die hij tekent — de enige
 * berekening die het contract toestaat.
 *
 * Props:
 *   punten    [{ key, waarde: number|null, lopend?: bool, tip: { kop, tekst, zwak? }, aria?: string }]
 *             oud → nieuw. `waarde === null` is een gat (geen meting), 0 is een
 *             gemeten nul, `lopend` is de onvolledige periode (L4).
 *   doel      number|null — L1; zonder doel geen lijn en geen normlabel.
 *   doelLabel tekst aan de lijn ("doel 6").
 *   doelTip   { kop, tekst } — hover op het normlabel (herkomst + peildatum).
 *   asEerste  label onder de eerste periode ("29 jun").
 *   asLaatste label onder de laatste afgeronde periode ("vorige week").
 *   voetnoot  ReactNode — alleen de herkomst van het doel, één regel.
 *   onKies    (punt) => void — maakt elke staaf een **drill-target** (G7, v0.9.2):
 *             een klik zet de selectie van het bord op die periode en vult het
 *             detailpaneel van zone 4. Zonder deze prop is de strip passief en
 *             krijgt geen enkele staaf een hover-hand — een `cursor: pointer`
 *             op iets dat niets opent is een belofte die het bord niet nakomt.
 *   gekozen   de `key` van het gekozen punt. Hover en selectie zijn twee
 *             staten: de muis weghalen mag de keuze niet wissen.
 *
 * Filter-scope: paginafilter ja, chart-lokaal geen — er staat geen control in
 * of om de strip. Drill-target: staaf → periode, op de `key` uit de view en
 * nooit op de index: een selectie op positie breekt stil zodra een
 * paginafilter de reeks inkort.
 */
const PLOT = 34
const VOET = 4

export default function Periodestrip({
  punten, doel = null, doelLabel = null, doelTip = null,
  asEerste = null, asLaatste = 'vorige week', voetnoot = null,
  onKies = null, gekozen = null,
}) {
  const [hover, setHover] = useState(null) // index | 'norm' | null
  const [focusIdx, setFocusIdx] = useState(0)
  const wortel = useRef(null)
  const asRef = useRef(null)
  const tipRef = useRef(null)
  const slotRefs = useRef([])
  const normRef = useRef(null)
  const [tipStijl, setTipStijl] = useState(null)

  const n = punten?.length || 0

  /* Rovende tabindex: twaalf staven als twaalf tabstops maken de kaart
     onbruikbaar met een toetsenbord. Eén stop, pijltjes verplaatsen,
     Enter/Spatie kiest (dat laatste doet de knop zelf). */
  const opToets = useCallback((e) => {
    const stap = e.key === 'ArrowRight' ? 1 : e.key === 'ArrowLeft' ? -1 : 0
    if (!stap) return
    e.preventDefault()
    const volgende = Math.min(n - 1, Math.max(0, focusIdx + stap))
    setFocusIdx(volgende)
    slotRefs.current[volgende]?.focus()
  }, [focusIdx, n])

  // De tooltip valt ónder de tijdas: hoofdgetal, doel, waarderij én tijdas
  // blijven zichtbaar. Horizontaal geklemd binnen de strip, pijltje op de slot.
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

  // De laatst afgeronde periode: het getal dat op de kaart staat.
  let laatst = -1
  for (let i = n - 1; i >= 0; i--) {
    if (!punten[i].lopend && punten[i].waarde !== null && punten[i].waarde !== undefined) { laatst = i; break }
  }

  // Een gat is geen drill-target: er is niets gemeten, dus er is niets achter.
  // Een gemeten nul is dat wél — "0 kennismakingen in week 33" is een antwoord.
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
    <div className="c1" ref={wortel}>
      <div className="c1__veld">
        <div className="c1__baan">
          <div className="c1__plot">
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

              // Een tweede klik op dezelfde staaf maakt de selectie leeg: de
              // sink van zone 4 hoort niet vast te zitten aan een keuze die je
              // niet meer wilt (visualisatie.md, "zone 4 is een gedeelde sink").
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

      {/* Waarderij: dezelfde padding en gap als de plot, zodat elk cijfer
          gecentreerd onder zijn eigen slot valt — ongeacht de kaartbreedte. */}
      <div className="c1__rij" aria-hidden>
        <div className="c1__rij-in">
          {punten.map((p, i) => (
            <span
              key={p.key ?? i}
              className={`c1__cijfer ${klassen(p, i)}`}
              onMouseEnter={() => setHover(i)}
              onMouseLeave={() => setHover(null)}
              /* Hetzelfde target als de staaf erboven, want het cijfer hoort
                 bij die staaf. De toegankelijke bediening zit op de knop: deze
                 rij staat op `aria-hidden` en is puur een tweede muisdoel. */
              onClick={isTarget(p) ? () => onKies(p.key === gekozen ? null : p) : undefined}
            >
              {p.waarde === null || p.waarde === undefined ? '–' : p.waarde}
            </span>
          ))}
        </div>
      </div>

      {/* Tijdas: eerste periode links, `vorige week` onder de laatst afgeronde
          slot. Het doellabel staat níet op de as — dat leest als een derde
          tijdsaanduiding. */}
      <div className="c1__as" ref={asRef} aria-hidden>
        <div className="c1__as-in">
          {punten.map((p, i) => (
            <span
              key={p.key ?? i}
              className={`c1__as-slot${i === 0 ? ' is-eerste' : ''}${i === laatst ? ' is-laatst' : ''}`}
            >
              {i === 0 && asEerste && <><i /><span>{asEerste}</span></>}
              {i === laatst && i !== 0 && asLaatste && <><i /><span>{asLaatste}</span></>}
            </span>
          ))}
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
