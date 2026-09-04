// connector-composio.ts — één implementatie voor elke per-user Connectors-knop.
//
// v1.136 zette de hele flow (status / connect / disconnect) in
// `connectors-outlook`. Toen Confluence erbij kwam (v1.141) waren er twee
// keuzes: die ~250 regels dupliceren, of het provider-onafhankelijke deel hier
// zetten. Dupliceren zou betekenen dat een fix in de OAuth-afhandeling op twee
// plekken moet — precies het soort schaduw-versie dat CLAUDE.md verbiedt.
//
// Wat hier staat is voor élke provider hetzelfde:
//   • de `sub` uit de door de gateway gevalideerde JWT (nooit een user_id uit
//     de body — dan kon je de koppeling van een collega beheren)
//   • de auth-config opzoeken/pinnen
//   • connect → consent-URL, status → verversen bij Composio, disconnect
//   • `user_connectors` bijhouden (UNIQUE user_id, provider)
//
// Wat de provider zelf levert (ConnectorSpec): welke toolkit, welke tool het
// account-label ophaalt, en optioneel wat er ná 'connected' moet gebeuren
// (Outlook: de mail-spiegel aanzetten) of vóór een disconnect (Outlook: de
// org-mailbox beschermen).

import { createClient, type SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2.45.4';
import { getCfg } from './mail-account.ts';

const COMPOSIO_API_BASE = 'https://backend.composio.dev/api/v3';

// Waar Composio de gebruiker na consent terugstuurt. Alleen deze origins zijn
// toegestaan; een vrije Origin zou een open redirect via Composio opleveren.
const ALLOWED_ORIGINS = [
  'https://legal-mind-dashboard-git-main-jelle-burggraaf.vercel.app',
  'http://localhost:5173',
  'http://localhost:4173',
];
const DEFAULT_ORIGIN = ALLOWED_ORIGINS[0];
const RETURN_PATH = '/instellingen/connectors';

export const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

export function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status, headers: { 'Content-Type': 'application/json', ...CORS },
  });
}

export interface ConnectorRow {
  id: string; composio_user_id: string; composio_connection_id: string | null;
  status: string; account_email: string | null; connected_at: string | null;
}

export interface ConnectorSpec {
  /** Waarde van user_connectors.provider — ook de sleutel in de UI. */
  provider: string;
  /** Composio-toolkit waaruit de auth-config komt. */
  toolkitSlug: string;
  /**
   * Tool die het account-label ophaalt (mailbox, Confluence-account, …).
   * Optioneel: HubSpot heeft er geen — die toolkit kent geen "wie ben ik"-tool
   * (304 tools doorzocht, 2026-09-04). Zo'n provider levert `resolveLabel`.
   */
  identityTool?: string;
  /** Haalt het label uit de tool-respons. Mag null geven: dan blijft het leeg. */
  identityLabel?: (responseData: Record<string, unknown>) => string | null;
  /**
   * Alternatief voor `identityTool`: bepaal het label zonder Composio-tool, bv.
   * uit onze eigen spiegel. Wordt alleen aangeroepen als er nog geen label
   * staat. Mag null geven en mag niet gooien — een leeg label is nooit een
   * reden om een geldige koppeling als kapot te tonen.
   */
  resolveLabel?: (supabase: SupabaseClient, userId: string) => Promise<string | null>;
  /**
   * Extra velden die Composio bij het AANMAKEN van de connectie eist
   * (`expected_input_fields` op de auth-config). Outlook heeft er geen;
   * Confluence eist `subdomain`. Ze gaan als `connection.data` mee — dat is de
   * enige vorm die v3 accepteert (`val`, `config`, `initiation_fields` en
   * `connection_data` geven alle vier "Missing required fields", gemeten
   * 2026-09-03).
   */
  connectionData?: (supabase: SupabaseClient) => Promise<Record<string, unknown> | null>;
  /** Draait nadat de koppeling 'connected' is. Extra veld voor de UI. */
  afterConnected?: (supabase: SupabaseClient, userId: string, row: ConnectorRow) => Promise<string | null>;
  /** Mag deze connectie los? Geef een foutcode terug om te blokkeren. */
  beforeDisconnect?: (supabase: SupabaseClient, userId: string, connectionId: string) => Promise<string | null>;
}

