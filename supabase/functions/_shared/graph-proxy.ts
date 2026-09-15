// graph-proxy.ts — rechtstreeks Microsoft Graph, via Composio's proxy-endpoint.
//
// ── Waarom dit bestaat ──────────────────────────────────────────────────────
// De Outlook-toolkit van Composio heeft 43 tools en drie dingen zitten er niet
// bij die Postvak wél nodig heeft (gemeten 2026-09-14, OUTLOOK-WRITE-IMPL-NOTES
// §5): **als gelezen markeren** (`UPDATE_EMAIL` kent geen `isRead`), de
// **follow-up-vlag**, en **pin-to-top** (`LIST_MESSAGES` strookt `$expand`, dus
// de extended property komt nooit aan).
//
// Die drie stonden genoteerd als "kan niet meer". Dat klopte voor de tools —
// niet voor de verbinding. Composio heeft naast `/tools/execute/<slug>` ook
//
//     POST /api/v3/tools/execute/proxy
//     { connected_account_id, endpoint, method, body? }
//
// en dat is een kale doorgeefluik naar Graph op dezelfde OAuth-token. Alles wat
// de Entra-grant toestaat kan hierlangs, ook wat geen tool heeft.
//
// ── Gemeten, niet aangenomen (2026-09-15, mailbox burggraaf@legal-mind.nl) ──
//   • `endpoint` moet met de **API-versie** beginnen: `/v1.0/me/...`. Zonder die
//     prefix antwoordt Graph met `ResourceNotFound: Invalid version: me` — de
//     proxy plakt het pad achter `https://graph.microsoft.com/`.
//   • `$expand=singleValueExtendedProperties($filter=...)` **overleeft** de
//     proxy. Controle met `String 0x0070` (PR_CONVERSATION_TOPIC, staat op elke
//     mail) gaf de waarde terug; dát is het bewijs dat expand niet gestript
//     wordt, want een leeg antwoord op de pin-property alleen bewijst niets.
//   • `PATCH /v1.0/me/messages/{id}` met `{isRead:true}` werkt.
//   • `PATCH` met `singleValueExtendedProperties` schrijft, `$expand` leest en
//     `DELETE .../singleValueExtendedProperties/{id}` wist — alle drie 2xx.
//
// ── De vorm van het antwoord ────────────────────────────────────────────────
// De proxy geeft **altijd HTTP 200** en stopt het échte antwoord in het lichaam:
// `{ data: <graph body>, status: <graph status>, headers: {...} }`. Een 404 van
// Graph is dus een 200 van Composio met `status: 404`. Wie alleen naar de
// buitenste status kijkt ziet elke fout als succes — vandaar dat `graphRequest`
// op de **binnenste** status kijkt en zelf gooit.

const COMPOSIO_API_BASE = "https://backend.composio.dev/api/v3";

export interface GraphCtx {
  apiKey: string;
  /** Composio connected_account_id van de mailbox. */
  connectionId: string;
}

export interface GraphResult {
  status: number;
  body: Record<string, unknown>;
}

/**
 * Eén Graph-call. `path` begint met de API-versie (`/v1.0/...`).
 * Gooit bij een Graph-status ≥ 400 met `graph_<status>:<code>` — de code van
 * Graph zelf, zodat een caller op `ErrorAccessDenied` kan matchen.
 */
export async function graphRequest(
  ctx: GraphCtx,
  method: "GET" | "PATCH" | "POST" | "DELETE",
  path: string,
  body?: Record<string, unknown>,
  retry = 0,
): Promise<GraphResult> {
  if (!path.startsWith("/v1.0/") && !path.startsWith("/beta/")) {
    // Anders wordt het eerste padsegment als API-versie gelezen en krijg je
    // "Invalid version: me" — een 404 die niets met de mailbox te maken heeft.
    throw new Error(`graph_path_needs_version:${path.slice(0, 40)}`);
  }
  const payload: Record<string, unknown> = {
    connected_account_id: ctx.connectionId,
    endpoint: path,
    method,
  };
  if (body) payload.body = body;

  const res = await fetch(`${COMPOSIO_API_BASE}/tools/execute/proxy`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "x-api-key": ctx.apiKey },
    body: JSON.stringify(payload),
  });
  if (res.status === 429 && retry < 2) {
    await new Promise((r) => setTimeout(r, [3000, 9000][retry]));
    return graphRequest(ctx, method, path, body, retry + 1);
  }
  const text = await res.text();
  let wrapper: { data?: unknown; status?: number; error?: unknown };
  try {
    wrapper = JSON.parse(text);
  } catch {
    throw new Error(`graph_proxy_non_json_${res.status}: ${text.slice(0, 200)}`);
  }
  if (!res.ok) throw new Error(`graph_proxy_http_${res.status}: ${text.slice(0, 200)}`);

  const inner = typeof wrapper.status === "number" ? wrapper.status : res.status;
  const data = (wrapper.data ?? {}) as Record<string, unknown>;
  if (inner >= 400) {
    const err = data.error as { code?: string; message?: string } | undefined;
    throw new Error(`graph_${inner}:${err?.code ?? "unknown"}: ${(err?.message ?? "").slice(0, 160)}`);
  }
  return { status: inner, body: data };
}

/**
 * `$expand=singleValueExtendedProperties($filter=…)`.
 *
 * Alleen de filter-**uitdrukking** wordt ge-encodeerd; `$filter=` blijft letterlijk
 * staan. Zo is het gemeten en zo werkt het — een volledig ge-encodeerde `%24filter`
 * leest Graph niet als optie maar als onderdeel van de naam.
 */
export function expandExtendedProps(propIds: readonly string[]): string {
  const filter = propIds.map((id) => `id eq '${id}'`).join(" or ");
  return `$expand=singleValueExtendedProperties($filter=${encodeURIComponent(filter)})`;
}

/**
 * De waarde van één extended property uit een Graph-bericht, of `null`.
 * Graph laat de hele `singleValueExtendedProperties`-sleutel **weg** als het
 * filter niets matcht — er komt geen lege array. Afwezig = niet gezet.
 */
export function extendedPropValue(message: Record<string, unknown>, propId: string): string | null {
  const list = message.singleValueExtendedProperties;
  if (!Array.isArray(list)) return null;
  for (const p of list as Array<Record<string, unknown>>) {
    if (String(p.id ?? "").toLowerCase() === propId.toLowerCase()) {
      const v = p.value;
      return v == null ? null : String(v);
    }
  }
  return null;
}
