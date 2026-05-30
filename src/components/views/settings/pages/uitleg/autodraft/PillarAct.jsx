/**
 * Fundament 3 — Handelen & klaarzetten.
 * De soorten handelingen/taken, de drie snelheden, de schrijfstijl, en de rails.
 */
export default function PillarAct() {
  return (
    <>
      <section className="set-ex-hero">
        <div className="set-ex-hero__tag">fundament 3</div>
        <h3 className="set-ex-hero__title">Handelen &amp; klaarzetten</h3>
        <p className="set-ex-hero__lede">
          Pas nu komt de daad: de juiste handeling <em>klaarzetten</em> of (deels)
          <em> uitvoeren</em>. Soms een antwoord, vaak iets heel anders — en altijd
          met de hand aan de rem.
        </p>
      </section>

      <section className="set-ex-card">
        <div className="set-ex-card__kicker">niet alleen antwoorden</div>
        <h4 className="set-ex-card__title">De juiste handeling, niet zomaar een mail</h4>
        <p>
          De meeste mail vraagt niet om een antwoord. Daarom denkt AutoDraft in
          handelingen, waarvan beantwoorden er maar één is:
        </p>
        <div className="set-ex-bril-grid">
          <div className="set-ex-bril">
            <div className="set-ex-bril__num">✍</div>
            <div className="set-ex-bril__h">Beantwoorden</div>
            <p>Concept-reply in jouw stijl — soms ondersteund met een antwoord uit de kennisbank.</p>
          </div>
          <div className="set-ex-bril">
            <div className="set-ex-bril__num">📅</div>
            <div className="set-ex-bril__h">Inplannen</div>
            <p>Agenda checken en drie vrije momenten voorstellen.</p>
          </div>
          <div className="set-ex-bril">
            <div className="set-ex-bril__num">↪</div>
            <div className="set-ex-bril__h">Doorsturen</div>
            <p>Naar finance of HR, met een kort begeleidend zinnetje.</p>
          </div>
          <div className="set-ex-bril">
            <div className="set-ex-bril__num">🗂</div>
            <div className="set-ex-bril__h">Opbergen</div>
            <p>Naar archief, klant-map of "In afwachting" — de inbox blijft leeg.</p>
          </div>
          <div className="set-ex-bril">
            <div className="set-ex-bril__num">💬</div>
            <div className="set-ex-bril__h">Commentaar geven</div>
            <p>Een toegestuurd stuk doorlezen en er inhoudelijke feedback bij zetten.</p>
          </div>
          <div className="set-ex-bril">
            <div className="set-ex-bril__num">🙅</div>
            <div className="set-ex-bril__h">Wegzetten</div>
            <p>Cold-sales: een beleefde, korte "nee" en meteen uit het zicht.</p>
          </div>
        </div>
        <p className="set-ex-card__hint">
          De takenlijst groeit mee: van een paar nu naar zo'n tien à vijftien. Hoe dat
          schaalbaar blijft, staat in de project-pagina <em>"Van schrijven naar doen"</em>.
        </p>
      </section>

      <section className="set-ex-card">
        <div className="set-ex-card__kicker">hoeveel mag het zelf</div>
        <h4 className="set-ex-card__title">Drie snelheden, jij bepaalt de grens</h4>
        <div className="set-ex-bril-grid">
          <div className="set-ex-bril">
            <div className="set-ex-bril__num">0</div>
            <div className="set-ex-bril__h">Autopilot — nul klikken</div>
            <p>Alleen voor veilig opbergen, en alleen als jij het per type aanzet. Binnen 24u terug te draaien.</p>
          </div>
          <div className="set-ex-bril">
            <div className="set-ex-bril__num">1</div>
            <div className="set-ex-bril__h">Eén klik</div>
            <p>Zeker van zijn zaak: één voorstel met een groene knop.</p>
          </div>
          <div className="set-ex-bril">
            <div className="set-ex-bril__num">3</div>
            <div className="set-ex-bril__h">Met afweging</div>
            <p>Twijfel of gevoelig: meerdere opties met uitleg. Jij weegt en kiest.</p>
          </div>
        </div>
        <p className="set-ex-card__hint">
          Zelfstandigheid wordt <strong>verdiend</strong>: een taak begint als suggestie
          en mag pas autonomer worden als de cijfers laten zien dat je 'm tóch al bijna
          altijd goedkeurt.
        </p>
      </section>

      <section className="set-ex-card">
        <div className="set-ex-card__kicker">het klinkt als jij</div>
        <h4 className="set-ex-card__title">Jouw schrijfstijl, bewaakt</h4>
        <p>
          Elk concept gaat door een aparte stijl-laag, geleerd uit duizenden van je
          eigen verzonden mails: je begroetingen, je toon per relatie, en de dingen die
          je nooit doet (geen lange streepjes, altijd "je"). Zo gebruik je het ook echt.
        </p>
      </section>

      <section className="set-ex-card">
        <div className="set-ex-card__kicker">de rails eronder</div>
        <h4 className="set-ex-card__title">Wat het met opzet nooit doet</h4>
        <ul className="set-ex-list">
          <li><strong>Nooit zelf versturen.</strong> Het zet een concept klaar in Outlook; jij klikt verzenden.</li>
          <li><strong>Autopilot alleen voor verplaatsen.</strong> Iets dat naar buiten gaat, krijgt altijd eerst jouw klik — zo kan een verborgen instructie in een mail niets uitrichten.</li>
          <li><strong>Nooit een datum of map verzinnen.</strong> Tijden komen uit je agenda, mappen bestaan echt in Outlook.</li>
          <li><strong>Leert alleen via voorstellen.</strong> Nieuwe regels gelden pas als jij ze goedkeurt.</li>
          <li><strong>Alles gelogd &amp; terug te draaien.</strong> Geen black box, een terugknop binnen 24 uur.</li>
        </ul>
      </section>
    </>
  )
}
