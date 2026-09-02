// =============================================================================
// fireflies-categorize v1.0 — F-1 + F-2 in één Edge Function
// =============================================================================
// Voor elke nog-niet-gecategoriseerde Fireflies-meeting:
//   1. Bouw classificatie-context (title + attendees + summary + transcript-head)
//   2. Roept gpt-5-nano aan voor audience + category + confidence + reasoning
//   3. Schrijft resultaten naar fireflies_meetings (F-1)
//   4. Roept propagate_meeting_entities() voor entity-linking (F-2)
//   5. Skipt entity-link voor audience='personal' (privacy)
//
// Cron: */20 * * * * (10 min na fireflies-sync, geeft sync tijd om klaar te zijn)
// Auth: Bearer cron_secret OR service_key (zelfde patroon als andere edge fns)
//
// Cost: ~$0.005 per meeting (gpt-5-nano: $0.05/1M input, $0.40/1M output)
// =============================================================================

import { createClient, type SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2.45.4";
import { matchesAnySecret } from "../_shared/edge-auth.ts";

const SKILL_VERSION = "fireflies-categorize-v1.0";
const CLASSIFIER_MODEL = "gpt-5-nano";
const CLASSIFIER_FALLBACK = "gpt-4.1-nano";
const BATCH_SIZE = 10;                 // Per run; cron-tick eens per 20 min ruim genoeg
const MAX_WALL_TIME_MS = 90_000;
const SAFETY_MARGIN_MS = 15_000;
const MAX_TRANSCRIPT_HEAD_CHARS = 4000;
const RECLASSIFY_AFTER_DAYS = 30;      // LLM-classificaties na 30 dagen heroverwegen
const CONFIDENCE_THRESHOLD = 0.6;      // Onder dit → audience='unknown' (categorie idem)

const VALID_AUDIENCES = ["internal", "external", "personal", "unknown"] as const;
const VALID_CATEGORIES = [
  "client_call", "sales_team", "mt_meeting", "strategy_vision",
  "org_team", "1on1", "partner_call", "personal", "unknown",
] as const;

type Audience = typeof VALID_AUDIENCES[number];
type Category = typeof VALID_CATEGORIES[number];

interface Classification {
  audience: Audience;
  category: Category;
  confidence: number;
  reasoning: string;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

async function getCfg(supabase: SupabaseClient, agentName: string, key: string): Promise<string | null> {
  const { data: vaultValue } = await supabase.rpc("get_skill_secret_service", {
    p_skill_name: agentName, p_secret_name: key,
  });
  if (typeof vaultValue === "string" && vaultValue.length > 0) return vaultValue;
  const { data } = await supabase.from("agent_config").select("config_value")
    .eq("agent_name", agentName).eq("config_key", key).maybeSingle();
  if (!data?.config_value) return null;
  return typeof data.config_value === "string" ? data.config_value : String(data.config_value);
}

async function getCfgJson(supabase: SupabaseClient, agentName: string, key: string): Promise<unknown> {
  const { data } = await supabase.from("agent_config").select("config_value")
    .eq("agent_name", agentName).eq("config_key", key).maybeSingle();
  return data?.config_value ?? null;
}

function asStringArray(v: unknown): string[] {
  if (!Array.isArray(v)) return [];
  return v.filter((x): x is string => typeof x === "string");
}

function emailDomain(email: string | null | undefined): string | null {
  if (!email) return null;
  const at = email.lastIndexOf("@");
  if (at < 0) return null;
  return email.slice(at + 1).toLowerCase().trim();
}

// ---------------------------------------------------------------------------
// Build classifier-prompt
// ---------------------------------------------------------------------------

function buildAttendeeBrief(
  meeting: any,
  internalDomains: string[],
  partnerDomains: string[],
): string {
  const att: any[] = Array.isArray(meeting.attendees) ? meeting.attendees : [];
  const orgEmail = meeting.organizer_email ?? null;

  const allEmails = new Set<string>();
  if (orgEmail) allEmails.add(orgEmail.toLowerCase());
  for (const a of att) {
    if (a?.email) allEmails.add(String(a.email).toLowerCase());
  }
  const emails = Array.from(allEmails);
  const lines: string[] = [];
  let internalCount = 0, externalCount = 0, partnerCount = 0;
  for (const e of emails) {
    const dom = emailDomain(e);
    if (!dom) continue;
    let tag = "extern";
    if (internalDomains.includes(dom)) { tag = "INTERN (Legal Mind)"; internalCount++; }
    else if (partnerDomains.includes(dom)) { tag = "partner_domain"; partnerCount++; }
    else { externalCount++; }
    lines.push(`- ${e} [${tag}]`);
  }
  return [
    `Aantal attendees: ${emails.length} (${internalCount} intern, ${externalCount} extern, ${partnerCount} partner)`,
    `Organisator: ${orgEmail ?? "(onbekend)"}`,
    "Lijst:",
    ...lines,
  ].join("\n");
}

function buildClassifierPrompt(
  meeting: any,
  internalDomains: string[],
  partnerDomains: string[],
): { system: string; user: string } {
  const system = `Je classificeert Fireflies-meetings van Jelle Burggraaf (CEO Legal Mind / Burggraaf Group) voor een RAG-systeem. Output JSON-only.

CATEGORIE-SET (kies precies één):
- client_call       — extern; klant-kennismaking, demo, evaluatie, accountmanagement met advocatenkantoor of MKB-klant
- partner_call      — extern; gesprek met partner-organisatie (geen sales-deal, samenwerking)
- sales_team        — intern; sales-team bespreekt deals, pipeline, klant-strategie
- mt_meeting        — intern; management/beleid, KPI's, governance
- strategy_vision   — intern; lange-termijn architectuur, productvisie, financiering, fundraising
- org_team          — intern; HR, sollicitaties, team-zaken, training
- 1on1              — 2 personen, korte coaching/check-in
- personal          — privé: kerk, familie, sport, training, hobby — NIET WERK
- unknown           — onvoldoende signaal of confidence te laag

AUDIENCE (kies precies één):
- internal — alle (relevante) attendees zitten op interne domeinen (Legal Mind / Burggraaf Group)
- external — minstens één attendee buiten interne domeinen die geen onderdeel is van het interne team
- personal — privé-onderwerp ongeacht attendees (kerk, familie, sport, training, hobby)
- unknown  — confidence < 0.6 op audience-bepaling

PERSOONLIJK-DETECTIE (belangrijk!):
Als titel of inhoud overduidelijk gaat over: kerk/gemeente/Bijbel/Jezus/God/getuigenis/ministry/zondagsdienst, óf privé-familie, óf hobby/sport/training, óf coaching die niet bedrijfsmatig is — categoriseer als "personal" met audience "personal". CONFIDENCE moet hoog zijn (>0.85) voor personal-classificatie; in twijfel: unknown.

CONFIDENCE:
- 0.9+ : titel/inhoud is glashelder een type
- 0.7-0.9 : sterke signalen, klein twijfelgebied
- 0.6-0.7 : redelijk
- <0.6 : audience='unknown' EN category='unknown'

REASONING:
Twee zinnen max. Welk signaal in titel / attendees / inhoud was doorslaggevend.

OUTPUT (strikte JSON, geen andere tekst):
{"audience": "...", "category": "...", "confidence": 0.0, "reasoning": "..."}`;

  const attendeeBrief = buildAttendeeBrief(meeting, internalDomains, partnerDomains);
  const summary = (meeting.summary_text ?? "").slice(0, 1500);
  const head = (meeting.transcript_text ?? "").slice(0, MAX_TRANSCRIPT_HEAD_CHARS);

  const user = [
    `TITEL: ${meeting.title ?? "(geen titel)"}`,
    `DUUR: ${meeting.duration_min ?? "?"} min`,
    `DATUM: ${meeting.date_time ?? "?"}`,
    "",
    `ATTENDEES:`,
    attendeeBrief,
    "",
    summary ? `SUMMARY (Fireflies):\n${summary}\n` : "",
    head ? `TRANSCRIPT-HEAD (eerste ~4000 chars):\n${head}` : "",
  ].filter(Boolean).join("\n");

  return { system, user };
}

// ---------------------------------------------------------------------------
// LLM-call
// ---------------------------------------------------------------------------

async function classifyMeeting(
  apiKey: string,
  system: string,
  user: string,
  model: string = CLASSIFIER_MODEL,
): Promise<{ classification: Classification; tokens: number; model_used: string }> {
  const res = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model,
      messages: [
        { role: "system", content: system },
        { role: "user", content: user },
      ],
      response_format: { type: "json_object" },
      max_completion_tokens: 250,
      // gpt-5-nano accepteert alleen default temperature (1); 4.1-nano accepteert 0-2.
      // Op default laten staan voor cross-model compat — output is enum, dus
      // determinisme komt uit response_format + system-prompt, niet uit T.
    }),
  });
  const text = await res.text();
  if (!res.ok) {
    if (res.status === 404 && model !== CLASSIFIER_FALLBACK) {
      return classifyMeeting(apiKey, system, user, CLASSIFIER_FALLBACK);
    }
    throw new Error(`classifier_${res.status}: ${text.slice(0, 200)}`);
  }
  const json = JSON.parse(text);
  const raw = json.choices?.[0]?.message?.content?.trim() ?? "{}";
  let parsed: any;
  try { parsed = JSON.parse(raw); } catch (e) {
    throw new Error(`classifier_invalid_json: ${raw.slice(0, 200)}`);
  }

  // Validatie + normalisatie
  let audience: Audience = VALID_AUDIENCES.includes(parsed.audience) ? parsed.audience : "unknown";
  let category: Category = VALID_CATEGORIES.includes(parsed.category) ? parsed.category : "unknown";
  const confidence = Math.max(0, Math.min(1, Number(parsed.confidence) || 0));
  const reasoning = String(parsed.reasoning ?? "").slice(0, 500);

  // Confidence-floor enforcement
  if (confidence < CONFIDENCE_THRESHOLD) {
    audience = "unknown";
    category = "unknown";
  }

  // Cross-consistency: personal ↔ personal
  if (category === "personal" && audience !== "personal") audience = "personal";
  if (audience === "personal" && category !== "personal") category = "personal";

  const tokens = json.usage?.total_tokens ?? 0;
  return {
    classification: { audience, category, confidence, reasoning },
    tokens,
    model_used: model,
  };
}

