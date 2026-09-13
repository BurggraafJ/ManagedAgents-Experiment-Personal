import { getal, decimaal } from '../stuurinformatie/format'

/**
 * VerliesDiagnose — de drie vragen onder de eerste blik: waarom, wanneer, waar.
 *
 * Waarom: twee bronnen, twee blokken, nooit één staafdiagram. De AI-categorieën
 * van de churn-analytics-agent dekken de klantkant (B en C); het HubSpot-veld
 * `closed_lost_reason` dekt de prospectkant (A) en is nul van zevenenvijftig.
 * Die nul staat er met opzet groot en rood in plaats van dat de balk wordt
 * weggelaten — het bord dwingt het gedrag af dat de data ontbeert
 * (per-dashboard.md, D10).
 *
 * Wanneer: de tijd tot verlies per soort, mediaan én gemiddelde, met de
 * grondslag erbij. Bij twintig records vervormt één uitschieter een gemiddelde
 * volledig, en A meet iets anders (aanmaak → verliesstage) dan B en C
 * (startdatum → einddatum). Twee verschillende grondslagen naast elkaar zonder
 * label is hoe een bord onvergelijkbare getallen vergelijkbaar laat lijken.
 *
 * Waar: een rode lege plek. Segmentatie op kantoorgrootte vraagt
 * `totale_omvang` op de company, en dat veld staat op een fractie van de
 * mirror. De lege plek is het argument voor het veld; hem weglaten zou de
 * vraag onzichtbaar maken.
 */

/**
 * Eén bronblok. `hard` is het bronlabel dat zegt hoe hard de reden is — de
 * AI-lezing is een afleiding uit notities en mails, het HubSpot-veld is wat
 * sales heeft ingevuld; geen van beide is een gemeten opzegreden. `gatLabel`
 * staat op elke rode rij, zodat "Reden onbekend 7/20" of "Niet geregistreerd
 * 57/57" nergens als een reden geciteerd kan worden (CD-review D10 v1.175).
 */
function RedenBlok({ titel, hard, bereik, rijen, gatLabel, toonVenster }) {
  if (rijen.length === 0) return null
  const max = Math.max(1, ...rijen.map(r => r.aantal || 0))
  const gaten = rijen.filter(r => r.is_niet_geregistreerd)
  const alleenGaten = gaten.length === rijen.length
  const gatAantal = gaten.reduce((n, r) => n + (r.aantal || 0), 0)
  const noemer = rijen[0]?.noemer

  return (
    <div className="d10-reden">
      <div className="d10-reden__kop">
        <span className="d10-reden__bron">{titel}</span>
        <span className="d10-reden__bereik">{bereik}</span>
      </div>
      <span className="d10-reden__hard">{hard}</span>
      {rijen.map(r => (
        <div key={`${r.bron}-${r.reden}`} className={`d10-reden__rij ${r.is_niet_geregistreerd ? 'is-gat' : ''}`}>
          <span className="d10-reden__label" title={r.reden}>
            {r.reden}
            {r.is_niet_geregistreerd && <span className="d10-reden__gat">{gatLabel}</span>}
          </span>
          <span className="d10-reden__balk">
            {/* De categoriekleur komt uit churn_categories en mag alleen een
                échte reden kleuren. Een gat ("Reden onbekend", "nog geen
                dossier", "niet geregistreerd") houdt de rode klasse-kleur:
                een inline background zou die overschrijven, en dan is
                uitgerekend de balk die groot en rood hoort te zijn grijs. */}
            <i
              style={{
                width: `${Math.max(2, ((r.aantal || 0) / max) * 100)}%`,
                ...(r.is_niet_geregistreerd ? {} : { background: r.kleur || undefined }),
              }}
            />
          </span>
          <span className="d10-reden__n">
            {getal(r.aantal)}<span className="d10-reden__noemer"> / {getal(r.noemer)}</span>
          </span>
        </div>
      ))}
      {alleenGaten && (
        <p className="d10-voetnoot d10-voetnoot--gat">
          {getal(gatAantal)} van {getal(noemer)}: {gatLabel}. Dat is ontbrekende registratie,
          geen opgegeven reden — hier valt niets uit te citeren.
        </p>
      )}
      {toonVenster && (
        <p className="d10-voetnoot">
          Laatste dertig dagen: {toonVenster}. De oude KPI-strip toonde die top-reden als
          hoofdgetal; bij dit aantal waarnemingen is een ranglijst over dertig dagen ruis,
          dus staat het volledige venster voorop en dertig dagen erachter.
        </p>
      )}
    </div>
  )
}

