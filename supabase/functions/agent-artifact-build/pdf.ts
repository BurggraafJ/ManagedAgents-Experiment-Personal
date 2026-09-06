// =============================================================================
// pdf.ts — een chat-antwoord als échte PDF                       (spoor 05, v2)
// =============================================================================
// Tot v1.146 was "PDF" in de UI `window.print()`: geen rij in agent_artifacts,
// geen bytes in de bucket, geen verantwoording die met het bestand meereist, en
// op een geïnstalleerde PWA waarschijnlijk helemaal niets. Hier wordt het een
// bestand, langs exact dezelfde weg als xlsx/csv.
//
// pdf-lib via esm.sh, hetzelfde importpatroon waarmee ExcelJS hier al draait.
// Gemeten onder Deno 2.9.6 (onderzoek M4b): 90 regels in 30 ms / 3,2 kB; op de
// harde cap van 5.000 rijen 1.411 ms / 895 kB. Kosten: $0,00 — geen leverancier,
// geen tweede uitgaande host.
//
// ⚠ DE FAALMODUS DIE ALLES OMGOOIT IS ÉÉN TEKEN. Standaardfonts kunnen alleen
// WinAnsi (CP1252). Eén Japans teken in één cel en pdf-lib gooit
// `WinAnsi cannot encode "日" (0x65e5)` — gemeten, niet bedacht — en dan valt de
// hele export om in plaats van die ene cel. Daarom saniteert deze module élke
// string vóór hij getekend wordt, en telt hij de vervangingen zodat ze in de
// verantwoording komen te staan. Een stille vervanging is een leugen; een
// getelde vervanging is een voetnoot.
// =============================================================================
import { PDFDocument, StandardFonts, rgb } from "https://esm.sh/pdf-lib@1.17.1";

export interface ColumnDef {
  key: string;
  label?: string;
  definition?: string;
  type?: string;   // text | number | currency | percent | date
  format?: string;
  width?: number;  // relatieve breedte; leeg = automatisch
}

export interface PdfInput {
  title: string;
  question: string;
  body_markdown?: string | null;
  columns: string[];
  rows: any[];
  column_defs?: ColumnDef[];
  provenance: Array<[string, string]>;
}

const A4_SHORT = 595.28;
const A4_LONG = 841.89;
const MARGIN = 36;
const INK = rgb(0.12, 0.12, 0.13);
const MUTED = rgb(0.45, 0.45, 0.47);
const RULE = rgb(0.82, 0.82, 0.84);
const ZEBRA = rgb(0.965, 0.965, 0.972);

const NUMERIC_TYPES = new Set(["number", "currency", "percent", "int", "integer", "float"]);

// ── WinAnsi ──────────────────────────────────────────────────────────────────
// Niet mijn eigen tabel met toegestane tekens, maar de encoder zelf om zijn
// oordeel vragen — dan kan een verkeerde aanname in deze file de export niet
// alsnog omgooien. Gememoïseerd per codepoint: de kosten schalen met het
// alfabet, niet met de tekstlengte.
function makeSanitizer(font: any) {
  const known = new Map<number, boolean>();
  let replaced = 0;
  const ok = (cp: number): boolean => {
    if (cp >= 0x20 && cp <= 0x7e) return true; // ASCII: altijd goed, snelste pad
    const cached = known.get(cp);
    if (cached !== undefined) return cached;
    let good = false;
    try { font.encodeText(String.fromCodePoint(cp)); good = true; } catch { good = false; }
    known.set(cp, good);
    return good;
  };
  const clean = (v: unknown): string => {
    if (v == null) return "";
    const s = typeof v === "string" ? v : (typeof v === "object" ? safeJson(v) : String(v));
    let out = "";
    for (const ch of s.replace(/[\r\n\t]+/g, " ")) {
      const cp = ch.codePointAt(0)!;
      if (ok(cp)) out += ch;
      else { out += "?"; replaced++; }
    }
    return out;
  };
  return { clean, count: () => replaced };
}

function safeJson(v: unknown): string {
  try { return JSON.stringify(v); } catch { return String(v); }
}

function isNumericish(v: unknown): boolean {
  return typeof v === "number" || (typeof v === "string" && v !== "" && !Number.isNaN(Number(v.replace(",", "."))));
}

// ── tekst ────────────────────────────────────────────────────────────────────
function wrap(text: string, font: any, size: number, maxWidth: number): string[] {
  const words = text.split(/\s+/).filter(Boolean);
  if (words.length === 0) return [""];
  const lines: string[] = [];
  let line = "";
  for (const w of words) {
    const probe = line ? `${line} ${w}` : w;
    if (font.widthOfTextAtSize(probe, size) <= maxWidth) { line = probe; continue; }
    if (line) lines.push(line);
    // Eén woord dat zelf te breed is (een url, een pad) hard breken.
    let rest = w;
    while (font.widthOfTextAtSize(rest, size) > maxWidth && rest.length > 1) {
      let cut = rest.length;
      while (cut > 1 && font.widthOfTextAtSize(rest.slice(0, cut), size) > maxWidth) cut--;
      lines.push(rest.slice(0, cut));
      rest = rest.slice(cut);
    }
    line = rest;
  }
  if (line) lines.push(line);
  return lines;
}

