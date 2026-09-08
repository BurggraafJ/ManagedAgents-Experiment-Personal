// =============================================================================
// agent-artifact-build — een chat-antwoord als Excel, CSV of PDF     (v2, sp.05)
// =============================================================================
// De browser stuurt de tabel uit de antwoord-envelop hierheen en krijgt een
// signed URL terug. Niets wordt vooraf gebouwd: de meeste antwoorden worden
// gelezen, niet gedownload.
//
// verify_jwt: TRUE. Dit is een browser-endpoint, geen cron-functie, en het
// bestand moet aan een persoon hangen. Zonder JWT geen `sub`, zonder `sub` geen
// eigenaar, en dan is er geen zinnig pad om het bestand op te zetten. Zie de
// hard-rule in CLAUDE.md: de RAG-cron-functies staan op false, user-callable
// functies op true.
//
// ⚠ ELK ARTEFACT DRAAGT ZIJN VERANTWOORDING. Naast het databad staat een tabblad
// "Verantwoording" (csv: kopregels, pdf: de laatste pagina) met de vraag, de
// definitie, de peildatum, de doorzochte bronnen en het run-id. Een geëxporteerd
// getal dat niet naar zijn herkomst te herleiden is, is slechter dan geen export
// — het gaat een vergadering in en komt er als feit weer uit. (AR36.)
//
// v2 (spoor 05) voegt toe: pdf als écht bestand (pdf.ts), meerdere tabbladen,
// kolomdefinities, params.period, source_artifact_id, en build_ms/build_cost_usd
// in de rij. En het herstelt een naamgevingsdefect: v1 gaf `expires_at` terug
// met de vervaldatum van de HANDTEKENING (24 u), terwijl agent_artifacts.
// expires_at de bewaartermijn van het BESTAND is (30 dagen). Twee dingen met
// dezelfde naam en een factor 30 ertussen. v2 geeft ze allebei, uit elkaar
// gehouden: `url_expires_at` en `expires_at`.
// =============================================================================
import { createClient, type SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2.45.4";
import { toCsv, toXlsx, type ColumnDef, type Sheet } from "./tabular.ts";
import { buildPdf } from "./pdf.ts";

const BUCKET = "agent-artifacts";
const SIGNED_URL_SECONDS = 60 * 60 * 24; // 24 uur — een downloadlink, geen publicatiekanaal
const DEFAULT_RETENTION_DAYS = 30;
const MAX_ROWS = 5000; // per tabblad; de envelop levert er in de praktijk max 500
const MAX_COLS = 60;
const MAX_SHEETS = 24;

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};
const JSON_HEADERS = { "Content-Type": "application/json", ...CORS };
const TYPES = new Set(["xlsx", "csv", "pdf"]);

// De `sub` uit de JWT. Alleen `role === 'authenticated'` telt: een service-role-
// sleutel draagt geen persoon, en een bestand zonder eigenaar hoort hier niet
// gemaakt te worden. Zelfde functie als callerSub() in rag-chat.
function callerSub(req: Request): string | null {
  try {
    const token = (req.headers.get("Authorization") || "").replace(/^Bearer\s+/i, "");
    const payload = JSON.parse(atob(token.split(".")[1].replace(/-/g, "+").replace(/_/g, "/")));
    return payload.role === "authenticated" && typeof payload.sub === "string" ? payload.sub : null;
  } catch { return null; }
}

function slug(s: string): string {
  return (s || "export").toLowerCase().normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")          // combining diacritics: é -> e
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "").slice(0, 60) || "export";
}

/** Bewaartermijn uit agent_config, zodat wijzigen geen deploy kost (fork F3). */
async function retentionDays(supabase: SupabaseClient): Promise<number> {
  try {
    const { data } = await supabase.from("agent_config").select("config_value")
      .eq("agent_name", "agent-artifacts").eq("config_key", "retention_days").maybeSingle();
    const n = Number(data?.config_value);
    if (Number.isFinite(n) && n >= 1 && n <= 3650) return Math.floor(n);
  } catch { /* val terug op de default */ }
  return DEFAULT_RETENTION_DAYS;
}

