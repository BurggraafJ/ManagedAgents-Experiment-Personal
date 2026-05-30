/**
 * Fundament 2 — Context & afwegen.
 * De geschiedenis erbij halen (RAG, tijdlijnen, agenda, geleerde lessen) en de
 * verwachte actie bepalen (de router). De schakel tussen begrijpen en handelen.
 */
export default function PillarContext() {
  return (
    <>
      <section className="set-ex-hero">
        <div className="set-ex-hero__tag">fundament 2</div>
        <h3 className="set-ex-hero__title">Context &amp; afwegen</h3>
        <p className="set-ex-hero__lede">
          Een losse mail zegt weinig. Het systeem haalt de relevante geschiedenis
          erbij en weegt dán pas wat er moet gebeuren — <em>gegrond in wat er echt
          gebeurd is</em>, niet in een gok.
        </p>
      </section>

      <section className="set-ex-card">
        <div className="set-ex-card__kicker">wat is hier eerder gebeurd</div>
        <h4 className="set-ex-card__title">De geschiedenis erbij, automatisch</h4>
        <p>
          Voor elke mail die echt voor jou is, verzamelt het systeem de context die
          jij anders met de hand zou opzoeken:
        </p>
        <div className="set-ex-bril-grid">
          <div className="set-ex-bril">
            <div className="set-ex-bril__num">A</div>
            <div className="set-ex-bril__h">Eerdere gesprekken</div>
            <p>Verwante mails, deals en meetings uit je hele archief (semantisch gezocht).</p>
          </div>
          <div className="set-ex-bril">
            <div className="set-ex-bril__num">B</div>
            <div className="set-ex-bril__h">Contact- &amp; bedrijfstijdlijn</div>
            <p>Alle harde feiten over deze persoon en hun bedrijf, op een rij.</p>
          </div>
          <div className="set-ex-bril">
            <div className="set-ex-bril__num">C</div>
            <div className="set-ex-bril__h">Je agenda</div>
            <p>Vraagt de mail om een afspraak? Dan wordt je agenda eerst gecheckt.</p>
          </div>
          <div className="set-ex-bril">
            <div className="set-ex-bril__num">D</div>
            <div className="set-ex-bril__h">Geleerde voorkeuren</div>
            <p>Regels en lessen uit hoe jij eerder met dit soort mail omging.</p>
          </div>
        </div>
      </section>

      <section className="set-ex-card">
        <div className="set-ex-card__kicker">eerst ophalen, dan schrijven</div>
        <h4 className="set-ex-card__title">Geen verzonnen feiten</h4>
        <p>
          Dit is wat een betrouwbare assistent onderscheidt van eentje die alleen
          plausibel klinkt: <strong>eerst de feiten ophalen, dán pas formuleren</strong>.
          Een antwoord op een klantvraag leunt op de kennisbank, niet op een gok. En
          er komt nooit een datum in een concept zonder dat je agenda is geraadpleegd.
        </p>
      </section>

      <section className="set-ex-card">
        <div className="set-ex-card__kicker">van begrijpen naar beslissen</div>
        <h4 className="set-ex-card__title">De router: wat is de verwachte actie?</h4>
        <p>
          Met de brillen (fundament 1) plus de context bepaalt een <em>router</em> de
          meest waarschijnlijke handeling. Het combineert <strong>wie het stuurde ×
          wat de mail doet × waarover</strong> tot een verwachte actie: een factuur
          van een leverancier hoort naar finance, een afspraakverzoek vraagt om
          agenda-slots, een nieuwsbrief mag het archief in.
        </p>
        <p>
          Waar dat overduidelijk is, gebeurt het deterministisch (gratis, zonder AI).
          Waar het subtiel is, denkt het taalmodel mee. Hoe zeker de router is, bepaalt
          met hoeveel <em>autonomie</em> het in fundament 3 wordt klaargezet.
        </p>
        <p className="set-ex-card__hint">
          Dit fundament is de scharnier: het verbindt "wat ís dit" (1) met "doe het
          juiste" (3). Hoe beter de context, hoe scherper het voorstel.
        </p>
      </section>
    </>
  )
}
