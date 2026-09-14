import { useMemo, useRef, useState } from 'react'
import BalkrangRij from './BalkrangRij'
import useContainerBreedte from './useContainerBreedte'
import './balkrang.css'

/**
 * C4 · Gerangschikte staven — `balk-rang` (skill dashboarding v0.9.1, §C4, locked).
 *
 * De volgorde ís de rangorde: geen nummers, geen as. De groepskop zegt wat de
 * noemer is; elke rij zegt hoeveel daarvan. Alles wat geen categorie is maar
 * het ontbreken ervan (het gat) staat rood onder een stippellijn, telt mee in
 * de schaal en doet niet mee in de rangorde. Twee bronnen = twee koppen, twee
 * schalen.
 *
 * Wat de component rekent, en niets meer (G5): het schaalmaximum per blok over
 * exact de rijen die hij tekent, en de client-sort `waarde ↔ naam` over
 * dezelfde array — de schakelaar die het contract toestaat. Sortering raakt
 * alleen de categorieën; gatregels blijven onderaan in de volgorde van de view.
 *
 * Props:
 *   groepen        [{ id, naam, tel, kort, noemer, noemerTekst, noemerTip: {kop, tekst},
 *                     rijen: [{ id, naam, sub, vlag, warn, waarde, noemer, gat }],
 *                     l5, vast }]
 *                  `vast` = de volgorde is de meting (geen sorteer-toggle).
 *   layout         'auto' (containerbreedte, 560 px) | 'onder' | 'kolom'
 *   noemerPerRij   'auto' (alleen bij meer dan één noemer in de lijst) | true | false
 *   gekozenId      id van de gekozen rij (zone 4 toont haar records)
 *   onKies(rij)    maakt de rijen klikbaar; zonder onKies zijn het lijstitems
 *   extraKoppen    kolom-layout: koppen van tabelkolommen naast de balk
 *   extra(rij)     kolom-layout: de cellen van die kolommen (slots van de tabel)
 *   voet           ReactNode onder de lijst (schaal, bron, peildatum) — of
 *                  gebruik `balkrangSchaal(groepen)` en zet hem in het paneel.
 *   leeg           tekst als er geen enkele rij is
 *   getal          formatter voor getallen (default nl-NL)
 */
const DREMPEL = 560

const nlGetal = n => (n === null || n === undefined ? null : Number(n).toLocaleString('nl-NL', { maximumFractionDigits: 0 }))

/** "AI 0 – 7 van 20 · HubSpot 0 – 57 van 57" — de schaal per blok voor de voetnoot (G2). */
export function balkrangSchaal(groepen, getal = nlGetal) {
  return (groepen || []).map(g => {
    const max = schaalMax(g.rijen)
    const kop = g.kort || g.naam
    return `${kop} 0 – ${getal(max)}${g.noemer !== null && g.noemer !== undefined ? ` van ${getal(g.noemer)}` : ''}`
  }).join(' · ')
}

function schaalMax(rijen) {
  return Math.max(1, ...(rijen || []).map(r => r.waarde || 0))
}

function sorteer(rijen, sort) {
  const cats = rijen.filter(r => !r.gat)
  const gats = rijen.filter(r => r.gat)
  const gesorteerd = sort === 'waarde'
    ? [...cats].sort((a, b) => (b.waarde || 0) - (a.waarde || 0))
    : cats
  return { cats: gesorteerd, gats }
}

