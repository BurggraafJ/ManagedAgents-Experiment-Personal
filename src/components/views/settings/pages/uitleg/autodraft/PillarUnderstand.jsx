/**
 * Fundament 1 — Begrijpen & indexeren.
 * De classificatie-laag: elke mail langs vijf brillen + een doorzoekbaar geheugen.
 * Kernpunt: dit is descriptief (wát is dit), nog geen actie.
 */
export default function PillarUnderstand() {
  return (
    <>
      <section className="set-ex-hero">
        <div className="set-ex-hero__tag">fundament 1</div>
        <h3 className="set-ex-hero__title">Begrijpen &amp; indexeren</h3>
        <p className="set-ex-hero__lede">
          Voordat het systeem iets dóét, snapt het eerst wát er binnenkomt — en het
          onthoudt alles wat het ziet. Hier wordt een berg losse mails een
          <em> geheugen dat je kunt bevragen</em>.
        </p>
      </section>

      <section className="set-ex-card">
        <div className="set-ex-card__kicker">stap 1 — de vijf brillen</div>
        <h4 className="set-ex-card__title">Elke mail langs vijf brillen</h4>
        <p>
          Elke binnenkomende mail wordt langs vijf onafhankelijke "brillen" gehaald.
          Samen vormen ze een rijke beschrijving van wie, wat en waarover — de basis
          voor alles wat daarna gebeurt.
        </p>
        <div className="set-ex-bril-grid">
          <div className="set-ex-bril">
            <div className="set-ex-bril__num">1</div>
            <div className="set-ex-bril__h">Wie &amp; in welke fase</div>
            <p>Klant, lead, partner, leverancier? En was hij dat tóén ook al?</p>
          </div>
          <div className="set-ex-bril">
            <div className="set-ex-bril__num">2</div>
            <div className="set-ex-bril__h">Wat doet de mail</div>
            <p>Vraagt iets, stelt iets voor, bevestigt iets? Vraagt het om antwoord?</p>
          </div>
          <div className="set-ex-bril">
            <div className="set-ex-bril__num">3</div>
            <div className="set-ex-bril__h">Waarover</div>
            <p>Tot drie onderwerpen: pricing, contract, factuur, support, churn…</p>
          </div>
          <div className="set-ex-bril">
            <div className="set-ex-bril__num">4</div>
            <div className="set-ex-bril__h">Wat staat erin</div>
            <p>Eén-zin-samenvatting, sentiment, taal, genoemde namen.</p>
          </div>
          <div className="set-ex-bril">
            <div className="set-ex-bril__num">5</div>
            <div className="set-ex-bril__h">Waar in de klantreis</div>
            <p>Alleen voor klanten/leads: eerste contact, onderhandeling, churn-signaal?</p>
          </div>
        </div>
        <p className="set-ex-card__hint">
          Veel van dit werk is <strong>gratis en deterministisch</strong> (vaste regels);
          alleen de twijfelgevallen gaan langs een AI-classifier. Dieper lezen? Zie de
          uitleg <em>Mail-verrijking</em>.
        </p>
      </section>

      <section className="set-ex-card">
        <div className="set-ex-card__kicker">stap 2 — het geheugen</div>
        <h4 className="set-ex-card__title">Indexeren: een berg mails wordt doorzoekbaar</h4>
        <p>
          De brillen worden niet alleen op nieuwe mail toegepast, maar op je hele
          historie. Duizenden mails zijn zo <strong>geïndexeerd</strong> tot een
          gestructureerd geheugen: niet "deze mail bestaat", maar "deze kwam van een
          actieve klant, ging over een contract-onderhandeling met een zorg-toon".
          Dat is wat fundament 2 straks kan bevragen — plus de kennisbank, waar de
          antwoorden op terugkerende vragen in leven.
        </p>
      </section>

      <section className="set-ex-card">
        <div className="set-ex-card__kicker">één concreet voorbeeld</div>
        <h4 className="set-ex-card__title">Een mail, en wat we eruit halen</h4>
        <div className="set-ex-example">
          <div className="set-ex-example__mail">
            <div className="set-ex-example__head">
              <div><strong>Van:</strong> george@advocatenkantoor.nl</div>
              <div><strong>Onderwerp:</strong> Re: SLA-variant + korte sync?</div>
            </div>
            <div className="set-ex-example__body">
              <p>Hi Jelle, de SLA ziet er goed uit, op de compensatie na. Kunnen we
                deze week kort bellen? Donderdag het liefst.</p>
            </div>
          </div>
          <div className="set-ex-example__arrow">→</div>
          <div className="set-ex-example__labels">
            <div className="set-ex-example__group">
              <div className="set-ex-example__group-title">Wie &amp; fase</div>
              <ul>
                <li><code>party</code>: <strong>customer</strong></li>
                <li><code>fase toen</code>: <strong>active</strong></li>
              </ul>
            </div>
            <div className="set-ex-example__group">
              <div className="set-ex-example__group-title">Wat &amp; waarover</div>
              <ul>
                <li><code>bedoeling</code>: <strong>verzoek + afspraak</strong></li>
                <li><code>onderwerp</code>: <strong>contract-onderhandeling</strong></li>
              </ul>
            </div>
          </div>
        </div>
        <p className="set-ex-card__hint">
          Let op: dit is <strong>classificatie</strong> — een beschrijving van wát de
          mail is. Nog geen actie. Wat ermee moet gebeuren, wordt in fundament 2
          afgewogen en in fundament 3 gedaan.
        </p>
      </section>
    </>
  )
}
