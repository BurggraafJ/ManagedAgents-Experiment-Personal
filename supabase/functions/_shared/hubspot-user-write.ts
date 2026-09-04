// hubspot-user-write.ts — schrijven in HubSpot NAMENS één ingelogde gebruiker.
//
// ── Waarom dit apart staat van de org-spiegel ────────────────────────────────
//
// Lezen doet Maestro uit de spiegel: `hubspot_deals`, `hubspot_companies`,
// `hubspot_contacts`, `hubspot_engagements`, gevuld door `hubspot-sync-etl` met
// een HubSpot **Private App**-token uit Vault. Die pijplijn raakt Composio niet
// aan (zie de kop van hubspot-sync-etl/index.ts). Er komt hier dus GEEN
// live-read-tool bij — reads blijven de spiegel.
//
// Schrijven is het omgekeerde geval. Een notitie op een deal is een handeling
// van een persoon, niet van "de organisatie". Met één org-token staat er onder
// elke notitie dezelfde naam, wie hem ook liet maken. Daarom loopt elke write
// over de **eigen OAuth-grant** van die gebruiker (`user_connectors`,
// provider='hubspot'), en weigert deze module als die grant er niet is.
//
// ── Waarom de v2-proxy en niet v3 ────────────────────────────────────────────
//
// Composio's v3 `tools/execute` heeft geen tool die een note MET association
// aanmaakt — de HubSpot-toolkit (304 tools, gemeten 2026-09-04) kent geen
// HUBSPOT_CREATE_NOTE, en de generieke object-tool vertaalt `to__id` niet naar
// `{"to":{"id":…}}` waardoor HubSpot `400 [to] required` geeft. De v2-proxy is
// een pass-through: hij stuurt onze body letterlijk door naar het HubSpot-pad
// dat we opgeven. Zie agent-handbook/references/authentication.md §3.4.
//
// Let op de naamgeving: "v2" slaat op de **Composio**-API. Het HubSpot-pad
// eronder blijft gewoon `/crm/v3/objects/notes`.

import type { SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2.45.4';
import { getCfg } from './mail-account.ts';

const COMPOSIO_PROXY_URL = 'https://backend.composio.dev/api/v2/actions/proxy';
const PROXY_TIMEOUT_MS = 15_000;

/**
 * HUBSPOT_DEFINED association-type-ids, live opgehaald uit het portaal via
 * `/crm/v4/associations/notes/<object>/labels` op 2026-09-04 — niet uit een
 * skill-geheugen overgetypt. Deze ids zijn portal-onafhankelijk en stabiel.
 */
export const NOTE_ASSOCIATION_TYPE_ID = {
  deal: 214,
  company: 190,
  contact: 202,
} as const;

export type NoteTarget = keyof typeof NOTE_ASSOCIATION_TYPE_ID;

export interface HubspotGrant {
  apiKey: string;
  connectionId: string;
  /** hubspot_users.hubspot_owner_id, of null als we het niet konden herleiden. */
  ownerId: string | null;
  /** Menselijk label van die owner — voor de Connectors-kaart en de logging. */
  ownerLabel: string | null;
}

/** Fout-codes die de aanroeper 1-op-1 aan de UI mag doorgeven. */
export type GrantError =
  | 'hubspot_not_connected'
  | 'hubspot_connection_missing'
  | 'composio_api_key_missing';

/**
 * Wie is deze Maestro-gebruiker in HubSpot?
 *
 * Bewust in deze volgorde, en bewust ZONDER nieuwe mappingtabel:
 *   1. `hubspot_owner_map` — de bestaande org-brede koppeling uit v1.134, die
 *      Jelle in Organisatie › Gebruikers beheert. Dat blijft de bron.
 *   2. Anders: het e-mailadres van de ingelogde gebruiker tegen de
 *      owner-spiegel `hubspot_users` leggen.
 *   3. Anders: null. Dan laten we `hubspot_owner_id` weg en bepaalt HubSpot de
 *      eigenaar zelf op basis van het OAuth-account dat de call doet. Een fout
 *      raden is erger dan niets zetten.
 */
export async function resolveOwner(
  supabase: SupabaseClient, userId: string,
): Promise<{ ownerId: string | null; ownerLabel: string | null }> {
  const { data: mapped } = await supabase.from('hubspot_owner_map')
    .select('hubspot_owner_id').eq('user_id', userId).maybeSingle();

  let ownerId: string | null = mapped?.hubspot_owner_id ?? null;

  if (!ownerId) {
    // service-role client: admin.getUserById mag dit.
    const { data: u } = await supabase.auth.admin.getUserById(userId);
    const email = u?.user?.email?.toLowerCase() ?? null;
    if (email) {
      const { data: hu } = await supabase.from('hubspot_users')
        .select('hubspot_owner_id, full_name, email')
        .ilike('email', email).eq('active', true).maybeSingle();
      if (hu?.hubspot_owner_id) {
        return { ownerId: String(hu.hubspot_owner_id), ownerLabel: hu.full_name || hu.email || null };
      }
    }
    return { ownerId: null, ownerLabel: null };
  }

  const { data: hu } = await supabase.from('hubspot_users')
    .select('full_name, email').eq('hubspot_owner_id', ownerId).maybeSingle();
  return { ownerId, ownerLabel: hu?.full_name || hu?.email || null };
}

/**
 * De grant van deze gebruiker, of een foutcode. Geeft NOOIT stilzwijgend terug
 * op een org-connectie: zonder eigen koppeling schrijft er niemand namens jou.
 */
export async function loadHubspotGrant(
  supabase: SupabaseClient, userId: string,
): Promise<HubspotGrant | { error: GrantError }> {
  const { data: row } = await supabase.from('user_connectors')
    .select('status, composio_connection_id')
    .eq('user_id', userId).eq('provider', 'hubspot').maybeSingle();

  if (!row || row.status !== 'connected') return { error: 'hubspot_not_connected' };
  if (!row.composio_connection_id) return { error: 'hubspot_connection_missing' };

  const apiKey = await getCfg(supabase, 'global', 'composio_api_key');
  if (!apiKey) return { error: 'composio_api_key_missing' };

  const { ownerId, ownerLabel } = await resolveOwner(supabase, userId);
  return { apiKey, connectionId: row.composio_connection_id, ownerId, ownerLabel };
}

export interface ProxyResult { ok: boolean; status: number; body: any }

/**
 * Eén call naar HubSpot via de Composio v2-proxy.
 * `endpoint` is HubSpot's eigen pad, bv. "/crm/v3/objects/notes".
 */
export async function hubspotProxy(
  grant: Pick<HubspotGrant, 'apiKey' | 'connectionId'>,
  endpoint: string,
  method: 'GET' | 'POST' | 'PATCH' | 'PUT',
  body?: Record<string, unknown>,
): Promise<ProxyResult> {
  const res = await fetch(COMPOSIO_PROXY_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-api-key': grant.apiKey },
    body: JSON.stringify({
      connectedAccountId: grant.connectionId,   // camelCase — v2, anders dan v3
      endpoint,
      method,
      ...(body ? { body } : {}),
    }),
    signal: AbortSignal.timeout(PROXY_TIMEOUT_MS),
  });
  const parsed = await res.json().catch(() => null);
  return { ok: res.ok, status: res.status, body: parsed };
}

