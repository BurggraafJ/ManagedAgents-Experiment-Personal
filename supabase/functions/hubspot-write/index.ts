// hubspot-write — schrijft in HubSpot namens de INGELOGDE gebruiker.
//
// verify_jwt: TRUE — user-callable. De gateway checkt de handtekening, wij
// lezen alleen `sub` uit de claims. Bewust nooit een user_id uit de body: dan
// kon je namens een collega schrijven.
//
// ── Waarom deze functie bestaat ─────────────────────────────────────────────
//
// Lezen gaat via de spiegel (`hubspot_*`, gevuld door `hubspot-sync-etl` op een
// Private App-token). Schrijven kan dat niet: een notitie op een deal is een
// handeling van een persoon. Met één org-token staat onder elke notitie
// dezelfde naam. Daarom loopt elke write over de eigen OAuth-grant van de
// gebruiker uit `user_connectors` (provider='hubspot'), en weigert deze functie
// als die grant er niet is. Er is geen org-fallback — dat zou het hele punt
// ongedaan maken.
//
// ── Wat hij kan ─────────────────────────────────────────────────────────────
//
//   POST { action: "capabilities" }
//     → of jij kunt schrijven, en onder welke HubSpot-owner. Leest niets in
//       HubSpot; puur onze eigen tabellen.
//
//   POST { action: "create_note", body, target?: { type, id }, at? }
//     → één notitie, optioneel gekoppeld aan een deal/company/contact.
//       target.type ∈ deal | company | contact.
//
// Meer niet. Elke extra write is een apart besluit, geen uitbreiding van dit
// endpoint "omdat het toch al kan".
//
// ── Techniek ────────────────────────────────────────────────────────────────
//
// De association-write gaat over de Composio **v2**-proxy
// (`/api/v2/actions/proxy`), niet over v3 `tools/execute`. v3 kent geen
// note-met-association-tool en vertaalt `to__id` niet naar `{"to":{"id":…}}`.
// Zie `_shared/hubspot-user-write.ts` en agent-handbook §3.4.
//
// Elke poging — geslaagd of niet — landt in `agent_runs`, met de gebruiker, de
// owner en het doel-object, maar NOOIT de notitie-tekst: die kan klantinhoud
// bevatten en hoort in HubSpot te staan, niet in onze logs.

import 'jsr:@supabase/functions-js/edge-runtime.d.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.45.4';
import { CORS, json, jwtClaims } from '../_shared/connector-composio.ts';
import {
  createNote, loadHubspotGrant, NOTE_ASSOCIATION_TYPE_ID, type NoteTarget,
} from '../_shared/hubspot-user-write.ts';

const SKILL_VERSION = 'hubspot-write-v1.0';
const MAX_NOTE_CHARS = 12_000;

/** Foutcode → wat de UI erover mag zeggen. Nederlands, want dit is user-facing. */
const ERROR_COPY: Record<string, string> = {
  hubspot_not_connected:
    'Je HubSpot-koppeling staat niet aan. Koppel HubSpot in Instellingen › Connectors — schrijven gebeurt namens jou, dus het kan niet met een organisatie-token.',
  hubspot_connection_missing:
    'De HubSpot-koppeling staat op gekoppeld maar heeft geen geldige connectie. Koppel opnieuw in Instellingen › Connectors.',
  composio_api_key_missing:
    'De koppelingsdienst is niet geconfigureerd (composio_api_key ontbreekt).',
};

