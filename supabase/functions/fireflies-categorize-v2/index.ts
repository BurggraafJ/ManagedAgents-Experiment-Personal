// fireflies-categorize v1.0.2 - F-1+F-2; gpt-4.1-nano (enum classifier, geen reasoning)
import { createClient, type SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2.45.4";

const SKILL_VERSION = "fireflies-categorize-v1.0.2";
const CLASSIFIER_MODEL = "gpt-4.1-nano";
const BATCH_SIZE = 10;
const MAX_WALL_TIME_MS = 90000;
const SAFETY_MARGIN_MS = 15000;
const MAX_TRANSCRIPT_HEAD_CHARS = 4000;
const RECLASSIFY_AFTER_DAYS = 30;
const CONFIDENCE_THRESHOLD = 0.6;

const VALID_AUDIENCES = ["internal", "external", "personal", "unknown"] as const;
const VALID_CATEGORIES = ["client_call", "sales_team", "mt_meeting", "strategy_vision", "org_team", "1on1", "partner_call", "personal", "unknown"] as const;

type Audience = typeof VALID_AUDIENCES[number];
type Category = typeof VALID_CATEGORIES[number];

interface Classification { audience: Audience; category: Category; confidence: number; reasoning: string; }

async function getCfg(supabase: SupabaseClient, agentName: string, key: string): Promise<string | null> {
  const { data: vaultValue } = await supabase.rpc("get_skill_secret_service", { p_skill_name: agentName, p_secret_name: key });
  if (typeof vaultValue === "string" && vaultValue.length > 0) return vaultValue;
  const { data } = await supabase.from("agent_config").select("config_value").eq("agent_name", agentName).eq("config_key", key).maybeSingle();
  if (!data?.config_value) return null;
  return typeof data.config_value === "string" ? data.config_value : String(data.config_value);
}

async function getCfgJson(supabase: SupabaseClient, agentName: string, key: string): Promise<unknown> {
  const { data } = await supabase.from("agent_config").select("config_value").eq("agent_name", agentName).eq("config_key", key).maybeSingle();
  return data?.config_value ?? null;
}

function asStringArray(v: unknown): string[] { if (!Array.isArray(v)) return []; return v.filter((x): x is string => typeof x === "string"); }
function emailDomain(email: string | null | undefined): string | null { if (!email) return null; const at = email.lastIndexOf("@"); if (at < 0) return null; return email.slice(at + 1).toLowerCase().trim(); }

function buildAttendeeBrief(meeting: any, internalDomains: string[], partnerDomains: string[]): string {
  const att: any[] = Array.isArray(meeting.attendees) ? meeting.attendees : [];
  const orgEmail = meeting.organizer_email ?? null;
  const allEmails = new Set<string>();
  if (orgEmail) allEmails.add(orgEmail.toLowerCase());
  for (const a of att) { if (a?.email) allEmails.add(String(a.email).toLowerCase()); }
  const emails = Array.from(allEmails);
  const lines: string[] = [];
  let internalCount = 0, externalCount = 0, partnerCount = 0;
  for (const e of emails) {
    const dom = emailDomain(e);
    if (!dom) continue;
    let tag = "extern";
    if (internalDomains.includes(dom)) { tag = "INTERN"; internalCount++; }
    else if (partnerDomains.includes(dom)) { tag = "partner_domain"; partnerCount++; }
    else { externalCount++; }
    lines.push("- " + e + " [" + tag + "]");
  }
  return [emails.length + " attendees (" + internalCount + " intern, " + externalCount + " extern, " + partnerCount + " partner)", "Organisator: " + (orgEmail ?? "?"), ...lines].join("\n");
}

function buildClassifierPrompt(meeting: any, internalDomains: string[], partnerDomains: string[]): { system: string; user: string } {
  const system = "Je classificeert Fireflies-meetings van Jelle Burggraaf (Legal Mind / Burggraaf Group) voor een RAG-systeem. Output JSON-only.\n\nCATEGORIE-SET (kies precies een):\n- client_call: extern, klant-kennismaking/demo/evaluatie/accountmanagement (advocatenkantoor of MKB)\n- partner_call: extern partner-organisatie (samenwerking, geen sales-deal)\n- sales_team: intern sales-team over deals/pipeline/klant-strategie\n- mt_meeting: intern management/beleid/KPI/governance\n- strategy_vision: intern lange-termijn architectuur/productvisie/financiering/fundraising\n- org_team: intern HR/sollicitaties/team/training\n- 1on1: 2 personen korte coaching/check-in\n- personal: prive (kerk/Bijbel/Jezus/God/getuigenis/zondagsdienst, familie, hobby/sport/training) - NIET WERK\n- unknown: onvoldoende signaal of confidence te laag\n\nAUDIENCE (kies precies een):\n- internal: alle attendees op interne domeinen (Legal Mind / Burggraaf Group)\n- external: minstens een attendee buiten interne domeinen, geen partner\n- personal: prive ongeacht attendees\n- unknown: confidence < 0.6\n\nPERSOONLIJK-DETECTIE BELANGRIJK: kerk/gemeente/Bijbel/Jezus/getuigenis/zondagsdienst, prive-familie, hobby/sport/training, niet-bedrijfsmatige coaching -> personal+personal met confidence > 0.85; in twijfel: unknown.\n\nCONFIDENCE: 0.9+ glashelder, 0.7-0.9 sterk, 0.6-0.7 redelijk, <0.6 -> unknown/unknown.\n\nREASONING: max 2 zinnen, doorslaggevend signaal.\n\nOUTPUT STRIKT JSON: {\"audience\":\"...\",\"category\":\"...\",\"confidence\":0.0,\"reasoning\":\"...\"}";
  const attendeeBrief = buildAttendeeBrief(meeting, internalDomains, partnerDomains);
  const summary = (meeting.summary_text ?? "").slice(0, 1500);
  const head = (meeting.transcript_text ?? "").slice(0, MAX_TRANSCRIPT_HEAD_CHARS);
  const userParts: string[] = ["TITEL: " + (meeting.title ?? "?"), "DUUR: " + (meeting.duration_min ?? "?") + " min", "DATUM: " + (meeting.date_time ?? "?"), "", "ATTENDEES:", attendeeBrief, ""];
  if (summary) userParts.push("SUMMARY:\n" + summary);
  if (head) userParts.push("TRANSCRIPT-HEAD:\n" + head);
  return { system, user: userParts.join("\n") };
}

async function classifyMeeting(apiKey: string, system: string, user: string): Promise<{ classification: Classification; tokens: number; model_used: string }> {
  const res = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: { Authorization: "Bearer " + apiKey, "Content-Type": "application/json" },
    body: JSON.stringify({ model: CLASSIFIER_MODEL, messages: [{ role: "system", content: system }, { role: "user", content: user }], response_format: { type: "json_object" }, max_completion_tokens: 400, temperature: 0.1 }),
  });
  const text = await res.text();
  if (!res.ok) throw new Error("classifier_" + res.status + ": " + text.slice(0, 200));
  const json = JSON.parse(text);
  const raw = json.choices?.[0]?.message?.content?.trim() ?? "{}";
  let parsed: any;
  try { parsed = JSON.parse(raw); } catch (e) { throw new Error("classifier_invalid_json: " + raw.slice(0, 200)); }
  let audience: Audience = (VALID_AUDIENCES as readonly string[]).includes(parsed.audience) ? parsed.audience : "unknown";
  let category: Category = (VALID_CATEGORIES as readonly string[]).includes(parsed.category) ? parsed.category : "unknown";
  const confidence = Math.max(0, Math.min(1, Number(parsed.confidence) || 0));
  const reasoning = String(parsed.reasoning ?? "").slice(0, 500);
  if (confidence < CONFIDENCE_THRESHOLD) { audience = "unknown"; category = "unknown"; }
  if (category === "personal" && audience !== "personal") audience = "personal";
  if (audience === "personal" && category !== "personal") category = "personal";
  return { classification: { audience, category, confidence, reasoning }, tokens: json.usage?.total_tokens ?? 0, model_used: CLASSIFIER_MODEL };
}

