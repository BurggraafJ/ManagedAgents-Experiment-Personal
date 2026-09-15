import { createContext, useContext, useRef } from 'react'
import useMaat from '../../../../ui/charts/visx/useMaat'
import Tip from '../../../../ui/charts/visx/Tip'

/**
 * Kaart — de kaartanatomie van het Live-bord (Design ronde 4/5): kop met
 * LABEL links en context rechts (`dagen`, `per maand`, `bron`), een subregel,
 * een lijf dat de chart op echte pixelmaat krijgt, en een voet met legenda
 * links en bronregel rechts — nooit meer dan één regel.
 *
 * De kaart is `data-tipanker`: de gedeelde Tip meet zijn positie hiertegen.
 *
 * **Focus-split (v1.210, Jelle 2026-09-15).** Staat de kaart alleen — omdat een
 * snede erop gekozen is — dan leest hij `KaartFocus` en draagt zijn kop drie
 * dingen extra: `◂ Overzicht` (de weg terug naar de grid), de gekozen snede
 * achter het label (`TIJD IN FASE · FASE 3`) en de eenheid (`units: deals`).
 * Dat gaat via een context en niet via props, zodat de zeven kaarten hier
 * niets van hoeven te weten: ze staan in de grid of ze staan in focus, en de
 * kaart zelf is in beide gevallen dezelfde.
 *
 * Props:
 *   label · plus (mono-badge naast het label) · meta (rechts in de kop)
 *   sub          subregel onder de kop
 *   boven        vaste inhoud vóór de chart (groot getal, metric-pairs)
 *   children     (maat) => chart, of gewone inhoud; `maat` = { breedte, hoogte }
 *   legenda      [{ swatch: 'o'|'od'|'g'|'pl'|'q'|'ol'|'os', tekst }]
 *   voet         tekst rechts in de voet · voetExtra: tweede voetregel
 *   tip          de actieve Tip-inhoud (uit useTip)
 *   className
 */
export const KaartFocus = createContext(null)

export default function Kaart({
  label, plus = null, meta = null, sub = null, boven = null, children,
  legenda = null, voet = null, voetExtra = null, tip = null, className = '', ontbreekt = null,
}) {
  const ref = useRef(null)
  const maat = useMaat(ref)
  const focus = useContext(KaartFocus)

  return (
    <section className={`dl-kaart ${className}${focus ? ' is-focus' : ''}`.trim()} data-tipanker>
      <div className="dl-kaart__kop">
        <div className="dl-kaart__links">
          {focus && (
            <button type="button" className="dl-terug" onClick={focus.terug} title="Terug naar het overzicht (Esc, of klik de snede nog eens)">
              ◂ Overzicht <kbd>esc</kbd>
            </button>
          )}
          <div className="dl-kaart__label">
            {label}
            {plus && <span className="dl-kaart__plus">{plus}</span>}
            {focus?.snede && <span className="dl-kaart__snede">{focus.snede}</span>}
          </div>
        </div>
        {(meta || focus) && (
          <div className="dl-kaart__meta">
            {meta}
            {focus?.units && <span className="dl-units">units: {focus.units}</span>}
          </div>
        )}
      </div>
      {sub && <div className="dl-kaart__sub">{sub}</div>}
      {boven}
      <div className="dl-kaart__lijf" ref={ref}>
        {ontbreekt
          ? <div className="dl-kaart__ontbreekt">{ontbreekt}</div>
          : (typeof children === 'function' ? (maat ? children(maat) : null) : children)}
      </div>
      {(legenda || voet) && (
        <div className="dl-kaart__voet">
          {legenda && (
            <div className="dl-legenda">
              {legenda.map(l => <span key={l.tekst}><i className={`dl-sw dl-sw--${l.swatch}`} />{l.tekst}</span>)}
              {focus && <span><i className="dl-sw dl-sw--sel" />geselecteerd</span>}
            </div>
          )}
          {voet && <span className="dl-kaart__voettekst">{voet}</span>}
        </div>
      )}
      {voetExtra && <div className="dl-kaart__voet dl-kaart__voet--extra">{voetExtra}</div>}
      <Tip tip={tip} />
    </section>
  )
}

/** Drie losse metric-pairs onder het grote getal (label boven, waarde onder). */
export function Paren({ items }) {
  return (
    <div className="dl-paren">
      {items.map(p => (
        <div key={p.k} className="dl-paar" title={p.titel || undefined}>
          <div className="dl-paar__k">{p.k}</div>
          <div className={`dl-paar__v${p.warn ? ' is-warn' : ''}`}>{p.v}</div>
        </div>
      ))}
    </div>
  )
}
