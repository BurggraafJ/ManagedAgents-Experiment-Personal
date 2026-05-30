/**
 * Overview — landingssectie van de AutoDraft-uitleg.
 * Toont de drie fundamenten als klikbare kaarten (zoom-in) + de rode draad.
 * onOpen(tabId) schakelt de segmented-nav in de shell.
 */
export default function Overview({ onOpen }) {
  return (
    <>
      <section className="set-ex-hero">
        <div className="set-ex-hero__tag">hoe je postvak denkt</div>
        <h3 className="set-ex-hero__title">
          Drie fundamenten: begrijpen, afwegen, handelen.
        </h3>
        <p className="set-ex-hero__lede">
          AutoDraft is geen knop maar een keten van drie fundamenten. Eerst
          <em> begrijpt</em> het elke mail en bouwt er geheugen van op, dan
          <em> weegt</em> het met de juiste context erbij wat er moet gebeuren,
          en pas dan <em>handelt</em> het: iets klaarzetten of (deels) uitvoeren.
          Jij houdt altijd de knip. Kies een fundament om in te zoomen, of lees
          bij <em>Samenhang</em> hoe ze samen één beweging vormen.
        </p>
      </section>

      <div className="set-ex-pillars">
        <button type="button" className="set-ex-pillar" onClick={() => onOpen('begrijpen')}>
          <div className="set-ex-pillar__num">1</div>
          <div className="set-ex-pillar__h">Begrijpen &amp; indexeren</div>
          <p className="set-ex-pillar__sub">
            Wat ís deze mail, en wat weten we al? Elke mail langs vijf "brillen",
            plus een doorzoekbaar geheugen van je hele historie.
          </p>
          <span className="set-ex-pillar__go">Inzoomen →</span>
        </button>

        <button type="button" className="set-ex-pillar" onClick={() => onOpen('context')}>
          <div className="set-ex-pillar__num">2</div>
          <div className="set-ex-pillar__h">Context &amp; afwegen</div>
          <p className="set-ex-pillar__sub">
            Wat is hier eerder gebeurd, en wat moet er gebeuren? De geschiedenis
            erbij halen en de verwachte actie bepalen.
          </p>
          <span className="set-ex-pillar__go">Inzoomen →</span>
        </button>

        <button type="button" className="set-ex-pillar" onClick={() => onOpen('handelen')}>
          <div className="set-ex-pillar__num">3</div>
          <div className="set-ex-pillar__h">Handelen &amp; klaarzetten</div>
          <p className="set-ex-pillar__sub">
            De juiste handeling klaarzetten of (deels) uitvoeren, in drie
            snelheden, met de hand aan de rem.
          </p>
          <span className="set-ex-pillar__go">Inzoomen →</span>
        </button>
      </div>

      <section className="set-ex-card set-ex-card--soft">
        <div className="set-ex-card__kicker">de rode draad</div>
        <h4 className="set-ex-card__title">Eén belofte verbindt de drie</h4>
        <p>
          <strong>De inbox moet minder van jouw aandacht vragen.</strong> Niet door
          jou te vervangen, maar door het uitzoekwerk vóór je te doen, zodat er aan
          het eind alleen nog een <em>keuze</em> overblijft. De drie fundamenten zijn
          de stappen daarnaartoe: begrijpen wat binnenkomt, wegen wat het betekent,
          en het juiste klaarzetten.
        </p>
        <p className="set-ex-card__hint">
          De belangrijkste rail staat al vast: AutoDraft verstuurt <strong>nooit</strong>
          zelf. De allerlaatste klik is altijd van jou.
        </p>
      </section>
    </>
  )
}
