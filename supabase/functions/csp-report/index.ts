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

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.4";

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

  const rows = reports.map((b) => normalizeReport(b, userAgent));
  const { error } = await supabase.from("security_csp_violations").insert(rows);

  if (error) {
    // Niet een 5xx terugsturen anders gaat browser retry — stiltjes 204
    console.error("csp-report insert failed", error);
  }

  return new Response(null, { status: 204 });
});
