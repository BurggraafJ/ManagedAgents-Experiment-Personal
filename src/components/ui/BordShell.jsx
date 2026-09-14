import './bord-shell.css'
import './bord-kop.css'

/**
 * BordShell — de gedeelde vorm van een stuurbord (D9 · D1 · D10).
 *
 * Vijf zones in vaste volgorde: kop · antwoord · master · detail ·
 * vertrouwen. Wie D9 kan lezen, kan D1 en D10 lezen — dát is wat "set"
 * betekent (skill `dashboarding`, visualisatie.md "de vijf-zone-grammatica").
 *
 * **Vijf zones, vier banden** (v1.188). Twee banden verdwenen hier en kwamen
 * terug in de kop. Zone 5 was een strook onder het werk: dat is de plek waar
 * niemand kijkt, en op een telefoon staat hij na drie schermen scrollen. En de
 * filterstrook — het zevende slot uit v1.187 — kostte gemeten **34 px** op
 * D10, dat daarmee op 246 px eerste blik uitkwam tegen een budget van 224. In
 * beide gevallen was niet de inhoud het probleem maar de band eromheen: in de
 * kopregel staan al knoppen, dus daar kosten dezelfde controls geen eigen
 * hoogte. `BordFilter` bleef; alleen zijn strook is weg.
 *
 * De shell draagt één harde structurele eigenschap, en die zit in de CSS en
 * niet in een afspraak: **de pagina scrollt niet, de panelen scrollen.** De
 * werkrij is `grid-template-rows: minmax(0, 1fr)`; met een `auto`-rij groeit
 * het werk mee en duwt het de kop van het scherm. Dat is de enige ingreep die
 * een bord van 6.000 px onmogelijk maakt.
 *
 * De zones zijn props en geen children-volgorde, zodat een bord er geen kan
 * overslaan zonder dat het opvalt.
 */
export default function BordShell({ className = '', kop, antwoord, kernzin, master, detail }) {
  return (
    <div className={`bs ${className}`.trim()}>
      {kop}
      {antwoord && <div className="bs__antwoord" data-zone="antwoord">{antwoord}</div>}
      {kernzin}
      <div className="bs__werk">
        {master}
        {detail}
      </div>
    </div>
  )
}

/**
 * BordKop — zone 1, twee regels. Alles waarmee je een bord bestuurt staat hier.
 *
 *   regel 1   ◂ terug · kruimel — — — peildatum · bronnen · ▸ Wat ontbreekt (n)
 *   regel 2   de vraag — — — — — — — eigenaar en ritme · filters · acties
 *
 * De tweede regel is nieuw in v0.9.2 en kost geen hoogte die het bord niet al
 * kwijt was: de kruimelregel bestond, en de knoppenregel bestond. Wat erbij
 * komt staat ernáást, niet eronder.
 *
 * Nooit een intro-alinea: het woordbudget van deze zone is nul lopende tekst en
 * een vraagregel van hoogstens tien woorden (Research 2 §2.3). Alles wat je
 * erover zou willen zeggen hoort in de tooltip van het getal of op de D-pagina
 * in Confluence.
 *
 * Props:
 *   terug       { label, onClick } — de weg terug, mét de naam van zijn
 *               bestemming ("Home", niet "Terug"). Verplicht op elk bord en op
 *               elke ingesprongen pagina; de browserknop telt niet als ontwerp,
 *               want op een tegel-ingang staat hij niet op het scherm.
 *   kruimel     "Stuurinformatie · D1"
 *   vraag       de vraag die dit bord beantwoordt
 *   meta        eigenaar en ritme
 *   vertrouwen  zone 5 — `<DataStatusBar variant="kop">`
 *   filters     paginafilters en zusterpagina's (andere sneden van dezelfde
 *               vraag), vóór de acties: die dóen iets, deze gaan ergens heen
 *   acties      ververs, export — de knoppen die handelen
 */