/**
 * Composio's `error` is soms een string en soms een object; `String(obj)` maakte
 * daar "[object Object]" van en verborg dan juist de oorzaak. Dezelfde les als
 * in mail-sync-etl-v2 v2.7 — hier kostte het een halve zoektocht naar waarom
 * een Confluence-connect faalde (antwoord: het `subdomain`-veld ontbrak).
 */
function composioError(body: any, status: number): string {
  const raw = body?.error ?? body?.message;
  const nested = (raw && typeof raw === 'object') ? (raw.message ?? raw.error ?? raw.slug) : null;
  const pick = nested ?? raw;
  if (typeof pick === 'string' && pick.length > 0) return pick.slice(0, 500);
  try { return JSON.stringify(raw ?? body).slice(0, 500); } catch { /* circulair */ }
  return `composio_${status}`;
}

/**
 * De gateway heeft de handtekening al gecheckt; hier alleen de claims lezen.
 * Geëxporteerd omdat elke user-callable functie die namens de ingelogde
 * gebruiker handelt (`hubspot-write`) exact dezelfde check nodig heeft — een
 * tweede kopie is precies het schaduw-pad dat CLAUDE.md verbiedt.
 */
export function jwtClaims(req: Request): { role: string | null; sub: string | null } {
  try {
    const token = (req.headers.get('Authorization') || '').replace(/^Bearer\s+/i, '');
    const payload = JSON.parse(atob(token.split('.')[1].replace(/-/g, '+').replace(/_/g, '/')));
    return {
      role: typeof payload.role === 'string' ? payload.role : null,
      sub: typeof payload.sub === 'string' ? payload.sub : null,
    };
  } catch { return { role: null, sub: null }; }
}

function composioUserId(sub: string): string { return `maestro-${sub}`; }

function returnUrl(req: Request): string {
  const origin = req.headers.get('Origin') || '';
  return (ALLOWED_ORIGINS.includes(origin) ? origin : DEFAULT_ORIGIN) + RETURN_PATH;
}

async function composio(
  apiKey: string, path: string, init: RequestInit = {},
): Promise<{ ok: boolean; status: number; body: any }> {
  const res = await fetch(`${COMPOSIO_API_BASE}${path}`, {
    ...init,
    headers: { 'Content-Type': 'application/json', 'x-api-key': apiKey, ...(init.headers || {}) },
    signal: AbortSignal.timeout(20_000),
  });
  const body = await res.json().catch(() => null);
  return { ok: res.ok, status: res.status, body };
}

/** Composio-status → onze drie toestanden. */
function mapStatus(composioStatus: string | null | undefined): 'pending' | 'connected' | 'error' {
  const s = String(composioStatus || '').toUpperCase();
  if (s === 'ACTIVE') return 'connected';
  if (s === 'INITIATED' || s === 'INITIALIZING' || s === 'PENDING') return 'pending';
  return 'error';
}

/**
 * De auth-config voor deze toolkit. Composio-managed OAuth2 — dus geen eigen
 * app bij Microsoft of Atlassian. Overschrijfbaar via
 * agent_config('connectors', '<provider>_auth_config_id').
 */
async function authConfigId(
  supabase: SupabaseClient, apiKey: string, spec: ConnectorSpec,
): Promise<string> {
  const pinned = await getCfg(supabase, 'connectors', `${spec.provider}_auth_config_id`);
  if (pinned) return pinned;
  const r = await composio(apiKey, `/auth_configs?toolkit_slug=${spec.toolkitSlug}`);
  const items = Array.isArray(r.body?.items) ? r.body.items : [];
  const first = items.find((a: any) => !a.is_disabled) || items[0];
  if (!first?.id) throw new Error(`${spec.provider}_auth_config_missing`);
  return String(first.id);
}