export default function VerliesDiagnose({ redenen, kop, meta }) {
  const ai = redenen.filter(r => r.bron === 'ai')
  const hs = redenen.filter(r => r.bron === 'hubspot')

  // Het venster van dertig dagen komt uit de view, niet uit een berekening hier.
  const ai30 = ai.filter(r => (r.aantal_30d || 0) > 0)
  const venster30 = ai30.length === 0
    ? 'geen enkel dossier'
    : ai30.map(r => `${r.reden} ${getal(r.aantal_30d)}`).join(' · ')

  const segmentDekking = meta && meta.companies_zichtbaar
    ? (meta.companies_met_omvang / meta.companies_zichtbaar) * 100
    : null

  return (
    <section className="d10-blok">
      <div className="d10-blok__kop">
        <h3 className="d10-blok__titel">Waarom, wanneer en waar</h3>
      </div>

      <div className="d10-diagnose">
        <div className="d10-diagnose__kolom">
          <h4 className="d10-diagnose__titel">Waarom</h4>
          <RedenBlok
            titel="AI-lezing uit notities en mails"
            hard="AI-afleiding · geen gemeten opzegreden"
            bereik="B · C — klantkant"
            rijen={ai}
            gatLabel="AI kon geen reden vaststellen"
            toonVenster={venster30}
          />
          <RedenBlok
            titel="Veld closed_lost_reason in HubSpot"
            hard="door sales ingevuld · geen gemeten opzegreden"
            bereik="A — prospectkant"
            rijen={hs}
            gatLabel="HubSpot-veld leeg"
          />
          <p className="d10-voetnoot">
            Geen van beide blokken is een gemeten opzegreden: links staat wat de AI uit notities
            en mails afleidt, rechts wat sales in HubSpot heeft ingevuld. Een opgave van de klant
            zelf bestaat vandaag als bron niet; de rode rijen zijn ontbrekende registratie, geen
            reden.
          </p>
        </div>

        <div className="d10-diagnose__kolom">
          <h4 className="d10-diagnose__titel">Wanneer</h4>
          <div className="d10-duur">
            {kop.map(r => (
              <div key={r.soort} className="d10-duur__rij">
                <span className="d10-duur__soort">{r.soort}</span>
                <div className="d10-duur__tekst">
                  <b>
                    {r.duur_mediaan == null
                      ? 'geen meting'
                      : `mediaan ${getal(r.duur_mediaan)} dagen`}
                  </b>
                  {r.duur_gemiddeld != null && (
                    <span> · gemiddeld {getal(r.duur_gemiddeld)} · {getal(r.duur_min)}–{getal(r.duur_max)}</span>
                  )}
                  <span className="d10-duur__grondslag">{r.duur_grondslag}</span>
                </div>
              </div>
            ))}
          </div>
          <p className="d10-voetnoot">
            De grens tussen B en C is een duurregel van {getal(meta?.duurgrens_dagen)} dagen, geen
            statusveld: een verlengde proef wordt administratief nergens vastgelegd.
            {meta?.grensgevallen > 0 && (
              <> <b>{getal(meta.grensgevallen)} van de {getal(meta.bc_totaal)}</b> records liggen binnen
              {' '}{getal(meta.grensmarge_dagen)} dagen van die grens en kunnen door één administratieve
              slordigheid van soort wisselen.</>
            )}
          </p>
        </div>

        <div className="d10-diagnose__kolom">
          <h4 className="d10-diagnose__titel">Waar</h4>
          <div className="d10-leeg d10-leeg--rood">
            <span className="d10-leeg__kop">Segment · kantoorgrootte</span>
            <p className="d10-leeg__tekst">
              Niet te maken. Segmentatie vraagt <code>totale_omvang</code> op de company, en dat
              veld staat op {getal(meta?.companies_met_omvang)} van {getal(meta?.companies_zichtbaar)} kantoren
              {segmentDekking != null && <> ({decimaal(segmentDekking, 1)} %)</>}. Dit is dezelfde lege
              plek als op het pipelinebord — één veld, drie borden.
            </p>
          </div>
          <div className="d10-leeg d10-leeg--rood">
            <span className="d10-leeg__kop">Early-warning · dalend gebruik</span>
            <p className="d10-leeg__tekst">
              Niet te maken. Een lijst van klanten met dalend gebruik vraagt gebruiksdata, en
              die is in dit project nergens ontsloten. De lijst blijft als lege plek staan: dat
              is het argument voor de koppeling, niet een reden om de vraag te verbergen.
            </p>
          </div>
        </div>
      </div>
    </section>
  )
}
