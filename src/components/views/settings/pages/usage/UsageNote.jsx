import { eur, STANDAARD_PLAFOND_EUR } from '../../../../../hooks/useModelUsage'

// De dingen die je moet weten om de tabel erboven goed te lezen. Ze staan
// eronder en niet in een gekleurde balk erboven: het zijn voorwaarden bij de
// cijfers, geen waarschuwing die je van de cijfers weghoudt.
//
// Wat hier NIET mag staan is een €0 voor wat niet gemeten is. Een nul die "we
// weten het niet" betekent is op een kostenpagina de duurste leugen die je kunt
// tonen, en precies daarom noemt de vierde alinea het gat zonder bedrag.

export default function UsageNote({ koers }) {
  return (
    <div className="usg-note">
      <p>
        <strong>Verbruik staat in dollar, het plafond in euro.</strong> De koers
        (<code>model_budget_usd_per_eur</code> in <code>dash_parameters</code>) is bewust
        leeg gelaten. Zolang die leeg is rekent dit scherm niets om en toont het geen
        percentage van het plafond — dat zou een zelf gekozen wisselkoers zijn.
        {koers === null && ' Vul de parameter om beide kolommen in één munt te krijgen.'}
      </p>
      <p>
        <strong>Het plafond remt sinds v1.198 echt.</strong> Elke regel staat op{' '}
        {eur(STANDAARD_PLAFOND_EUR)} per maand en is hier te wijzigen. Twee plekken houden
        zich eraan, allebei via <code>model_budget_state()</code>: een trigger op{' '}
        <code>agent_chat_runs</code> weigert een chatvraag van wie over is (de rij die
        geld gaat kosten komt er dan niet in), en de zes betaalde Edge Functions geven
        <code> 402 budget_exceeded</code> met het bedrag erbij.
      </p>
      <p>
        <strong>Wie niet geremd wordt, en waarom.</strong> De <b>owner</b> niet —
        beslissing 5 zegt "per member", en een plafond dat de eigenaar buiten zijn eigen
        product sluit is een self-lockout. Hij wordt wél gemeten en staat gewoon in de
        tabel. <b>Maestro</b> niet: die heeft geen sessie, dus geen persoon om te remmen;
        zijn getal in <code>dash_parameters.model_budget_maestro_eur</code> is een signaal
        voor jou, geen slot. En een <b>evalronde</b> niet: een meting is geen verbruik van
        een mens, en hem afknijpen maakt de poort onbetrouwbaar in plaats van zuinig.
        Pauzeren (<code>user_model_budget.paused</code>) sluit wél af, ongeacht het bedrag.
      </p>
      <p>
        <strong>Bron.</strong> <code>rag_chat_query_log.est_cost_usd</code> via{' '}
        <code>agent_chat_runs.caller_user_id</code> — de enige koppeling tussen een
        model-call en een mens die dit schema heeft. De regel <b>Maestro zelf</b> komt uit
        dezelfde tabel: het zijn de vragen waarbij rag-chat geen ingelogde gebruiker zag
        (<code>meta.caller_identified</code> is niet <code>true</code>). <b>Niet toe te
        wijzen</b> is het omgekeerde: wél een mens herkend, geen chat-run op naam. Dat is
        een meetgat in de logging, geen verbruik van niemand — daarom telt het niet bij
        Maestro op.
      </p>
      <p>
        <strong>Verbruik overig, en wat er nog steeds buiten valt.</strong> De kolom{' '}
        <b>overig</b> komt uit <code>model_usage_log</code>: de zes user-callable Edge
        Functions schrijven daar sinds v1.198 per call één regel (wie, waar, welk model,
        wat het kostte — geen prompt, geen antwoord, geen mailinhoud). Hij staat náást de
        chat en wordt er niet bij opgeteld: twee bronnen met elk een eigen dekking.
      </p>
      <p>
        Búiten beide vallen de <b>Claude-routines van de agents</b>. Die lopen via{' '}
        <code>claude_api_calls</code>, en die tabel stopte op <b>19 mei 2026</b> met
        vollopen (253 rijen, geen <code>user_id</code>). Die kosten bestaan en staan op
        geen enkele regel hierboven — ook niet in <b>Totaal gemeten</b>, en ook niet in de
        rem. Er staat nergens een €0 voor.
      </p>
    </div>
  )
}
