// meeting-briefing v1.0 — pre-generated meeting briefings
import { createClient, type SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2.45.4";
import { callAnthropic } from "../_shared/anthropic-fetch.ts";

const SKILL_VERSION = "meeting-briefing-v1.0";
const INTERNAL_DOMAIN = "legal-mind.nl";
const CUSTOMER_PIPELINE_ID = "2299277539";
const MAX_WALL_TIME_MS = 110_000;
const SAFETY_MARGIN_MS = 25_000;
const MAX_INPUT_CHARS = 6000;
const NL = "Europe/Amsterdam";

async function getCfg(supabase: SupabaseClient, agentName: string, key: string): Promise<string | null> {
  const { data: vaultValue } = await supabase.rpc("get_skill_secret_service", { p_skill_name: agentName, p_secret_name: key });
  if (typeof vaultValue === "string" && vaultValue.length > 0) return vaultValue;
  const { data } = await supabase.from("agent_config").select("config_value").eq("agent_name", agentName).eq("config_key", key).maybeSingle();
  if (!data?.config_value) return null;
  return typeof data.config_value === "string" ? data.config_value : String(data.config_value);
}

async function sha256(text: string): Promise<string> {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return Array.from(new Uint8Array(buf)).map((b) => b.toString(16).padStart(2, "0")).join("");
}

function truncate(s: string, max: number): string { return s.length <= max ? s : s.slice(0, max); }

function domainOf(email: string | null | undefined): string | null {
  if (!email || !email.includes("@")) return null;
  return email.split("@")[1].toLowerCase().trim();
}

function fmtDateTimeNL(iso: string | null): string {
  if (!iso) return "onbekend";
  try { return new Date(iso).toLocaleString("nl-NL", { weekday: "long", day: "numeric", month: "long", hour: "2-digit", minute: "2-digit", timeZone: NL }); } catch { return iso; }
}

function fmtDateNL(iso: string | null): string {
  if (!iso) return "";
  try { return new Date(iso).toLocaleDateString("nl-NL", { day: "numeric", month: "short", year: "numeric", timeZone: NL }); } catch { return iso; }
}

function extractJson(text: string): any | null {
  if (!text) return null;
  try { return JSON.parse(text); } catch { /* */ }
  const m = text.match(/\{[\s\S]*\}/);
  if (m) { try { return JSON.parse(m[0]); } catch { /* */ } }
  return null;
}

function toBullets(v: unknown): string {
  if (Array.isArray(v)) return v.map((x) => `- ${String(x).trim()}`).join("\n");
  if (typeof v === "string" && v.trim()) return v.trim();
  return "";
}

function renderMarkdown(sections: Record<string, unknown>): string {
  const parts: string[] = [];
  if (sections.type_who)        parts.push(`**Type & wie** — ${sections.type_who}`);
  if (sections.relation_status) parts.push(`**Relatie & status** — ${sections.relation_status}`);
  if (sections.recent_history)  parts.push(`**Recent**\n${toBullets(sections.recent_history)}`);
  if (sections.open_items)      parts.push(`**Open items**\n${toBullets(sections.open_items)}`);
  if (sections.talking_points)  parts.push(`**Gesprekspunten**\n${toBullets(sections.talking_points)}`);
  if (sections.summary)         parts.push(`> ${sections.summary}`);
  return parts.join("\n\n");
}

async function resolveCompanyId(supabase: SupabaseClient, domain: string | null): Promise<string | null> {
  if (!domain) return null;
  const { data } = await supabase.from("entity_resolution").select("entity_id, confidence").eq("alias_type", "email_domain").eq("alias_value", domain).eq("entity_type", "company").order("confidence", { ascending: false }).limit(1).maybeSingle();
  return data?.entity_id ?? null;
}

async function gatherFacts(supabase: SupabaseClient, companyId: string | null) {
  if (!companyId) return { company: null as any, deals: [] as any[] };
  const [{ data: company }, { data: deals }] = await Promise.all([
    supabase.from("hubspot_companies").select("company_id,name,domain,lifecyclestage").eq("company_id", companyId).maybeSingle(),
    supabase.from("hubspot_deals").select("dealname,dealstage,pipeline_id,amount,closedate").contains("associated_company_ids", [companyId]).order("closedate", { ascending: false }).limit(6),
  ]);
  return { company: company ?? null, deals: deals ?? [] };
}

async function classifyMeeting(supabase: SupabaseClient, primary: { email: string | null; domain: string | null } | null, companyId: string | null, facts: { company: any; deals: any[] }): Promise<{ type: string; confidence: number; directory_label: string | null }> {
  if (!primary) return { type: "intern", confidence: 1.0, directory_label: null };
  const { data: dir } = await supabase.rpc("classify_external_party", { p_domain_or_email: primary.email || primary.domain });
  const dirClass = dir && typeof dir === "object" ? String((dir as any).classification ?? "").toLowerCase() : "";
  if (dirClass) {
    if (/recruit/.test(dirClass))                     return { type: "recruitment", confidence: 1.0, directory_label: (dir as any).classification };
    if (/partner/.test(dirClass))                     return { type: "partner", confidence: 1.0, directory_label: (dir as any).classification };
    if (/vendor|leverancier|supplier/.test(dirClass)) return { type: "partner", confidence: 0.7, directory_label: (dir as any).classification };
  }
  if (companyId) {
    if (facts.deals.some((d) => d.pipeline_id === CUSTOMER_PIPELINE_ID)) return { type: "klant", confidence: 0.9, directory_label: null };
    if (/customer|klant/i.test(String(facts.company?.lifecyclestage ?? ""))) return { type: "klant", confidence: 0.8, directory_label: null };
    if (facts.deals.length > 0)                                              return { type: "lead", confidence: 0.7, directory_label: null };
    return { type: "lead", confidence: 0.5, directory_label: null };
  }
  return { type: "onbekend", confidence: 0.3, directory_label: null };
}

async function callContextBuild(supabaseUrl: string, cronSecret: string, runId: string, event: any, company: string | null, counterparties: any[], primary: { email: string | null; domain: string | null } | null, companyId: string | null, lookbackDays: number, topK: number): Promise<{ bundle_id: string | null; matches: any[]; knowledge_lessons: any[]; entity_used: any }> {
  const queryText = truncate([`Onderwerp: ${event.subject ?? ""}`, company ? `Bedrijf: ${company}` : "", counterparties.length ? `Deelnemers: ${counterparties.map((c) => c.name || c.email).filter(Boolean).join(", ")}` : "", event.body_preview ? `Context: ${event.body_preview}` : ""].filter(Boolean).join("\n"), MAX_INPUT_CHARS);
  const filterAfter = new Date(Date.now() - lookbackDays * 86_400_000).toISOString();
  const options: Record<string, unknown> = { from_email: primary?.email ?? undefined, from_domain: primary?.domain ?? undefined, top_k: topK, filter_after: filterAfter };
  if (companyId) { options.entity_type = "company"; options.entity_id = companyId; }
  const res = await fetch(`${supabaseUrl}/functions/v1/context-build`, { method: "POST", headers: { "Content-Type": "application/json", "Authorization": `Bearer ${cronSecret}` }, body: JSON.stringify({ intent: "analyze_meeting", audience: "meeting-briefing", trigger_type: "meeting", trigger_id: event.id, query_text: queryText, agent_run_id: runId, options }) });
  const text = await res.text();
  if (!res.ok) throw new Error(`context-build_${res.status}: ${text.slice(0, 200)}`);
  const json = JSON.parse(text);
  if (!json.ok) throw new Error(`context-build_not_ok: ${json.error ?? "unknown"}`);
  return { bundle_id: json.bundle_id ?? null, matches: json.matches ?? [], knowledge_lessons: json.knowledge_lessons ?? [], entity_used: json.entity_used ?? null };
}

function relationBlock(facts: { company: any; deals: any[] }): string {
  if (!facts.company && facts.deals.length === 0) return "Geen HubSpot-relatie gevonden.";
  const lines: string[] = [];
  if (facts.company) lines.push(`Bedrijf: ${facts.company.name ?? "?"}${facts.company.lifecyclestage ? ` (lifecycle: ${facts.company.lifecyclestage})` : ""}`);
  for (const d of facts.deals.slice(0, 5)) {
    const amt = d.amount != null ? `€${Number(d.amount).toLocaleString("nl-NL")}` : "";
    const close = d.closedate ? `sluit ${fmtDateNL(d.closedate)}` : "";
    const pipe = d.pipeline_id === CUSTOMER_PIPELINE_ID ? "Customer Base" : "Sales";
    lines.push(`Deal: ${d.dealname ?? "?"} [${pipe}] ${[amt, close, d.dealstage ? `stage ${d.dealstage}` : ""].filter(Boolean).join(" · ")}`);
  }
  return lines.join("\n");
}

function historyBlock(matches: any[], lim = 8): string {
  if (!matches?.length) return "Geen relevante historie gevonden in het zoeksysteem.";
  return matches.slice(0, lim).map((m) => { const d = m.occurred_at ? ` ${fmtDateNL(m.occurred_at)}` : ""; const snip = String(m.preview ?? "").replace(/\s+/g, " ").slice(0, 220); return `- [${m.source ?? "bron"}${d}] ${snip}`; }).join("\n");
}

function openItemsBlock(facts: { deals: any[] }): string {
  const open = facts.deals.filter((d) => d.pipeline_id !== CUSTOMER_PIPELINE_ID);
  if (open.length === 0) return "Geen lopende sales-deal gevonden. Let op openstaande punten uit de historie hierboven.";
  return open.slice(0, 4).map((d) => `- ${d.dealname ?? "deal"}${d.dealstage ? ` (stage ${d.dealstage})` : ""}${d.closedate ? ` — sluit ${fmtDateNL(d.closedate)}` : ""}`).join("\n");
}

function lessonsBlock(lessons: any[]): string {
  if (!lessons?.length) return "Geen.";
  return lessons.slice(0, 4).map((l) => `- ${String(l.lesson_text ?? l.lesson ?? l.content ?? l.text ?? "").slice(0, 200)}`).filter((s) => s.length > 2).join("\n") || "Geen.";
}

async function generateForEvent(supabase: SupabaseClient, supabaseUrl: string, cronSecret: string, anthropicKey: string, cfg: any, eventId: string, runId: string, force: boolean): Promise<{ status: string; meeting_type?: string; reason?: string }> {
  const { data: event } = await supabase.from("calendar_events").select("id, subject, body_preview, start_time, end_time, location_text, online_meeting_url, organizer_email").eq("id", eventId).maybeSingle();
  if (!event) return { status: "skipped", reason: "event_not_found" };
  const { data: attendees } = await supabase.from("calendar_attendees").select("email, name, attendee_type, is_organizer").eq("calendar_event_id", eventId);
  const att = attendees ?? [];
  const attEmails = att.map((a) => (a.email ?? "").toLowerCase()).filter(Boolean).sort().join(",");
  const sourceHash = await sha256(`${event.subject ?? ""}|${event.start_time ?? ""}|${attEmails}`);
  if (!force) {
    const { data: existing } = await supabase.from("meeting_briefings").select("status, source_hash").eq("calendar_event_id", eventId).maybeSingle();
    if (existing && existing.status === "ready" && existing.source_hash === sourceHash) return { status: "fresh", reason: "unchanged" };
  }
  await supabase.from("meeting_briefings").upsert({ calendar_event_id: eventId, status: "generating", event_start_time: event.start_time, updated_at: new Date().toISOString() }, { onConflict: "calendar_event_id" });
  try {
    const counterparties = att.filter((a) => a.email && domainOf(a.email) && domainOf(a.email) !== INTERNAL_DOMAIN).map((a) => ({ name: a.name ?? null, email: a.email, domain: domainOf(a.email), is_organizer: !!a.is_organizer }));
    if (counterparties.length === 0) {
      if (!(cfg.include_meeting_types as string[]).includes("intern")) {
        await supabase.from("meeting_briefings").update({ status: "skipped", meeting_type: "intern", meeting_type_confidence: 1.0, counterparties: [], source_hash: sourceHash, event_start_time: event.start_time, error_text: null, updated_at: new Date().toISOString(), run_id: runId }).eq("calendar_event_id", eventId);
        return { status: "skipped", meeting_type: "intern", reason: "internal_only" };
      }
    }
    const primaryCp = counterparties.find((c) => c.is_organizer) ?? counterparties[0] ?? null;
    const primary = primaryCp ? { email: primaryCp.email, domain: primaryCp.domain } : null;
    const companyId = await resolveCompanyId(supabase, primary?.domain ?? null);
    const facts = await gatherFacts(supabase, companyId);
    const companyName = facts.company?.name ?? primaryCp?.domain ?? null;
    const cls = await classifyMeeting(supabase, primary, companyId, facts);
    if (!(cfg.include_meeting_types as string[]).includes(cls.type)) {
      await supabase.from("meeting_briefings").update({ status: "skipped", meeting_type: cls.type, meeting_type_confidence: cls.confidence, counterparties, company_name: companyName, entity_type: companyId ? "company" : null, entity_id: companyId, source_hash: sourceHash, event_start_time: event.start_time, error_text: null, updated_at: new Date().toISOString(), run_id: runId }).eq("calendar_event_id", eventId);
      return { status: "skipped", meeting_type: cls.type, reason: "type_excluded" };
    }
    const ctx = await callContextBuild(supabaseUrl, cronSecret, runId, event, companyName, counterparties, primary, companyId, Number(cfg.lookback_days ?? 365), Number(cfg.top_k ?? 10));
    const enabled = cfg.enabled_sections ?? {};
    const enabledKeys = Object.entries(enabled).filter(([, v]) => v).map(([k]) => k);
    enabledKeys.push("summary");
    const meetingBlock = [`Onderwerp: ${event.subject ?? "(geen titel)"}`, `Wanneer: ${fmtDateTimeNL(event.start_time)}`, event.location_text ? `Locatie: ${event.location_text}` : (event.online_meeting_url ? "Locatie: online (Teams)" : "")].filter(Boolean).join("\n");
    const classificationBlock = [`Type: ${cls.type}${cls.directory_label ? ` (directory: ${cls.directory_label})` : ""} (zekerheid ${Math.round(cls.confidence * 100)}%)`, `Tegenpartij: ${companyName ?? "onbekend"}`, counterparties.length ? `Aanwezig: ${counterparties.map((c) => `${c.name ?? c.email}${c.is_organizer ? " (organisator)" : ""}`).join(", ")}` : "Geen externe deelnemers met e-mail."].join("\n");
    const userPrompt = String(cfg.prompt_user_template ?? "").replace("{{meeting_block}}", meetingBlock).replace("{{classification_block}}", classificationBlock).replace("{{relation_block}}", relationBlock(facts)).replace("{{history_block}}", historyBlock(ctx.matches)).replace("{{open_items_block}}", openItemsBlock(facts)).replace("{{lessons_block}}", lessonsBlock(ctx.knowledge_lessons)).replace("{{enabled_keys}}", enabledKeys.join(", "));
    const ai = await callAnthropic({ supabase, apiKey: anthropicKey, model: String(cfg.model ?? "claude-sonnet-4-5"), max_tokens: 2000, system: String(cfg.prompt_system ?? ""), messages: [{ role: "user", content: userPrompt }], attribution: { runId, edgeFunction: "meeting-briefing", skillName: "meeting-briefing" } });
    const parsed = extractJson(ai.content);
    if (!parsed) throw new Error(`json_parse_failed: ${ai.content.slice(0, 200)}`);
    const sections: Record<string, unknown> = {};
    for (const k of enabledKeys) if (parsed[k] != null) sections[k] = parsed[k];
    const briefingMd = renderMarkdown(sections);
    await supabase.from("meeting_briefings").update({ status: "ready", meeting_type: cls.type, meeting_type_confidence: cls.confidence, entity_type: companyId ? "company" : (primary?.email ? "contact" : null), entity_id: companyId, company_name: companyName, counterparties, context_bundle_id: ctx.bundle_id, sections, briefing_md: briefingMd, model: ai.model, tokens_used: (ai.input_tokens ?? 0) + (ai.output_tokens ?? 0), cost_usd: ai.cost_usd ?? null, source_hash: sourceHash, event_start_time: event.start_time, generated_at: new Date().toISOString(), regenerate_requested_at: null, error_text: null, run_id: runId, updated_at: new Date().toISOString() }).eq("calendar_event_id", eventId);
    return { status: "ready", meeting_type: cls.type };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    await supabase.from("meeting_briefings").update({ status: "error", error_text: msg.slice(0, 500), source_hash: sourceHash, event_start_time: event.start_time, updated_at: new Date().toISOString(), run_id: runId }).eq("calendar_event_id", eventId);
    return { status: "error", reason: msg.slice(0, 200) };
  }
}

async function selectScanCandidates(supabase: SupabaseClient, horizonDays: number, maxPerRun: number): Promise<string[]> {
  const { data: queuedRows } = await supabase.from("meeting_briefings").select("calendar_event_id").eq("status", "queued").order("regenerate_requested_at", { ascending: true }).limit(50);
  const queuedIds = (queuedRows ?? []).map((r) => r.calendar_event_id);
  const nowIso = new Date(Date.now() - 15 * 60_000).toISOString();
  const horizonEnd = new Date(Date.now() + horizonDays * 86_400_000).toISOString();
  const { data: upcoming } = await supabase.from("calendar_events").select("id").eq("is_cancelled", false).eq("is_deleted", false).eq("is_all_day", false).gte("start_time", nowIso).lte("start_time", horizonEnd).order("start_time", { ascending: true }).limit(100);
  const upcomingIds = (upcoming ?? []).map((e) => e.id);
  const { data: existing } = await supabase.from("meeting_briefings").select("calendar_event_id, status").in("calendar_event_id", upcomingIds.length ? upcomingIds : ["00000000-0000-0000-0000-000000000000"]);
  const exMap = new Map((existing ?? []).map((r) => [r.calendar_event_id, r.status]));
  const out: string[] = [];
  const seen = new Set<string>();
  const push = (id: string) => { if (!seen.has(id)) { seen.add(id); out.push(id); } };
  for (const id of queuedIds) push(id);
  for (const id of upcomingIds) { const st = exMap.get(id); if (!st || st === "error") push(id); }
  return out.slice(0, maxPerRun);
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
  let body: any = {};
  try { body = await req.json(); } catch { /* */ }
  const mode: string = body.mode ?? "scan";
  const triggeredBy = req.headers.get("x-trigger-source") || "edge_cron";
  const startedAt = new Date().toISOString();
  const stats = { skill_version: SKILL_VERSION, triggered_by: triggeredBy, mode, candidates: 0, generated: 0, skipped: 0, fresh: 0, errors: 0, by_type: {} as Record<string, number>, warnings: [] as string[] };
  const { data: runIns, error: runErr } = await supabase.from("agent_runs").insert({ agent_name: "meeting-briefing", run_type: "edge_function", status: "running", started_at: startedAt, stats, errors: [] }).select("id").single();
  if (runErr || !runIns) return new Response(JSON.stringify({ error: `run_create_failed: ${runErr?.message}` }), { status: 500, headers: { "Content-Type": "application/json" } });
  const runId = runIns.id as string;
  try {
    const { data: cfg } = await supabase.from("meeting_briefing_config").select("*").eq("id", 1).maybeSingle();
    if (!cfg) throw new Error("meeting_briefing_config row id=1 missing");
    const anthropicKey = await getCfg(supabase, "anthropic", "api_key");
    if (!anthropicKey) throw new Error("anthropic_api_key_missing");
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const authSecret = cronSecret || serviceKey;
    let eventIds: string[] = [];
    let force = false;
    if (mode === "single") {
      if (!body.event_id) throw new Error("event_id_required_for_single");
      eventIds = [body.event_id];
      force = body.force !== false;
    } else {
      eventIds = await selectScanCandidates(supabase, Number(cfg.scan_horizon_days ?? 7), Number(cfg.max_per_run ?? 8));
    }
    stats.candidates = eventIds.length;
    for (const eid of eventIds) {
      if ((Date.now() - startTime) >= MAX_WALL_TIME_MS - SAFETY_MARGIN_MS) { stats.warnings.push("wall_time_reached"); break; }
      const r = await generateForEvent(supabase, supabaseUrl, authSecret, anthropicKey, cfg, eid, runId, force || mode === "single");
      if (r.status === "ready") { stats.generated++; if (r.meeting_type) stats.by_type[r.meeting_type] = (stats.by_type[r.meeting_type] ?? 0) + 1; }
      else if (r.status === "skipped") stats.skipped++;
      else if (r.status === "fresh") stats.fresh++;
      else if (r.status === "error") { stats.errors++; stats.warnings.push(`${eid}: ${r.reason ?? "error"}`); }
    }
    const summary = mode === "single" ? `single ${eventIds[0]?.slice(0, 8)}: ${stats.generated ? "ready" : stats.skipped ? "skipped" : stats.errors ? "error" : "n/a"}` : `${stats.generated} briefings, ${stats.skipped} skipped, ${stats.fresh} fresh, ${stats.errors} errors (${stats.candidates} kandidaten)`;
    const finalStatus = stats.errors > 0 ? "warning" : "success";
    await supabase.from("agent_runs").update({ status: finalStatus, completed_at: new Date().toISOString(), summary, stats }).eq("id", runId);
    return new Response(JSON.stringify({ ok: true, runId, summary, stats }), { status: 200, headers: { "Content-Type": "application/json" } });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    await supabase.from("agent_runs").update({ status: "error", completed_at: new Date().toISOString(), summary: msg.slice(0, 500), stats, errors: [{ message: msg, at: new Date().toISOString() }] }).eq("id", runId);
    return new Response(JSON.stringify({ ok: false, error: msg }), { status: 500, headers: { "Content-Type": "application/json" } });
  }
});