function isTarget(v: unknown): v is NoteTarget {
  return typeof v === 'string' && v in NOTE_ASSOCIATION_TYPE_ID;
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: CORS });
  if (req.method !== 'POST') return json({ ok: false, error: 'method_not_allowed' }, 405);

  const { role, sub } = jwtClaims(req);
  // De anon-key zit in de frontend-bundle en mag hier niets.
  if (role !== 'authenticated' || !sub) return json({ ok: false, error: 'forbidden' }, 403);

  let body: any = {};
  try { body = await req.json(); } catch { /* leeg = capabilities */ }
  const action = typeof body.action === 'string' ? body.action : 'capabilities';

  const supabase = createClient(
    Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
  );

  const grant = await loadHubspotGrant(supabase, sub);

  if (action === 'capabilities') {
    if ('error' in grant) {
      return json({
        ok: true, can_write: false, reason: grant.error,
        detail: ERROR_COPY[grant.error] ?? null, owner_id: null, owner_label: null,
      });
    }
    return json({
      ok: true, can_write: true, reason: null, detail: null,
      owner_id: grant.ownerId, owner_label: grant.ownerLabel,
      targets: Object.keys(NOTE_ASSOCIATION_TYPE_ID),
    });
  }

  if (action !== 'create_note') return json({ ok: false, error: 'unknown_action' }, 400);

  // ── Valideren vóór we een run-rij aanmaken ────────────────────────────────
  const noteBody = typeof body.body === 'string' ? body.body.trim() : '';
  if (!noteBody) return json({ ok: false, error: 'body_required' }, 400);
  if (noteBody.length > MAX_NOTE_CHARS) return json({ ok: false, error: 'body_too_long' }, 400);

  let target: { type: NoteTarget; id: string } | null = null;
  if (body.target != null) {
    const t = body.target;
    if (!isTarget(t?.type)) return json({ ok: false, error: 'target_type_invalid' }, 400);
    const id = typeof t.id === 'string' ? t.id.trim() : '';
    // HubSpot-object-ids zijn numeriek; een niet-numerieke id is een aanroepfout
    // en hoort hier te stranden, niet als 400 uit HubSpot terug te komen.
    if (!/^\d{1,20}$/.test(id)) return json({ ok: false, error: 'target_id_invalid' }, 400);
    target = { type: t.type, id };
  }

  if ('error' in grant) {
    return json({
      ok: false, error: grant.error, detail: ERROR_COPY[grant.error] ?? null,
    }, grant.error === 'composio_api_key_missing' ? 500 : 409);
  }

  const startedAt = new Date().toISOString();
  const stats: Record<string, unknown> = {
    schema_version: '1',
    skill_version: SKILL_VERSION,
    mode: 'create_note',
    counts: { notes: 0 },
    extra: {
      // Wie, waarheen, hoe lang — nooit WAT. De tekst blijft in HubSpot.
      acting_user_id: sub,
      hubspot_owner_id: grant.ownerId,
      owner_resolved: grant.ownerId != null,
      target_type: target?.type ?? null,
      target_id: target?.id ?? null,
      body_chars: noteBody.length,
      transport: 'composio_v2_proxy',
    },
    warnings: grant.ownerId ? [] : ['owner_unresolved_hubspot_defaults_to_oauth_user'],
  };

  const { data: runIns } = await supabase.from('agent_runs').insert({
    agent_name: 'hubspot-write', run_type: 'edge_function', status: 'running',
    started_at: startedAt, stats, errors: [],
  }).select('id').single();
  const runId = runIns?.id ?? null;

  try {
    const res = await createNote(grant, { body: noteBody, target, at: body.at ?? null });
    (stats.counts as any).notes = 1;
    (stats.extra as any).note_id = res.noteId;

    if (runId) {
      await supabase.from('agent_runs').update({
        status: (stats.warnings as string[]).length > 0 ? 'warning' : 'success',
        completed_at: new Date().toISOString(),
        summary: `notitie ${res.noteId} aangemaakt${target ? ` op ${target.type} ${target.id}` : ''}`,
        stats,
      }).eq('id', runId);
    }
    return json({ ok: true, note_id: res.noteId, owner_id: res.ownerId, associated: res.associated, run_id: runId });
  } catch (e) {
    const msg = String((e as Error).message || e).slice(0, 400);
    if (runId) {
      await supabase.from('agent_runs').update({
        status: 'error', completed_at: new Date().toISOString(),
        summary: msg, stats, errors: [{ message: msg, at: new Date().toISOString() }],
      }).eq('id', runId);
    }
    return json({ ok: false, error: 'hubspot_write_failed', detail: msg, run_id: runId }, 502);
  }
});
