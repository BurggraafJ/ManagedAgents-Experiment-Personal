// autodraft-rewrite-sync v1 (2026-05-13)
//
// **Synchrone draft-herschrijving** voor de Maestro AIPromptBar.
//
// Tot V8.8 ging een 'amend'-actie via submit_autodraft_decision → heartbeat-
// wachtrij. Jelle moest dan 5-15 minuten wachten tot auto-draft-execute de
// herwerking deed. V8.9 lost dit op: AIPromptBar callt deze function direct,
// die roept Grok aan met de mail-thread als context, schrijft de nieuwe
// draft terug naar autodraft_mails, en returnt het resultaat zodat de
// frontend de tekst meteen kan tonen.
//
// Endpoint: POST /functions/v1/autodraft-rewrite-sync
// Auth: Bearer = cron_secret OF service_role_key (zoals andere edge functions)
//
// Body:
//   {
//     "mail_id":        "...",       // verplicht — referentie naar autodraft_mails
//     "prompt":         "...",       // verplicht — Jelle's instructie ("maak formeler")
//     "current_body":   "...",       // optioneel — huidige draft (HTML) als context
//     "current_subject":"..."        // optioneel — huidige onderwerp
//   }
//
// Response (200):
//   {
//     ok: true,
//     draft_subject: "...",
//     draft_body: "...",
//     model: "grok-4-...",
//     duration_ms: 4321,
//     usage: { prompt_tokens, completion_tokens }
//   }
//
// Response (4xx/5xx): { ok: false, error: "...", reason?: "..." }

