/**
 * Overview — de introductie van de AutoDraft-uitleg.
 * Warm, koffie-stijl: je komt binnen en weet nog niks, dus eerst het hele
 * plaatje + de samenhang, en daarna benoemt het de drie uitklapbare fundamenten.
 */
export default function Overview() {
  return (
    <>
      <section className="set-ex-hero">
        <div className="set-ex-hero__tag">begin hier</div>
        <h3 className="set-ex-hero__title">
          Je postvak, dat het voorwerk al voor je deed.
        </h3>
        <p className="set-ex-hero__lede">
          Stel je voor: je opent 's ochtends je mail en het meeste is al uitgezocht.
          De nieuwsbrieven zijn opgeruimd, bij de klantvraag ligt een concept-antwoord
          klaar mét het juiste artikel erin, de factuur staat klaar om door te zetten
          naar finance, en bij het afspraakverzoek staan al drie vrije momenten uit je
          agenda. Jij hoeft alleen nog te <em>kiezen</em>. Dat is AutoDraft. En het
          <em> verstuurt nooit zelf</em> — de laatste klik blijft altijd van jou.
        </p>
      </section>

      <section className="set-ex-card">
        <div className="set-ex-card__kicker">waarom dit bestaat</div>
        <h4 className="set-ex-card__title">De duurste tien seconden zitten aan het begin van elke mail</h4>
        <p>
          Het echte werk van een inbox zit niet in het typen. Het zit in de tien
          seconden dáárvoor, bij elke mail opnieuw: <em>"wat is dit, is dit voor mij, en
          wat moet ik ermee?"</em>. Honderd mails per dag, duizend keer die kleine
          schakelaar omzetten. Dat sloopt je aandacht, niet het antwoorden zelf.
        </p>
        <p>
          AutoDraft neemt precies die tien seconden over. Tegen de tijd dat jij de mail
          ziet, is de vraag "wat is dit en wat moet ermee" al beantwoord, en ligt het
          meest waarschijnlijke vervolg klaar. Jij houdt het oordeel; het systeem doet
          het uitzoekwerk. En hoe vaker je het bijstuurt, hoe meer het op jou gaat lijken.
        </p>
      </section>

      <section className="set-ex-card">
        <div className="set-ex-card__kicker">hoe het in elkaar zit</div>
        <h4 className="set-ex-card__title">Eén beweging, drie fundamenten</h4>
        <p>
          AutoDraft is geen losse knop maar een vloeiende keten. Onder de motorkap zijn
          dat drie fundamenten, die elk op de vorige voortbouwen. Samen zorgen ze dat een
          binnenkomende mail bij jou belandt als een kant-en-klare keuze in plaats van een
          klusje:
        </p>
        <ul className="set-ex-list">
          <li>
            <strong>1 · Begrijpen &amp; indexeren.</strong> Eerst snapt het systeem wát er
            binnenkomt — wie het stuurt, wat het wil, waarover het gaat — en het onthoudt
            alles, zodat je hele historie doorzoekbaar wordt.
          </li>
          <li>
            <strong>2 · Context &amp; afwegen.</strong> Dan haalt het de geschiedenis erbij
            (eerdere gesprekken, je agenda, wat je eerder deed) en weegt het wát er moet
            gebeuren — gegrond in echte feiten, niet in een gok.
          </li>
          <li>
            <strong>3 · Handelen &amp; klaarzetten.</strong> Pas dan zet het de juiste
            handeling klaar of voert die (deels) uit — een antwoord, een doorsturing, een
            opberg-actie — in drie snelheden, met de hand aan de rem.
          </li>
        </ul>
        <p className="set-ex-card__hint">
          Hieronder kun je elk fundament <strong>uitklappen</strong> voor het hele verhaal.
          Wil je liever eerst zien hoe de drie samen één geheel worden? Dat staat onderaan,
          bij <em>Samenhang</em>.
        </p>
      </section>
    </>
  )
}