export default function Balkrang({
  groepen, layout = 'auto', noemerPerRij = 'auto', gekozenId = null, onKies = null,
  extraKoppen = null, extra = null, voet = null, leeg = 'Geen regels.', getal = nlGetal,
}) {
  const wortel = useRef(null)
  const breedte = useContainerBreedte(wortel)
  const [sort, setSort] = useState('waarde')

  const vorm = layout === 'auto'
    ? (breedte === null ? 'onder' : breedte < DREMPEL ? 'onder' : 'kolom')
    : layout

  const noemers = useMemo(
    () => new Set((groepen || []).flatMap(g => g.rijen.map(r => r.noemer)).filter(n => n !== null && n !== undefined)),
    [groepen],
  )
  const perRij = noemerPerRij === 'auto' ? noemers.size > 1 : !!noemerPerRij

  const sorteerbaar = (groepen || []).some(g => !g.vast && g.rijen.filter(r => !r.gat).length > 1)
  const klikbaar = typeof onKies === 'function'
  const nExtra = vorm === 'kolom' && extra ? (extraKoppen?.length || 0) : 0
  // Kolommen van de tabel: naam · balk+goot · extra's · caret. Data-driven
  // (aantal extra kolommen), daarom inline.
  const kolommen = vorm === 'kolom'
    ? [
        nExtra ? 'minmax(170px, 1.15fr)' : 'minmax(180px, 1.2fr)',
        nExtra ? 'minmax(180px, 1.5fr)' : 'minmax(150px, 1fr)',
        ...Array(nExtra).fill('minmax(110px, .85fr)'),
        ...(klikbaar ? ['14px'] : []),
      ].join(' ')
    : null

  const totaal = (groepen || []).reduce((n, g) => n + g.rijen.length, 0)

  return (
    <div className={`c4 c4--${vorm}`} ref={wortel} role={klikbaar ? undefined : 'list'}>
      {totaal === 0 && <div className="c4__leeg">{leeg}</div>}

      {(groepen || []).map((g, gi) => {
        const max = schaalMax(g.rijen)
        const { cats, gats } = sorteer(g.rijen, g.vast ? 'vast' : sort)
        const toonSort = sorteerbaar && gi === 0
        return (
          <div key={g.id} className="c4__blok">
            <div className="c4__groep">
              <span className="c4__groep-naam">{g.naam}</span>
              {(g.tel || g.noemerTekst) && (
                <span className="c4__groep-tel">
                  {g.tel}
                  {g.noemerTekst && (
                    <>
                      {g.tel ? ' · ' : ''}van{' '}
                      <span className="c4__noemerwrap">
                        <button type="button" className="c4__noemer" aria-label={g.noemerTip ? `${g.noemerTip.kop}. ${g.noemerTip.tekst}` : g.noemerTekst}>
                          {g.noemerTekst}
                        </button>
                        {g.noemerTip && (
                          <span className="c4__tip" role="tooltip">
                            <b>{g.noemerTip.kop}</b>
                            {g.noemerTip.tekst}
                          </span>
                        )}
                      </span>
                    </>
                  )}
                </span>
              )}
              {toonSort && (
                <span className="c4__sort" role="group" aria-label="Sorteer de categorieën">
                  <button type="button" className={sort === 'waarde' ? 'is-actief' : ''} onClick={() => setSort('waarde')} aria-pressed={sort === 'waarde'}>waarde</button>
                  <span className="c4__sort-sep" aria-hidden>·</span>
                  <button type="button" className={sort === 'naam' ? 'is-actief' : ''} onClick={() => setSort('naam')} aria-pressed={sort === 'naam'} title="vaste volgorde uit de bron">naam</button>
                </span>
              )}
            </div>

            {vorm === 'kolom' && nExtra > 0 && gi === 0 && (
              <div className="c4__kolomkoppen" style={{ gridTemplateColumns: kolommen }} aria-hidden>
                <span /><span />
                {extraKoppen.map(k => <span key={k} className="c4__kolomkop">{k}</span>)}
                {klikbaar && <span />}
              </div>
            )}

            {cats.length === 0 && gats.length > 0 && (
              <div className="c4__l5">{g.l5 || 'Geen categorieën om te rangschikken.'}</div>
            )}

            {cats.map(r => (
              <BalkrangRij
                key={r.id} rij={r} frac={(r.waarde || 0) / max} layout={vorm}
                klikbaar={klikbaar} gekozen={gekozenId !== null && gekozenId === r.id} onKies={onKies}
                noemerPerRij={perRij} extra={nExtra ? extra(r) : null} kolommen={kolommen} getal={getal}
              />
            ))}

            {gats.length > 0 && (
              <>
                {/* Zonder deze scheiding leest "Reden onbekend 7" als de
                    grootste reden in plaats van als het ontbreken ervan. */}
                <div className="c4__gatsep" aria-hidden>
                  ontbrekende registratie<span className="c4__gatsep-lang"> · niet in de rangorde</span>
                </div>
                {gats.map(r => (
                  <BalkrangRij
                    key={r.id} rij={r} frac={(r.waarde || 0) / max} layout={vorm}
                    klikbaar={klikbaar} gekozen={gekozenId !== null && gekozenId === r.id} onKies={onKies}
                    noemerPerRij={perRij} extra={nExtra ? extra(r) : null} kolommen={kolommen} getal={getal}
                  />
                ))}
              </>
            )}
          </div>
        )
      })}

      {voet && <div className="c4__voet">{voet}</div>}
    </div>
  )
}
