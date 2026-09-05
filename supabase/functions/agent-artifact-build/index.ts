// =============================================================================
// agent-artifact-build — een chat-antwoord als Excel of CSV          (WP4, v1.0)
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
// ⚠ ELK ARTEFACT DRAAGT ZIJN VERANTWOORDING. Naast het databladet staat een
// tabblad "Verantwoording" (csv: een kopregel) met de vraag, de definitie, de
// peildatum, de doorzochte bronnen en het run-id. Een geëxporteerd getal dat
// niet naar zijn herkomst te herleiden is, is slechter dan geen export — het
// gaat een vergadering in en komt er als feit weer uit. (AR36 in de vragenbank.)
//
// Patroon overgenomen van het verwijderde km-excel-generate
// (`git show bc1b349^:supabase/functions/km-excel-generate/index.ts`):
// ExcelJS via esm.sh → Uint8Array → storage.upload → createSignedUrl.
// =============================================================================
import { createClient, type SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2.45.4";
import ExcelJS from "https://esm.sh/exceljs@4.4.0";

const BUCKET = "agent-artifacts";
const SIGNED_URL_SECONDS = 60 * 60 * 24; // 24 uur — een downloadlink, geen publicatiekanaal
const MAX_ROWS = 5000;
const MAX_COLS = 60;
const MAX_CELL_CHARS = 32_000; // Excel-limiet is 32.767

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};
const JSON_HEADERS = { "Content-Type": "application/json", ...CORS };

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

function cell(v: unknown): string | number | boolean | null {
  if (v == null) return null;
  if (typeof v === "number" || typeof v === "boolean") return v;
  if (typeof v === "string") return v.slice(0, MAX_CELL_CHARS);
  // Objecten en arrays plat als JSON — beter een leesbare string dan "[object Object]".
  try { return JSON.stringify(v).slice(0, MAX_CELL_CHARS); } catch { return String(v).slice(0, MAX_CELL_CHARS); }
}

