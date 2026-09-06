// =============================================================================
// tabular.ts — xlsx en csv                                       (spoor 05, v2)
// =============================================================================
// Uit index.ts gehaald toen de pdf erbij kwam: index.ts is de HTTP-, auth- en
// opslaglaag, hier staat het bouwen van een tabel. Gedrag t.o.v. v1 ongewijzigd
// op twee punten na, en allebei zijn ze een vraag uit de bank:
//
//   • MEERDERE TABBLADEN (AR06: "een Excel met per tabblad een maand").
//   • KOLOMDEFINITIES (AR09 "bron per rij", AR32 "hoe zeker ben je"). Het
//     verantwoordingsblad beschreef de tábel; nu ook de kólommen.
//
// De UTF-8-BOM in de csv blijft: zonder BOM maakt Excel-NL van "café" → "cafÃ©".
// Dat is geen randgeval maar het normale gedrag van Excel zonder byte-order mark.
// =============================================================================
import ExcelJS from "https://esm.sh/exceljs@4.4.0";

export const MAX_CELL_CHARS = 32_000; // Excel-limiet is 32.767

export interface ColumnDef {
  key: string;
  label?: string;
  definition?: string;
  type?: string;
  format?: string;
  width?: number;
}

export interface Sheet {
  name: string;
  columns: string[];
  rows: any[];
}

const PROV_SHEET = "Verantwoording";

export function cell(v: unknown): string | number | boolean | null {
  if (v == null) return null;
  if (typeof v === "number" || typeof v === "boolean") return v;
  if (typeof v === "string") return v.slice(0, MAX_CELL_CHARS);
  // Objecten en arrays plat als JSON — beter een leesbare string dan "[object Object]".
  try { return JSON.stringify(v).slice(0, MAX_CELL_CHARS); } catch { return String(v).slice(0, MAX_CELL_CHARS); }
}

/**
 * Excel weigert [ ] : * ? / \ in een tabbladnaam, kapt op 31 tekens en eist dat
 * namen uniek zijn. Een botsing is geen foutmelding maar een corrupt bestand,
 * dus ontdubbelen met een achtervoegsel. `Verantwoording` is gereserveerd —
 * anders overschrijft een datablad met die naam de verantwoording zelf.
 */
export function safeSheetName(raw: string, used: Set<string>): string {
  let name = String(raw ?? "").replace(/[[\]:*?/\\]/g, " ").replace(/\s+/g, " ").trim().slice(0, 31);
  if (!name) name = "Blad";
  if (name.toLowerCase() === PROV_SHEET.toLowerCase()) name = `${name} (data)`.slice(0, 31);
  let candidate = name;
  let n = 2;
  while (used.has(candidate.toLowerCase())) {
    const suffix = ` (${n++})`;
    candidate = name.slice(0, 31 - suffix.length) + suffix;
  }
  used.add(candidate.toLowerCase());
  return candidate;
}

/** Excel-getalnotatie uit de kolomdefinitie. `format` wint altijd van `type`. */
function numFmt(def: ColumnDef | undefined): string | null {
  if (!def) return null;
  if (def.format) return def.format;
  switch (def.type) {
    case "currency": return '"€" #,##0.00';
    case "number": case "float": return "#,##0.00";
    case "int": case "integer": return "#,##0";
    case "percent": return "0.0%";
    case "date": return "dd-mm-yyyy";
    default: return null;
  }
}

export function toCsv(columns: string[], rows: any[], provenance: string[]): Uint8Array {
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

export async function toXlsx(o: {
  title: string;
  sheets: Sheet[];
  columnDefs: ColumnDef[];
  provenance: Array<[string, string]>;
}): Promise<Uint8Array> {
  const wb = new ExcelJS.Workbook();
  wb.creator = "Legal Mind — Maestro chat";
  wb.created = new Date();

  const defs = new Map(o.columnDefs.map((d) => [d.key, d]));
  const used = new Set<string>();

  for (const sheet of o.sheets) {
    const ws = wb.addWorksheet(safeSheetName(sheet.name || o.title, used));
    ws.columns = sheet.columns.map((c) => {
      const d = defs.get(c);
      return {
        header: d?.label || c,
        key: c,
        width: Math.min(60, Math.max(12, d?.width ?? (String(d?.label || c).length + 4))),
      };
    });
    ws.getRow(1).font = { bold: true };
    ws.views = [{ state: "frozen", ySplit: 1 }];
    for (const r of sheet.rows) {
      const obj: Record<string, unknown> = {};
      for (const c of sheet.columns) obj[c] = cell(r?.[c]);
      ws.addRow(obj);
    }
    // Getalnotatie pas ná het vullen: ExcelJS zet het formaat op de kolom, en
    // een kolom zonder cellen heeft niets om het op te zetten.
    for (const c of sheet.columns) {
      const fmt = numFmt(defs.get(c));
      if (fmt) ws.getColumn(c).numFmt = fmt;
    }
    if (sheet.rows.length > 0) {
      ws.autoFilter = { from: { row: 1, column: 1 }, to: { row: 1, column: sheet.columns.length } };
    }
  }

  // Het tabblad dat het verschil maakt tussen een export en een bewering.
  const pv = wb.addWorksheet(PROV_SHEET);
  pv.columns = [{ header: "Veld", key: "k", width: 26 }, { header: "Waarde", key: "v", width: 110 }];
  pv.getRow(1).font = { bold: true };
  for (const [k, v] of o.provenance) pv.addRow({ k, v: String(v ?? "").slice(0, MAX_CELL_CHARS) });

  if (o.columnDefs.length > 0) {
    pv.addRow({});
    const kop = pv.addRow({ k: "Kolommen", v: "wat de kolom betekent, en hoe hij berekend is" });
    kop.font = { bold: true };
    for (const d of o.columnDefs) {
      pv.addRow({ k: d.label || d.key, v: String(d.definition || "(geen definitie meegegeven)").slice(0, MAX_CELL_CHARS) });
    }
  }
  pv.getColumn("v").alignment = { wrapText: true, vertical: "top" };

  const ab = await wb.xlsx.writeBuffer();
  return new Uint8Array(ab as ArrayBuffer);
}