export function BordKop({ terug, kruimel, vraag, meta, vertrouwen, filters, acties }) {
  return (
    <div className="bs__kop" data-zone="kop">
      <div className="bs__kop-boven">
        {terug && (
          <button
            type="button"
            className="bs-terug"
            onClick={terug.onClick}
            title={`Terug naar ${terug.label}`}
          >
            <span className="bs-terug__pijl" aria-hidden>◂</span>
            <span className="bs-terug__label">{terug.label}</span>
          </button>
        )}
        {kruimel && <div className="bs__eyebrow">{kruimel}</div>}
        {vertrouwen && <div className="bs__kop-trust">{vertrouwen}</div>}
      </div>

      <div className="bs__kop-onder">
        <h2 className="bs__vraag">{vraag}</h2>
        <div className="bs__kop-r">
          {meta && <span className="bs__meta">{meta}</span>}
          {filters}
          {acties}
        </div>
      </div>
    </div>
  )
}

/**
 * BordFilter — één paginafilter, in het slot `filters` van `BordKop`.
 *
 * Een paginafilter vernauwt de populatie van het héle bord (F1); een snede
 * verdeelt haar (F2) en woont in de master. Hij toont de actieve stand, nooit
 * de bronstatus (F6). Een stand die het bord niet kan waarmaken blijft
 * zichtbaar, uitgeschakeld, met de reden in de tooltip (F7) — weglaten
 * verbergt dát de doorsnede bestaat.
 *
 * **Hij stond één versie lang in een eigen strook** tussen kop en antwoord
 * (het zevende `BordShell`-slot, v1.187). Gemeten kostte die strook 34 px op
 * D10, dat daarmee op 246 px eerste blik uitkwam tegen een budget van 224. De
 * knoppen zijn niet het probleem — de band eromheen is het: in de kopregel
 * staan al acties, dus daar kost dezelfde groep geen eigen hoogte. Slot en
 * strook zijn per v1.188 weg; het component zelf is ongewijzigd gebleven.
 *
 * Props:
 *   label    naam van de as ("periode")
 *   opties   [{ id, label, uit?, titel? }]
 *   actief   id van de gekozen stand
 *   onKies   (id) => void
 *   scope    korte telegramtekst achter de knoppen: waarop de stand werkt
 */
export function BordFilter({ label, opties = [], actief, onKies, scope = null }) {
  return (
    <div className="bs-filter" role="group" aria-label={label}>
      <span className="bs-filter__label">{label}</span>
      {opties.map(o => (
        <button
          key={o.id}
          type="button"
          className={`bs-filter__knop${o.id === actief ? ' is-actief' : ''}`}
          onClick={() => !o.uit && onKies(o.id)}
          disabled={!!o.uit}
          aria-pressed={o.id === actief}
          title={o.titel}
        >
          {o.label}
        </button>
      ))}
      {scope && <span className="bs-filter__scope">{scope}</span>}
    </div>
  )
}

/**
 * BordZuster — een zusterpagina in de kop: een andere snede van dezelfde vraag
 * (kwartaaldiagnose, hygiënebord, dossierlijst), geen handeling.
 *
 * Lichter dan `bs-btn` met opzet. "Ga naar het kwartaal" en "ververs nu" zijn
 * niet even zwaar, en twee identieke knoppen naast elkaar maken ze dat wel.
 */
export function BordZuster({ children, onClick }) {
  return (
    <button type="button" className="bs-zuster" onClick={onClick}>
      {children}
      <span className="bs-zuster__pijl" aria-hidden>▸</span>
    </button>
  )
}

/**
 * Kernzin — precies één zin met een persoonsvorm onder de antwoordrij, die
 * zegt wat je met de getallen erboven moet dóén. Hoogstens achttien woorden.
 * Er is er één per bord; een tweede zin hoort in het detailpaneel.
 */
export function Kernzin({ children }) {
  return <div className="bs__kernzin" data-zone="kernzin">{children}</div>
}

/**
 * ContextChip — een klein blokje context ín een kaart ("⚠ blind voor H2 · H3").
 * Amber, en uitsluitend voor een ontbrekende norm of een blinde meting; nooit
 * als prestatiekleur (dan zou het naast een KPI op "we halen het niet" lijken).
 */
export function ContextChip({ children }) {
  return <span className="bs-chip">{children}</span>
}