// UTF-8 MET BOM. Zonder de BOM maakt Excel-NL van "café" → "cafÃ©"; dat is geen
// randgeval maar het normale gedrag van Excel bij een CSV zonder byte-order mark.
function toCsv(columns: string[], rows: any[], provenance: string[]): Uint8Array {
  const esc = (v: unknown) => {
    const s = v == null ? "" : String(v);
    return /[",;\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const lines: string[] = [];
  for (const p of provenance) lines.push(`# ${p.replace(/[\r\n]+/g, " ")}`);
  if (provenance.length) lines.push("");
  lines.push(columns.map(esc).join(";"));
  for (const r of rows) lines.push(columns.map((c) => esc(cell(r?.[c]))).join(";"));
  const body = lines.join("\r\n");
  const bytes = new TextEncoder().encode(body);
  const out = new Uint8Array(bytes.length + 3);
  out.set([0xef, 0xbb, 0xbf], 0);
  out.set(bytes, 3);
  return out;
}

async function toXlsx(title: string, columns: string[], rows: any[], provenance: Array<[string, string]>): Promise<Uint8Array> {
  const wb = new ExcelJS.Workbook();
  wb.creator = "Legal Mind — Maestro chat";
  wb.created = new Date();

  const ws = wb.addWorksheet(title.slice(0, 28) || "Data");
  ws.columns = columns.map((c) => ({
    header: c, key: c,
    width: Math.min(48, Math.max(12, c.length + 4)),
  }));
  ws.getRow(1).font = { bold: true };
  ws.views = [{ state: "frozen", ySplit: 1 }];
  for (const r of rows) {
    const obj: Record<string, unknown> = {};
    for (const c of columns) obj[c] = cell(r?.[c]);
    ws.addRow(obj);
  }
  if (rows.length > 0) ws.autoFilter = { from: { row: 1, column: 1 }, to: { row: 1, column: columns.length } };

  // Het tabblad dat het verschil maakt tussen een export en een bewering.
  const pv = wb.addWorksheet("Verantwoording");
  pv.columns = [{ header: "Veld", key: "k", width: 26 }, { header: "Waarde", key: "v", width: 110 }];
  pv.getRow(1).font = { bold: true };
  for (const [k, v] of provenance) pv.addRow({ k, v: String(v ?? "").slice(0, MAX_CELL_CHARS) });
  pv.getColumn("v").alignment = { wrapText: true, vertical: "top" };

  const ab = await wb.xlsx.writeBuffer();
  return new Uint8Array(ab as ArrayBuffer);
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

  const type: string = body.type === "csv" ? "csv" : "xlsx";
  const title: string = String(body.title || "Chat-export").slice(0, 120);
  const question: string = String(body.question || "").slice(0, 2000);
  const rawRows: any[] = Array.isArray(body.rows) ? body.rows : [];
  if (rawRows.length === 0) {
    return new Response(JSON.stringify({ ok: false, error: "no_rows" }), { status: 400, headers: JSON_HEADERS });
  }
  const rows = rawRows.slice(0, MAX_ROWS);
  const truncated = rawRows.length > MAX_ROWS;

  // Kolomvolgorde: wat de aanroeper meegeeft wint, anders de sleutels van de
  // eerste rij. Nooit de unie van alle rijen — dan verspringt de volgorde per
  // export en is een diff met de vorige maand onleesbaar.
  const columns: string[] = (Array.isArray(body.columns) && body.columns.length > 0
    ? body.columns.map(String)
    : Object.keys(rows[0] ?? {})).slice(0, MAX_COLS);
  if (columns.length === 0) {
    return new Response(JSON.stringify({ ok: false, error: "no_columns" }), { status: 400, headers: JSON_HEADERS });
  }

  const params = (body.params && typeof body.params === "object") ? body.params : {};
  const queryLogId: string | null = typeof body.query_log_id === "string" ? body.query_log_id : null;
  const nowIso = new Date().toISOString();
  const provenance: Array<[string, string]> = [
    ["Vraag", question || "(niet meegegeven)"],
    ["Definitie", String(params.definition ?? "(geen definitie meegegeven — dit is geen deterministische metric)")],
    ["Claim", String(params.claim ?? "—")],
    ["Route", String(params.route ?? "—")],
    ["Doorzochte bronnen", Array.isArray(params.searched) ? params.searched.join(", ") : "—"],
    ["Niet doorzocht", Array.isArray(params.not_searched) && params.not_searched.length ? params.not_searched.join(", ") : "—"],
    ["Peildatum", nowIso],
    ["Rijen in dit bestand", `${rows.length}${truncated ? ` (afgekapt op ${MAX_ROWS} van ${rawRows.length})` : ""}`],
    ["Run-id (query-log)", queryLogId ?? "—"],
    ["Gegenereerd door", "Legal Mind dashboard — agent-artifact-build v1.0"],
  ];

  let bytes: Uint8Array;
  try {
    bytes = type === "csv"
      ? toCsv(columns, rows, provenance.map(([k, v]) => `${k}: ${v}`))
      : await toXlsx(title, columns, rows, provenance);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error("[agent-artifact-build] build failed", msg);
    return new Response(JSON.stringify({ ok: false, error: `build_failed: ${msg.slice(0, 200)}` }), { status: 500, headers: JSON_HEADERS });
  }

  // Pad = <owner_id>/<datum>-<slug>-<random>.<ext>. De eerste map is waar de
  // storage-policy op filtert; hem anders opbouwen zet de ACL buitenspel.
  const ext = type === "csv" ? "csv" : "xlsx";
  const path = `${ownerId}/${nowIso.slice(0, 10)}-${slug(title)}-${crypto.randomUUID().slice(0, 8)}.${ext}`;
  const contentType = type === "csv"
    ? "text/csv"
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

  const expiresAt = new Date(Date.now() + SIGNED_URL_SECONDS * 1000).toISOString();
  const { data: row, error: insErr } = await supabase.from("agent_artifacts").insert({
    owner_id: ownerId, query_log_id: queryLogId, type, title, question,
    storage_path: path, rows, columns, params, bytes: bytes.byteLength,
  }).select("id").single();
  if (insErr) {
    // Het bestand staat er al; de rij is de administratie. Melden, niet falen —
    // de gebruiker heeft zijn download en wij hebben een logregel om op te ruimen.
    console.error("[agent-artifact-build] row insert failed", insErr.message, path);
  }

  return new Response(JSON.stringify({
    ok: true, id: row?.id ?? null, type, title,
    url: signed.signedUrl, expires_at: expiresAt,
    filename: path.split("/").pop(),
    rows: rows.length, columns: columns.length, bytes: bytes.byteLength,
    truncated,
  }), { status: 200, headers: JSON_HEADERS });
});
