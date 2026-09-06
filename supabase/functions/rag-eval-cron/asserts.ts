// =============================================================================
// rag-eval-cron/asserts.ts — laag 1: deterministische asserts (RESEARCH.md §3.4)
// =============================================================================
// Eén scoringsimplementatie voor beide lanes. Elke check schrijft `naam(gemeten)`
// in assert_detail; rag_eval_compare grept op `no_empty(`, `build_ms(`, `latency(`.
//
// Drie regels die hier hard zijn:
//   • Een onbekende of nog niet meetbare key is `pending`: telt niet als pass en
//     niet als fail, en een item met alleen pending-keys krijgt signal_hit = null.
//   • Een chat-item met persona ≠ cron waarvan rag-chat de aanroeper níét
//     herkende (debug_pipeline.caller_identified !== true) is rood: ran_as_cron.
//     Ongeacht de andere asserts. Onbetrouwbaar-groen is erger dan rood.
//   • Wat niet te parsen is (expect_order op een kolom die geen datum/getal is)
//     is een FAIL met detail, geen stille pass.
// =============================================================================
import type { Q } from "./judge.ts";

export type AssertOutcome = { hit: boolean | null; detail: string; pending: string[] };
export type ChatCall = { ok: boolean; status: number; body: any; latencyMs: number };
export type ArtifactBuild = { attempted: boolean; ok: boolean; url_status: number | null; error: string | null; type: string | null };

// Keys die de runner kent — alles daarbuiten is pending (en een laadfout in de loader).
const CHAT_KEYS = new Set(["expect_route", "required_entities", "forbidden_entities", "answer_must_match_regex", "answer_must_not_match_regex",
  "expect_min_rows", "expect_max_rows", "expect_scan_claim", "expect_tools_include", "expect_tools_exclude", "expect_metric", "expect_no_empty",
  "expect_coverage_reason", "expect_sources_include", "expect_sources_include_space", "expect_sources_exclude_space", "expect_artifact_type",
  "answer_must_cite_min", "expect_clarifying_question", "expect_order", "max_latency_ms", "max_cost_usd"]);
const PENDING_KEYS = new Set(["expect_effort_at_least"]);
const RETRIEVAL_KEYS = new Set(["must_match_regex", "must_include_source", "must_exclude_source", "top1_max_age_days", "expect_strategy_prefix",
  "expect_reranked", "expect_meta_null", "max_build_ms", "expect_no_context",
  // v3.2 (06f-α): gefilterde recall, flooding en toekomstdatums zijn meetbaar per item.
  // expect_sources_live wordt in index.ts gecontroleerd (heeft de DB nodig).
  "expect_min_chunks", "max_chunks_per_record", "top1_not_future", "expect_sources_live"]);

function finish(passes: string[], failures: string[], pending: string[]): AssertOutcome {
  const detail = failures.length ? "FAIL " + failures.join("; ") : (passes.length ? "pass: " + passes.join(",") : "");
  const withPending = pending.length ? `${detail}${detail ? " " : ""}[pending: ${pending.join(",")}]` : detail;
  if (failures.length) return { hit: false, detail: withPending, pending };
  if (passes.length) return { hit: true, detail: withPending, pending };
  return { hit: null, detail: withPending, pending };
}

// ── Chat-lane ────────────────────────────────────────────────────────────────
export type ChatFacts = {
  route: string; answer: string; rows: any[]; columns: string[]; sources: Array<{ type: string; id: string; space_key: string | null }>;
  unresolvedConfluenceIds: number; toolsUsed: Set<string>; metricTool: string | null; scannedN: unknown;
  answerEmpty: boolean; coverageReason: string | null; callerIdentified: boolean | null; costUsd: number | null;
  artifactsAvailable: string[]; latencyMs: number; hasAnalytics: boolean;
};

