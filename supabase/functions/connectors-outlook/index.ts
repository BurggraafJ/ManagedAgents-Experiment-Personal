// connectors-outlook — per-user Outlook-koppeling voor Instellingen › Connectors.
//
// Maestro is de MCP-host: de gebruiker logt één keer bij Microsoft in, Composio
// bewaart de OAuth-tokens en wij bewaren alleen de identifiers in
// `user_connectors`. De browser krijgt nooit een token te zien — hij krijgt
// alleen een status en (bij koppelen) de consent-URL van Composio.
//
// Drie acties, alle drie namens de INGELOGDE gebruiker (de `sub` uit de door de
// gateway gevalideerde JWT — nooit een user_id uit de body, dat zou betekenen
// dat je de mailbox van een collega kunt koppelen of loskoppelen):
//
//   { action: 'status' }     → { status, account_email, connected_at }
//                              Ververst 'pending'/'connected' eerst bij Composio,
//                              zodat de pagina na terugkeer uit de OAuth-flow
//                              meteen klopt.
//   { action: 'connect' }    → { redirect_url }  — open die in de browser.
//   { action: 'disconnect' } → { status: 'disconnected' }
//
// verify_jwt: TRUE. Dit is een user-callable functie (browser, ingelogde
// gebruiker), geen cron-functie — zie de RAG-cron-hard-rule in CLAUDE.md: die
// `verify_jwt:false`-regel geldt voor de pijplijn-functies, niet voor deze.
//
// RAAKT DE ORG-MAILBOX NIET. `mail_accounts` (burggraaf@legal-mind.nl,
// scope='org', connectie ca_SO3uHQpkDc-z) voedt de sync-ETL's en blijft hier
// volledig buiten beeld; deze functie leest en schrijft alleen
// `user_connectors`. Als extra grendel weigert `disconnect` elke connectie die
// in mail_accounts voorkomt.

import 'jsr:@supabase/functions-js/edge-runtime.d.ts';
import { createClient, type SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2.45.4';

const COMPOSIO_API_BASE = 'https://backend.composio.dev/api/v3';
const PROVIDER = 'outlook';
const TOOLKIT_SLUG = 'outlook';
const TOOL_GET_PROFILE = 'OUTLOOK_OUTLOOK_GET_PROFILE';

// Waar Composio de gebruiker na consent terugstuurt. Alleen deze origins zijn
// toegestaan; een vrije Origin zou een open redirect via Composio opleveren.
const ALLOWED_ORIGINS = [
  'https://legal-mind-dashboard-git-main-jelle-burggraaf.vercel.app',
  'http://localhost:5173',
  'http://localhost:4173',
];
const DEFAULT_ORIGIN = ALLOWED_ORIGINS[0];
const RETURN_PATH = '/instellingen/connectors';

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};
function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status, headers: { 'Content-Type': 'application/json', ...CORS },
  });
}

/** De gateway heeft de handtekening al gecheckt; hier alleen de claims lezen. */
function jwtClaims(req: Request): { role: string | null; sub: string | null } {
  try {
    const token = (req.headers.get('Authorization') || '').replace(/^Bearer\s+/i, '');
    const payload = JSON.parse(atob(token.split('.')[1].replace(/-/g, '+').replace(/_/g, '/')));
    return {
      role: typeof payload.role === 'string' ? payload.role : null,
      sub: typeof payload.sub === 'string' ? payload.sub : null,
    };
  } catch { return { role: null, sub: null }; }
}

