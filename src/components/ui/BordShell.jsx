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
 * D10, dat daarmee op 246 px eerste blik uitkwam tegen een budget van 224.
 * Sinds v1.189 draagt de kop die controls in een **witte standaardbalk** tegen
 * de app-topbalk aan (zie `BordKop`); de vraagregel is weer alleen de vraag.
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
 * BordKop — zone 1: de witte standaardbalk en daaronder de vraagregel.
 *
 *   balk      filters · zusterpagina's — — — — — — — — — — — — — — ● Sync │ acties
 *   regel A   de vraag — — — — — — — — — — — — — — — — — — — — — — eigenaar en ritme
 *
 * Sinds v1.189 (Jelle, 14-09-2026). In v1.188 stond alles wat een bord
 * bestuurt rechts op de vraagregel: ververs, kwartaaldiagnose, periodefilter,
 * en de vertrouwensgroep op de kruimelregel erboven — "rechtsboven in de
 * vraagregel geknald". De standaard-paginadingen hebben nu een eigen witte
 * balk, tegen de app-topbalk aan, en de vraagregel draagt alleen nog de vraag
 * met eigenaar en ritme als tekst.
 *
 * **Sinds v1.191 draagt de balk alleen nog echte paginacontrols** (Jelle,
 * 14-09-2026). De terugknop en de kruimel `STUURINFORMATIE · D1` zijn eruit:
 * de weg terug staat in de app-topbalk (`◂ Dashboard`, `◂ Pipeline`) en de
 * titel van het bord ook, dus hier waren het twee keer dezelfde plaatsbepaling
 * binnen veertig pixels. Wat blijft, staat vast:
 *
 *   • links: waar je heen kunt — paginafilters die iets dóen met de data, en
 *     zusterpagina's die bestaan. Geen filter die een doorsnede suggereert die
 *     het bord niet kan maken (dan liever geen filter);
 *   • rechts: wat de cijfers waard zijn (zone 5) en wat je kunt dóen (acties).
 *
 * Heeft een pagina geen van drie, dan is er geen balk: een lege witte strook
 * van 37 px is geen standaard maar een gat.
 *
 * Sinds v1.190 is zone 5 één woord: `● Sync`, met peildatum, bronnen,
 * waarschuwing, `Wat ontbreekt (n)` én Ververs in een paneel dat opent op
 * hover, focus of klik (Jelle, 14-09-2026: te veel sync-tekst in de balk).
 * Het slot `acties` bestaat nog voor knoppen die níét bij de sync horen
 * (export); D1, D9 en D10 gebruiken het sinds die versie niet meer.
 *
 * De balk is full-bleed binnen `.bs` (hij trekt de bovenpadding van het bord
 * naar zich toe), dus hij kost minder hoogte dan een losse strook: gemeten
 * kopBottom 67 → 78 px. Zie bord-kop.css voor de meting en `npm run meet`.
 *
 * Nooit een intro-alinea: het woordbudget van deze zone is nul lopende tekst en
 * een vraagregel van hoogstens tien woorden (Research 2 §2.3). Alles wat je
 * erover zou willen zeggen hoort in de tooltip van het getal of op de D-pagina
 * in Confluence.
 *
 * Props:
 *   vraag       de vraag die dit bord beantwoordt
 *   meta        eigenaar en ritme — tekst, rechts op de vraagregel
 *   vertrouwen  zone 5 — `<DataStatusBar variant="kop">`: `● Sync` + paneel, met
 *               Ververs erin (prop `ververs`), rechts in de balk
 *   filters     paginafilters (`BordPeriode`, `BordFilter`) en zusterpagina's
 *               (`BordZuster`), vóór de acties: die dóen iets, deze gaan ergens heen
 *   acties      export e.d. — knoppen die handelen en niet bij de sync horen, uiterst rechts
 *
 * `terug` en `kruimel` bestaan niet meer als prop. Wie ze toch meegeeft, krijgt
 * niets: de weg terug is van de topbalk (Dashboard.jsx via parentFor).
 */
export function BordKop({ vraag, meta, vertrouwen, filters, acties }) {
  const heeftBalk = !!(filters || vertrouwen || acties)
  return (
    <div className="bs__kop" data-zone="kop">
      {heeftBalk && (
        <div className="bs__balk" role="toolbar" aria-label="Paginabalk">
          {filters && <div className="bs__balk-filters">{filters}</div>}
          <span className="bs__balk-spacer" />
          {vertrouwen && <div className="bs__kop-trust">{vertrouwen}</div>}
          {acties && (
            <>
              {vertrouwen && <span className="bs__balk-sep" aria-hidden />}
              <div className="bs__balk-acties">{acties}</div>
            </>
          )}
        </div>
      )}

      <div className="bs__kop-onder">
        <h2 className="bs__vraag">{vraag}</h2>
        {meta && <span className="bs__meta">{meta}</span>}
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
 * **Waar hij staat is drie keer verhuisd**, het component niet. v1.187: een
 * eigen strook tussen kop en antwoord (34 px, D10 op 246 tegen een budget van
 * 224). v1.188: op de vraagregel, tussen de knoppen. v1.189: in de witte
 * standaardbalk van `BordKop`, waar alle paginacontrols staan — de vraagregel
 * draagt sinds die versie alleen nog de vraag.
 *
 * Props:
 *   label    naam van de as ("periode")
 *   opties   [{ id, label, uit?, titel? }]
 *   actief   id van de gekozen stand
 *   onKies   (id) => void
 *   scope    korte telegramtekst achter de knoppen: waarop de stand werkt
 *
 * Voor de as **periode** is er `BordPeriode` (ui/BordPeriode.jsx): dezelfde
 * knoppen, maar met het contract dat elke stand aan een kolom of venster van
 * een `v_d*`-view hangt. Een bord dat dat contract niet kan waarmaken krijgt
 * geen periodefilter — niet een uitgeschakelde (v1.191).
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
 * BordTabs — paginatabs in de kop: twee of drie views van hetzelfde onderwerp
 * die echt bij elkaar horen (Live overzicht ↔ Kwartaal op D1).
 *
 * Verschil met BordZuster: zusterpagina's zijn losse bestemmingen, tabs zijn
 * dezelfde pagina in een andere stand. De actieve tab draagt een accentlijn;
 * de andere is een link zonder pijl. Beide staan in het `filters`-slot van
 * BordKop, vóór een eventueel periodefilter.
 */
export function BordTabs({ tabs }) {
  return (
    <div className="bs-tabs" role="tablist">
      {tabs.map(t => (
        <button
          key={t.id}
          type="button"
          role="tab"
          className={`bs-tabs__tab${t.actief ? ' is-actief' : ''}`}
          aria-selected={t.actief}
          onClick={t.actief ? undefined : t.onClick}
        >
          {t.label}
        </button>
      ))}
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