/** Haalt de feiten uit het non-stream-antwoord van rag-chat; spaceMap komt uit confluence_pages. */
export function chatFacts(res: ChatCall, spaceMap: Map<string, string>): ChatFacts {
  const b = res.body || {};
  const env = b.envelope || {};
  const analytics = b.analytics || null;
  const dbg = b.debug_pipeline || {};
  const rows: any[] = Array.isArray(env.rows) ? env.rows : (Array.isArray(analytics?.rows) ? analytics.rows : []);
  const columns: string[] = Array.isArray(env.columns) ? env.columns : (rows.length ? Object.keys(rows[0] ?? {}) : []);
  const rawSources: any[] = Array.isArray(env.sources) ? env.sources : [];
  let unresolved = 0;
  const sources = rawSources.slice(0, 40).map((s) => {
    const type = String(s.type ?? s.source ?? "");
    const id = String(s.id ?? "");
    let space_key: string | null = null;
    if (type === "confluence") { space_key = spaceMap.get(id) ?? null; if (!space_key) unresolved++; }
    return { type, id, space_key };
  });
  const toolsUsed = new Set<string>((analytics?.tools_used || []).map((t: any) => t?.tool).filter(Boolean));
  if (analytics?.tool) toolsUsed.add(String(analytics.tool));
  // De structured no_data-tool ís de uitspraak "dit wordt niet bijgehouden"; de
  // envelop zet coverage.reason dan op null omdat er analytics is. Runner-afleiding,
  // expliciet en gedocumenteerd (DECISIONS 2026-09-06), geen wijziging aan de keten.
  const coverageReason: string | null = env.coverage?.reason ?? dbg.coverage_reason ?? (analytics?.tool === "no_data" ? "not_tracked" : null);
  const answerEmpty: boolean = typeof b.answer_empty === "boolean" ? b.answer_empty : ((env.coverage?.chunk_count ?? 0) === 0 && rows.length === 0);
  return {
    route: String(analytics?.route || env.route || "semantic"), answer: String(b.answer || ""), rows, columns, sources,
    unresolvedConfluenceIds: unresolved, toolsUsed, metricTool: analytics?.tool ? String(analytics.tool) : null, scannedN: analytics?.scanned_n,
    answerEmpty, coverageReason, callerIdentified: typeof dbg.caller_identified === "boolean" ? dbg.caller_identified : null,
    costUsd: typeof env.cost?.usd === "number" ? env.cost.usd : null,
    artifactsAvailable: Array.isArray(env.artifacts_available) ? env.artifacts_available.map(String) : [],
    latencyMs: res.latencyMs, hasAnalytics: !!analytics,
  };
}

const NL_MONTHS = ["januari", "februari", "maart", "april", "mei", "juni", "juli", "augustus", "september", "oktober", "november", "december"];
function parseDate(v: unknown): number | null {
  if (v == null) return null;
  if (v instanceof Date) return v.getTime();
  const s = String(v).trim();
  let m = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (m) return Date.UTC(+m[1], +m[2] - 1, +m[3]);
  m = s.match(/^(\d{1,2})-(\d{1,2})-(\d{4})/);
  if (m) return Date.UTC(+m[3], +m[2] - 1, +m[1]);
  m = s.match(/^(\d{1,2})\s+([a-z]+)\s+(\d{4})/i);
  if (m) { const mi = NL_MONTHS.indexOf(m[2].toLowerCase()); if (mi >= 0) return Date.UTC(+m[3], mi, +m[1]); }
  return null;
}
function parseAmount(v: unknown): number | null {
  if (typeof v === "number") return isFinite(v) ? v : null;
  if (v == null) return null;
  const s = String(v).replace(/[€$\s]/g, "").replace(/\.(?=\d{3}(\D|$))/g, "").replace(",", ".");
  const n = Number(s);
  return s.length && isFinite(n) ? n : null;
}
function monotone(vals: number[], dir: "asc" | "desc" | "any"): boolean {
  const asc = vals.every((v, i) => i === 0 || v >= vals[i - 1]);
  const desc = vals.every((v, i) => i === 0 || v <= vals[i - 1]);
  return dir === "asc" ? asc : dir === "desc" ? desc : (asc || desc);
}