async function getCfg(supabase: SupabaseClient, agentName: string, key: string): Promise<string | null> {
  const { data: vaultValue } = await supabase.rpc('get_skill_secret_service', {
    p_skill_name: agentName, p_secret_name: key,
  });
  if (typeof vaultValue === 'string' && vaultValue.length > 0) return vaultValue;
  const { data } = await supabase.from('agent_config').select('config_value')
    .eq('agent_name', agentName).eq('config_key', key).maybeSingle();
  if (!data?.config_value) return null;
  return typeof data.config_value === 'string' ? data.config_value : String(data.config_value);
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

/** Composio-status → onze vier toestanden. */
function mapStatus(composioStatus: string | null | undefined): 'pending' | 'connected' | 'error' {
  const s = String(composioStatus || '').toUpperCase();
  if (s === 'ACTIVE') return 'connected';
  if (s === 'INITIATED' || s === 'INITIALIZING' || s === 'PENDING') return 'pending';
  return 'error';
}

/**
 * De auth-config voor Outlook. Er staat er precies één in het account
 * (Composio-managed OAuth2), dus geen Entra-app nodig. Overschrijfbaar via
 * agent_config('connectors', 'outlook_auth_config_id') als dat ooit verandert.
 */
async function outlookAuthConfigId(supabase: SupabaseClient, apiKey: string): Promise<string> {
  const pinned = await getCfg(supabase, 'connectors', 'outlook_auth_config_id');
  if (pinned) return pinned;
  const r = await composio(apiKey, `/auth_configs?toolkit_slug=${TOOLKIT_SLUG}`);
  const items = Array.isArray(r.body?.items) ? r.body.items : [];
  const first = items.find((a: any) => !a.is_disabled) || items[0];
  if (!first?.id) throw new Error('outlook_auth_config_missing');
  return String(first.id);
}

/** Mailbox-adres ophalen. Mislukt dit, dan blijft account_email leeg — de
 *  koppeling zelf is dan nog steeds geldig, dus dit mag nooit hard falen. */
async function fetchMailbox(
  apiKey: string, composioUser: string, connectionId: string,
): Promise<string | null> {
  try {
    const r = await composio(apiKey, `/tools/execute/${TOOL_GET_PROFILE}`, {
      method: 'POST',
      body: JSON.stringify({ user_id: composioUser, connected_account_id: connectionId, arguments: {} }),
    });
    if (!r.ok) return null;
    const rd = r.body?.data?.response_data ?? r.body?.data ?? {};
    const mail = rd.mail ?? rd.userPrincipalName ?? rd.emailAddress ?? rd.email;
    return typeof mail === 'string' && mail.includes('@') ? mail : null;
  } catch { return null; }
}

interface Row {
  id: string; composio_user_id: string; composio_connection_id: string | null;
  status: string; account_email: string | null; connected_at: string | null;
}

async function loadRow(supabase: SupabaseClient, userId: string): Promise<Row | null> {
  const { data } = await supabase.from('user_connectors')
    .select('id, composio_user_id, composio_connection_id, status, account_email, connected_at')
    .eq('user_id', userId).eq('provider', PROVIDER).maybeSingle();
  return (data as Row) ?? null;
}

/** Ververst een rij met wat Composio nu zegt. Geen connection_id = niets te doen. */
async function refresh(
  supabase: SupabaseClient, apiKey: string, userId: string, row: Row,
): Promise<Row> {
  if (!row.composio_connection_id) return row;
  const r = await composio(apiKey, `/connected_accounts/${encodeURIComponent(row.composio_connection_id)}`);
  // 404 = bij Composio verwijderd: terug naar disconnected, niet blijven hangen.
  if (r.status === 404) {
    const patch = { status: 'disconnected', composio_connection_id: null, account_email: null, connected_at: null, last_error: null };
    await supabase.from('user_connectors').update(patch).eq('id', row.id);
    return { ...row, ...patch } as Row;
  }
  if (!r.ok) return row;   // netwerk/5xx: laat de bekende status staan

  const status = mapStatus(r.body?.status);
  const patch: Record<string, unknown> = { status };
  if (status === 'connected') {
    if (!row.connected_at) patch.connected_at = new Date().toISOString();
    patch.last_error = null;
    if (!row.account_email) {
      patch.account_email = await fetchMailbox(apiKey, row.composio_user_id, row.composio_connection_id);
    }
  } else if (status === 'error') {
    patch.last_error = String(r.body?.status_reason || r.body?.status || 'onbekende fout bij Composio').slice(0, 500);
  }
  await supabase.from('user_connectors').update(patch).eq('id', row.id);
  return { ...row, ...patch } as Row;
}

Deno.serve(async (req) => {
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
    let row = await loadRow(supabase, sub);

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
      if (!row) return json({ ok: true, status: 'disconnected', account_email: null, connected_at: null });
      if (row.status === 'pending' || row.status === 'connected') {
        row = await refresh(supabase, await needKey(), sub, row);
      }
      return json({
        ok: true, status: row.status, account_email: row.account_email,
        connected_at: row.connected_at,
      });
    }

    if (action === 'connect') {
      const apiKey = await needKey();
      const authConfigId = await outlookAuthConfigId(supabase, apiKey);
      const cUser = row?.composio_user_id || composioUserId(sub);

      const r = await composio(apiKey, '/connected_accounts', {
        method: 'POST',
        body: JSON.stringify({
          auth_config: { id: authConfigId },
          connection: { user_id: cUser, callback_url: returnUrl(req) },
        }),
      });
      if (!r.ok) {
        const detail = String(r.body?.message || r.body?.error || `composio_${r.status}`).slice(0, 500);
        await supabase.from('user_connectors').upsert({
          user_id: sub, provider: PROVIDER, composio_user_id: cUser,
          auth_config_id: authConfigId, status: 'error', last_error: detail,
        }, { onConflict: 'user_id,provider' });
        return json({ ok: false, error: 'composio_connect_failed', detail }, 502);
      }

      const redirectUrl = r.body?.redirect_url ?? r.body?.redirect_uri
        ?? r.body?.connectionData?.val?.redirectUrl ?? null;
      if (!redirectUrl) return json({ ok: false, error: 'composio_no_redirect_url' }, 502);

      await supabase.from('user_connectors').upsert({
        user_id: sub, provider: PROVIDER, composio_user_id: cUser,
        composio_connection_id: r.body?.id ?? null, auth_config_id: authConfigId,
        status: 'pending', last_error: null, account_email: null, connected_at: null,
      }, { onConflict: 'user_id,provider' });

      return json({ ok: true, status: 'pending', redirect_url: redirectUrl });
    }

    if (action === 'disconnect') {
      if (!row) return json({ ok: true, status: 'disconnected' });
      const connId = row.composio_connection_id;
      if (connId) {
        // Grendel: een connectie die de sync-registry gebruikt is de org-mailbox
        // en hoort niet bij deze knop. Nooit weggooien.
        const { data: shared } = await supabase.from('mail_accounts')
          .select('id').eq('composio_connection_id', connId).limit(1);
        if (Array.isArray(shared) && shared.length > 0) {
          return json({ ok: false, error: 'connection_in_use_by_mail_sync' }, 409);
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
});
