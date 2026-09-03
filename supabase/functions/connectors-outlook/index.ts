// connectors-outlook — per-user Outlook-koppeling voor Instellingen › Connectors.
//
// Maestro is de MCP-host: de gebruiker logt één keer bij Microsoft in, Composio
// bewaart de OAuth-tokens en wij bewaren alleen de identifiers in
// `user_connectors`. De browser krijgt nooit een token te zien — hij krijgt
// alleen een status en (bij koppelen) de consent-URL van Composio.
//
// De hele OAuth-afhandeling (status / connect / disconnect) staat in
// `_shared/connector-composio.ts`; hier alleen wat Outlook-eigen is.
//
// verify_jwt: TRUE. Dit is een user-callable functie (browser, ingelogde
// gebruiker), geen cron-functie — zie de RAG-cron-hard-rule in CLAUDE.md: die
// `verify_jwt:false`-regel geldt voor de pijplijn-functies, niet voor deze.
//
// ─────────────────────────────────────────────────────────────────────────────
// v1.141 — KOPPELEN = SPIEGEL STARTEN, niet "live mogen zoeken".
//
// Tot v1.140 schreef deze functie alleen `user_connectors`, en het enige dat
// een koppeling opleverde was de LIVE Composio-tool `outlook_mail_search` in
// rag-chat. Er kwam geen mail in `mail_messages`, dus ook niets in
// `mail_enrichment` of `chunks`.
//
// Nu zet `status` er één stap bij: zodra de koppeling `connected` is én we het
// mailbox-adres kennen, krijgt die gebruiker een rij in `mail_accounts` — de
// registry waar `claim_next_mail_account(purpose)` uit claimt. Daarmee pakken
// de bestaande cron-ETL's hem op zonder één regel verandering:
// mail-sync-etl-v2 (*/5), mail-backfill (*/1), mail-reconcile (5,35),
// mail-enricher (*/5), outlook-calendar-sync-etl (*/15), chunker (*/5).
// De historie volgt via cron `mail-backfill-seed-new-accounts` (migratie
// 20260903210000), die pas zaait zodra mail-sync-etl-v2 de folders kent.
//
// DE ORG-MAILBOX WORDT NIET GERAAKT. Bestaat er al een rij voor
// (user_id, mailbox_email) — en dat is precies de situatie voor de eigenaar,
// die de org-rij (scope='org') al heeft — dan blijft die rij ongemoeid:
// scope, connectie en credential worden NIET overschreven. De enige uitzondering
// is een rij zonder connectie: die mag deze koppeling aanvullen (reparatie).
// `disconnect` weigert nog steeds een org-rij weg te halen; een eigen
// spiegel-rij wordt gepauzeerd, niet verwijderd — de al gespiegelde mail
// blijft staan.

import 'jsr:@supabase/functions-js/edge-runtime.d.ts';
import type { SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2.45.4';
import { handleConnector, type ConnectorRow } from '../_shared/connector-composio.ts';

/**
 * Zorgt dat er een spiegel bestaat voor deze gebruiker + mailbox.
 *
 * Bewust conservatief: dit mag NOOIT een werkende sync omleggen. Een
 * bestaande rij met een connectie blijft exact zoals hij is — de mailbox wordt
 * dan immers al gespiegeld en een tweede grant erin schrijven levert alleen
 * risico op. `mail_accounts` heeft UNIQUE (user_id, mailbox_email), dus dezelfde
 * mailbox kan sowieso niet twee keer in de round-robin belanden.
 *
 * Uitkomsten (gaan als `mirror` mee naar de UI):
 *   created          nieuwe rij → de ETL's beginnen te spiegelen
 *   existing         deze mailbox werd al gespiegeld → niets veranderd
 *   adopted          bestaande rij zonder connectie: credential aangevuld
 *   paused           rij staat gepauzeerd; koppelen zet dat niet stil terug
 *   pending_mailbox  nog geen mailbox-adres van Composio → volgende status-call
 */
async function ensureMirror(
  supabase: SupabaseClient, userId: string, row: ConnectorRow,
): Promise<string> {
  if (!row.account_email || !row.composio_connection_id) return 'pending_mailbox';
  const mailbox = row.account_email.toLowerCase();
  const domain = mailbox.split('@')[1] || null;

  const { data: existing } = await supabase.from('mail_accounts')
    .select('id, scope, paused, composio_connection_id')
    .eq('user_id', userId).ilike('mailbox_email', mailbox).maybeSingle();

  if (existing) {
    if (!existing.composio_connection_id) {
      await supabase.from('mail_accounts').update({
        composio_user_id: row.composio_user_id,
        composio_connection_id: row.composio_connection_id,
        last_error: null, last_error_at: null,
      }).eq('id', existing.id);
      return 'adopted';
    }
    // Scope, connectie en paused blijven van de eigenaar van die rij. Een
    // gepauzeerde mailbox weer aanzetten is een expliciete beheer-actie, geen
    // neveneffect van op "Koppelen" klikken.
    return existing.paused ? 'paused' : 'existing';
  }

  await supabase.from('mail_accounts').insert({
    user_id: userId,
    mailbox_email: mailbox,
    own_domains: domain ? [domain] : [],
    provider: 'composio',
    composio_user_id: row.composio_user_id,
    composio_connection_id: row.composio_connection_id,
    enabled: true,
    paused: false,
    scope: 'personal',
    folder_names: null,   // null = mail-sync-etl-v2 ontdekt zelf alle folders
  });
  return 'created';
}

/**
 * Grendel: de ORG-mailbox hangt niet aan deze knop. Die connectie voedt de
 * gedeelde sync en mag hier nooit sneuvelen.
 *
 * v1.141: de grendel kijkt naar de SCOPE, niet naar het enkele feit dat de
 * connectie in mail_accounts staat. Sinds koppelen zelf een spiegel-rij
 * aanmaakt zou de oude check elke disconnect met 409 weigeren — de knop zou
 * permanent klemzitten.
 */
async function guardDisconnect(
  supabase: SupabaseClient, _userId: string, connectionId: string,
): Promise<string | null> {
  const { data } = await supabase.from('mail_accounts')
    .select('id, scope').eq('composio_connection_id', connectionId);
  const rows = Array.isArray(data) ? data : [];
  if (rows.some((r) => r.scope === 'org')) return 'connection_in_use_by_mail_sync';

  // Eigen spiegel: pauzeren, niet weggooien. De al gespiegelde mail blijft
  // staan (en blijft dus vindbaar in de chat); er komt alleen niets bij.
  for (const r of rows) {
    await supabase.from('mail_accounts').update({
      paused: true, paused_reason: 'connector_disconnected',
      composio_connection_id: null,
    }).eq('id', r.id);
  }
  return null;
}

Deno.serve((req) => handleConnector(req, {
  provider: 'outlook',
  toolkitSlug: 'outlook',
  identityTool: 'OUTLOOK_OUTLOOK_GET_PROFILE',
  identityLabel: (rd) => {
    const mail = rd.mail ?? rd.userPrincipalName ?? rd.emailAddress ?? rd.email;
    return typeof mail === 'string' && mail.includes('@') ? mail : null;
  },
  afterConnected: ensureMirror,
  beforeDisconnect: guardDisconnect,
}));