/** expect_order: kolomkeuze + monotonie (RESEARCH §3.4). stageOrder: label → displayOrder (hubspot_pipelines). */
export function checkOrder(kind: string, rows: any[], columns: string[], stageOrder: Map<string, number>): { pass: boolean; info: string } {
  if (rows.length < 2) return { pass: rows.length === 1, info: rows.length === 0 ? "no_rows" : "1_row" };
  const pick = (pred: (vals: unknown[]) => number[] | null, nameRe?: RegExp): { col: string; vals: number[] } | null => {
    const ordered = nameRe ? [...columns.filter((c) => nameRe.test(c)), ...columns.filter((c) => !nameRe.test(c))] : columns;
    for (const c of ordered) { const vals = pred(rows.map((r) => r?.[c])); if (vals) return { col: c, vals }; }
    return null;
  };
  const dates = (vals: unknown[]) => { const p = vals.map(parseDate); return p.filter((x) => x != null).length >= Math.ceil(0.8 * vals.length) ? p.map((x) => x ?? NaN).filter((x) => !isNaN(x)) : null; };
  const nums = (vals: unknown[]) => { const p = vals.map(parseAmount); return p.every((x) => x != null) ? (p as number[]) : null; };
  if (kind === "chronologisch" || kind === "omgekeerd_chronologisch") {
    const c = pick(dates, /datum|date|dag|wanneer|start|eind/i);
    if (!c) return { pass: false, info: "unparseable_column(date)" };
    return { pass: monotone(c.vals, kind === "chronologisch" ? "asc" : "desc"), info: `${c.col}` };
  }
  if (kind === "op_bedrag") {
    const c = pick(nums, /bedrag|waarde|prijs|amount|value|eur/i);
    if (!c) return { pass: false, info: "unparseable_column(amount)" };
    return { pass: monotone(c.vals, "any"), info: `${c.col}` };
  }
  if (kind === "op_fase") {
    const c = pick((vals) => { const p = vals.map((v) => stageOrder.get(String(v ?? "").trim().toLowerCase())); return p.every((x) => x != null) ? (p as number[]) : null; }, /fase|stage|status/i);
    if (!c) return { pass: false, info: "unparseable_column(stage)" };
    return { pass: monotone(c.vals, "any"), info: `${c.col}` };
  }
  if (kind === "alfabetisch") {
    const col = columns.find((c) => rows.every((r) => typeof r?.[c] === "string"));
    if (!col) return { pass: false, info: "unparseable_column(text)" };
    const vals = rows.map((r) => String(r[col]));
    const asc = vals.every((v, i) => i === 0 || v.localeCompare(vals[i - 1], "nl") >= 0);
    const desc = vals.every((v, i) => i === 0 || v.localeCompare(vals[i - 1], "nl") <= 0);
    return { pass: asc || desc, info: col };
  }
  return { pass: false, info: `unknown_order(${kind})` };
}