/** Kolommen: wat de aanroeper meegeeft wint, anders de sleutels van rij 1. */
function columnsOf(given: unknown, rows: any[]): string[] {
  return (Array.isArray(given) && given.length > 0 ? given.map(String) : Object.keys(rows[0] ?? {})).slice(0, MAX_COLS);
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: CORS });
  if (req.method !== "POST") return new Response(JSON.stringify({ error: "method_not_allowed" }), { status: 405, headers: JSON_HEADERS });

  const ownerId = callerSub(req);
  if (!ownerId) {
    return new Response(JSON.stringify({ ok: false, error: "authenticated_user_required" }), { status: 401, headers: JSON_HEADERS });
  }

  const supabase: SupabaseClient = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);

  let body: any;
  try { body = await req.json(); } catch { return new Response(JSON.stringify({ ok: false, error: "invalid_json" }), { status: 400, headers: JSON_HEADERS }); }

  const type: string = TYPES.has(body.type) ? body.type : "xlsx";
  const title: string = String(body.title || "Chat-export").slice(0, 120);
  const question: string = String(body.question || "").slice(0, 2000);
  const bodyMarkdown: string | null = typeof body.body_markdown === "string" && body.body_markdown.trim()
    ? body.body_markdown.slice(0, 40_000) : null;

  const columnDefs: ColumnDef[] = (Array.isArray(body.column_defs) ? body.column_defs : [])
    .filter((d: any) => d && typeof d.key === "string").slice(0, MAX_COLS);

  // ── het databad ────────────────────────────────────────────────────────────
  // `sheets` aanwezig → de tabbladen komen daaruit (xlsx). `rows`/`columns` is
  // het enkelvoudige geval en de bron voor csv en pdf. Nooit allebei tegelijk
  // als databron (fork F9); wél leest csv/pdf het eerste tabblad als er géén
  // enkelvoudige tabel is meegegeven — anders werkt de xlsx-knop en de
  // csv-knop niet, met exact hetzelfde verzoek.
  const rawRows: any[] = Array.isArray(body.rows) ? body.rows : [];
  const rawSheets: any[] = Array.isArray(body.sheets) ? body.sheets : [];
  let truncated = rawRows.length > MAX_ROWS;
  const sheets: Sheet[] = rawSheets
    .filter((s) => s && Array.isArray(s.rows))
    .slice(0, MAX_SHEETS)
    .map((s: any, i: number) => {
      if (s.rows.length > MAX_ROWS) truncated = true;
      const rows = s.rows.slice(0, MAX_ROWS);
      return { name: String(s.name || `Blad ${i + 1}`), columns: columnsOf(s.columns, rows), rows };
    })
    .filter((s) => s.columns.length > 0);

  let rows = rawRows.slice(0, MAX_ROWS);
  let columns = columnsOf(body.columns, rows);
  if (rows.length === 0 && sheets.length > 0) { rows = sheets[0].rows; columns = sheets[0].columns; }

  // Een pdf mág zonder tabel: AR08 vraagt om een rapport ("zet dat rapport in
  // een PDF met onze naam erboven"), en dat is tekst, geen rijen. Voor xlsx en
  // csv blijft een lege tabel een fout — een leeg werkblad is geen antwoord.
  const hasTable = rows.length > 0 && columns.length > 0;
  if (!hasTable && !(type === "pdf" && bodyMarkdown)) {
    return new Response(JSON.stringify({ ok: false, error: rows.length === 0 ? "no_rows" : "no_columns" }), { status: 400, headers: JSON_HEADERS });
  }

  const params = (body.params && typeof body.params === "object") ? body.params : {};
  const period = (params.period && typeof params.period === "object") ? params.period : null;
  const queryLogId: string | null = typeof body.query_log_id === "string" ? body.query_log_id : null;
  const sourceArtifactId: string | null = typeof body.source_artifact_id === "string" ? body.source_artifact_id : null;
  const nowIso = new Date().toISOString();
  const retention = await retentionDays(supabase);

  const rowCount = sheets.length > 0 && type === "xlsx"
    ? sheets.reduce((a, s) => a + s.rows.length, 0)
    : rows.length;

  const provenance: Array<[string, string]> = [
    ["Vraag", question || "(niet meegegeven)"],
    ["Definitie", String(params.definition ?? "(geen definitie meegegeven — dit is geen deterministische metric)")],
    ["Claim", String(params.claim ?? "—")],
    ["Route", String(params.route ?? "—")],
    ["Doorzochte bronnen", Array.isArray(params.searched) ? params.searched.join(", ") : "—"],
    ["Niet doorzocht", Array.isArray(params.not_searched) && params.not_searched.length ? params.not_searched.join(", ") : "—"],
    ["Periode", period ? `${period.label ?? ""} ${period.from ?? "?"} t/m ${period.to ?? "?"}`.trim() : "—"],
    ["Peildatum", nowIso],
    ["Rijen in dit bestand", `${rowCount}${truncated ? ` (afgekapt op ${MAX_ROWS} per tabblad)` : ""}`],
    ["Tabbladen", sheets.length > 0 && type === "xlsx" ? sheets.map((s) => s.name).join(", ") : "—"],
    ["Bewaartermijn", `link ${SIGNED_URL_SECONDS / 3600} uur geldig · bestand ${retention} dagen bewaard`],
    ["Herhaling van", sourceArtifactId ?? "—"],
    ["Run-id (query-log)", queryLogId ?? "—"],
    ["Gegenereerd door", "Legal Mind dashboard — agent-artifact-build v2.0"],
  ];

  let bytes: Uint8Array;
  let pdfInfo: { pages: number; sanitized: number } | null = null;
  const t0 = performance.now();
  try {
    if (type === "csv") {
      const defLines = columnDefs.map((d) => `Kolom ${d.label || d.key}: ${d.definition || "(geen definitie)"}`);
      bytes = toCsv(columns, rows, [...provenance.map(([k, v]) => `${k}: ${v}`), ...defLines]);
    } else if (type === "pdf") {
      const r = await buildPdf({
        title, question, body_markdown: bodyMarkdown,
        columns: hasTable ? columns : [], rows: hasTable ? rows : [],
        column_defs: columnDefs, provenance,
      });
      bytes = r.bytes;
      pdfInfo = { pages: r.pages, sanitized: r.sanitized };
    } else {
      const dataSheets: Sheet[] = sheets.length > 0 ? sheets : [{ name: title.slice(0, 28) || "Data", columns, rows }];
      bytes = await toXlsx({ title, sheets: dataSheets, columnDefs, provenance });
    }
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error("[agent-artifact-build] build failed", type, msg);
    return new Response(JSON.stringify({ ok: false, error: `build_failed: ${msg.slice(0, 200)}` }), { status: 500, headers: JSON_HEADERS });
  }
  // performance.now() met een ondergrens van 1: een csv van drie rijen is klaar
  // binnen een milliseconde, en `0` zou in de kolom "niet gemeten" betekenen in
  // plaats van "heel snel".
  const buildMs = Math.max(1, Math.ceil(performance.now() - t0));

  // Pad = <owner_id>/<datum>-<slug>-<random>.<ext>. De eerste map is waar de
  // storage-policy op filtert; hem anders opbouwen zet de ACL buitenspel.
  const path = `${ownerId}/${nowIso.slice(0, 10)}-${slug(title)}-${crypto.randomUUID().slice(0, 8)}.${type}`;
  const contentType = type === "csv"
    ? "text/csv"
    : type === "pdf"
      ? "application/pdf"
      : "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";

  const { error: upErr } = await supabase.storage.from(BUCKET).upload(path, bytes, { contentType, upsert: false });
  if (upErr) {
    console.error("[agent-artifact-build] upload failed", upErr.message);
    return new Response(JSON.stringify({ ok: false, error: `storage_upload_failed: ${upErr.message}` }), { status: 500, headers: JSON_HEADERS });
  }

  const { data: signed, error: signErr } = await supabase.storage.from(BUCKET).createSignedUrl(path, SIGNED_URL_SECONDS);
  if (signErr || !signed?.signedUrl) {
    return new Response(JSON.stringify({ ok: false, error: `sign_failed: ${signErr?.message ?? "geen url"}` }), { status: 500, headers: JSON_HEADERS });
  }

  const urlExpiresAt = new Date(Date.now() + SIGNED_URL_SECONDS * 1000).toISOString();
  const expiresAt = new Date(Date.now() + retention * 86_400_000).toISOString();
  const { data: row, error: insErr } = await supabase.from("agent_artifacts").insert({
    owner_id: ownerId, query_log_id: queryLogId, type, title, question,
    storage_path: path,
    rows: sheets.length > 0 && type === "xlsx" ? [] : rows,
    columns, params, sheets: sheets.map((s) => ({ name: s.name, columns: s.columns, n: s.rows.length })),
    column_defs: columnDefs, source_artifact_id: sourceArtifactId,
    bytes: bytes.byteLength, build_ms: buildMs,
    // Structureel 0,00: pdf-lib en ExcelJS draaien in deze runtime en er gaat
    // geen call naar een leverancier. Expliciet meegeschreven, want een 0,00 die
    // een meting is zegt iets anders dan een 0,00 die een kolomdefault is.
    build_cost_usd: 0,
    expires_at: expiresAt,
  }).select("id").single();
  if (insErr) {
    // Het bestand staat er al; de rij is de administratie. Melden, niet falen —
    // de gebruiker heeft zijn download en de opruimer heeft de wezensweep.
    console.error("[agent-artifact-build] row insert failed", insErr.message, path);
  }

  return new Response(JSON.stringify({
    ok: true, id: row?.id ?? null, type, title,
    url: signed.signedUrl,
    url_expires_at: urlExpiresAt,   // de handtekening: 24 uur
    expires_at: expiresAt,          // het bestand: de bewaartermijn
    retention_days: retention,
    filename: path.split("/").pop(),
    rows: rowCount, columns: columns.length, bytes: bytes.byteLength,
    sheets: sheets.length > 0 && type === "xlsx" ? sheets.map((s) => s.name) : [],
    build_ms: buildMs, build_cost_usd: 0,
    pages: pdfInfo?.pages ?? null, sanitized: pdfInfo?.sanitized ?? null,
    truncated,
  }), { status: 200, headers: JSON_HEADERS });
});
