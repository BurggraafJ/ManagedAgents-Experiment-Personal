// =============================================================================
// _shared/mfa.ts — gedeelde helpers voor mfa-email-send en mfa-email-verify.
// Security review 2026-09-02 · REPORT §3.
// =============================================================================

export const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

export const JSON_HEADERS = { ...CORS, "Content-Type": "application/json" };

export function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: JSON_HEADERS });
}

/** Bearer-token van de aanroeper. De gateway (verify_jwt=true) heeft hem al gevalideerd. */
export function callerToken(req: Request): string {
  return (req.headers.get("Authorization") || "").replace(/^Bearer\s+/i, "").trim();
}

/** Claims uit een al gevalideerde JWT. Alleen voor session_id — de identiteit
 *  halen we via auth.getUser(), niet uit deze payload. */
export function jwtClaims(token: string): Record<string, unknown> {
  try {
    const part = token.split(".")[1];
    const b64 = part.replace(/-/g, "+").replace(/_/g, "/");
    const pad = b64 + "=".repeat((4 - (b64.length % 4)) % 4);
    return JSON.parse(atob(pad));
  } catch {
    return {};
  }
}

export async function sha256Hex(input: string): Promise<string> {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(input));
  return Array.from(new Uint8Array(buf))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

export function randomToken(bytes = 32): string {
  const a = new Uint8Array(bytes);
  crypto.getRandomValues(a);
  return Array.from(a).map((b) => b.toString(16).padStart(2, "0")).join("");
}

export function clientIp(req: Request): string | null {
  const fwd = req.headers.get("x-forwarded-for") || "";
  const ip = (fwd.split(",")[0] || req.headers.get("cf-connecting-ip") || "").trim();
  return ip || null;
}

export interface Caller {
  userId: string;
  email: string;
  sessionId: string | null;
  token: string;
}

/**
 * Identiteit van de aanroeper. verify_jwt=true betekent dat de gateway de
 * signature al heeft gecontroleerd; getUser() is de tweede check (revoked
 * sessies, verwijderde users) en levert het e-mailadres.
 */
export async function resolveCaller(req: Request, anonClient: any): Promise<Caller | null> {
  const token = callerToken(req);
  if (!token) return null;
  const { data, error } = await anonClient.auth.getUser(token);
  if (error || !data?.user?.id || !data.user.email) return null;
  const claims = jwtClaims(token);
  const sid = typeof claims.session_id === "string" ? claims.session_id : null;
  return { userId: data.user.id, email: data.user.email, sessionId: sid, token };
}