// ---------------------------------------------------------------------------
// Main loop
// ---------------------------------------------------------------------------

async function loadDomainConfig(supabase: SupabaseClient): Promise<{ internal: string[]; partner: string[] }> {
  const internalCfg = await getCfgJson(supabase, "global", "internal_domains");
  const partnerCfg = await getCfgJson(supabase, "daily-admin", "partner_domains");
  return {
    internal: asStringArray(internalCfg).map((s) => s.toLowerCase()),
    partner: asStringArray(partnerCfg).map((s) => s.toLowerCase()),
  };
}

async function fetchUncategorized(supabase: SupabaseClient, limit: number): Promise<any[]> {
  // Pak meetings die nooit gecategoriseerd zijn, OF >30 dagen geleden door LLM
  // (manueel jelle-override blijft staan).
  const cutoff = new Date(Date.now() - RECLASSIFY_AFTER_DAYS * 86400_000).toISOString();
  const { data, error } = await supabase
    .from("fireflies_meetings")
    .select("id, fireflies_id, title, date_time, duration_min, organizer_email, attendees, summary_text, transcript_text, categorized_at, categorized_by")
    .or(`categorized_at.is.null,and(categorized_by.in.(llm-gpt-5-nano,llm-gpt-4.1-nano),categorized_at.lt.${cutoff})`)
    .order("date_time", { ascending: false })
    .limit(limit);
  if (error) throw new Error(`fetch_uncategorized_failed: ${error.message}`);
  return data ?? [];
}

