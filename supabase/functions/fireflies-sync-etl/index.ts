// fireflies-sync-etl v1.1 - Fireflies GraphQL API mirror
// Pulls meetings (laatste 72u rolling) into fireflies_meetings + fireflies_action_items.
// Auth: agent_config.fireflies-sync-etl.api_key (Bearer).
//
// v1.1 (2026-05-05): WINDOW_HOURS van 24 → 72 + delta-strategie verwijderd.
// Reden: meetings worden door Fireflies pas uren na het gesprek gefinaliseerd,
// maar krijgen `date` op de gespreksdatum. Bij sync elke 15 min met delta-overlap
// 30 min werd het effectieve window 30-45 min, en late-arriving meetings van
// "gisteren" werden permanent gemist. 72u-window vangt deze op; upserts skippen
// duplicaten kosteloos.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.4";
const FIREFLIES_GRAPHQL = "https://api.fireflies.ai/graphql";
const SKILL_VERSION = "fireflies-edge-fn-v1.1";
const PAGE_SIZE = 25; // Fireflies transcripts limit per call
const MAX_PAGES_PER_RUN = 12; // 12 * 25 = 300 meetings cap, ruim genoeg voor 72u
const WINDOW_HOURS = 72;
const TRANSCRIPT_TEXT_CAP = 200_000; // bytes
async function getCfg(supabase, agentName, key) {
  // Vault first (canonical for secrets), agent_config fallback (non-secret config)
  const { data: vaultValue } = await supabase.rpc("get_skill_secret_service", { p_skill_name: agentName, p_secret_name: key });
  if (typeof vaultValue === "string" && vaultValue.length > 0) return vaultValue;
  const { data } = await supabase.from("agent_config").select("config_value").eq("agent_name", agentName).eq("config_key", key).maybeSingle();
  if (!data?.config_value) return null;
  return typeof data.config_value === "string" ? data.config_value : String(data.config_value);
}
async function buildCtx(supabase) {
  const apiKey = await getCfg(supabase, "fireflies-sync-etl", "api_key");
  if (!apiKey || apiKey.length < 10) throw new Error("fireflies_api_key_missing — vul in via dashboard Secrets > fireflies_api_key");
  return {
    apiKey
  };
}
async function ffQuery(ctx, query, variables, retry = 0) {
  const res = await fetch(FIREFLIES_GRAPHQL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${ctx.apiKey}`
    },
    body: JSON.stringify({
      query,
      variables
    })
  });
  if ((res.status === 429 || res.status >= 500) && retry < 3) {
    await new Promise((r)=>setTimeout(r, [
        4000,
        12000,
        30000
      ][retry]));
    return ffQuery(ctx, query, variables, retry + 1);
  }
  const text = await res.text();
  if (!res.ok) throw new Error(`fireflies_http_${res.status}: ${text.slice(0, 300)}`);
  let body;
  try {
    body = JSON.parse(text);
  } catch  {
    throw new Error(`fireflies_non_json: ${text.slice(0, 200)}`);
  }
  if (body.errors && body.errors.length > 0) {
    throw new Error(`fireflies_graphql: ${body.errors.map((e)=>e.message).join("; ").slice(0, 300)}`);
  }
  return body.data;
}
const LIST_QUERY = `
query Transcripts($fromDate: DateTime, $toDate: DateTime, $limit: Int, $skip: Int) {
  transcripts(fromDate: $fromDate, toDate: $toDate, limit: $limit, skip: $skip) {
    id
    title
    date
    duration
    organizer_email
    transcript_url
    meeting_link
    meeting_attendees { displayName email name }
    summary {
      action_items
      overview
      short_summary
      bullet_gist
      keywords
    }
    sentences { index speaker_name text start_time }
  }
}
`;
function toIso(date) {
  if (date === null || date === undefined) return null;
  if (typeof date === "number") return new Date(date).toISOString();
  // Fireflies sometimes returns numeric strings
  const num = Number(date);
  if (Number.isFinite(num) && num > 1_000_000_000) return new Date(num).toISOString();
  const d = new Date(date);
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
}
function sentencesToTranscriptText(sentences) {
  if (!sentences || sentences.length === 0) return null;
  const parts = [];
  for (const s of sentences){
    const speaker = (s.speaker_name || "Speaker").trim();
    const text = (s.text || "").trim();
    if (!text) continue;
    parts.push(`${speaker}: ${text}`);
    if (parts.join("\n").length > TRANSCRIPT_TEXT_CAP) break;
  }
  return parts.join("\n").slice(0, TRANSCRIPT_TEXT_CAP);
}
function parseActionItems(raw) {
  if (!raw) return [];
  // Fireflies action_items komt vaak als markdown-string met bullets, soms grouped per persoon.
  // We splitsen op regels; overslaan headers/lege regels.
  const lines = String(raw).split(/\r?\n/).map((l)=>l.trim()).filter(Boolean);
  const items = [];
  for (const ln of lines){
    // Headers like "**Jelle Burggraaf**" of "Jelle:" overslaan.
    if (/^\*\*[^*]+\*\*$/.test(ln)) continue;
    if (/^[A-Z][A-Za-z\s]+:$/.test(ln) && ln.length < 50) continue;
    // Bullet markers strippen
    const stripped = ln.replace(/^[-*••●\d.)\s]+/, "").trim();
    if (stripped.length >= 4) items.push(stripped);
  }
  return items;
}
function guessAssigneeFromContext(itemText, prevHeader) {
  // Probeer een naam aan het begin ("Jelle: stuur offerte") of uit de prev-header.
  const m = itemText.match(/^([A-Z][A-Za-z]+(?:\s+[A-Z][A-Za-z]+)?):\s+/);
  if (m) return m[1];
  return prevHeader;
}
function isForJelle(text) {
  return /\b(jelle|burggraaf)\b/i.test(text);
}
function mapMeetingRow(t) {
  const att = Array.isArray(t.meeting_attendees) ? t.meeting_attendees : [];
  const attJson = att.map((a)=>({
      email: a.email ?? null,
      name: a.displayName ?? a.name ?? null
    }));
  const summaryText = t.summary?.overview || t.summary?.short_summary || t.summary?.bullet_gist || null;
  const actionItemsRaw = t.summary?.action_items ?? null;
  return {
    fireflies_id: t.id,
    title: t.title ?? null,
    date_time: toIso(t.date ?? null),
    duration_min: typeof t.duration === "number" ? Math.round(t.duration) : null,
    organizer_email: t.organizer_email ? t.organizer_email.toLowerCase() : null,
    attendees: attJson,
    transcript_text: sentencesToTranscriptText(t.sentences),
    summary_text: summaryText,
    action_items: actionItemsRaw,
    meeting_url: t.transcript_url || t.meeting_link || null,
    raw: t,
    updated_at: new Date().toISOString()
  };
}
function extractActionItemRows(t) {
  const raw = t.summary?.action_items;
  if (!raw) return [];
  // Walk lines; track current header (bv. **Jelle Burggraaf**) als impliciete assignee.
  const lines = String(raw).split(/\r?\n/).map((l)=>l.trim()).filter(Boolean);
  let prevHeader = null;
  const out = [];
  let idx = 0;
  for (const ln of lines){
    const headerMatch = ln.match(/^\*\*([^*]+)\*\*$/) || ln.match(/^([A-Z][A-Za-z\s]+):$/);
    if (headerMatch) {
      prevHeader = headerMatch[1].trim();
      continue;
    }
    const stripped = ln.replace(/^[-*••●\d.)\s]+/, "").trim();
    if (stripped.length < 4) continue;
    const inline = guessAssigneeFromContext(stripped, prevHeader);
    const text = stripped.replace(/^([A-Z][A-Za-z]+(?:\s+[A-Z][A-Za-z]+)?):\s+/, "");
    out.push({
      fireflies_id: t.id,
      external_key: `${t.id}::${idx}`,
      assignee: inline,
      text: text.slice(0, 1000),
      due_date: null,
      is_for_jelle: isForJelle(`${inline ?? ""} ${text}`)
    });
    idx++;
  }
  return out;
}
async function syncWindow(supabase, ctx, fromIso, toIso) {
  let totalMeetings = 0;
  let totalActionItems = 0;
  let pages = 0;
  for(let skip = 0; pages < MAX_PAGES_PER_RUN; skip += PAGE_SIZE){
    const data = await ffQuery(ctx, LIST_QUERY, {
      fromDate: fromIso,
      toDate: toIso,
      limit: PAGE_SIZE,
      skip
    });
    pages++;
    const list = Array.isArray(data?.transcripts) ? data.transcripts : [];
    if (list.length === 0) break;
    const mRows = list.map(mapMeetingRow);
    const { error: mErr } = await supabase.from("fireflies_meetings").upsert(mRows, {
      onConflict: "fireflies_id"
    });
    if (mErr) throw new Error(`fireflies_meetings_upsert_failed: ${mErr.message}`);
    totalMeetings += mRows.length;
    // Refresh meeting-uuid map zodat we fireflies_meeting_id kunnen zetten op losse action items
    const ffIds = mRows.map((r)=>r.fireflies_id);
    const { data: idMap } = await supabase.from("fireflies_meetings").select("id, fireflies_id").in("fireflies_id", ffIds);
    const uuidByFf = new Map();
    for (const r of idMap ?? [])uuidByFf.set(r.fireflies_id, r.id);
    const aiRows = [];
    for (const t of list){
      const items = extractActionItemRows(t);
      const meetingUuid = uuidByFf.get(t.id) ?? null;
      for (const it of items){
        aiRows.push({
          ...it,
          fireflies_meeting_id: meetingUuid
        });
      }
    }
    if (aiRows.length > 0) {
      const { error: aErr } = await supabase.from("fireflies_action_items").upsert(aiRows, {
        onConflict: "external_key"
      });
      if (aErr) throw new Error(`fireflies_action_items_upsert_failed: ${aErr.message}`);
      totalActionItems += aiRows.length;
    }
    if (list.length < PAGE_SIZE) break;
  }
  return {
    meetings: totalMeetings,
    actionItems: totalActionItems,
    pages
  };
}
Deno.serve(async (req)=>{
  const supabase = createClient(Deno.env.get("SUPABASE_URL"), Deno.env.get("SUPABASE_SERVICE_ROLE_KEY"));
  const presentedToken = (req.headers.get("Authorization") || "").replace(/^Bearer\s+/i, "");
  const cronSecret = await getCfg(supabase, "global", "cron_secret") || "";
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";
  if (!presentedToken || presentedToken !== cronSecret && presentedToken !== serviceKey) {
    return new Response(JSON.stringify({
      error: "unauthorized"
    }), {
      status: 401,
      headers: {
        "Content-Type": "application/json"
      }
    });
  }
  const triggeredBy = req.headers.get("x-trigger-source") || "edge_cron";
  const startedAt = new Date().toISOString();
  const stats = {
    schema_version: "1",
    skill_version: SKILL_VERSION,
    triggered_by: triggeredBy,
    triggered_at: startedAt,
    window_hours: WINDOW_HOURS,
    meetings_upserted: 0,
    action_items_upserted: 0,
    pages: 0,
    warnings: []
  };
  const { data: runIns, error: runErr } = await supabase.from("agent_runs").insert({
    agent_name: "fireflies-sync",
    run_type: "edge_function",
    status: "running",
    started_at: startedAt,
    stats,
    errors: []
  }).select("id").single();
  if (runErr || !runIns) return new Response(`run_record_create_failed: ${runErr?.message}`, {
    status: 500
  });
  const runId = runIns.id;
  try {
    const ctx = await buildCtx(supabase);
    const now = new Date();
    // v1.1: altijd vol-window. Late-arriving meetings worden zo wel opgepakt;
    // upserts deduplicaten op fireflies_id zodat dit kosteloos is.
    const from = new Date(now.getTime() - WINDOW_HOURS * 3_600_000);
    const fromIso = from.toISOString();
    const toIso = now.toISOString();
    const { meetings, actionItems, pages } = await syncWindow(supabase, ctx, fromIso, toIso);
    stats.meetings_upserted = meetings;
    stats.action_items_upserted = actionItems;
    stats.pages = pages;
    const stateRow = {
      id: 1,
      last_delta_sync_at: now.toISOString(),
      last_meetings_count: meetings,
      last_window_hours: WINDOW_HOURS,
      last_error: null,
      last_error_at: null,
      updated_at: now.toISOString()
    };
    const { error: stateErr } = await supabase.from("fireflies_sync_state").upsert(stateRow, {
      onConflict: "id"
    });
    if (stateErr) throw new Error(`fireflies_sync_state_upsert_failed: ${stateErr.message}`);
    const summary = `${meetings} meetings, ${actionItems} action_items over ${pages} page(s) (window ${WINDOW_HOURS}u)`;
    await supabase.from("agent_runs").update({
      status: "success",
      completed_at: new Date().toISOString(),
      summary,
      stats
    }).eq("id", runId);
    return new Response(JSON.stringify({
      ok: true,
      runId,
      stats
    }), {
      status: 200,
      headers: {
        "Content-Type": "application/json"
      }
    });
  } catch (err) {
    const errMsg = err instanceof Error ? err.message : String(err);
    await supabase.from("fireflies_sync_state").upsert({
      id: 1,
      last_error: errMsg.slice(0, 500),
      last_error_at: new Date().toISOString(),
      updated_at: new Date().toISOString()
    }, {
      onConflict: "id"
    });
    await supabase.from("agent_runs").update({
      status: "error",
      completed_at: new Date().toISOString(),
      summary: errMsg.slice(0, 500),
      stats,
      errors: [
        {
          message: errMsg,
          at: new Date().toISOString()
        }
      ]
    }).eq("id", runId);
    return new Response(JSON.stringify({
      ok: false,
      error: errMsg
    }), {
      status: 500,
      headers: {
        "Content-Type": "application/json"
      }
    });
  }
});