/**
 * De proxy wikkelt HubSpot's antwoord soms in `{ data: … }` (zo leest
 * daily-admin-future hem) en geeft het soms plat terug (zo staat het in het
 * handboek). Beide vormen accepteren is goedkoper dan erop gokken.
 */
function unwrap(body: any): any {
  if (body && typeof body === 'object' && body.data && typeof body.data === 'object') return body.data;
  return body;
}

export interface CreateNoteInput {
  body: string;
  /** Waar de notitie aan hangt. Zonder target komt hij los in HubSpot te staan. */
  target?: { type: NoteTarget; id: string } | null;
  /** ISO-tijdstip; default nu. */
  at?: string | null;
}

export interface CreateNoteResult {
  noteId: string;
  ownerId: string | null;
  associated: { type: NoteTarget; id: string } | null;
}

/** Maakt één notitie aan namens de gebruiker, optioneel gekoppeld aan een object. */
export async function createNote(
  grant: HubspotGrant, input: CreateNoteInput,
): Promise<CreateNoteResult> {
  const properties: Record<string, unknown> = {
    hs_note_body: input.body,
    hs_timestamp: input.at || new Date().toISOString(),
  };
  // Alleen zetten als we hem echt kennen — zie resolveOwner.
  if (grant.ownerId) properties.hubspot_owner_id = grant.ownerId;

  const payload: Record<string, unknown> = { properties };
  if (input.target) {
    payload.associations = [{
      to: { id: input.target.id },
      types: [{
        associationCategory: 'HUBSPOT_DEFINED',
        associationTypeId: NOTE_ASSOCIATION_TYPE_ID[input.target.type],
      }],
    }];
  }

  const r = await hubspotProxy(grant, '/crm/v3/objects/notes', 'POST', payload);
  const data = unwrap(r.body);
  const noteId = data?.id ?? null;
  if (!r.ok || !noteId) {
    // HubSpot's eigen `message` is bruikbaarder dan "proxy 400"; wel afkappen,
    // want een 4xx-body kan de hele request echoën.
    const detail = String(data?.message ?? r.body?.error ?? r.status).slice(0, 300);
    throw new Error(`hubspot_note_failed_${r.status}: ${detail}`);
  }
  return {
    noteId: String(noteId),
    ownerId: grant.ownerId,
    associated: input.target ?? null,
  };
}