/** Account-label ophalen. Mislukt dit, dan blijft het leeg — de koppeling zelf
 *  is dan nog steeds geldig, dus dit mag nooit hard falen. */
async function fetchLabel(
  supabase: SupabaseClient, apiKey: string, spec: ConnectorSpec,
  userId: string, composioUser: string, connectionId: string,
): Promise<string | null> {
  try {
    if (spec.resolveLabel) return await spec.resolveLabel(supabase, userId);
    if (!spec.identityTool || !spec.identityLabel) return null;
    const r = await composio(apiKey, `/tools/execute/${spec.identityTool}`, {
      method: 'POST',
      body: JSON.stringify({ user_id: composioUser, connected_account_id: connectionId, arguments: {} }),
    });
    if (!r.ok) return null;
    const rd = r.body?.data?.response_data ?? r.body?.data ?? {};
    return spec.identityLabel(rd as Record<string, unknown>);
  } catch { return null; }
}

async function loadRow(
  supabase: SupabaseClient, userId: string, provider: string,
): Promise<ConnectorRow | null> {
  const { data } = await supabase.from('user_connectors')
    .select('id, composio_user_id, composio_connection_id, status, account_email, connected_at')
    .eq('user_id', userId).eq('provider', provider).maybeSingle();
  return (data as ConnectorRow) ?? null;
}

/** Ververst een rij met wat Composio nu zegt. Geen connection_id = niets te doen. */
async function refresh(
  supabase: SupabaseClient, apiKey: string, spec: ConnectorSpec, userId: string, row: ConnectorRow,
): Promise<ConnectorRow> {
  if (!row.composio_connection_id) return row;
  const r = await composio(apiKey, `/connected_accounts/${encodeURIComponent(row.composio_connection_id)}`);
  // 404 = bij Composio verwijderd: terug naar disconnected, niet blijven hangen.
  if (r.status === 404) {
    const patch = { status: 'disconnected', composio_connection_id: null, account_email: null, connected_at: null, last_error: null };
    await supabase.from('user_connectors').update(patch).eq('id', row.id);
    return { ...row, ...patch } as ConnectorRow;
  }
  if (!r.ok) return row;   // netwerk/5xx: laat de bekende status staan

  const status = mapStatus(r.body?.status);
  const patch: Record<string, unknown> = { status };
  if (status === 'connected') {
    if (!row.connected_at) patch.connected_at = new Date().toISOString();
    patch.last_error = null;
    if (!row.account_email) {
      patch.account_email = await fetchLabel(
        supabase, apiKey, spec, userId, row.composio_user_id, row.composio_connection_id,
      );
    }
  } else if (status === 'error') {
    patch.last_error = String(r.body?.status_reason || r.body?.status || 'onbekende fout bij Composio').slice(0, 500);
  }
  await supabase.from('user_connectors').update(patch).eq('id', row.id);
  return { ...row, ...patch } as ConnectorRow;
}

