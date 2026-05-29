// hubspot-deal-files-sync v1.5 — + DOCX download & parse (signed-url + fflate)
//
// Detecteert LoA-files op HubSpot deals via twee strategies en cachet de
// geparste tekst in hubspot_deal_files.parsed_text:
//   S1. engagements (notes/emails) + hs_attachment_ids
//   S2. custom deal-properties van fieldType='file' (bv. contract_document)
//
// Bevinding (2026-05-29): Jelle's LoAs zitten in property `contract_document`
// (label "Licentieovereenkomst", type=string fieldType=file), NIET als
// note-attachment. Files API vereist scopes `files` + `files.ui_hidden.read`.
//
// DOCX wordt inline geparsed (signed-url -> fflate unzip -> word/document.xml).
// PDF/doc krijgen parse_error en worden door de skill (anthropic-skills:pdf)
// in-session geparsed.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.4";
import { unzipSync, strFromU8 } from "https://esm.sh/fflate@0.8.2";

const SKILL_VERSION = "hubspot-deal-files-sync-v1.5";
const HUBSPOT_API = "https://api.hubapi.com";
const MAX_WALL_TIME_MS = 110_000;
const DELAY_MS = 80;
const LOA_FILENAME_RE = /(licentie|licentieovereenkomst|loa|contract|overeenkomst)/i;
const LOA_EXT_RE = /\.(pdf|docx|doc)$/i;
const FILE_ID_RE = /^\d{9,20}$/;
const SYSTEM_PROPS = new Set(["hs_object_id","createdate","hs_lastmodifieddate","hs_createdate"]);