import { createClient, type SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2.45.4";

// V2 (2026-05-14): switch naar grok-3-mini-fast (4-8s ipv 30-60s) + chat/completions
// endpoint dat sneller responsen geeft dan responses API.
const FN_VERSION = "autodraft-rewrite-sync-v2";
const GROK_ENDPOINT = "https://api.x.ai/v1/chat/completions";
const DEFAULT_MODEL = "grok-3-mini-fast";
const TIMEOUT_MS = 45_000;

async function getCfg(supabase: SupabaseClient, agentName: string, key: string): Promise<string | null> {
  const { data: vaultValue } = await supabase.rpc("get_skill_secret_service", {
    p_skill_name: agentName,
    p_secret_name: key,
  });
  if (typeof vaultValue === "string" && vaultValue.length > 0) return vaultValue;
  const { data } = await supabase.from("agent_config").select("config_value")
    .eq("agent_name", agentName).eq("config_key", key).maybeSingle();
  if (!data?.config_value) return null;
  return typeof data.config_value === "string" ? data.config_value : String(data.config_value);
}

interface RewriteRequest {
  mail_id: string;
  prompt: string;
  current_body?: string;
  current_subject?: string;
}

function buildSystemPrompt(): string {
  return [
    "Je herschrijft een e-mail-draft voor Jelle Burggraaf (oprichter Legal Mind B.V.).",
    "Volg de gebruiker zijn instructie zo strikt mogelijk; verzin geen feiten.",
    "Behoud de oorspronkelijke kernboodschap tenzij de instructie expliciet vraagt om iets nieuws.",
    "Schrijf in het Nederlands tenzij de mail-thread duidelijk Engels is.",
    "Output STRICT JSON met velden: subject (string) en body_html (string, geldige HTML met <p>/<br> tags, geen <html>/<body>-wrapper).",
    "Geen extra uitleg buiten de JSON.",
  ].join(" ");
}

function buildUserPrompt(req: RewriteRequest, threadContext: string, mailMeta: Record<string, unknown>): string {
  const current = req.current_body
    ? `Huidige draft (HTML):\n${req.current_body}\n\nHuidige subject: ${req.current_subject || "(geen)"}\n`
    : "Er is nog geen draft — schrijf 'em from scratch op basis van de mail-thread + instructie.\n";
  const meta = mailMeta && Object.keys(mailMeta).length > 0
    ? `\nMail-meta:\n${JSON.stringify(mailMeta, null, 2)}\n`
    : "";
  const thread = threadContext ? `\nMail-thread context:\n${threadContext}\n` : "";
  return [
    "Instructie van Jelle:",
    req.prompt.trim(),
    "",
    current,
    meta,
    thread,
    "",
    "Geef het herschreven draft als JSON: { \"subject\": \"...\", \"body_html\": \"<p>...</p>\" }.",
  ].join("\n");
}

async function buildThreadContext(supabase: SupabaseClient, mailId: string): Promise<{ thread: string; meta: Record<string, unknown> }> {
  // Haal de huidige mail op + ALLE messages met dezelfde conversation_id.
  // Voor de prompt: korte snippets van laatste 5 messages (newest first).
  const { data: current } = await supabase
    .from("mail_messages")
    .select("id, conversation_id, subject, from_name, from_email, received_at, body_preview, body_text, body_html, categories")
    .eq("id", mailId)
    .maybeSingle();
  if (!current) return { thread: "", meta: {} };
  const meta = {
    from: current.from_name ? `${current.from_name} <${current.from_email}>` : current.from_email,
    subject: current.subject,
    received_at: current.received_at,
    categories: current.categories,
  };
  if (!current.conversation_id) return { thread: "", meta };
  const { data: thread } = await supabase
    .from("mail_messages")
    .select("from_name, from_email, received_at, body_preview, body_text")
    .eq("conversation_id", current.conversation_id)
    .order("received_at", { ascending: false })
    .limit(5);
  const lines: string[] = [];
  for (const m of (thread || []).reverse()) {
    const who = m.from_name || m.from_email || "(onbekend)";
    const when = m.received_at ? new Date(m.received_at as string).toISOString().slice(0, 16) : "";
    const snippet = (m.body_text || m.body_preview || "").toString().slice(0, 600);
    if (snippet) lines.push(`[${when}] ${who}:\n${snippet}\n`);
  }
  return { thread: lines.join("\n---\n"), meta };
}

interface GrokOutput { subject?: string; body_html?: string }

function parseGrokJson(text: string): GrokOutput {
  // Grok soms wrapt JSON in markdown-code-fence. Strip die.
  let s = text.trim();
  const fence = s.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (fence) s = fence[1].trim();
  // Eerste { tot laatste } extracten als parse faalt
  try { return JSON.parse(s); } catch { /* fallthrough */ }
  const first = s.indexOf("{");
  const last = s.lastIndexOf("}");
  if (first >= 0 && last > first) {
    try { return JSON.parse(s.slice(first, last + 1)); } catch { /* skip */ }
  }
  return { subject: undefined, body_html: s };
}

async function callGrok(apiKey: string, system: string, user: string, model: string): Promise<{ raw: string; usage: Record<string, unknown> }> {
  // V2 (2026-05-14): chat/completions API ipv responses API — chat/completions
  // is sneller en geeft een eenvoudiger response-format.
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(GROK_ENDPOINT, {
      method: "POST",
      headers: { "Content-Type": "application/json", "Authorization": `Bearer ${apiKey}` },
      body: JSON.stringify({
        model,
        messages: [
          { role: "system", content: system },
          { role: "user", content: user },
        ],
        response_format: { type: "json_object" },  // forceer JSON output
        temperature: 0.5,
        max_tokens: 1500,
      }),
      signal: controller.signal,
    });
    const text = await res.text();
    if (!res.ok) throw new Error(`grok_http_${res.status}: ${text.slice(0, 300)}`);
    const body = JSON.parse(text);
    const raw = body?.choices?.[0]?.message?.content || "";
    return { raw, usage: body.usage || {} };
  } finally {
    clearTimeout(timeout);
  }
}