/** De hele request-afhandeling. Elke connector-functie is hier een dunne schil omheen. */
export async function handleConnector(req: Request, spec: ConnectorSpec): Promise<Response> {
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: CORS });
  if (req.method !== 'POST') return json({ ok: false, error: 'method_not_allowed' }, 405);

  const { role, sub } = jwtClaims(req);
  // De anon-key is publiek (zit in de frontend-bundle) en mag hier niets.
  if (role !== 'authenticated' || !sub) return json({ ok: false, error: 'forbidden' }, 403);

  let body: any = {};
  try { body = await req.json(); } catch { /* leeg = status */ }
  const action = typeof body.action === 'string' ? body.action : 'status';

  const supabase = createClient(
    Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
  );

  try {
    let row = await loadRow(supabase, sub, spec.provider);

    // De sleutel pas ophalen zodra we Composio echt nodig hebben: wie niets
    // gekoppeld heeft, hoort een gewone "niet gekoppeld" te krijgen en geen
    // 500 omdat er toevallig geen Composio-config staat.
    let cachedKey: string | null | undefined;
    const needKey = async (): Promise<string> => {
      if (cachedKey === undefined) cachedKey = await getCfg(supabase, 'global', 'composio_api_key');
      if (!cachedKey) throw new Error('composio_api_key_missing');
      return cachedKey;
    };

    if (action === 'status') {
      if (!row) {
        return json({
          ok: true, status: 'disconnected', account_email: null,
          connected_at: null, mirror: null,
        });
      }
      if (row.status === 'pending' || row.status === 'connected') {
        row = await refresh(supabase, await needKey(), spec, sub, row);
      }
      // Provider-specifieke vervolgstap (Outlook: spiegel aanzetten). Faalt dit,
      // dan is de koppeling zelf nog steeds geldig: de pagina hoort geen 500 te
      // krijgen omdat een registry even niet meewerkt.
      let mirror: string | null = null;
      if (row.status === 'connected' && spec.afterConnected) {
        try { mirror = await spec.afterConnected(supabase, sub, row); }
        catch { mirror = null; }
      }
      return json({
        ok: true, status: row.status, account_email: row.account_email,
        connected_at: row.connected_at, mirror,
      });
    }

    if (action === 'connect') {
      const apiKey = await needKey();
      const cfgId = await authConfigId(supabase, apiKey, spec);
      const cUser = row?.composio_user_id || composioUserId(sub);

      const extra = spec.connectionData ? await spec.connectionData(supabase) : null;
      const r = await composio(apiKey, '/connected_accounts', {
        method: 'POST',
        body: JSON.stringify({
          auth_config: { id: cfgId },
          connection: {
            user_id: cUser,
            callback_url: returnUrl(req),
            ...(extra ? { data: extra } : {}),
          },
        }),
      });
      if (!r.ok) {
        const detail = composioError(r.body, r.status);
        await supabase.from('user_connectors').upsert({
          user_id: sub, provider: spec.provider, composio_user_id: cUser,
          auth_config_id: cfgId, status: 'error', last_error: detail,
        }, { onConflict: 'user_id,provider' });
        return json({ ok: false, error: 'composio_connect_failed', detail }, 502);
      }

      const redirectUrl = r.body?.redirect_url ?? r.body?.redirect_uri
        ?? r.body?.connectionData?.val?.redirectUrl ?? null;
      if (!redirectUrl) return json({ ok: false, error: 'composio_no_redirect_url' }, 502);

      await supabase.from('user_connectors').upsert({
        user_id: sub, provider: spec.provider, composio_user_id: cUser,
        composio_connection_id: r.body?.id ?? null, auth_config_id: cfgId,
        status: 'pending', last_error: null, account_email: null, connected_at: null,
      }, { onConflict: 'user_id,provider' });

      return json({ ok: true, status: 'pending', redirect_url: redirectUrl });
    }

    if (action === 'disconnect') {
      if (!row) return json({ ok: true, status: 'disconnected' });
      const connId = row.composio_connection_id;
      if (connId) {
        if (spec.beforeDisconnect) {
          const block = await spec.beforeDisconnect(supabase, sub, connId);
          if (block) return json({ ok: false, error: block }, 409);
        }
        await composio(await needKey(), `/connected_accounts/${encodeURIComponent(connId)}`, { method: 'DELETE' })
          .catch(() => null);   // al weg bij Composio = ook goed
      }
      await supabase.from('user_connectors').update({
        status: 'disconnected', composio_connection_id: null,
        account_email: null, connected_at: null, last_error: null,
      }).eq('id', row.id);
      return json({ ok: true, status: 'disconnected' });
    }

    return json({ ok: false, error: 'unknown_action' }, 400);
  } catch (e) {
    return json({ ok: false, error: String((e as Error).message || e).slice(0, 300) }, 500);
  }
}
