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
// NIET: een spiegel. Er is nog geen Confluence-ETL, geen `confluence_pages`, en
// de chunker kent geen Confluence-bron. De chat kan er dus NIETS mee — en dat
// staat ook zo in de UI-copy. Bewust geen live-zoektool als tussenoplossing:
// dat is exact de constructie die voor mail is uitgebouwd omdat een live-tool
// onverrijkte, niet-herleidbare treffers geeft (zie v1.141 in rag-chat).
//
// VOLGENDE STAP om dit nuttig te maken, in deze volgorde:
//   1. `confluence_pages` (page_id pk, space_key, title, body_storage,
//      version, updated_at, owner_user_id) + RLS zoals `mail_messages`.
//   2. Edge Function `confluence-sync-etl` op `verify_jwt:false` (cron), die
//      per `user_connectors`-rij met provider='confluence' de spaces uit
//      CONFLUENCE_GET_SPACES haalt en per space CONFLUENCE_GET_PAGES pagineert.
//      Bestaande read-tools in de toolkit: GET_SPACES, GET_PAGES, GET_PAGE_BY_ID,
//      GET_CHILD_PAGES, SEARCH_CONTENT (57 tools totaal).
//   3. `chunker` een bron 'confluence' geven (storage-XHTML → tekst → chunks
//      met owner_user_id), zodat semantic_search/match_chunks het meenemen.
//   4. Pas DAN een chat-tool, en die leest uit chunks — niet live.
//
// Let op: er bestaat al een ORG-brede Confluence-toegang via Vault
// (`skill:global:atlassian_api_token`, Basic auth) die de documentatie-agents
// gebruiken. Die staat los van deze per-user grant en blijft ongemoeid.

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