async function loadDomainConfig(supabase: SupabaseClient): Promise<{ internal: string[]; partner: string[] }> {
  const internalCfg = await getCfgJson(supabase, "global", "internal_domains");
  const partnerCfg = await getCfgJson(supabase, "daily-admin", "partner_domains");
  return { internal: asStringArray(internalCfg).map((s) => s.toLowerCase()), partner: asStringArray(partnerCfg).map((s) => s.toLowerCase()) };
}

async function fetchUncategorized(supabase: SupabaseClient, limit: number): Promise<any[]> {
  const cutoff = new Date(Date.now() - RECLASSIFY_AFTER_DAYS * 86400000).toISOString();
  const { data, error } = await supabase.from("fireflies_meetings").select("id, fireflies_id, title, date_time, duration_min, organizer_email, attendees, summary_text, transcript_text, categorized_at, categorized_by").or("categorized_at.is.null,and(categorized_by.in.(llm-gpt-5-nano,llm-gpt-4.1-nano),categorized_at.lt." + cutoff + ")").order("date_time", { ascending: false }).limit(limit);
  if (error) throw new Error("fetch_uncategorized_failed: " + error.message);
  return data ?? [];
}

Deno.serve(async (req) => {
  const startTime = Date.now();
  const supabase = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
  const presentedToken = (req.headers.get("Authorization") || "").replace(/^Bearer\s+/i, "");
  const cronSecret = (await getCfg(supabase, "global", "cron_secret")) || "";
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";
  if (!presentedToken || (presentedToken !== cronSecret && presentedToken !== serviceKey)) {
    return new Response(JSON.stringify({ error: "unauthorized" }), { status: 401, headers: { "Content-Type": "application/json" } });
  }
  const triggeredBy = req.headers.get("x-trigger-source") || "edge_cron";
  const startedAt = new Date().toISOString();
  const stats: any = { schema_version: "1", skill_version: SKILL_VERSION, classifier_model: CLASSIFIER_MODEL, triggered_by: triggeredBy, triggered_at: startedAt, meetings_seen: 0, meetings_classified: 0, by_audience: { internal: 0, external: 0, personal: 0, unknown: 0 }, by_category: {} as Record<string, number>, entity_links_made: 0, entity_links_skipped_personal: 0, total_tokens: 0, warnings: [] as string[] };
  for (const c of VALID_CATEGORIES) stats.by_category[c] = 0;
  const { data: runIns } = await supabase.from("agent_runs").insert({ agent_name: "fireflies-categorize", run_type: "edge_function", status: "running", started_at: startedAt, stats, errors: [] }).select("id").single();
  const runId = runIns?.id;
  try {
    const openaiKey = await getCfg(supabase, "openai", "embedding_key");
    if (!openaiKey) throw new Error("openai_key_missing");
    const domains = await loadDomainConfig(supabase);
    const meetings = await fetchUncategorized(supabase, BATCH_SIZE);
    stats.meetings_seen = meetings.length;
    for (const m of meetings) {
      if (Date.now() - startTime >= MAX_WALL_TIME_MS - SAFETY_MARGIN_MS) { stats.warnings.push("wall_time_break_at_" + stats.meetings_classified); break; }
      try {
        const { system, user } = buildClassifierPrompt(m, domains.internal, domains.partner);
        const { classification, tokens } = await classifyMeeting(openaiKey, system, user);
        const { error: upErr } = await supabase.from("fireflies_meetings").update({ audience: classification.audience, category: classification.category, category_confidence: classification.confidence, category_reasoning: classification.reasoning, categorized_at: new Date().toISOString(), categorized_by: "llm-gpt-4.1-nano", updated_at: new Date().toISOString() }).eq("id", m.id);
        if (upErr) { stats.warnings.push("update_" + m.id.slice(0, 8) + ": " + upErr.message.slice(0, 120)); continue; }
        stats.meetings_classified++;
        stats.total_tokens += tokens;
        stats.by_audience[classification.audience]++;
        stats.by_category[classification.category]++;
        if (classification.audience === "personal") { stats.entity_links_skipped_personal++; }
        else {
          const { error: linkErr } = await supabase.rpc("propagate_meeting_entities", { p_meeting_id: m.id });
          if (linkErr) stats.warnings.push("link_" + m.id.slice(0, 8) + ": " + linkErr.message.slice(0, 120));
          else stats.entity_links_made++;
        }
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        stats.warnings.push("meeting_" + m.id.slice(0, 8) + ": " + msg.slice(0, 200));
      }
    }
    const finalStatus = stats.warnings.length > 0 ? "warning" : "success";
    const breakdown = Object.entries(stats.by_category).filter(([, v]: any) => v > 0).map(([k, v]: any) => v + " " + k).join(" + ");
    const summary = stats.meetings_classified === 0 ? "no meetings to classify (saw " + stats.meetings_seen + ")" : stats.meetings_classified + " classified (" + breakdown + "), " + stats.entity_links_made + " entity-linked, " + stats.entity_links_skipped_personal + " personal-skip, " + stats.total_tokens + " tokens";
    if (runId) await supabase.from("agent_runs").update({ status: finalStatus, completed_at: new Date().toISOString(), summary, stats }).eq("id", runId);
    return new Response(JSON.stringify({ ok: true, runId, stats, summary }), { status: 200, headers: { "Content-Type": "application/json" } });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    if (runId) await supabase.from("agent_runs").update({ status: "error", completed_at: new Date().toISOString(), summary: msg.slice(0, 500), stats, errors: [{ message: msg, at: new Date().toISOString() }] }).eq("id", runId);
    return new Response(JSON.stringify({ ok: false, error: msg }), { status: 500, headers: { "Content-Type": "application/json" } });
  }
});
