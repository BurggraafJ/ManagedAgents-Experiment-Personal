// ctx.ts — wélke mailbox, en met welke sleutels.
//
// v3 (2026-09-02) — PER CALLER, niet meer één vaste mailbox (blokkade B3).
// Tot v2 checkte `outlook-live` alleen `role === 'authenticated'` en pakte dan
// de vaste Composio-connectie uit agent_config. Elke tweede dashboard-gebruiker
// las daarmee Jelle's Concepten en schreef er concepten in. Nu bepaalt de `sub`
// uit de (door de gateway gevalideerde) JWT de mailbox, via `mail_accounts`.
// Geen rij = 403, geen stille terugval op de org-connectie.

import { createClient, type SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2.45.4';
import { type OutlookCtx } from '../_shared/outlook-write.ts';

export interface Ctx extends OutlookCtx {
  ownerUserId: string;
  mailboxEmail: string | null;
}

export function serviceClient(): SupabaseClient {
  return createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);
}

export async function getCfg(supabase: SupabaseClient, agentName: string, key: string): Promise<string | null> {
  const { data: vaultValue } = await supabase.rpc('get_skill_secret_service', {
    p_skill_name: agentName, p_secret_name: key,
  });
  if (typeof vaultValue === 'string' && vaultValue.length > 0) return vaultValue;
  const { data } = await supabase.from('agent_config').select('config_value')
    .eq('agent_name', agentName).eq('config_key', key).maybeSingle();
  if (!data?.config_value) return null;
  return typeof data.config_value === 'string' ? data.config_value : String(data.config_value);
}

export async function buildCtxForCaller(supabase: SupabaseClient, caller: string): Promise<Ctx> {
  const apiKey = await getCfg(supabase, 'global', 'composio_api_key');
  if (!apiKey) throw new Error('composio_api_key_missing');

  const { data: acct } = await supabase.from('mail_accounts')
    .select('user_id, mailbox_email, composio_user_id, composio_connection_id, enabled, paused')
    .eq('user_id', caller).eq('enabled', true).eq('paused', false)
    .order('created_at', { ascending: true })
    .limit(1);
  const account = Array.isArray(acct) && acct.length > 0 ? acct[0] : null;
  if (!account) throw new Error('no_mailbox_for_user');

  const userId = (account.composio_user_id as string)
    ?? (await getCfg(supabase, 'mail-sync-etl-v2', 'composio_user_id'))
    ?? (await getCfg(supabase, 'global', 'composio_user_id')) ?? 'user-jelle';
  const connectionId = (account.composio_connection_id as string)
    ?? (await getCfg(supabase, 'mail-sync-etl-v2', 'composio_connection_id'));
  if (!connectionId) throw new Error('composio_connection_id_missing');

  return {
    apiKey, userId, connectionId,
    ownerUserId: account.user_id as string,
    mailboxEmail: (account.mailbox_email as string) ?? null,
  };
}

// Gateway (verify_jwt) checkt de handtekening al; hier alleen de role-claim
// lezen zodat de publieke anon-key geen mail-inhoud kan opvragen.
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
