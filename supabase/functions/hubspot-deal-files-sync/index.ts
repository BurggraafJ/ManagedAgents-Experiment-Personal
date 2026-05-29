// hubspot-deal-files-sync v1.0
//
// Doel: voor Sales Pipeline (default) Closed-Won deals + Customer Base deals
// halen we file-attachments op via HubSpot REST API en slaan we metadata op
// in `hubspot_deal_files`. De `klantbase` skill leest hieruit om te
// detecteren of een licentieovereenkomst aanwezig is.
//
// Endpoints gebruikt:
//   GET /crm/v4/objects/deals/{dealId}/associations/notes
//   GET /crm/v3/objects/notes/{noteId}?properties=hs_attachment_ids,hs_note_body
//   GET /files/v3/files/{fileId}
//
// Input (POST body, alle optioneel):
//   { deal_ids?: string[] }   — beperk tot specifieke deals
//   { scan_all?: boolean }    — scan ALLE relevante deals (default true bij no input)
//
// Wordt aangeroepen:
//   • door agent-orchestrator als onderdeel van de klantbase-cyclus
//   • door RPC request_klantbase_deal_files_sync (vanuit UI of skill)
//   • direct via HTTP voor ad-hoc sync van 1 deal

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.4";

const SKILL_VERSION = "hubspot-deal-files-sync-v1.0";
const HUBSPOT_API = "https://api.hubapi.com";
const MAX_WALL_TIME_MS = 90_000;
const FILE_FETCH_DELAY_MS = 80;    // gentle throttle tussen HubSpot calls

// Sales Pipeline Closed-Won + Customer Base actieve stages
const TARGET_STAGE_FILTER = `
  (d.pipeline_id = 'default' AND d.dealstage = '3453858021')
  OR (d.pipeline_id = '2299277539' AND d.dealstage IN
      ('3504527569','3136444618','5052825799','5184563446','4441727186'))
`;

const LOA_FILENAME_RE = /(licentie|licentieovereenkomst|loa|contract|overeenkomst)/i;
const LOA_EXT_RE = /\.(pdf|docx|doc)$/i;

interface FileRow {
  hubspot_deal_id: string;
  hubspot_file_id: string;
  filename: string | null;
  mime_type: string | null;
  size_bytes: number | null;
  download_url: string | null;
  url_expires_at: string | null;
  detected_as_loa: boolean;
  source_note_id: string | null;
  source_kind: string;
}

Deno.serve(async (req) => {
  const startedAt = Date.now();
  const supabase = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );

  try {
    const body = await req.json().catch(() => ({}));
    const accessToken = await getCfg(supabase, "hubspot-sync-etl", "access_token");
    if (!accessToken) throw new Error("hubspot_access_token_missing");

    // Bepaal scope
    let dealIds: string[] = [];
    if (Array.isArray(body.deal_ids) && body.deal_ids.length > 0) {
      dealIds = body.deal_ids.map((x: any) => String(x));
    } else {
      // Pak priority_deals uit agent_config als gezet, anders scan_all
      const priorityRaw = await getCfg(supabase, "hubspot-deal-files-sync", "priority_deals");
      if (priorityRaw) {
        try { dealIds = JSON.parse(priorityRaw); } catch { /* ignore */ }
      }
      if (dealIds.length === 0 && body.scan_all !== false) {
        // Pak ALLE relevante deals — beperkt tot recent (afgelopen 90d)
        const { data } = await supabase
          .from("hubspot_deals")
          .select("deal_id, pipeline_id, dealstage, is_archived")
          .or("pipeline_id.eq.default,pipeline_id.eq.2299277539")
          .eq("is_archived", false)
          .limit(200);
        dealIds = (data || [])
          .filter((d: any) =>
            (d.pipeline_id === "default" && d.dealstage === "3453858021") ||
            (d.pipeline_id === "2299277539" && ["3504527569","3136444618","5052825799","5184563446","4441727186"].includes(d.dealstage)),
          )
          .map((d: any) => d.deal_id);
      }
    }

    // Clear priority_deals — éénmalig verwerkt
    if (dealIds.length > 0) {
      await supabase.from("agent_config")
        .update({ config_value: "[]", updated_at: new Date().toISOString() })
        .eq("agent_name", "hubspot-deal-files-sync")
        .eq("config_key", "priority_deals");
    }

    const stats = {
      deals_scanned: 0,
      notes_scanned: 0,
      files_found: 0,
      files_upserted: 0,
      loa_detected: 0,
      errors: 0,
    };
    const perDeal: Record<string, any> = {};

    for (const dealId of dealIds) {
      if (Date.now() - startedAt > MAX_WALL_TIME_MS) {
        console.warn(`[${SKILL_VERSION}] wall-time exceeded, stopping`);
        break;
      }
      stats.deals_scanned++;
      const dealStats = { notes: 0, files: 0, loa: 0, error: null as string | null };
      perDeal[dealId] = dealStats;
      try {
        // 1. List notes geassocieerd met deal
        const noteIds = await listAssociatedNoteIds(accessToken, dealId);
        dealStats.notes = noteIds.length;
        stats.notes_scanned += noteIds.length;

        // 2. Voor elke note: haal attachment_ids op
        const fileTuples: Array<{ fileId: string; noteId: string }> = [];
        for (const noteId of noteIds) {
          await sleep(FILE_FETCH_DELAY_MS);
          const ids = await fetchNoteAttachmentIds(accessToken, noteId);
          for (const fid of ids) fileTuples.push({ fileId: fid, noteId });
        }

        // 3. Voor elke file: metadata + signed URL
        const fileRows: FileRow[] = [];
        for (const { fileId, noteId } of fileTuples) {
          await sleep(FILE_FETCH_DELAY_MS);
          const meta = await fetchFileMeta(accessToken, fileId);
          if (!meta) continue;
          stats.files_found++;
          dealStats.files++;
          const isLoa = isLoaFile(meta.name, meta.extension, meta.type);
          if (isLoa) { stats.loa_detected++; dealStats.loa++; }
          fileRows.push({
            hubspot_deal_id: dealId,
            hubspot_file_id: String(fileId),
            filename: meta.name || null,
            mime_type: meta.type || meta.mime_type || null,
            size_bytes: typeof meta.size === "number" ? meta.size : null,
            download_url: meta.url || null,
            url_expires_at: meta.expires_at || null,
            detected_as_loa: isLoa,
            source_note_id: noteId,
            source_kind: "note_attachment",
          });
        }

        // 4. Upsert in DB
        if (fileRows.length > 0) {
          const { error } = await supabase
            .from("hubspot_deal_files")
            .upsert(fileRows, { onConflict: "hubspot_deal_id,hubspot_file_id" });
          if (error) { dealStats.error = `upsert: ${error.message}`; stats.errors++; }
          else { stats.files_upserted += fileRows.length; }
        }
      } catch (e: any) {
        dealStats.error = String(e?.message || e);
        stats.errors++;
        console.error(`[${SKILL_VERSION}] deal ${dealId} failed: ${dealStats.error}`);
      }
    }

    // Schrijf run-record naar agent_runs (light, optioneel)
    try {
      await supabase.from("agent_runs").insert({
        agent_name: "hubspot-deal-files-sync",
        status: stats.errors > 0 ? "warning" : "success",
        started_at: new Date(startedAt).toISOString(),
        ended_at: new Date().toISOString(),
        duration_ms: Date.now() - startedAt,
        stats: {
          schema_version: "1",
          skill_version: SKILL_VERSION,
          counts: stats,
          per_deal: perDeal,
        },
      });
    } catch (_e) { /* agent_runs is optional logging */ }

    return new Response(JSON.stringify({ ok: true, stats, per_deal: perDeal, deal_ids: dealIds }), {
      headers: { "content-type": "application/json" },
    });
  } catch (e: any) {
    console.error(`[${SKILL_VERSION}] fatal: ${e?.message || e}`);
    return new Response(JSON.stringify({ ok: false, error: String(e?.message || e) }),
      { status: 500, headers: { "content-type": "application/json" } });
  }
});

