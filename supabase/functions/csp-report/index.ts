// csp-report v1 — endpoint waar de browser CSP-violations heen stuurt.
//
// Frontend Security F.3.3. Geactiveerd via vercel.json header
//   Content-Security-Policy: ... ; report-uri /functions/v1/csp-report
//
// Body-formats die we accepteren:
//   - CSP-Level-1 (legacy):  { "csp-report": { ... } }       Content-Type: application/csp-report
//   - Reporting-API (level 3): [ { "type": "csp-violation", "body": { ... } }, ... ]
//
// Public endpoint — geen JWT (browser stuurt rapporten zonder credential).
// Insert via service_role; security_csp_violations heeft RLS dus eigen role bypasst.
//
// v2 (2026-09-02 · security review F-18): rate-limiting toegevoegd. Bewust
// publiek blijven — dat is correct ontwerp voor een report-endpoint — maar
// zonder cap was security_csp_violations van buitenaf vol te schrijven.
// Twee lagen, beide goedkoop:
//   1. per-IP token bucket in het instance-geheugen (burst-bescherming);
//   2. een globale uur-cap, geteld in de DB en 60s gecachet, zodat een
//      gedistribueerde stroom ook stopt.
// Boven de cap: stil 204 (geen insert). De browser mag nooit een 5xx zien,
// anders gaat hij retryen.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.4";

// ── Rate-limiting ─────────────────────────────────────────────────────────
const PER_IP_PER_MINUTE = 12;
const MAX_ROWS_PER_HOUR = 500;
const MAX_REPORTS_PER_REQUEST = 10;

const ipBuckets = new Map<string, { count: number; windowStart: number }>();
let hourlyCount = { value: 0, checkedAt: 0 };

function clientIp(req: Request): string {
  const fwd = req.headers.get("x-forwarded-for") || "";
  return (fwd.split(",")[0] || req.headers.get("cf-connecting-ip") || "unknown").trim();
}

function ipAllowed(ip: string): boolean {
  const now = Date.now();
  const b = ipBuckets.get(ip);
  if (!b || now - b.windowStart > 60_000) {
    ipBuckets.set(ip, { count: 1, windowStart: now });
    if (ipBuckets.size > 5_000) ipBuckets.clear(); // geheugen-plafond
    return true;
  }
  b.count += 1;
  return b.count <= PER_IP_PER_MINUTE;
}

async function hourlyCapReached(supabase: any): Promise<boolean> {
  const now = Date.now();
  if (now - hourlyCount.checkedAt > 60_000) {
    const since = new Date(now - 3_600_000).toISOString();
    const { count } = await supabase
      .from("security_csp_violations")
      .select("id", { count: "exact", head: true })
      .gte("reported_at", since);
    hourlyCount = { value: count ?? 0, checkedAt: now };
  }
  return hourlyCount.value >= MAX_ROWS_PER_HOUR;
}

interface CspReportBody {
  "document-uri"?: string;
  documentURL?: string;
  "blocked-uri"?: string;
  blockedURL?: string;
  "violated-directive"?: string;
  effectiveDirective?: string;
  "effective-directive"?: string;
  "source-file"?: string;
  sourceFile?: string;
  "line-number"?: number;
  lineNumber?: number;
  "column-number"?: number;
  columnNumber?: number;
  referrer?: string;
}

function pickFirst<T>(...vals: (T | undefined | null)[]): T | null {
  for (const v of vals) if (v !== undefined && v !== null) return v;
  return null;
}

function normalizeReport(body: CspReportBody, userAgent: string | null) {
  return {
    document_uri: pickFirst(body["document-uri"], body.documentURL),
    blocked_uri: pickFirst(body["blocked-uri"], body.blockedURL),
    violated_directive: pickFirst(body["violated-directive"], body.effectiveDirective, body["effective-directive"]),
    effective_directive: pickFirst(body.effectiveDirective, body["effective-directive"], body["violated-directive"]),
    source_file: pickFirst(body["source-file"], body.sourceFile),
    line_number: pickFirst(body["line-number"], body.lineNumber),
    column_number: pickFirst(body["column-number"], body.columnNumber),
    referrer: body.referrer ?? null,
    user_agent: userAgent,
    raw: body as unknown as Record<string, unknown>,
  };
}

Deno.serve(async (req) => {
  // CORS preflight — browsers sturen die soms vóór CSP-reports
  if (req.method === "OPTIONS") {
    return new Response(null, {
      status: 204,
      headers: {
        "Access-Control-Allow-Origin": "*",
        "Access-Control-Allow-Methods": "POST, OPTIONS",
        "Access-Control-Allow-Headers": "Content-Type",
        "Access-Control-Max-Age": "86400",
      },
    });
  }

  if (req.method !== "POST") {
    return new Response("Method not allowed", { status: 405 });
  }

  // F-18 laag 1: burst per IP.
  if (!ipAllowed(clientIp(req))) {
    return new Response(null, { status: 204 });
  }

  const userAgent = req.headers.get("User-Agent");
  let raw: unknown;
  try {
    raw = await req.json();
  } catch {
    return new Response(null, { status: 204 }); // browser verwacht geen body
  }

  // Beide formats normaliseren naar lijst van CspReportBody
  const reports: CspReportBody[] = [];
  if (Array.isArray(raw)) {
    // Reporting-API level 3
    for (const entry of raw) {
      if (entry && typeof entry === "object") {
        const e = entry as { type?: string; body?: CspReportBody };
        if (e.type === "csp-violation" && e.body) reports.push(e.body);
      }
    }
  } else if (raw && typeof raw === "object") {
    const r = raw as { "csp-report"?: CspReportBody };
    if (r["csp-report"]) reports.push(r["csp-report"]);
  }

  if (reports.length === 0) {
    return new Response(null, { status: 204 });
  }

  const url = Deno.env.get("SUPABASE_URL")!;
  const key = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const supabase = createClient(url, key, { auth: { persistSession: false } });

  // F-18 laag 2: globale uur-cap (gecachet, dus max 1 count-query per minuut).
  if (await hourlyCapReached(supabase)) {
    return new Response(null, { status: 204 });
  }

  const rows = reports
    .slice(0, MAX_REPORTS_PER_REQUEST)
    .map((b) => normalizeReport(b, userAgent));
  const { error } = await supabase.from("security_csp_violations").insert(rows);
  if (!error) hourlyCount.value += rows.length;

  if (error) {
    // Niet een 5xx terugsturen anders gaat browser retry — stiltjes 204
    console.error("csp-report insert failed", error);
  }

  return new Response(null, { status: 204 });
});
