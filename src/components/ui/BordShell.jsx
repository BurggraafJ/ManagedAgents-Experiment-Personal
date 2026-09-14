import './bord-shell.css'

/**
 * BordShell — de gedeelde vorm van een stuurbord (D9 · D1 · D10).
 *
 * Vijf zones in vaste volgorde: kop · antwoord · master · detail ·
 * vertrouwen. Wie D9 kan lezen, kan D1 en D10 lezen — dát is wat "set"
 * betekent (skill `dashboarding`, visualisatie.md "de vijf-zone-grammatica").
 *
 * De shell draagt één harde structurele eigenschap, en die zit in de CSS en
 * niet in een afspraak: **de pagina scrollt niet, de panelen scrollen.** De
 * werkrij is `grid-template-rows: minmax(0, 1fr)`; met een `auto`-rij groeit
 * het werk mee en duwt het de vertrouwensregel van het scherm. Dat is de
 * enige ingreep die een bord van 6.000 px onmogelijk maakt.
 *
 * De zones zijn props en geen children-volgorde, zodat een bord er geen kan
 * overslaan zonder dat het opvalt.
 */
export default function BordShell({ className = '', kop, filter = null, antwoord, kernzin, master, detail, vertrouwen }) {
  return (
    <div className={`bs ${className}`.trim()}>
      {kop}
      {/* Zevende slot (v1.187): de filterstrook tussen kop en antwoord.
          Blijft leeg op elk bord waar F3 zegt dat er geen filter is — een
          lege strook bouwen omdat de grammatica er een voorschrijft, is
          erger dan geen strook (visualisatie.md, filterbalk). */}
      {filter && <div className="bs__filter" data-zone="filter">{filter}</div>}
      {antwoord && <div className="bs__antwoord" data-zone="antwoord">{antwoord}</div>}
      {kernzin}
      <div className="bs__werk">
        {master}
        {detail}
      </div>
      {vertrouwen}
    </div>
  )
}

/**
 * BordKop — zone 1. Kruimel + vraag links, ritme en acties rechts.
 *
 * Eén regel, nooit een intro-alinea: het woordbudget van deze zone is nul
 * lopende tekst en een vraagregel van hoogstens tien woorden (Research 2
 * §2.3). Alles wat je erover zou willen zeggen hoort in de tooltip van het
 * getal of op de D-pagina in Confluence.
 */
export function BordKop({ kruimel, vraag, meta, acties }) {
  return (
    <div className="bs__kop" data-zone="kop">
      <div className="bs__kop-l">
        <div className="bs__eyebrow">{kruimel}</div>
        <h2 className="bs__vraag">{vraag}</h2>
      </div>
      <div className="bs__kop-r">
        {meta && <span className="bs__meta">{meta}</span>}
        {acties}
      </div>
    </div>
  )
}

/**
 * BordFilter — één paginafilter in de strook tussen kop en antwoord.
 *
 * Een paginafilter vernauwt de populatie van het héle bord (F1); een snede
 * verdeelt haar (F2) en woont in de master. De strook toont de actieve
 * stand, nooit de bronstatus (F6). Een stand die het bord niet kan waarmaken
 * blijft zichtbaar, uitgeschakeld, met de reden in de tooltip (F7) — weglaten
 * verbergt dát de doorsnede bestaat.
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