// ────────── helpers ──────────

async function getCfg(supabase: any, agentName: string, key: string): Promise<string | null> {
  const { data: vaultValue } = await supabase.rpc("get_skill_secret_service",
    { p_skill_name: agentName, p_secret_name: key });
  if (typeof vaultValue === "string" && vaultValue.length > 0) return vaultValue;
  const { data } = await supabase.from("agent_config").select("config_value")
    .eq("agent_name", agentName).eq("config_key", key).maybeSingle();
  if (!data?.config_value) return null;
  return typeof data.config_value === "string" ? data.config_value : String(data.config_value);
}

function sleep(ms: number) { return new Promise(r => setTimeout(r, ms)); }

function isLoaFile(name: string | null | undefined, ext: string | null | undefined, mime: string | null | undefined): boolean {
  const candidate = `${name || ""} ${ext || ""}`.toLowerCase();
  const looksLikeLoa = LOA_FILENAME_RE.test(name || "");
  const goodExt = LOA_EXT_RE.test(name || "") ||
                  (ext && ["pdf","docx","doc"].includes(String(ext).toLowerCase())) ||
                  (mime && /pdf|wordprocessingml|msword/i.test(mime));
  return looksLikeLoa && !!goodExt;
}

async function listAssociatedNoteIds(token: string, dealId: string): Promise<string[]> {
  const url = `${HUBSPOT_API}/crm/v4/objects/deals/${encodeURIComponent(dealId)}/associations/notes?limit=100`;
  const res = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
  if (!res.ok) {
    if (res.status === 404) return [];
    throw new Error(`hubspot_associations_${res.status}: ${await res.text()}`);
  }
  const json = await res.json();
  return (json?.results || []).map((r: any) => String(r?.toObjectId || r?.id || "")).filter(Boolean);
}

async function fetchNoteAttachmentIds(token: string, noteId: string): Promise<string[]> {
  const url = `${HUBSPOT_API}/crm/v3/objects/notes/${encodeURIComponent(noteId)}?properties=hs_attachment_ids,hs_note_body`;
  const res = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
  if (!res.ok) return [];
  const json = await res.json();
  const raw = json?.properties?.hs_attachment_ids;
  if (!raw) return [];
  // HubSpot levert dit als semicolon-separated string
  return String(raw).split(/[;,]/).map(s => s.trim()).filter(Boolean);
}

async function fetchFileMeta(token: string, fileId: string): Promise<any | null> {
  const url = `${HUBSPOT_API}/files/v3/files/${encodeURIComponent(fileId)}`;
  const res = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
  if (!res.ok) return null;
  const json = await res.json();
  return json || null;
}
