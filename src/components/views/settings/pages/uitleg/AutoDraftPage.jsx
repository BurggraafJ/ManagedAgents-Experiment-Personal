import { SettingsPage } from '../../SettingsLayout'

/**
 * AutoDraftPage — uitleg-pagina onder Instellingen → Uitleg.
 *
 * Doel: in begrijpelijke taal vertellen wat AutoDraft als geheel doet —
 * van een binnenkomende mail tot een concept-antwoord of een actie die
 * klaarligt. Vertelt hoe de keten in elkaar haakt (verrijking → categorie
 * → actie → stijl → uitvoeren), welke drie "snelheden" er zijn, welke
 * veiligheids-rails eronder liggen, en waar je zelf aan kunt draaien.
 *
 * Tweede in de groep "Uitleg", na Mail-verrijking. Niet tijdsafhankelijk —
 * wordt langs het project mee-geüpdatet. Hergebruikt de set-ex-* styling.
 */
export default function AutoDraftPage() {
  return (
    <SettingsPage
      title="AutoDraft"
      intro="Hoe je postvak elke mail leest, begrijpt en een antwoord of actie klaarlegt — en waar jij altijd de knip houdt."
    >
      <div className="set-ex">

        {/* Hero */}
        <section className="set-ex-hero">
          <div className="set-ex-hero__tag">het idee</div>
          <h3 className="set-ex-hero__title">
            Van een volle inbox naar een postvak dat het voorwerk al deed.
          </h3>
          <p className="set-ex-hero__lede">
            AutoDraft leest elke binnenkomende mail, bepaalt <em>wat het is</em>,
            <em> of het bij jou hoort</em> en <em>wat ermee moet gebeuren</em>, en
            legt vervolgens het juiste klaar: een concept-antwoord in jouw stijl,
            een doorstuur-actie, of gewoon netjes opbergen. Jij opent je postvak en
            hoeft alleen nog te kiezen. Versturen doe je altijd zelf.
          </p>
        </section>

        {/* Waarom */}
        <section className="set-ex-card">
          <div className="set-ex-card__kicker">waarom dit bestaat</div>
          <h4 className="set-ex-card__title">De duurste tien seconden zitten aan het begin van elke mail</h4>
          <p>
            Het echte werk van een inbox zit niet in het typen. Het zit in de tien
            seconden dáárvoor, bij elke mail opnieuw: <em>"wat is dit, is dit voor
            mij, en wat moet ik ermee?"</em>. Honderd mails per dag, duizend keer die
            kleine schakelaar omzetten. Dat sloopt je focus, niet het antwoorden zelf.
          </p>
          <p>
            AutoDraft neemt precies díe tien seconden over. Tegen de tijd dat jij de
            mail ziet, is de vraag <strong>"wat is dit en wat moet ik ermee"</strong> al
            beantwoord, en ligt het meest waarschijnlijke vervolg klaar. Jij houdt het
            oordeel, het systeem doet het uitzoekwerk.
          </p>
          <p className="set-ex-card__hint">
            Belangrijk: AutoDraft beslist nooit definitief. Het stelt voor. Jij keurt
            goed, past aan, of wijst af, en daarvan leert het de volgende keer.
          </p>
        </section>

        {/* De keten */}
        <section className="set-ex-card">
          <div className="set-ex-card__kicker">hoe het samenhangt</div>
          <h4 className="set-ex-card__title">Vijf schakels die in elkaar haken</h4>
          <p>
            AutoDraft is geen losse knop maar een ketting van kleine, gespecialiseerde
            onderdelen. Elk doet één ding goed en geeft het door aan het volgende.
            Zo ziet de reis van een mail eruit:
          </p>
          <div className="set-ex-bril-grid">
            <div className="set-ex-bril">
              <div className="set-ex-bril__num">1</div>
              <div className="set-ex-bril__h">Ophalen</div>
              <p>Elke paar minuten worden nieuwe mails uit Outlook in de database
                gezet, zodat de rest van de keten een verse kopie heeft om mee te
                werken.</p>
            </div>
            <div className="set-ex-bril">
              <div className="set-ex-bril__num">2</div>
              <div className="set-ex-bril__h">Verrijken</div>
              <p>De mail krijgt zijn "vijf brillen": wie stuurde het, wat wil hij,
                waar gaat het over, wat staat erin, en waar in de klantreis. (Zie de
                uitleg <em>Mail-verrijking</em>.)</p>
            </div>
            <div className="set-ex-bril">
              <div className="set-ex-bril__num">3</div>
              <div className="set-ex-bril__h">AutoDraft</div>
              <p>De schrijver. Kiest een categorie, bepaalt of het voor jou is, en
                stelt een antwoord of actie voor. Dit is het hart van het verhaal.</p>
            </div>
            <div className="set-ex-bril">
              <div className="set-ex-bril__num">4</div>
              <div className="set-ex-bril__h">Schrijfstijl</div>
              <p>Levert "hoe Jelle schrijft": je begroetingen, je toon per relatie,
                je stopwoorden. Zo klinkt elk concept als jij, niet als een robot.</p>
            </div>
            <div className="set-ex-bril">
              <div className="set-ex-bril__num">5</div>
              <div className="set-ex-bril__h">Uitvoeren</div>
              <p>Zet jouw beslissing om in Outlook: een concept in de juiste thread,
                of de mail naar de juiste map. Verstuurt nooit zelf.</p>
            </div>
          </div>
          <p className="set-ex-card__hint">
            Het idee achter deze opdeling: één grote alleskunner is broos. Vijf kleine
            schakels die elk hun werk loggen, kun je los testen, bijsturen en vertrouwen.
          </p>
        </section>

        {/* Stap 1 — categorie */}
        <section className="set-ex-card">
          <div className="set-ex-card__kicker">stap 1 — wat voor mail is dit</div>
          <h4 className="set-ex-card__title">Eerst een categorie, dan pas een antwoord</h4>
          <p>
            Voordat er ook maar één zin geschreven wordt, plaatst AutoDraft de mail in
            één van ruim twintig categorieën, en bepaalt het of de mail <strong>voor
            jou</strong> is (een echt verzoek) of <strong>niet voor jou</strong> (een
            nieuwsbrief, een systeem-notificatie, een cold-sales-pitch).
          </p>
          <div className="set-ex-bril-grid">
            <div className="set-ex-bril">
              <div className="set-ex-bril__num">K</div>
              <div className="set-ex-bril__h">Klanten</div>
              <p>Customer base, pilot, sales-lead, opvolging. Elk met eigen toon en
                eigen urgentie.</p>
            </div>
            <div className="set-ex-bril">
              <div className="set-ex-bril__num">P</div>
              <div className="set-ex-bril__h">Partners &amp; leveranciers</div>
              <p>Samenwerkingen, facturen, contracten. Vaak doorsturen of opbergen.</p>
            </div>
            <div className="set-ex-bril">
              <div className="set-ex-bril__num">I</div>
              <div className="set-ex-bril__h">Intern &amp; afspraken</div>
              <p>Het team, en mails die om een moment in je agenda vragen.</p>
            </div>
            <div className="set-ex-bril">
              <div className="set-ex-bril__num">R</div>
              <div className="set-ex-bril__h">Ruis</div>
              <p>Nieuwsbrieven, notificaties, bounces, automatische antwoorden. Bijna
                altijd "niet voor jou".</p>
            </div>
          </div>
          <p className="set-ex-card__hint">
            Veel van deze keuzes zijn <strong>gratis en deterministisch</strong>: een
            agenda-uitnodiging of een bounce herkent het systeem aan vaste regels,
            zonder dure AI. Alleen de twijfelgevallen gaan langs een taalmodel. Dat
            scheelt kosten én maakt het voorspelbaar.
          </p>
        </section>

        {/* Stap 2 — zes acties */}
        <section className="set-ex-card">
          <div className="set-ex-card__kicker">stap 2 — wat moet ermee gebeuren</div>
          <h4 className="set-ex-card__title">Niet drie antwoorden, maar zes soorten acties</h4>
          <p>
            De grote sprong die AutoDraft maakte: een mail vraagt lang niet altijd om
            een antwoord. Een factuur hoort naar finance, een nieuwsbrief naar het
            archief, een "we komen erop terug" in een wachtmap. Daarom denkt AutoDraft
            in zes soorten acties, waarvan antwoorden er maar één is:
          </p>
          <div className="set-ex-bril-grid">
            <div className="set-ex-bril">
              <div className="set-ex-bril__num">✍</div>
              <div className="set-ex-bril__h">Beantwoorden</div>
              <p>Een concept-reply, kort of uitgebreid, in jouw stijl. De meest
                voorkomende actie voor mails die echt voor jou zijn.</p>
            </div>
            <div className="set-ex-bril">
              <div className="set-ex-bril__num">↪</div>
              <div className="set-ex-bril__h">Doorsturen</div>
              <p>Naar finance of HR, met een kort begeleidend zinnetje. Voor facturen,
                salaris- of personeelszaken.</p>
            </div>
            <div className="set-ex-bril">
              <div className="set-ex-bril__num">🗂</div>
              <div className="set-ex-bril__h">Opbergen</div>
              <p>Naar het archief, een klant-map, of "In afwachting". De inbox blijft
                leeg zonder dat iets zoekraakt.</p>
            </div>
            <div className="set-ex-bril">
              <div className="set-ex-bril__num">📅</div>
              <div className="set-ex-bril__h">Inplannen</div>
              <p>Bij een verzoek om een afspraak: eerst je agenda checken, dan vrije
                momenten in het antwoord zetten.</p>
            </div>
            <div className="set-ex-bril">
              <div className="set-ex-bril__num">🎫</div>
              <div className="set-ex-bril__h">Uitbesteden</div>
              <p>Een bug of feature-verzoek wordt een taak voor het team (Jira). Pas
                actief als je dat aanzet.</p>
            </div>
            <div className="set-ex-bril">
              <div className="set-ex-bril__num">🙅</div>
              <div className="set-ex-bril__h">Vriendelijk afwijzen</div>
              <p>Cold-sales en ongevraagde pitches: een beleefde, korte "nee" en
                meteen uit het zicht.</p>
            </div>
          </div>
        </section>

        {/* Voorbeeld */}
        <section className="set-ex-card">
          <div className="set-ex-card__kicker">één concreet voorbeeld</div>
          <h4 className="set-ex-card__title">Een echte klantmail, van binnenkomst tot klaar voorstel</h4>

          <div className="set-ex-example">
            <div className="set-ex-example__mail">
              <div className="set-ex-example__head">
                <div><strong>Van:</strong> george@advocatenkantoor.nl</div>
                <div><strong>Onderwerp:</strong> Re: SLA-variant + korte sync?</div>
              </div>
              <div className="set-ex-example__body">
                <p>Hi Jelle,</p>
                <p>De nieuwe SLA ziet er goed uit, op de compensatie-regeling na, die
                  vind ik nu wel zwaar. Kunnen we hier deze week kort over bellen?
                  Donderdag het liefst, anders komt de board-review in de knel.</p>
                <p>Groet, George</p>
              </div>
            </div>

            <div className="set-ex-example__arrow">→</div>

            <div className="set-ex-example__labels">
              <div className="set-ex-example__group">
                <div className="set-ex-example__group-title">Categorie &amp; publiek</div>
                <ul>
                  <li><code>categorie</code>: <strong>klant_customer_base</strong></li>
                  <li><code>voor jou?</code>: <strong>ja — echt verzoek</strong></li>
                </ul>
              </div>
              <div className="set-ex-example__group">
                <div className="set-ex-example__group-title">Wat de brillen zien</div>
                <ul>
                  <li><code>bedoeling</code>: <strong>verzoek + afspraak</strong></li>
                  <li><code>onderwerp</code>: <strong>contract-onderhandeling</strong></li>
                  <li><code>urgentie</code>: <strong>deze week</strong></li>
                  <li><code>toon</code>: <strong>neutraal</strong></li>
                </ul>
              </div>
              <div className="set-ex-example__group">
                <div className="set-ex-example__group-title">Gekozen aanpak</div>
                <ul>
                  <li><code>actie</code>: <strong>Beantwoorden (uitgebreid)</strong></li>
                  <li><code>snelheid</code>: <strong>met afweging</strong></li>
                  <li><code>agenda</code>: <strong>gecheckt — 3 vrije momenten</strong></li>
                </ul>
              </div>
            </div>
          </div>

          <p className="set-ex-card__hint">
            Het resultaat: twee concept-antwoorden liggen klaar (een korte en een
            uitgebreide), met drie echte vrije momenten uit je agenda er al in
            verwerkt, en in een toon die past bij hoe je eerder met George mailde. Jij
            kiest er één, schaaft desgewenst bij, en klikt zelf op verzenden in Outlook.
          </p>
        </section>

        {/* Drie snelheden */}
        <section className="set-ex-card">
          <div className="set-ex-card__kicker">hoeveel mag het zelf</div>
          <h4 className="set-ex-card__title">Drie snelheden, jij bepaalt de grens</h4>
          <p>
            Niet elke mail verdient evenveel aandacht. Een nieuwsbrief opbergen is geen
            beslissing; een gevoelige klantmail beantwoorden wél. Daarom kent AutoDraft
            drie snelheden, gekozen op basis van hoe zeker het systeem is:
          </p>
          <div className="set-ex-bril-grid">
            <div className="set-ex-bril">
              <div className="set-ex-bril__num">0</div>
              <div className="set-ex-bril__h">Autopilot — nul klikken</div>
              <p>Alleen voor veilig opbergen (archief, mappen), en alleen als jij het
                per type expliciet aanzet. Binnen 24 uur altijd terug te draaien.</p>
            </div>
            <div className="set-ex-bril">
              <div className="set-ex-bril__num">1</div>
              <div className="set-ex-bril__h">Eén klik</div>
              <p>Het systeem is zeker van zijn zaak: één voorstel met een groene knop.
                Akkoord? Eén klik en klaar.</p>
            </div>
            <div className="set-ex-bril">
              <div className="set-ex-bril__num">3</div>
              <div className="set-ex-bril__h">Met afweging</div>
              <p>Twijfelgevallen en belangrijke mails: meerdere opties naast elkaar,
                met uitleg waarom. Jij weegt en kiest.</p>
            </div>
          </div>
          <p className="set-ex-card__hint">
            Harde regel: <strong>antwoorden, doorsturen en uitbesteden gaan nooit op
            autopilot</strong>, hoe zeker het systeem ook is. Iets dat naar buiten gaat,
            krijgt altijd eerst jouw klik. Autopilot is er puur om de ruis weg te
            ruimen.
          </p>
        </section>

        {/* Schrijfstijl */}
        <section className="set-ex-card">
          <div className="set-ex-card__kicker">het klinkt als jij</div>
          <h4 className="set-ex-card__title">Een apart geheugen voor jouw schrijfstijl</h4>
          <p>
            Een concept dat niet klinkt zoals jij praat, gebruik je toch niet. Daarom
            is er een aparte schakel die niets anders doet dan jouw stijl bewaken: hoe
            je groet en afsluit, hoe formeel of warm je bent per relatie, je vaste
            zinnetjes, en de dingen die je <em>nooit</em> doet (geen lange streepjes,
            altijd "je" in plaats van "u").
          </p>
          <p>
            Die stijl is geleerd uit duizenden van je eigen verzonden mails, en wordt
            per contact en per onderwerp fijner afgesteld. Hoe vaker je een concept
            bijschaaft, hoe scherper het beeld van "zo schrijft Jelle" wordt.
          </p>
        </section>

        {/* Veiligheid */}
        <section className="set-ex-card">
          <div className="set-ex-card__kicker">de rails eronder</div>
          <h4 className="set-ex-card__title">Wat AutoDraft met opzet nooit doet</h4>
          <ul className="set-ex-list">
            <li>
              <strong>Nooit zelf versturen.</strong> AutoDraft plaatst een concept in
              de juiste thread in Outlook. De allerlaatste klik, verzenden, is altijd
              van jou.
            </li>
            <li>
              <strong>Nooit een datum verzinnen.</strong> Voorstelt het een tijd? Dan
              is je agenda eerst gecheckt. Geen ruimte gevonden, dan staat dat er
              eerlijk in plaats van een gegokte datum.
            </li>
            <li>
              <strong>Nooit een map verzinnen.</strong> Opbergen kan alleen naar mappen
              die echt in jouw Outlook bestaan.
            </li>
            <li>
              <strong>Nooit stiekem leren.</strong> Nieuwe schrijfregels en nieuwe
              categorieën worden eerst als voorstel klaargezet. Pas als jij ze
              goedkeurt, gaan ze gelden.
            </li>
            <li>
              <strong>Alles wordt gelogd.</strong> Elke run, elke beslissing en elke
              kostenpost is terug te zien. Geen black box.
            </li>
          </ul>
        </section>

        {/* Wat je kunt sturen */}
        <section className="set-ex-card">
          <div className="set-ex-card__kicker">waar jij aan draait</div>
          <h4 className="set-ex-card__title">De knoppen die je hebt</h4>
          <div className="set-ex-opt-grid">
            <div className="set-ex-opt">
              <div className="set-ex-opt__h">Categorieën</div>
              <p>Bekijk en stel de categorieën bij die AutoDraft gebruikt om mail te
                herkennen.</p>
            </div>
            <div className="set-ex-opt">
              <div className="set-ex-opt__h">Acties</div>
              <p>Welke soorten acties mag het voorstellen, en voor welke veilige types
                zet je autopilot aan?</p>
            </div>
            <div className="set-ex-opt">
              <div className="set-ex-opt__h">Regels</div>
              <p>Leer-regels en skip-regels: "mail van dit adres mag altijd direct naar
                deze map".</p>
            </div>
            <div className="set-ex-opt">
              <div className="set-ex-opt__h">Kalibratie</div>
              <p>Zie zwart-op-wit hoe vaak je voorstellen overneemt, zodat je weet wat
                je gerust autonomer mag maken.</p>
            </div>
            <div className="set-ex-opt">
              <div className="set-ex-opt__h">Schrijfstijl</div>
              <p>Het profiel van hoe jij schrijft, met voorstellen tot verbetering die
                je accepteert of afwijst.</p>
            </div>
            <div className="set-ex-opt">
              <div className="set-ex-opt__h">Voorkeuren</div>
              <p>Korte instructies per categorie of per toon, die altijd zwaarder wegen
                dan wat het systeem zelf bedacht.</p>
            </div>
          </div>
        </section>

        {/* Slot */}
        <section className="set-ex-card set-ex-card--soft">
          <h4 className="set-ex-card__title">Onthoud dit</h4>
          <p>
            AutoDraft is geen knop die mails verstuurt. Het is een assistent die je
            inbox vóór je uitzoekt, zodat er aan het eind alleen nog een <strong>keuze
            </strong> overblijft, geen uitzoekwerk. De ruis verdwijnt vanzelf, het
            belangrijke ligt voorbereid klaar.
          </p>
          <p>
            En het wordt beter naarmate je het gebruikt: elke correctie, elke
            goedkeuring en elke afwijzing is een lesje dat het meeneemt. Hoe meer je
            ermee werkt, hoe meer het op jou gaat lijken.
          </p>
        </section>

      </div>
    </SettingsPage>
  )
}
