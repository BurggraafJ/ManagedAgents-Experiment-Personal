import { SettingsPage } from '../../SettingsLayout'

/**
 * MailVerrijkingPage — uitleg-pagina onder Instellingen → Uitleg.
 *
 * Doel: in begrijpelijke taal vertellen wat mail-metadata-verrijking doet,
 * waarom het waardevol is en welke knoppen je (straks) hebt om eraan te
 * draaien. Niet tijdsafhankelijk — wordt langs het project mee-geüpdatet.
 *
 * Eerste in een nieuwe groep "Uitleg" — er volgen er meer naarmate andere
 * systemen uitleg verdienen.
 */
export default function MailVerrijkingPage() {
  return (
    <SettingsPage
      title="Mail-verrijking"
      intro="Wat het is, waarom we het doen, en hoe het straks jouw werkdag verandert."
    >
      <div className="set-ex">

        {/* Hero — pakkende opening */}
        <section className="set-ex-hero">
          <div className="set-ex-hero__tag">het idee</div>
          <h3 className="set-ex-hero__title">
            Van een berg mails naar een geheugen dat je kan bevragen.
          </h3>
          <p className="set-ex-hero__lede">
            We laten een AI elke binnenkomende mail langs vijf "brillen" lopen —
            en slaan per mail op wát erin staat, wíé hem stuurde (in welke rol
            op dat moment), wat de bedoeling was, en hoe het past in de
            klantreis. Eenmaal verrijkt is een vraag als <em>"laat me alle
            contract-onderhandelingen zien waar de klant een zorg uitsprak"</em>
            een query van twee tellen.
          </p>
        </section>

        {/* Waarom — psychologie */}
        <section className="set-ex-card">
          <div className="set-ex-card__kicker">waarom dit werkt</div>
          <h4 className="set-ex-card__title">Ons brein zoekt op associaties — een database niet</h4>
          <p>
            Je hebt vast wel eens gedacht: <em>"die mail van vorig jaar over die
            SLA-onderhandeling met dat advocatenkantoor, waar zat die ook
            alweer?"</em>. Je brein onthoudt het verhaal — de klant, het
            onderwerp, de spanning, de toon — maar niet het exacte zoekwoord.
            En dus zit je 20 minuten in Outlook te scrollen.
          </p>
          <p>
            Wat we hier doen is precies dat verhaal-deel codificeren. Niet
            alleen "ja deze mail bestaat" maar <strong>"deze mail kwam van een
            klant die toen al actief was, ging over contract-onderhandeling
            met een zorg-toon, en vroeg om reactie binnen een week"</strong>.
            Dát is wat je brein onbewust al opslaat — en wat tot nu toe verloren
            ging op het moment dat je de mail wegklikte.
          </p>
          <p className="set-ex-card__hint">
            Bijvangst: de kleine dopamine-hit als je een vraag stelt en het
            systeem precies de drie relevante mails laat zien. Geen geploeter
            meer.
          </p>
        </section>

        {/* Hoe — 5 brillen */}
        <section className="set-ex-card">
          <div className="set-ex-card__kicker">hoe het werkt</div>
          <h4 className="set-ex-card__title">Vijf brillen, samen één rijke beschrijving</h4>
          <p>
            Elke mail wordt langs vijf onafhankelijke "brillen" gehaald.
            Sommige zijn gratis en deterministisch (regels), andere gebruiken
            een goedkope AI-classifier, en alleen voor commerciële mails komt
            er nog een uitgebreidere AI-laag overheen.
          </p>

          <div className="set-ex-bril-grid">
            <div className="set-ex-bril">
              <div className="set-ex-bril__num">1</div>
              <div className="set-ex-bril__h">Wie &amp; in welke fase</div>
              <p>Is deze afzender een klant, lead, partner, leverancier? En —
                belangrijk — was hij dat <em>toen</em> ook al, of is dat pas
                later geworden?</p>
            </div>
            <div className="set-ex-bril">
              <div className="set-ex-bril__num">2</div>
              <div className="set-ex-bril__h">Wat doet de mail</div>
              <p>Stelt iets voor, vraagt iets, levert iets op, bevestigt
                iets? Vraagt om antwoord? Is het urgent?</p>
            </div>
            <div className="set-ex-bril">
              <div className="set-ex-bril__num">3</div>
              <div className="set-ex-bril__h">Waar gaat het over</div>
              <p>Tot drie onderwerpen uit een gedeelde lijst: pricing, demo,
                contract-onderhandeling, factuur, onboarding, churn, …</p>
            </div>
            <div className="set-ex-bril">
              <div className="set-ex-bril__num">4</div>
              <div className="set-ex-bril__h">Wat staat erin</div>
              <p>Eén-zin-samenvatting, sentiment, taal, en bij relevante
                mails een paragraaf-samenvatting plus genoemde entiteiten.</p>
            </div>
            <div className="set-ex-bril">
              <div className="set-ex-bril__num">5</div>
              <div className="set-ex-bril__h">Waar in de klantreis</div>
              <p>Alleen voor klanten/leads: zit deze mail in een eerste
                contact, een offerte-onderhandeling, een renewal-window, of
                tikt er een churn-signaal?</p>
            </div>
          </div>
        </section>

        {/* Voorbeeld — concrete mail naar labels */}
        <section className="set-ex-card">
          <div className="set-ex-card__kicker">één concreet voorbeeld</div>
          <h4 className="set-ex-card__title">Een echte klantmail, en wat we eruit halen</h4>

          <div className="set-ex-example">
            <div className="set-ex-example__mail">
              <div className="set-ex-example__head">
                <div><strong>Van:</strong> george@advocatenkantoor.nl</div>
                <div><strong>Onderwerp:</strong> Re: Controle nieuwe SLA-variant</div>
              </div>
              <div className="set-ex-example__body">
                <p>Hi Jelle,</p>
                <p>We hebben de SLA opnieuw bekeken naar aanleiding van het ticket
                  vorige week. De compensatie-regeling vind ik nu wel zwaar geworden —
                  willen we hier nog even kort over praten? Voor donderdag idealiter,
                  anders komt de board-review in de knel.</p>
                <p>Groet, George</p>
              </div>
            </div>

            <div className="set-ex-example__arrow">→</div>

            <div className="set-ex-example__labels">
              <div className="set-ex-example__group">
                <div className="set-ex-example__group-title">Wie &amp; fase</div>
                <ul>
                  <li><code>party_type</code>: <strong>customer</strong></li>
                  <li><code>lifecycle_at_moment</code>: <strong>active</strong></li>
                  <li><code>relationship_age_days</code>: <strong>467</strong></li>
                </ul>
              </div>
              <div className="set-ex-example__group">
                <div className="set-ex-example__group-title">Wat doet de mail</div>
                <ul>
                  <li><code>speech_act</code>: <strong>propose</strong></li>
                  <li><code>intent_object</code>: <strong>meeting</strong></li>
                  <li><code>asks_response</code>: <strong>true</strong></li>
                  <li><code>urgency</code>: <strong>normal</strong></li>
                </ul>
              </div>
              <div className="set-ex-example__group">
                <div className="set-ex-example__group-title">Waarover</div>
                <ul>
                  <li><code>topics</code>: <strong>[contract_negotiation, support, license_agreement]</strong></li>
                </ul>
              </div>
              <div className="set-ex-example__group">
                <div className="set-ex-example__group-title">Wat staat erin</div>
                <ul>
                  <li><code>summary</code>: "Vindt SLA-compensatieregeling zwaar; vraagt kort gesprek vóór donderdag i.v.m. board-review."</li>
                  <li><code>sentiment</code>: <strong>neutral</strong></li>
                  <li><code>language</code>: <strong>nl</strong></li>
                </ul>
              </div>
              <div className="set-ex-example__group">
                <div className="set-ex-example__group-title">Klantreis-signaal</div>
                <ul>
                  <li><code>cycle_stage</code>: <strong>proposal_negotiation</strong></li>
                  <li><code>spin_type</code>: <strong>problem</strong></li>
                  <li><code>signal_type</code>: <strong>declared</strong></li>
                </ul>
              </div>
            </div>
          </div>

          <p className="set-ex-card__hint">
            Eén mail wordt zo een gestructureerde rij van ~25 velden. Een agent
            of zoekfilter kan daarmee precies hier landen vanuit een vraag als
            <em> "klanten die de afgelopen 30 dagen een zorg uitspraken over een
            contract"</em>.
          </p>
        </section>

        {/* Wat je ermee kan */}
        <section className="set-ex-card">
          <div className="set-ex-card__kicker">wat het je oplevert</div>
          <h4 className="set-ex-card__title">Een paar dingen die hierdoor mogelijk worden</h4>
          <ul className="set-ex-list">
            <li>
              <strong>Vroege churn-signalen.</strong> Niet pas als HubSpot de
              klant "beëindigd" zet, maar al wanneer de toon in mails kantelt.
            </li>
            <li>
              <strong>Renewal-prep 90 dagen vooraf.</strong> Het systeem ziet
              welke klanten in een renewal-window zitten en bundelt automatisch
              de relevante mail-historie.
            </li>
            <li>
              <strong>Auto-offerte aanleidingen.</strong> Een klant die om een
              prijswijziging vraagt? Filter <code>topic=pricing</code> +
              <code> speech_act=request</code> + <code>party_type=customer</code>
              en een concept-mail ligt klaar.
            </li>
            <li>
              <strong>Kennisbank-zoekvragen.</strong> "Alle
              licentie-onderhandelingen sinds 2024" wordt een filter — geen
              gegrep door je inbox meer.
            </li>
            <li>
              <strong>Inbox-zero geautomatiseerd.</strong> Bevestigingen en
              afsluitende mails (speech_act = ack of deliver) ouder dan 30 dagen
              kunnen automatisch naar Archief.
            </li>
          </ul>
        </section>

        {/* Wat je kunt instellen */}
        <section className="set-ex-card">
          <div className="set-ex-card__kicker">wat je straks kunt instellen</div>
          <h4 className="set-ex-card__title">Knoppen die je krijgt (binnenkort op deze pagina)</h4>

          <div className="set-ex-opt-grid">
            <div className="set-ex-opt">
              <div className="set-ex-opt__h">Maandelijkse kostencap</div>
              <p>Hard plafond (default $30/maand) — daarboven stopt
                verrijking automatisch. Plus zachte waarschuwing op 80%.</p>
            </div>
            <div className="set-ex-opt">
              <div className="set-ex-opt__h">Persoonlijke mails</div>
              <p>Mails van familie/vrienden uit-laten of meenemen? Privacy
                versus volledigheid. Default: <em>overslaan</em>.</p>
            </div>
            <div className="set-ex-opt">
              <div className="set-ex-opt__h">Talen</div>
              <p>Welke talen moet de verrijker meenemen? NL en EN staan
                standaard aan; DE, FR optioneel.</p>
            </div>
            <div className="set-ex-opt">
              <div className="set-ex-opt__h">Diepte per categorie</div>
              <p>Per mailcategorie: alleen snelle classificatie of ook
                paragraaf-samenvatting + entiteiten?</p>
            </div>
            <div className="set-ex-opt">
              <div className="set-ex-opt__h">Backfill-prioriteit</div>
              <p>Bij het terug-verrijken van historische mails: nieuwste
                eerst, klanten eerst, of beide tegelijk?</p>
            </div>
            <div className="set-ex-opt">
              <div className="set-ex-opt__h">Her-verrijking</div>
              <p>Als de topic-lijst groeit: oude mails opnieuw laten lopen
                op de nieuwe lijst, of laten staan?</p>
            </div>
          </div>
        </section>

        {/* Slot */}
        <section className="set-ex-card set-ex-card--soft">
          <h4 className="set-ex-card__title">Onthoud dit</h4>
          <p>
            Mail-verrijking is geen feature die op zichzelf staat — het is de
            <strong> ondergrond </strong>waar alle slimme agents straks op
            draaien. Auto-offertes, churn-watch, renewal-prep, slimme zoeken:
            allemaal hebben ze deze gestructureerde laag nodig.
          </p>
          <p>
            Het mooie: één keer goed verrijken, eindeloos hergebruiken. En
            zodra een nieuw teamlid z'n mailbox aansluit, gaat het systeem
            automatisch óók zijn historie verrijken. Geen losse setup per
            persoon.
          </p>
        </section>

      </div>
    </SettingsPage>
  )
}
