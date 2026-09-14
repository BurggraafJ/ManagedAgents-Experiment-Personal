import { useRef, useState } from 'react'
import useContainerBreedte from './useContainerBreedte'
import './reeksnaast.css'

/**
 * C7 · Parallelle reeksen — `reeks-naast` (skill dashboarding v0.9.1, chart-catalogus §C7).
 *
 * Twee tot drie soorten per periode die **inhoudelijk niet optelbaar** zijn:
 * A prospectverlies · B proef niet omgezet · C opzegging. Náást elkaar, nooit
 * gestapeld, nooit met een rijtotaal — stapelen én optellen suggereren allebei
 * dat de drie hetzelfde meten.
 *
 * Contract dat in de component zit:
 *  • **Eén gedeelde schaal over álle reeksen en álle rijen** (G2); `max` komt
 *    van de aanroeper, die hem in de voetnoot van het blok noemt.
 *  • **Vast label vóór de baan**, niet erachter: met de baan op `flex:1` landt
 *    een label erachter aan de rechterrand van zijn derde en leest "A 2" als
 *    het getal van de kolom ernaast.
 *  • **Getal altijd zichtbaar, ook op nul** — een gemeten nul is grijs maar
 *    staat er; een reeks die verdwijnt maakt "geen verlies" en "niet gemeten"
 *    onzichtbaar hetzelfde.
 *  • **L4**: de lopende periode is licht (arcering over de baan), nooit een
 *    volle staaf — een onvolledige maand als volle staaf leest elke eerste
 *    van de maand als een instorting.
 *  • **L3**: een annotatie uit `events_annotaties` staat als markering op de
 *    rij, met het label in de tooltip.
 *  • **Mobiel** (container < 560 px): twee reeksen zichtbaar, de derde achter
 *    een tap. De aanroeper zegt met `verborgen` welke dat is.
 *
 * Maat: 8 px hoog, radius 4, vulling minimaal 2 px (maatcontract C4–C7).
 *
 * Props:
 *   reeksen    [{ id, label, kleur: 'n400' | 'orange' | 'deep' }] — 2 of 3
 *   rijen      [{ id, naam, sub, waarden: { [reeksId]: n }, huidig, markering: { label, tekst } }]
 *   max        gedeelde schaal (> 0), uit de view of over exact deze rijen
 *   verborgen  reeks-id die op een smalle container achter een tap staat
 *   gekozenId  id van de gekozen rij (zone 4 toont haar records)
 *   onKies     (rij) => void — maakt de rijen klikbaar
 *   getal      formatter
 */
const DREMPEL = 560
const nlGetal = n => Number(n || 0).toLocaleString('nl-NL', { maximumFractionDigits: 0 })

export default function Reeksnaast({
  reeksen = [], rijen = [], max, verborgen = null, gekozenId = null, onKies = null, getal = nlGetal,
}) {
  const wortel = useRef(null)
  const breedte = useContainerBreedte(wortel)
  const [toonAlle, setToonAlle] = useState(false)
  const smal = breedte !== null && breedte < DREMPEL
  const m = Math.max(Number(max) || 0, 1)
  const klikbaar = typeof onKies === 'function'
  const zichtbaar = smal && !toonAlle && verborgen ? reeksen.filter(r => r.id !== verborgen) : reeksen
  const weg = reeksen.find(r => r.id === verborgen)

  return (
    <div className={`c7${smal ? ' c7--smal' : ''}`} ref={wortel} role={klikbaar ? undefined : 'list'}>
      {smal && weg && (
        <button type="button" className="c7__toon" onClick={() => setToonAlle(v => !v)} aria-pressed={toonAlle}>
          {toonAlle ? `${weg.label} verbergen` : `+ ${weg.label} tonen`}
        </button>
      )}
      {rijen.map(rij => {
        const gekozen = gekozenId !== null && gekozenId === rij.id
        const klasse = ['c7__rij', rij.huidig ? 'is-huidig' : '', gekozen ? 'is-gekozen' : ''].filter(Boolean).join(' ')
        const Tag = klikbaar ? 'button' : 'div'
        return (
          <Tag
            key={rij.id}
            type={klikbaar ? 'button' : undefined}
            className={klasse}
            onClick={klikbaar ? () => onKies(rij) : undefined}
            aria-pressed={klikbaar ? gekozen : undefined}
            title={rij.markering ? `${rij.markering.label} — ${rij.markering.tekst || ''}`.trim() : undefined}
          >
            <span className="c7__cel">
              <span className="c7__naam">
                {rij.naam}
                {rij.markering && <span className="c7__markering" aria-label="annotatie">▲ {rij.markering.label}</span>}
              </span>
              {rij.sub && <span className="c7__sub">{rij.sub}</span>}
              <span className="c7__reeksen">
                {zichtbaar.map(r => {
                  const w = Number(rij.waarden?.[r.id] || 0)
                  const pct = Math.round((w / m) * 1000) / 10
                  return (
                    <span key={r.id} className={`c7__reeks c7__reeks--${r.kleur}`}>
                      <span className={`c7__label${w === 0 ? ' is-nul' : ''}`}>{r.label} {getal(w)}</span>
                      <span className="c7__baan">
                        {w > 0 && <i style={{ width: `${pct}%` }} />}
                      </span>
                    </span>
                  )
                })}
              </span>
            </span>
            {klikbaar && <span className="c7__caret" aria-hidden>▸</span>}
          </Tag>
        )
      })}
    </div>
  )
}

/** "schaal tot 27 per reeks" — voor de voetnoot van het blok (G2). */
export function reeksnaastSchaal(max, getal = nlGetal) {
  return `één schaal · 0 – ${getal(max)} per reeks`
}
