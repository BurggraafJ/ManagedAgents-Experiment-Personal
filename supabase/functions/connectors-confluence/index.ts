// connectors-confluence — per-user Confluence-koppeling voor Instellingen › Connectors.
//
// Zelfde patroon als Outlook: één Atlassian-login, Composio bewaart de
// OAuth-tokens, wij bewaren alleen identifiers in `user_connectors`. De
// auth-config staat in agent_config('connectors','confluence_auth_config_id')
// en is **Composio-managed OAuth2**, dus er komt GEEN eigen Atlassian OAuth-app
// aan te pas — precies de lijn die voor Outlook is afgesproken (één login,
// geen eigen Entra-app).
//
// verify_jwt: TRUE — user-callable, browser, ingelogde gebruiker.
//
// ⚠ WAT DIT WÉL EN NIET DOET (v1.141)
//
// WEL: een echte per-user OAuth-koppeling. Na consent staat er een geldige,
// verversbare Confluence-grant en toont de kaart aan welk Atlassian-account hij
// hangt.
//
// NIET: de spiegel aanzetten. Die stap uit de v1.141-kop is in v1.142 gezet,
// maar ANDERS dan daar voorgesteld — en dat is een bewuste correctie.
//
// Het plan was: per `user_connectors`-rij met provider='confluence' de spaces
// ophalen en per gebruiker chunks met `owner_user_id` schrijven. Dat is voor
// mail juist (elke mailbox is andere inhoud), maar voor een wiki verkeerd:
// iedereen ziet dezelfde 592 pagina's, dus per-user spiegelen zou dezelfde
// pagina N keer in de index zetten en N× embedden.
//
// Het is daarom één ORG-brede spiegel geworden, met het bestaande
// org-Vault-token (`skill:global:atlassian_api_token`) en `owner_user_id = NULL`
// op de chunks:
//   • `confluence_pages`             — migratie 20260904091000
//   • `confluence-sync-etl`          — verify_jwt:false, cron 2×/dag
//   • chunker `source='confluence'`  — her-chunkt op `version`
//   • chat vindt het via de BESTAANDE `semantic_search`; er is en komt geen
//     live Confluence-zoektool in rag-chat (zelfde reden als bij mail in
//     v1.141: live treffers zijn onverrijkt en niet herleidbaar).
//
// WEL, en dat blijft de reden dat deze functie bestaat: een echte per-user
// grant. Hij legt vast welk Atlassian-account van wie is en is het aanknopings-
// punt voor toekomstige acties NAMENS een gebruiker (schrijven, of pagina's die
// alleen díe gebruiker mag zien). Voor zoeken is hij niet nodig — en de
// UI-copy zegt dat ook zo, in plaats van een koppeling te suggereren die je
// zoekresultaten zou verbeteren.

import 'jsr:@supabase/functions-js/edge-runtime.d.ts';
import { handleConnector } from '../_shared/connector-composio.ts';
import { getCfg } from '../_shared/mail-account.ts';

Deno.serve((req) => handleConnector(req, {
  provider: 'confluence',
  toolkitSlug: 'confluence',
  identityTool: 'CONFLUENCE_GET_CURRENT_USER',
  // Composio eist bij Confluence één extra veld: het site-subdomein
  // (`acme` uit acme.atlassian.net). Dat is org-breed, dus we vragen het niet
  // aan de gebruiker maar lezen het uit agent_config('global','atlassian_site')
  // — dezelfde waarde die de documentatie-agents al gebruiken. Zo blijft het
  // één klik + één Atlassian-login.
  connectionData: async (supabase) => {
    const site = await getCfg(supabase, 'global', 'atlassian_site');
    if (!site) throw new Error('atlassian_site_missing in agent_config(global, atlassian_site)');
    return { subdomain: site.replace(/^https?:\/\//, '').replace(/\.atlassian\.net.*$/i, '') };
  },
  // Confluence geeft een account, niet een mailbox. We hergebruiken de kolom
  // `account_email` als generiek label — e-mail als die zichtbaar is, anders de
  // weergavenaam, zodat de kaart altijd zegt aan wélk account hij hangt.
  identityLabel: (rd) => {
    const r = rd as Record<string, any>;
    const cand = r.email ?? r.emailAddress ?? r.publicName ?? r.displayName
      ?? r.accountId ?? r.account_id;
    return typeof cand === 'string' && cand.length > 0 ? cand.slice(0, 200) : null;
  },
  // Geen afterConnected: er is geen spiegel om aan te zetten. Geen
  // beforeDisconnect: deze grant voedt geen gedeelde pijplijn.
}));
