// connectors-hubspot — per-user HubSpot-koppeling voor Instellingen › Connectors.
//
// verify_jwt: TRUE — user-callable, browser, ingelogde gebruiker.
//
// ⚠ WAT DEZE KOPPELING WÉL EN NIET DOET (v1.142)
//
// NIET: lezen. De chat en de agents lezen HubSpot uitsluitend uit de org-spiegel
// (`hubspot_deals`, `hubspot_companies`, `hubspot_contacts`,
// `hubspot_engagements`) die `hubspot-sync-etl` vult met een HubSpot **Private
// App**-token uit Vault. Er is bewust géén live-read-tool bijgekomen: dezelfde
// afweging als bij mail in v1.141 — live treffers zijn onverrijkt, ongerankt en
// niet herleidbaar naast de rest van de index.
//
// NIET: een tweede sync. Koppelen zet niets aan, verandert niets aan de
// org-spiegel en deelt er geen credential mee. De org-ETL gebruikt Composio
// helemaal niet, dus een per-user OAuth-grant kan hem niet raken.
//
// WEL: het recht om namens jou te SCHRIJVEN. `hubspot-write` gebruikt de
// connectie uit `user_connectors` als `connectedAccountId` op de Composio
// v2-proxy, zodat een notitie in HubSpot onder jouw account staat en niet onder
// één org-token. Zonder koppeling weigert die functie — dat is het hele punt.
//
// Twee dingen die HubSpot anders maken dan Outlook/Confluence:
//
//   • Er is geen "wie ben ik"-tool. De HubSpot-toolkit heeft 304 tools
//     (gemeten 2026-09-04) en geen daarvan geeft het account terug waarop de
//     grant staat. Daarom `resolveLabel` in plaats van `identityTool`: we
//     herleiden de HubSpot-owner uit onze eigen data (`hubspot_owner_map` →
//     `hubspot_users`), precies de koppeling die Jelle in Organisatie ›
//     Gebruikers beheert. Geen nieuwe mappingtabel.
//
//   • Geen `connectionData`. De auth-config `ac_22USb_Ss73Hp` is
//     Composio-managed OAUTH2 met `expected_input_fields: []` — anders dan
//     Confluence, dat een `subdomain` eist.
//
// Geen `beforeDisconnect`: deze grant voedt geen gedeelde pijplijn. Loskoppelen
// betekent alleen dat er niet meer namens jou geschreven kan worden; alles wat
// al in HubSpot staat blijft staan, en de spiegel blijft gewoon lezen.

import 'jsr:@supabase/functions-js/edge-runtime.d.ts';
import { handleConnector } from '../_shared/connector-composio.ts';
import { resolveOwner } from '../_shared/hubspot-user-write.ts';

Deno.serve((req) => handleConnector(req, {
  provider: 'hubspot',
  toolkitSlug: 'hubspot',
  // Het label op de kaart is de HubSpot-owner onder wiens naam jouw notities
  // komen te staan. Kennen we die niet, dan blijft het leeg — HubSpot bepaalt
  // de eigenaar dan zelf op basis van het OAuth-account.
  resolveLabel: async (supabase, userId) => (await resolveOwner(supabase, userId)).ownerLabel,
  // Hergebruikt het `mirror`-veld van de UI als "wat gebeurt er nu echt":
  // weten we jouw HubSpot-owner, dan krijgt elke notitie jouw naam mee.
  afterConnected: async (supabase, userId) => {
    const { ownerId } = await resolveOwner(supabase, userId);
    return ownerId ? 'owner_known' : 'owner_unknown';
  },
}));