export function runChatAsserts(q: Q, res: ChatCall, f: ChatFacts, art: ArtifactBuild, stageOrder: Map<string, number>): AssertOutcome {
  const a = q.asserts || {};
  const passes: string[] = []; const failures: string[] = []; const pending: string[] = [];
  const check = (name: string, pass: boolean, info: string) => (pass ? passes.push(name) : failures.push(`${name}(${info})`));
  if (!res.ok) return { hit: false, detail: `rag-chat_failed status=${res.status} ${(JSON.stringify(res.body) || "").slice(0, 160)}`, pending: [] };

  // Identiteit — impliciet voor elk chat-item met persona ≠ cron.
  if (q.persona !== "cron" && f.callerIdentified !== true) failures.push(`identity(ran_as_cron caller_identified=${f.callerIdentified})`);

  const answerL = f.answer.toLowerCase();
  const rowsText = JSON.stringify(f.rows).toLowerCase();
  const combined = rowsText + " " + answerL;
  for (const key of Object.keys(a)) {
    const v = a[key] as any;
    if (PENDING_KEYS.has(key) || !CHAT_KEYS.has(key)) { pending.push(key); continue; }
    switch (key) {
      case "expect_route": check("route", f.route === v, `${f.route}!=${v}`); break;
      case "required_entities": { const missing = (v as string[]).filter((e) => !combined.includes(String(e).toLowerCase())); check("required", missing.length === 0, `missing=${missing.join("|")}`); break; }
      case "forbidden_entities": { const scope = f.rows.length > 0 ? rowsText : answerL; const found = (v as string[]).filter((e) => scope.includes(String(e).toLowerCase())); check("forbidden", found.length === 0, `found=${found.join("|")}`); break; }
      case "answer_must_match_regex": { let p = false; try { p = new RegExp(v, "i").test(f.answer); } catch { p = false; } check("answer_regex", p, String(v).slice(0, 60)); break; }
      case "answer_must_not_match_regex": { let h = false; try { h = new RegExp(v, "i").test(f.answer); } catch { h = false; } check("answer_not_regex", !h, String(v).slice(0, 60)); break; }
      case "expect_min_rows": check("min_rows", f.rows.length >= v, `${f.rows.length}<${v}`); break;
      case "expect_max_rows": check("max_rows", f.rows.length <= v, `${f.rows.length}>${v}`); break;
      case "expect_scan_claim": if (v === true) check("scan_claim", f.scannedN != null, "scanned_n=null"); break;
      case "expect_tools_include": { const missing = (v as string[]).filter((t) => !f.toolsUsed.has(t)); check("tools", missing.length === 0, `missing=${missing.join("|")}`); break; }
      case "expect_tools_exclude": { const found = (v as string[]).filter((t) => f.toolsUsed.has(t)); check("tools_exclude", found.length === 0, `found=${found.join("|")}`); break; }
      case "expect_metric": check("metric", f.metricTool === v || f.toolsUsed.has(v), `${f.metricTool ?? ([...f.toolsUsed].join("|") || "none")}!=${v}`); break;
      case "expect_no_empty": if (v === true) check("no_empty", f.answer.length >= 40 && f.answerEmpty !== true && (f.sources.length >= 1 || f.rows.length >= 1), `len=${f.answer.length} empty=${f.answerEmpty} sources=${f.sources.length} rows=${f.rows.length} reason=${f.coverageReason ?? "-"}`); break;
      case "expect_coverage_reason": check("coverage_reason", f.coverageReason === v, `${f.coverageReason ?? "null"}!=${v}`); break;
      case "expect_sources_include": { const types = new Set(f.sources.map((s) => s.type)); const missing = (v as string[]).filter((t) => !types.has(t)); check("sources_include", missing.length === 0, `missing=${missing.join("|")} have=${[...types].join("|") || "none"}`); break; }
      case "expect_sources_include_space": {
        const spaces = new Set(f.sources.filter((s) => s.type === "confluence" && s.space_key).map((s) => s.space_key as string));
        const missing = (v as string[]).filter((sp) => !spaces.has(sp));
        check("sources_include_space", missing.length === 0 && f.unresolvedConfluenceIds === 0, missing.length ? `missing=${missing.join("|")} have=${[...spaces].join("|") || "none"}` : `unresolvable_source_ids=${f.unresolvedConfluenceIds}`); break;
      }
      case "expect_sources_exclude_space": {
        const spaces = new Set(f.sources.filter((s) => s.type === "confluence" && s.space_key).map((s) => s.space_key as string));
        const found = (v as string[]).filter((sp) => spaces.has(sp));
        check("sources_exclude_space", found.length === 0 && f.unresolvedConfluenceIds === 0, found.length ? `found=${found.join("|")}` : `unresolvable_source_ids=${f.unresolvedConfluenceIds}`); break;
      }
      case "expect_artifact_type": {
        if (v === "pdf") { pending.push("expect_artifact_type:pdf"); break; }
        if (v === "table") { check("artifact", f.rows.length >= 1 && f.columns.length >= 1, `rows=${f.rows.length} cols=${f.columns.length}`); break; }
        const offered = f.artifactsAvailable.includes(v);
        if (!art.attempted) { check("artifact", offered, `available=${f.artifactsAvailable.join("|") || "none"} (build not attempted)`); break; }
        check("artifact", offered && art.ok && art.url_status === 200, `available=${offered} build_ok=${art.ok} head=${art.url_status ?? "-"} ${art.error ?? ""}`.trim()); break;
      }
      case "answer_must_cite_min": { const n = Math.max(f.sources.length, (f.answer.match(/\[bron #\d+\]/g) || []).length); check("cite_min", n >= v, `${n}<${v}`); break; }
      case "expect_clarifying_question": {
        if (v !== true) break;
        const sentences = f.answer.split(/(?<=[.!?])\s+/).filter(Boolean).slice(-3).join(" ");
        const qmarks = (sentences.match(/\?/g) || []).length;
        const numericClaim = /\b\d+ (klanten|deals|mails|gebruikers)\b/i.test(f.answer);
        check("clarifying", f.rows.length === 0 && qmarks >= 1 && f.answer.length <= 700 && !numericClaim, `rows=${f.rows.length} q=${qmarks} len=${f.answer.length} numeric=${numericClaim}`); break;
      }
      case "expect_order": { const o = checkOrder(String(v), f.rows, f.columns, stageOrder); check("order", o.pass, `${v}:${o.info}`); break; }
      case "max_latency_ms": check("latency", f.latencyMs <= v, `${f.latencyMs}ms>${v}`); break;
      case "max_cost_usd": check("cost", f.costUsd != null && f.costUsd <= v, f.costUsd == null ? "cost_missing" : `${f.costUsd}>${v}`); break;
    }
  }
  return finish(passes, failures, pending);
}

// ── Retrieval-lane (v2.4, ongewijzigd; onbekende keys → pending) ─────────────
export function runRetrievalAsserts(q: Q, res: { ok: boolean; status: number; body: any }): AssertOutcome {
  const a = q.asserts || {};
  const passes: string[] = []; const failures: string[] = []; const pending: string[] = [];
  if (!res.ok) return { hit: false, detail: `context-build_failed status=${res.status} ${(JSON.stringify(res.body) || "").slice(0, 160)}`, pending: [] };
  const matches: any[] = res.body.matches || [];
  const meta = res.body.retrieval_meta || {};
  const allText = matches.map((m) => String(m.preview || "")).join("\n");
  const sources = new Set(matches.map((m) => String(m.source)));
  const check = (name: string, pass: boolean, info: string) => (pass ? passes.push(name) : failures.push(`${name}(${info})`));
  for (const key of Object.keys(a)) {
    const v = a[key] as any;
    if (key === "expect_no_context") continue; // via de judge (index.ts)
    if (key === "expect_sources_live") continue; // via de DB (index.ts)
    if (!RETRIEVAL_KEYS.has(key)) { pending.push(key); continue; }
    switch (key) {
      case "must_match_regex": { let p = false; try { p = new RegExp(v, "i").test(allText); } catch { p = false; } check("regex", p, String(v).slice(0, 60)); break; }
      case "must_include_source": check("include_source", sources.has(v), String(v)); break;
      case "must_exclude_source": check("exclude_source", !sources.has(v), String(v)); break;
      case "top1_max_age_days": if (matches.length > 0) { const occ = matches[0]?.occurred_at ? Date.parse(matches[0].occurred_at) : NaN; const ageDays = isFinite(occ) ? (Date.now() - occ) / 86400000 : Infinity; check("top1_age", ageDays <= v, `${Math.round(ageDays)}d>${v}d`); } break;
      case "expect_strategy_prefix": check("strategy", String(res.body.retrieval_strategy || "").startsWith(v), String(res.body.retrieval_strategy)); break;
      case "expect_reranked": if (v === true) check("reranked", res.body.reranked === true, String(res.body.reranked)); break;
      case "expect_meta_null": { const mv = meta[v]; check("meta_null:" + v, mv === null || mv === undefined, JSON.stringify(mv)?.slice(0, 60) ?? "undef"); break; }
      case "max_build_ms": { const total = meta?.timing_ms?.total ?? null; check("build_ms", typeof total === "number" && total <= v, `${total}ms`); break; }
      // v3.2 (06f-α) — gefilterde recall: vóór 2026-09-06 gaf filter_sources=mail + 90 d
      // 1 van 40 rijen (HNSW-post-filter), met een bronfilter op meeting 0.
      case "expect_min_chunks": check("min_chunks", matches.length >= v, `${matches.length}<${v}`); break;
      // v3.2 (06f-α) — flooding: hoogstens N chunks van dezelfde (source, source_id).
      case "max_chunks_per_record": {
        const perRec = new Map<string, number>();
        for (const m of matches) { const k = `${m.source}|${m.id ?? ""}`; perRec.set(k, (perRec.get(k) ?? 0) + 1); }
        const mx = perRec.size ? Math.max(...perRec.values()) : 0;
        check("chunks_per_record", mx <= v, `${mx}>${v}`); break;
      }
      // v3.2 (06f-α) — een toekomstige occurred_at (HubSpot-taak met deadline) mag niet
      // door de recency-boost bovenaan staan; één dag speling voor tijdzones.
      case "top1_not_future": if (v === true && matches.length > 0) { const occ = matches[0]?.occurred_at ? Date.parse(matches[0].occurred_at) : NaN; check("top1_not_future", !(isFinite(occ) && occ > Date.now() + 86400000), matches[0]?.occurred_at ?? "no_date"); } break;
    }
  }
  return finish(passes, failures, pending);
}
