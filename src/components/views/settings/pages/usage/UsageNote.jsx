import { eur, STANDAARD_PLAFOND_EUR } from '../../../../../hooks/useModelUsage'

// De vier dingen die je moet weten om de tabel erboven goed te lezen. Ze staan
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
        <strong>Het plafond remt vandaag niets.</strong> Elke regel staat op{' '}
        {eur(STANDAARD_PLAFOND_EUR)} per maand en is hier te wijzigen, maar geen enkele
        Edge Function leest het getal — de zes die betaalde model-calls doen hebben geen
        rolcheck en geen budgetcheck (GAP-3). Deze pagina rapporteert; ze begrenst niet.
        Een persoonlijk plafond staat in <code>user_model_budget</code>, dat van Maestro
        in <code>dash_parameters.model_budget_maestro_eur</code> — hij heeft geen rij in
        <code> auth.users</code> en hoort er ook geen te krijgen.
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
        <strong>Wat hier NIET in zit, en dus nergens staat.</strong> Alle betaalde
        model-calls búiten de chat — taalcheck, transcribe, kb-compose, de
        Claude-routines van de agents — worden sinds <b>19 mei 2026</b> niet meer
        geteld: <code>claude_api_calls</code> stopte toen met vollopen (253 rijen, geen
        <code> user_id</code>). Die kosten bestaan wel en staan op geen enkele regel
        hierboven, ook niet in <b>Totaal gemeten</b>.
      </p>
    </div>
  )
}
