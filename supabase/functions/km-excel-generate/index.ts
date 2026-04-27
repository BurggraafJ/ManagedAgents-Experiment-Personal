// km-excel-generate v1.1 - schema fix (van/naar/doel/parking_cost)
// Vervangt openpyxl-flow op Jelle's PC. Excel naar Supabase Storage `km-excels` bucket.
import { createClient, type SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2.45.4";
import ExcelJS from "https://esm.sh/exceljs@4.4.0";

const MONTH_NL = ["", "Januari", "Februari", "Maart", "April", "Mei", "Juni", "Juli", "Augustus", "September", "Oktober", "November", "December"];
const TARIEF = 0.21;

interface Trip {
  trip_date: string;
  van: string;
  naar: string;
  km: number;
  doel: string | null;
  maand: string | null;
  parking_cost: number | null;
  entity: string | null;
}

async function getCfg(supabase: SupabaseClient, agentName: string, key: string): Promise<string | null> {
  const { data } = await supabase.from("agent_config").select("config_value")
    .eq("agent_name", agentName).eq("config_key", key).maybeSingle();
  if (!data?.config_value) return null;
  return typeof data.config_value === "string" ? data.config_value : String(data.config_value);
}

function tripsByMonth(trips: Trip[]): Map<number, Trip[]> {
  const map = new Map<number, Trip[]>();
  for (const t of trips) {
    const m = t.maand ? parseInt(t.maand.split("-")[1] ?? "0", 10) : (new Date(t.trip_date).getMonth() + 1);
    if (!map.has(m)) map.set(m, []);
    map.get(m)!.push(t);
  }
  for (const [, list] of map) list.sort((a, b) => a.trip_date.localeCompare(b.trip_date));
  return map;
}

async function buildWorkbook(year: number, trips: Trip[]) {
  const wb = new ExcelJS.Workbook();
  wb.creator = "km-excel-generate Edge Function";
  wb.created = new Date();

  const monthsMap = tripsByMonth(trips);
  const monthsPresent = Array.from(monthsMap.keys()).sort((a, b) => a - b);

  const ov = wb.addWorksheet("Overzicht");
  ov.columns = [
    { header: "Maand", key: "maand", width: 14 },
    { header: "Dagen", key: "dagen", width: 8 },
    { header: "Kilometers", key: "km", width: 12 },
    { header: "Tarief", key: "tarief", width: 8 },
    { header: "KM-vergoeding", key: "vergoeding", width: 14 },
    { header: "Parkeerkosten", key: "parking", width: 14 },
    { header: "Totaal", key: "totaal", width: 12 },
  ];
  ov.getRow(1).font = { bold: true };

  for (const m of monthsPresent) {
    const list = monthsMap.get(m)!;
    const days = new Set(list.map((t) => t.trip_date)).size;
    const km = list.reduce((s, t) => s + Number(t.km), 0);
    const parking = list.reduce((s, t) => s + (Number(t.parking_cost) || 0), 0);
    const rowIdx = ov.rowCount + 1;
    ov.addRow({
      maand: MONTH_NL[m], dagen: days, km, tarief: TARIEF,
      vergoeding: { formula: `C${rowIdx}*D${rowIdx}` },
      parking, totaal: { formula: `E${rowIdx}+F${rowIdx}` },
    });
  }

  const lastDataRow = ov.rowCount;
  if (lastDataRow > 1) {
    const totalRow = ov.addRow({
      maand: "Totaal",
      dagen: { formula: `SUM(B2:B${lastDataRow})` },
      km: { formula: `SUM(C2:C${lastDataRow})` },
      tarief: TARIEF,
      vergoeding: { formula: `SUM(E2:E${lastDataRow})` },
      parking: { formula: `SUM(F2:F${lastDataRow})` },
      totaal: { formula: `SUM(G2:G${lastDataRow})` },
    });
    totalRow.font = { bold: true };
  }

  for (const m of monthsPresent) {
    const ws = wb.addWorksheet(MONTH_NL[m]);
    ws.columns = [
      { header: "Datum", key: "datum", width: 22 },
      { header: "Omschrijving", key: "omschrijving", width: 28 },
      { header: "Ritten", key: "ritten", width: 60 },
      { header: "Kilometers", key: "km", width: 12 },
      { header: "Vergoeding", key: "vergoeding", width: 12 },
      { header: "Parkeerkosten", key: "parking", width: 14 },
    ];
    ws.getRow(1).font = { bold: true };

    for (const t of monthsMap.get(m)!) {
      const dateObj = new Date(t.trip_date);
      const dayNames = ["zo", "ma", "di", "wo", "do", "vr", "za"];
      const datum = `(${dayNames[dateObj.getDay()]}) ${dateObj.getDate()} ${MONTH_NL[m].toLowerCase()} ${year}`;
      const ritten = `Heen: ${t.van} → ${t.naar}\nTerug: ${t.naar} → ${t.van}`;
      const rowIdx = ws.rowCount + 1;
      ws.addRow({
        datum, omschrijving: t.doel ?? "", ritten,
        km: t.km,
        vergoeding: { formula: `D${rowIdx}*${TARIEF}` },
        parking: Number(t.parking_cost) || 0,
      });
      ws.getRow(rowIdx).getCell("ritten").alignment = { wrapText: true, vertical: "top" };
    }

    const lastRow = ws.rowCount;
    if (lastRow > 1) {
      const total = ws.addRow({
        datum: "", omschrijving: "",
        ritten: "TOTAAL KILOMETERS",
        km: { formula: `SUM(D2:D${lastRow})` },
        vergoeding: { formula: `SUM(E2:E${lastRow})` },
        parking: { formula: `SUM(F2:F${lastRow})` },
      });
      total.font = { bold: true };
    }
  }

  return wb;
}

Deno.serve(async (req) => {
  const supabase = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
  const presented = (req.headers.get("Authorization") || "").replace(/^Bearer\s+/i, "");
  const cronSecret = (await getCfg(supabase, "global", "cron_secret")) || "";
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";
  if (!presented || (presented !== cronSecret && presented !== serviceKey)) {
    return new Response(JSON.stringify({ error: "unauthorized" }), { status: 401, headers: { "Content-Type": "application/json" } });
  }

  let body: { year?: number; month?: number };
  try { body = await req.json(); } catch { body = {}; }
  const year = body.year ?? new Date().getFullYear();
  const month = body.month;

  let q = supabase.from("km_trips").select("trip_date,van,naar,km,doel,maand,parking_cost,entity")
    .gte("trip_date", `${year}-01-01`).lt("trip_date", `${year + 1}-01-01`);
  if (month) {
    const mm = String(month).padStart(2, "0");
    q = supabase.from("km_trips").select("trip_date,van,naar,km,doel,maand,parking_cost,entity")
      .eq("maand", `${year}-${mm}`);
  }
  const { data: trips, error: tripsErr } = await q.order("trip_date");
  if (tripsErr) {
    return new Response(JSON.stringify({ error: `km_trips_select_failed: ${tripsErr.message}` }), { status: 500, headers: { "Content-Type": "application/json" } });
  }

  const wb = await buildWorkbook(year, (trips ?? []) as Trip[]);
  const arrayBuffer = await wb.xlsx.writeBuffer();
  const buf = new Uint8Array(arrayBuffer);

  const filename = month
    ? `reiskosten_${year}_${String(month).padStart(2, "0")}_${Date.now()}.xlsx`
    : `reiskosten_${year}_${Date.now()}.xlsx`;

  const { data: uploaded, error: upErr } = await supabase.storage
    .from("km-excels").upload(filename, buf, {
      contentType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      cacheControl: "3600", upsert: false,
    });
  if (upErr) {
    return new Response(JSON.stringify({ error: `storage_upload_failed: ${upErr.message}` }), { status: 500, headers: { "Content-Type": "application/json" } });
  }

  const expirySec = 60 * 60 * 24 * 7;
  const { data: signed } = await supabase.storage.from("km-excels").createSignedUrl(uploaded.path, expirySec);
  const expiresAt = new Date(Date.now() + expirySec * 1000).toISOString();

  const runId = crypto.randomUUID();
  await supabase.from("agent_runs").insert({
    agent_name: "km-excel-generate", run_type: "edge_function",
    status: "success", started_at: new Date().toISOString(), completed_at: new Date().toISOString(),
    summary: `Excel ${year}${month ? "-" + String(month).padStart(2, "0") : ""}: ${(trips ?? []).length} ritten in ${wb.worksheets.length} tabs`,
    stats: { triggered_by: req.headers.get("x-trigger-source") || "manual", year, month: month ?? null, rows_written: (trips ?? []).length, file_size: buf.byteLength, signed_url: signed?.signedUrl ?? null },
    errors: [],
  });

  return new Response(JSON.stringify({
    ok: true, path: uploaded.path, signed_url: signed?.signedUrl ?? null, expires_at: expiresAt,
    rows_written: (trips ?? []).length, file_size: buf.byteLength, run_id: runId,
  }), { status: 200, headers: { "Content-Type": "application/json" } });
});