Deno.serve(async (req) => {
  const startedAt = Date.now();
  const supabase = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
  try {
    const body = await req.json().catch(() => ({}));
    const accessToken = await getCfg(supabase, "hubspot-sync-etl", "access_token");
    if (!accessToken) throw new Error("hubspot_access_token_missing");
    const parseFiles = body.parse_files !== false;  // default true

    let dealIds: string[] = Array.isArray(body.deal_ids) ? body.deal_ids.map(String) : [];
    if (dealIds.length === 0) {
      const priorityRaw = await getCfg(supabase, "hubspot-deal-files-sync", "priority_deals");
      if (priorityRaw) { try { dealIds = JSON.parse(priorityRaw); } catch {} }
    }
    if (dealIds.length === 0 && body.scan_all !== false) {
      const { data } = await supabase.from("hubspot_deals")
        .select("deal_id, pipeline_id, dealstage, is_archived")
        .or("pipeline_id.eq.default,pipeline_id.eq.2299277539")
        .eq("is_archived", false).limit(200);
      dealIds = (data || [])
        .filter((d: any) =>
          (d.pipeline_id === "default" && d.dealstage === "3453858021") ||
          (d.pipeline_id === "2299277539" && ["3504527569","3136444618","5052825799","5184563446","4441727186"].includes(d.dealstage)),
        ).map((d: any) => d.deal_id);
    }

    const filePropNames = await discoverFileProperties(accessToken);
    const propsParam = filePropNames.join(",");

    const stats: any = { deals_scanned: 0, file_props_discovered: filePropNames.length,
      files_found: 0, files_upserted: 0, loa_detected: 0, parsed_ok: 0, parse_skipped: 0, parse_failed: 0, errors: 0 };
    const perDeal: Record<string, any> = {};

    for (const dealId of dealIds) {
      if (Date.now() - startedAt > MAX_WALL_TIME_MS) break;
      stats.deals_scanned++;
      const dealStats: any = { files: 0, loa: 0, parsed: 0, error: null };
      perDeal[dealId] = dealStats;
      try {
        const fileTuples: Array<{ fileId: string; srcProp: string | null }> = [];
        // Engagements
        const engsByType = await listAllEngagementIds(accessToken, dealId);
        for (const [type, ids] of Object.entries(engsByType)) {
          for (const id of ids as string[]) {
            await sleep(DELAY_MS);
            const attIds = await fetchEngagementAttachmentIds(accessToken, type, id);
            for (const fid of attIds) if (FILE_ID_RE.test(fid)) fileTuples.push({ fileId: fid, srcProp: null });
          }
        }
        // File-properties
        if (filePropNames.length > 0) {
          const propValues = await fetchDealFileProperties(accessToken, dealId, propsParam);
          for (const [propName, value] of Object.entries(propValues || {})) {
            if (SYSTEM_PROPS.has(propName) || value == null || value === "") continue;
            for (const fid of String(value).split(/[;,]/).map(s => s.trim()).filter(Boolean)) {
              if (FILE_ID_RE.test(fid)) fileTuples.push({ fileId: fid, srcProp: propName });
            }
          }
        }

        const fileRows: any[] = [];
        const seenIds = new Set<string>();
        for (const { fileId, srcProp } of fileTuples) {
          if (seenIds.has(fileId)) continue;
          seenIds.add(fileId);
          await sleep(DELAY_MS);
          const meta = await fetchFileMeta(accessToken, fileId);
          if (!meta) continue;
          stats.files_found++; dealStats.files++;
          const ext = (meta.extension || "").toLowerCase();
          const isLoaByName = isLoaFile(meta.name, ext, meta.type);
          const isLoaByProp = srcProp != null && /licent|loa|contract|overeenkomst/i.test(srcProp);
          const isLoa = isLoaByName || isLoaByProp;
          if (isLoa) { stats.loa_detected++; dealStats.loa++; }

          let parsedText: string | null = null;
          let parseError: string | null = null;
          if (parseFiles && isLoa) {
            if (ext === "docx") {
              const r = await downloadAndParseDocx(accessToken, fileId);
              if (r.text) { parsedText = r.text; stats.parsed_ok++; dealStats.parsed++; }
              else { parseError = r.error; stats.parse_failed++; }
            } else if (ext === "pdf" || ext === "doc") {
              parseError = `extension '${ext}' nog niet inline geparsed — skill parse't via pdf/docx skill`;
              stats.parse_skipped++;
            }
          }

          fileRows.push({
            hubspot_deal_id: dealId,
            hubspot_file_id: String(fileId),
            filename: meta.name || null,
            mime_type: meta.type || null,
            file_extension: ext || null,
            size_bytes: typeof meta.size === "number" ? meta.size : null,
            download_url: meta.url || null,
            url_expires_at: null,
            detected_as_loa: isLoa,
            source_note_id: srcProp ? `prop:${srcProp}` : null,
            source_kind: srcProp ? "deal_attachment" : "engagement_file",
            parsed_text: parsedText,
            parsed_at: parsedText ? new Date().toISOString() : null,
            parse_error: parseError,
          });
        }

        if (fileRows.length > 0) {
          const { error } = await supabase.from("hubspot_deal_files")
            .upsert(fileRows, { onConflict: "hubspot_deal_id,hubspot_file_id" });
          if (error) { dealStats.error = `upsert: ${error.message}`; stats.errors++; }
          else stats.files_upserted += fileRows.length;
        }
      } catch (e: any) {
        dealStats.error = String(e?.message || e); stats.errors++;
      }
    }

    try {
      await supabase.from("agent_runs").insert({
        agent_name: "hubspot-deal-files-sync", status: stats.errors > 0 ? "warning" : "success",
        started_at: new Date(startedAt).toISOString(), ended_at: new Date().toISOString(),
        duration_ms: Date.now() - startedAt,
        stats: { schema_version: "1", skill_version: SKILL_VERSION, counts: stats, per_deal: perDeal, file_properties: filePropNames },
      });
    } catch (_e) {}

    return new Response(JSON.stringify({ ok: true, stats, per_deal: perDeal }), {
      headers: { "content-type": "application/json" },
    });
  } catch (e: any) {
    return new Response(JSON.stringify({ ok: false, error: String(e?.message || e) }),
      { status: 500, headers: { "content-type": "application/json" } });
  }
});

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
function isLoaFile(name: any, ext: any, mime: any): boolean {
  const looksLikeLoa = LOA_FILENAME_RE.test(name || "");
  const goodExt = LOA_EXT_RE.test(name || "") ||
                  (ext && ["pdf","docx","doc"].includes(String(ext).toLowerCase())) ||
                  (mime && /pdf|wordprocessingml|msword|document/i.test(mime));
  return looksLikeLoa && !!goodExt;
}
async function discoverFileProperties(token: string): Promise<string[]> {
  const res = await fetch(`${HUBSPOT_API}/crm/v3/properties/deals`, { headers: { Authorization: `Bearer ${token}` } });
  if (!res.ok) return [];
  const json = await res.json();
  return (json?.results || []).filter((p: any) => p.type === "file" || p.fieldType === "file").map((p: any) => p.name).filter(Boolean);
}
async function fetchDealFileProperties(token: string, dealId: string, propsParam: string): Promise<Record<string, any>> {
  const res = await fetch(`${HUBSPOT_API}/crm/v3/objects/deals/${encodeURIComponent(dealId)}?properties=${encodeURIComponent(propsParam)}`, { headers: { Authorization: `Bearer ${token}` } });
  if (!res.ok) return {};
  return (await res.json())?.properties || {};
}
async function listAllEngagementIds(token: string, dealId: string): Promise<Record<string, string[]>> {
  const types = ["notes","emails"];
  const out: Record<string, string[]> = {};
  for (const t of types) {
    const res = await fetch(`${HUBSPOT_API}/crm/v4/objects/deals/${encodeURIComponent(dealId)}/associations/${t}?limit=100`, { headers: { Authorization: `Bearer ${token}` } });
    if (!res.ok) { out[t] = []; continue; }
    const json = await res.json();
    out[t] = (json?.results || []).map((r: any) => String(r?.toObjectId || r?.id || "")).filter(Boolean);
  }
  return out;
}
async function fetchEngagementAttachmentIds(token: string, engType: string, engId: string): Promise<string[]> {
  const res = await fetch(`${HUBSPOT_API}/crm/v3/objects/${encodeURIComponent(engType)}/${encodeURIComponent(engId)}?properties=hs_attachment_ids`, { headers: { Authorization: `Bearer ${token}` } });
  if (!res.ok) return [];
  const raw = (await res.json())?.properties?.hs_attachment_ids;
  if (!raw) return [];
  return String(raw).split(/[;,]/).map(s => s.trim()).filter(Boolean);
}
async function fetchFileMeta(token: string, fileId: string): Promise<any | null> {
  const res = await fetch(`${HUBSPOT_API}/files/v3/files/${encodeURIComponent(fileId)}`, { headers: { Authorization: `Bearer ${token}` } });
  if (!res.ok) return null;
  return await res.json();
}
// Download DOCX via signed-url endpoint + parse (unzip word/document.xml + strip tags)
async function downloadAndParseDocx(token: string, fileId: string): Promise<{ text: string | null; error: string | null }> {
  try {
    const sres = await fetch(`${HUBSPOT_API}/files/v3/files/${encodeURIComponent(fileId)}/signed-url`, { headers: { Authorization: `Bearer ${token}` } });
    if (!sres.ok) return { text: null, error: `signed-url ${sres.status}` };
    const url = (await sres.json())?.url;
    if (!url) return { text: null, error: "no signed url" };
    const fres = await fetch(url);
    if (!fres.ok) return { text: null, error: `download ${fres.status}` };
    const buf = new Uint8Array(await fres.arrayBuffer());
    const zip = unzipSync(buf);
    const docXml = zip["word/document.xml"];
    if (!docXml) return { text: null, error: "no word/document.xml (geen docx?)" };
    let xml = strFromU8(docXml);
    xml = xml.replace(/<\/w:p>/g, "\n").replace(/<[^>]+>/g, "");
    xml = xml.replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&apos;/g, "'");
    const text = xml.split("\n").map(l => l.trim()).filter(Boolean).join("\n").slice(0, 60000);
    return { text: text || null, error: text ? null : "empty after parse" };
  } catch (e: any) {
    return { text: null, error: String(e?.message || e).slice(0, 300) };
  }
}
