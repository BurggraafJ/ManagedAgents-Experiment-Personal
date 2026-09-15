// outlook-read.ts — gelezen-status en pin-to-top, rechtstreeks op Graph.
//
// Twee dingen die de Composio-toolkit niet kan (OUTLOOK-WRITE-IMPL-NOTES §5) en
// die via `_shared/graph-proxy.ts` wél kunnen. Lees daar eerst de kop: alles
// hieronder leunt op de vaststelling dat de proxy een kale Graph-verbinding is
// en dat `$expand` hem overleeft.
//
// ── Gelezen ─────────────────────────────────────────────────────────────────
// `PATCH /v1.0/me/messages/{id}` met `{isRead}`. Eén veld, geen vervang-val
// zoals bij `UPDATE_EMAIL` (die wist ontvangers als je ze weglaat) — Graph's
// PATCH op een bericht is een echte patch.
//
// ── Pin-to-top ──────────────────────────────────────────────────────────────
// Outlook's "Aan bovenkant vastmaken" is geen Graph-veld maar een MAPI-property:
// **PidTagPinTimestamp, id 0x6204**. Er is geen `isPinned` op `message`.
//
// Welk MAPI-**type** Outlook zelf gebruikt is niet vastgesteld. Een property-tag
// is (id << 16 | type), dus `SystemTime 0x6204` en `Integer 0x6204` zijn voor
// Graph twee verschillende properties die naast elkaar kunnen bestaan — gemeten:
// allebei te schrijven, te lezen en te wissen, en het wissen van de één laat de
// ander staan. Daarom zet Maestro ze **allebei** en wist ze allebei. Dat is geen
// slordigheid maar de goedkoopste manier om niet te gokken: welke Outlook ook
// leest, hij vindt er één, en er blijft niets achter.
//
// Wat hiermee nog **niet** bewezen is: of Outlook de mail dan ook echt bovenaan
// plakt. Dat vraagt één pin in de echte client en een terugmeting — daarvoor is
// `scripts/outlook_pin_probe.cjs`. Zie RESEARCH-PIN-STATUS.md.

import { expandExtendedProps, extendedPropValue, graphRequest, type GraphCtx } from "./graph-proxy.ts";

/** De twee vormen waarin PidTagPinTimestamp kan voorkomen. Volgorde = leesvoorkeur. */
export const PIN_PROPS = ["SystemTime 0x6204", "Integer 0x6204"] as const;

const msgPath = (id: string) => `/v1.0/me/messages/${encodeURIComponent(id)}`;

/** Zet `isRead` op één bericht. Geeft terug wat Graph daarna rapporteert. */
export async function setMessageRead(ctx: GraphCtx, messageId: string, isRead: boolean): Promise<boolean> {
  const r = await graphRequest(ctx, "PATCH", msgPath(messageId), { isRead });
  const v = r.body.isRead;
  // Graph geeft het bijgewerkte bericht terug. Ontbreekt het veld, dan is de
  // 2xx het enige bewijs dat we hebben — dat is genoeg, maar we verzinnen er
  // geen bevestiging bij die we niet hebben gelezen.
  return typeof v === "boolean" ? v : isRead;
}

export interface PinState {
  pinned: boolean;
  /** ISO-tijd zoals Outlook hem bewaart, of null. */
  pinned_at: string | null;
  /** Welke property-vorm er gevonden is — leeg als er geen staat. */
  found: string[];
}

/** Leest de pin-property van één bericht. */
export async function readPinState(ctx: GraphCtx, messageId: string): Promise<PinState> {
  const url = `${msgPath(messageId)}?$select=id&${expandExtendedProps(PIN_PROPS)}`;
  const r = await graphRequest(ctx, "GET", url);
  return pinStateOf(r.body);
}

/** Dezelfde uitleg, maar op een bericht dat je al hebt opgehaald mét de expand. */
export function pinStateOf(message: Record<string, unknown>): PinState {
  const found: string[] = [];
  let stamp: string | null = null;
  for (const prop of PIN_PROPS) {
    const v = extendedPropValue(message, prop);
    if (v == null) continue;
    found.push(prop);
    if (stamp === null) stamp = normalisePinStamp(v);
  }
  return { pinned: found.length > 0, pinned_at: stamp, found };
}

/**
 * Pint of ontpint. Bij pinnen worden beide property-vormen gezet met dezelfde
 * tijd; bij ontpinnen worden ze beide gewist. Een DELETE op een property die er
 * niet staat geeft 404 en dát is hier geen fout — de uitkomst is wat telt.
 */
export async function setMessagePin(ctx: GraphCtx, messageId: string, pinned: boolean): Promise<PinState> {
  if (pinned) {
    const iso = new Date().toISOString().replace(/\.\d+Z$/, "Z");
    const unix = String(Math.floor(Date.now() / 1000));
    await graphRequest(ctx, "PATCH", msgPath(messageId), {
      singleValueExtendedProperties: [
        { id: "SystemTime 0x6204", value: iso },
        { id: "Integer 0x6204", value: unix },
      ],
    });
  } else {
    for (const prop of PIN_PROPS) {
      try {
        await graphRequest(ctx, "DELETE", `${msgPath(messageId)}/singleValueExtendedProperties/${encodeURIComponent(prop)}`);
      } catch (e) {
        const m = e instanceof Error ? e.message : String(e);
        if (!m.startsWith("graph_404")) throw e;
      }
    }
  }
  // Altijd teruglezen. De vraag is niet of de call slaagde maar of de mail nu
  // gepind is — en dat is precies wat er in de database moet komen te staan.
  return readPinState(ctx, messageId);
}

/**
 * Outlook's waarde → ISO, of null. `SystemTime` levert al ISO; `Integer` levert
 * unix-seconden als string. Een waarde die geen van beide is laten we vallen in
 * plaats van hem tot een datum te dwingen.
 */
function normalisePinStamp(raw: string): string | null {
  const s = raw.trim();
  if (/^\d{4}-\d{2}-\d{2}T/.test(s)) {
    const d = new Date(s);
    return Number.isNaN(d.getTime()) ? null : d.toISOString();
  }
  if (/^\d{9,11}$/.test(s)) {
    const d = new Date(Number(s) * 1000);
    return Number.isNaN(d.getTime()) ? null : d.toISOString();
  }
  return null;
}