/** Knipt op de échte tekstbreedte, niet op een geschat aantal tekens. */
function clip(text: string, font: any, size: number, maxWidth: number): string {
  if (font.widthOfTextAtSize(text, size) <= maxWidth) return text;
  let lo = 0, hi = text.length;
  while (lo < hi) {
    const mid = Math.ceil((lo + hi) / 2);
    if (font.widthOfTextAtSize(text.slice(0, mid) + "...", size) <= maxWidth) lo = mid; else hi = mid - 1;
  }
  return text.slice(0, lo) + "...";
}

export async function buildPdf(o: PdfInput): Promise<{ bytes: Uint8Array; pages: number; sanitized: number }> {
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const bold = await doc.embedFont(StandardFonts.HelveticaBold);
  const san = makeSanitizer(font);

  const hasTable = Array.isArray(o.rows) && o.rows.length > 0 && o.columns.length > 0;
  // Landschap zodra er een tabel is; een puur tekstrapport (AR08) leest beter staand.
  const pageW = hasTable ? A4_LONG : A4_SHORT;
  const pageH = hasTable ? A4_SHORT : A4_LONG;
  const contentW = pageW - MARGIN * 2;

  const title = san.clean(o.title || "Chat-export");
  doc.setTitle(title);
  doc.setCreator("Legal Mind - Maestro chat");
  doc.setProducer("agent-artifact-build v2 (pdf-lib)");

  let page: any = null;
  let y = 0;
  let pageNo = 0;

  const newPage = () => {
    page = doc.addPage([pageW, pageH]);
    pageNo++;
    const top = pageH - MARGIN;
    page.drawText(clip(title, bold, 8, contentW - 190), { x: MARGIN, y: top, size: 8, font: bold, color: MUTED });
    const stamp = `Legal Mind - Maestro  |  pagina ${pageNo}`;
    page.drawText(stamp, { x: pageW - MARGIN - font.widthOfTextAtSize(stamp, 8), y: top, size: 8, font, color: MUTED });
    page.drawLine({ start: { x: MARGIN, y: top - 5 }, end: { x: pageW - MARGIN, y: top - 5 }, thickness: 0.5, color: RULE });
    y = top - 20;
  };

  /** Reserveert verticale ruimte; opent een pagina als het niet meer past. */
  const need = (h: number) => { if (!page || y - h < MARGIN) newPage(); };

  const text = (s: string, size: number, f: any = font, color = INK, gap = 3) => {
    for (const line of wrap(s, f, size, contentW)) {
      need(size + gap);
      if (line) page.drawText(line, { x: MARGIN, y: y - size, size, font: f, color });
      y -= size + gap;
    }
  };

  newPage();

  // ── kop ────────────────────────────────────────────────────────────────────
  text(title, 16, bold, INK, 5);
  y -= 2;
  if (o.question) { text(san.clean(o.question), 9.5, font, MUTED, 3); y -= 4; }

  // ── rapporttekst (AR07/AR08) ───────────────────────────────────────────────
  // Bewust geen markdown-engine: koppen, opsommingen en alinea's. Alles wat
  // daarbuiten valt is een alinea — een half werkende parser die stilletjes
  // tekens opeet is erger dan een simpele die alles laat staan.
  if (o.body_markdown) {
    for (const raw of String(o.body_markdown).split(/\n/)) {
      const line = raw.trim();
      if (!line) { y -= 5; continue; }
      if (/^#{2,}\s/.test(line)) { y -= 4; text(san.clean(line.replace(/^#+\s*/, "")), 11.5, bold, INK, 4); }
      else if (/^#\s/.test(line)) { y -= 6; text(san.clean(line.replace(/^#+\s*/, "")), 13, bold, INK, 4); }
      else if (/^[-*]\s+/.test(line)) {
        const body = san.clean(line.replace(/^[-*]\s+/, ""));
        const lines = wrap(body, font, 9.5, contentW - 12);
        lines.forEach((l, i) => {
          need(13);
          if (i === 0) page.drawText("-", { x: MARGIN, y: y - 9.5, size: 9.5, font, color: MUTED });
          page.drawText(l, { x: MARGIN + 12, y: y - 9.5, size: 9.5, font, color: INK });
          y -= 13;
        });
      } else text(san.clean(line.replace(/[*_`]/g, "")), 9.5, font, INK, 4);
    }
    y -= 6;
  }

  // ── tabel ──────────────────────────────────────────────────────────────────
  if (hasTable) {
    const defs = new Map((o.column_defs || []).map((d) => [d.key, d]));
    const size = 8.5;
    const rowH = 13;
    const sample = o.rows.slice(0, 60);
    const headers = o.columns.map((c) => san.clean(defs.get(c)?.label || c));

    // Natuurlijke breedte per kolom, daarna proportioneel naar de pagina.
    const natural = o.columns.map((c, i) => {
      const explicit = defs.get(c)?.width;
      if (typeof explicit === "number" && explicit > 0) return explicit;
      let w = bold.widthOfTextAtSize(headers[i], size) + 10;
      for (const r of sample) w = Math.max(w, font.widthOfTextAtSize(san.clean(r?.[c]), size) + 10);
      return Math.min(240, Math.max(42, w));
    });
    const total = natural.reduce((a, b) => a + b, 0) || 1;
    const widths = natural.map((w) => (w / total) * contentW);

    const rightAligned = o.columns.map((c, i) => {
      const t = defs.get(c)?.type;
      if (t) return NUMERIC_TYPES.has(t);
      return sample.length > 0 && sample.every((r) => r?.[c] == null || isNumericish(r[c]));
    });

    const drawHeaderRow = () => {
      need(rowH + 6);
      let x = MARGIN;
      headers.forEach((h, i) => {
        page.drawText(clip(h, bold, size, widths[i] - 8), { x: x + 4, y: y - size - 2, size, font: bold, color: INK });
        x += widths[i];
      });
      y -= rowH;
      page.drawLine({ start: { x: MARGIN, y: y + 2 }, end: { x: MARGIN + contentW, y: y + 2 }, thickness: 0.7, color: RULE });
      y -= 2;
    };

    drawHeaderRow();
    let zebra = false;
    for (const r of o.rows) {
      if (y - rowH < MARGIN) { newPage(); drawHeaderRow(); zebra = false; }
      if (zebra) page.drawRectangle({ x: MARGIN, y: y - rowH + 2, width: contentW, height: rowH, color: ZEBRA });
      zebra = !zebra;
      let x = MARGIN;
      o.columns.forEach((c, i) => {
        const v = san.clean(r?.[c]);
        const t = clip(v, font, size, widths[i] - 8);
        const tx = rightAligned[i] ? x + widths[i] - 4 - font.widthOfTextAtSize(t, size) : x + 4;
        if (t) page.drawText(t, { x: tx, y: y - size - 2, size, font, color: INK });
        x += widths[i];
      });
      y -= rowH;
    }
    y -= 8;
  }

  // ── laatste pagina: Verantwoording ─────────────────────────────────────────
  // Exact dezelfde velden als het xlsx-tabblad, plus het kolommenblok. Een
  // geëxporteerd getal dat niet naar zijn herkomst te herleiden is, is slechter
  // dan geen export — het gaat een vergadering in en komt er als feit weer uit.
  newPage();
  text("Verantwoording", 14, bold, INK, 6);
  y -= 4;
  const keyW = 140;
  const valW = contentW - keyW - 8;

  // Eerst álles saniteren, dan pas tellen, dan pas tekenen: de regel "n tekens
  // vervangen" moet ook de vervangingen in de verantwoording zelf meetellen.
  const provRows: Array<[string, string]> = o.provenance.map(([k, v]) => [san.clean(k), san.clean(v) || "-"]);
  const defRows: Array<[string, string]> = (o.column_defs || []).map((d) =>
    [san.clean(d.label || d.key), san.clean(d.definition || "(geen definitie meegegeven)")]);
  const nSan = san.count();
  if (nSan > 0) provRows.push(["Tekens vervangen", `${nSan} teken(s) buiten Latin-1 vervangen door "?" (standaardfont Helvetica)`]);

  const kvBlock = (pairs: Array<[string, string]>) => {
    for (const [k, v] of pairs) {
      const lines = wrap(v, font, 9, valW);
      need(lines.length * 12 + 4);
      page.drawText(clip(k, bold, 9, keyW - 6), { x: MARGIN, y: y - 9, size: 9, font: bold, color: INK });
      lines.forEach((l, i) => {
        if (l) page.drawText(l, { x: MARGIN + keyW, y: y - 9 - i * 12, size: 9, font, color: INK });
      });
      y -= lines.length * 12 + 3;
    }
  };

  kvBlock(provRows);
  if (defRows.length > 0) {
    y -= 10;
    text("Kolommen", 11.5, bold, INK, 5);
    y -= 2;
    kvBlock(defRows);
  }

  const bytes = await doc.save();
  return { bytes: new Uint8Array(bytes), pages: pageNo, sanitized: san.count() };
}