Deno.serve(async (req) => {
  const startedAt = Date.now();
  const supabase = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);

  // Auth — cron_secret of service_role_key (zoals andere edge fns)
  const presented = (req.headers.get("Authorization") || "").replace(/^Bearer\s+/i, "");
  const cronSecret = (await getCfg(supabase, "global", "cron_secret")) || "";
  const svcKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";
  if (!presented || (presented !== cronSecret && presented !== svcKey)) {
    return new Response(JSON.stringify({ ok: false, error: "unauthorized" }), {
      status: 401, headers: { "Content-Type": "application/json" },
    });
  }

  let body: RewriteRequest;
  try { body = await req.json(); } catch {
    return new Response(JSON.stringify({ ok: false, error: "invalid_json" }), {
      status: 400, headers: { "Content-Type": "application/json" },
    });
  }
  if (!body.mail_id || !body.prompt || body.prompt.trim().length < 2) {
    return new Response(JSON.stringify({ ok: false, error: "missing_fields", reason: "mail_id en prompt zijn verplicht" }), {
      status: 400, headers: { "Content-Type": "application/json" },
    });
  }

  // Haal autodraft_mails ter referentie (status check + current draft fallback)
  const { data: adMail } = await supabase
    .from("autodraft_mails")
    .select("mail_id, status, draft_subject, draft_body")
    .eq("mail_id", body.mail_id)
    .maybeSingle();
  if (adMail && ["sent", "ignored", "stale"].includes(adMail.status as string)) {
    return new Response(JSON.stringify({ ok: false, error: "mail_already_handled", reason: adMail.status }), {
      status: 409, headers: { "Content-Type": "application/json" },
    });
  }

  // Bouw context
  const { thread, meta } = await buildThreadContext(supabase, body.mail_id);
  const sys = buildSystemPrompt();
  const usr = buildUserPrompt({
    ...body,
    current_body: body.current_body || (adMail?.draft_body as string) || "",
    current_subject: body.current_subject || (adMail?.draft_subject as string) || "",
  }, thread, meta);

  // Grok API key uit vault
  const grokKey = await getCfg(supabase, "legal-ai-research", "grok_api_key");
  if (!grokKey) {
    return new Response(JSON.stringify({ ok: false, error: "grok_api_key_missing" }), {
      status: 500, headers: { "Content-Type": "application/json" },
    });
  }

  // Call Grok
  let raw: string, usage: Record<string, unknown>;
  try {
    const out = await callGrok(grokKey, sys, usr, DEFAULT_MODEL);
    raw = out.raw;
    usage = out.usage;
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return new Response(JSON.stringify({ ok: false, error: "grok_call_failed", reason: msg.slice(0, 300) }), {
      status: 502, headers: { "Content-Type": "application/json" },
    });
  }

  // Parse JSON-output
  const parsed = parseGrokJson(raw);
  const newSubject = (parsed.subject || body.current_subject || adMail?.draft_subject || "").toString();
  const newBody = (parsed.body_html || "").toString();
  if (!newBody) {
    return new Response(JSON.stringify({ ok: false, error: "empty_rewrite", reason: "Grok gaf geen body_html terug", raw_preview: raw.slice(0, 400) }), {
      status: 502, headers: { "Content-Type": "application/json" },
    });
  }

  // Persist naar autodraft_mails — overwrite draft_body + draft_subject
  if (adMail) {
    const { error: updErr } = await supabase
      .from("autodraft_mails")
      .update({ draft_body: newBody, draft_subject: newSubject })
      .eq("mail_id", body.mail_id);
    if (updErr) {
      // Niet-fataal — frontend kan met de returned tekst werken; loggen voor audit
      console.warn(`[${FN_VERSION}] autodraft_mails update failed: ${updErr.message}`);
    }
  }

  // Audit: schrijf een decision-rij met action='amend' + executed_at=now()
  // Zo zien we in autodraft_decisions dat deze rewrite via sync is gedaan.
  await supabase.from("autodraft_decisions").insert({
    mail_id: body.mail_id,
    action: "amend",
    amend_instructions: body.prompt.trim(),
    final_subject: newSubject,
    final_body: newBody,
    decided_by: "user-sync",
    execution_status: "success",
    executed_at: new Date().toISOString(),
    decision_kind: "reply",
    source_draft_body: adMail?.draft_body || null,
    source_draft_subject: adMail?.draft_subject || null,
  });

  return new Response(JSON.stringify({
    ok: true,
    draft_subject: newSubject,
    draft_body: newBody,
    model: DEFAULT_MODEL,
    duration_ms: Date.now() - startedAt,
    usage,
    skill_version: FN_VERSION,
  }), { status: 200, headers: { "Content-Type": "application/json" } });
});