Deno.serve(async (req) => {
  const startTime = Date.now();
  const supabase = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );

  // Auth
  const presentedToken = (req.headers.get("Authorization") || "").replace(/^Bearer\s+/i, "");
  const cronSecret = (await getCfg(supabase, "global", "cron_secret")) || "";
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";
  if (!presentedToken || !matchesAnySecret(presentedToken, [cronSecret, serviceKey])) {
    return new Response(JSON.stringify({ error: "unauthorized" }), {
      status: 401, headers: { "Content-Type": "application/json" },
    });
  }

  const triggeredBy = req.headers.get("x-trigger-source") || "edge_cron";
  const startedAt = new Date().toISOString();
  const stats: any = {
    schema_version: "1",
    skill_version: SKILL_VERSION,
    classifier_model: CLASSIFIER_MODEL,
    triggered_by: triggeredBy,
    triggered_at: startedAt,
    meetings_seen: 0,
    meetings_classified: 0,
    by_audience: { internal: 0, external: 0, personal: 0, unknown: 0 },
    by_category: {} as Record<string, number>,
    entity_links_made: 0,
    entity_links_skipped_personal: 0,
    total_tokens: 0,
    warnings: [] as string[],
  };
  for (const c of VALID_CATEGORIES) stats.by_category[c] = 0;

  const { data: runIns } = await supabase.from("agent_runs").insert({
    agent_name: "fireflies-categorize",
    run_type: "edge_function",
    status: "running",
    started_at: startedAt,
    stats,
    errors: [],
  }).select("id").single();
  const runId = runIns?.id;

  try {
    const openaiKey = await getCfg(supabase, "openai", "embedding_key");
    if (!openaiKey) throw new Error("openai_key_missing — vault skill:openai:embedding_key niet gevonden");

    const domains = await loadDomainConfig(supabase);
    const meetings = await fetchUncategorized(supabase, BATCH_SIZE);
    stats.meetings_seen = meetings.length;

    for (const m of meetings) {
      if (Date.now() - startTime >= MAX_WALL_TIME_MS - SAFETY_MARGIN_MS) {
        stats.warnings.push(`wall_time_break_at_${stats.meetings_classified}`);
        break;
      }

      try {
        const { system, user } = buildClassifierPrompt(m, domains.internal, domains.partner);
        const { classification, tokens, model_used } = await classifyMeeting(openaiKey, system, user);

        // Persist classificatie
        const { error: upErr } = await supabase
          .from("fireflies_meetings")
          .update({
            audience: classification.audience,
            category: classification.category,
            category_confidence: classification.confidence,
            category_reasoning: classification.reasoning,
            categorized_at: new Date().toISOString(),
            categorized_by: model_used === "gpt-4.1-nano" ? "llm-gpt-4.1-nano" : "llm-gpt-5-nano",
            updated_at: new Date().toISOString(),
          })
          .eq("id", m.id);
        if (upErr) {
          stats.warnings.push(`update_${m.id.slice(0, 8)}: ${upErr.message.slice(0, 120)}`);
          continue;
        }

        stats.meetings_classified++;
        stats.total_tokens += tokens;
        stats.by_audience[classification.audience]++;
        stats.by_category[classification.category]++;

        // Entity-link (skip voor personal)
        if (classification.audience === "personal") {
          stats.entity_links_skipped_personal++;
        } else {
          const { data: linkResult, error: linkErr } = await supabase.rpc("propagate_meeting_entities", {
            p_meeting_id: m.id,
          });
          if (linkErr) {
            stats.warnings.push(`link_${m.id.slice(0, 8)}: ${linkErr.message.slice(0, 120)}`);
          } else {
            stats.entity_links_made++;
          }
        }
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        stats.warnings.push(`meeting_${m.id.slice(0, 8)}: ${msg.slice(0, 200)}`);
      }
    }

    const finalStatus = stats.warnings.length > 0 ? "warning" : "success";
    const breakdown = Object.entries(stats.by_category).filter(([, v]: any) => v > 0).map(([k, v]: any) => `${v} ${k}`).join(" + ");
    const summary = stats.meetings_classified === 0
      ? `no meetings to classify (saw ${stats.meetings_seen})`
      : `${stats.meetings_classified} classified (${breakdown}), ${stats.entity_links_made} entity-linked, ${stats.entity_links_skipped_personal} personal-skip, ${stats.total_tokens} tokens`;

    if (runId) {
      await supabase.from("agent_runs").update({
        status: finalStatus,
        completed_at: new Date().toISOString(),
        summary,
        stats,
      }).eq("id", runId);
    }

    return new Response(JSON.stringify({ ok: true, runId, stats, summary }), {
      status: 200, headers: { "Content-Type": "application/json" },
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    if (runId) {
      await supabase.from("agent_runs").update({
        status: "error",
        completed_at: new Date().toISOString(),
        summary: msg.slice(0, 500),
        stats,
        errors: [{ message: msg, at: new Date().toISOString() }],
      }).eq("id", runId);
    }
    return new Response(JSON.stringify({ ok: false, error: msg }), {
      status: 500, headers: { "Content-Type": "application/json" },
    });
  }
});
