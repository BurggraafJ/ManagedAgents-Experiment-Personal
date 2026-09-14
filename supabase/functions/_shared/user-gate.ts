// =============================================================================
// _shared/user-gate.ts — de poort van een BROWSER-functie (verify_jwt = true)
// =============================================================================
//
// Tegenhanger van `_shared/edge-auth.ts`, die de cron/server-to-server-kant doet.
// Deze helper beantwoordt de drie vragen die een user-callable Edge Function
// moet stellen voordat hij iets doet dat geld kost of gegevens teruggeeft:
//
//   1. WIE belt er?           → callerSub(req)
//   2. MAG die dit?           → requireCapability(req, key)
//   3. HEEFT die nog budget?  → requireBudget(sub)
//
// ── Waarom dit nodig was (GAP-3) ────────────────────────────────────────────
//
// Het onderzoek van 2026-09-14 telde 18 Edge Functions op `verify_jwt = true`.
// Twee deden een eigen rolcheck (`create-user`, `invite-user`); de andere
// zestien accepteerden elke geldige JWT — ook die van een member. De gateway
// controleert alleen de handtekening, niet wie erachter zit. Zes van die
// zestien doen een betaalde model-call.
//
// De gateway geeft ons wél iets bruikbaars: hij heeft de JWT al geverifieerd
// voordat onze code draait. `callerSub()` hoeft hem dus niet opnieuw te
// valideren, alleen te lézen. Een user_id uit de BODY lezen mag nooit — dan kan
// iedereen namens een collega werken. Zelfde regel als in `hubspot-write`.
//
// ── Geen supabase-js ────────────────────────────────────────────────────────
//
// Alles loopt over `fetch` naar PostgREST. Vier van de zeven functies die deze
// helper gebruiken (taalcheck-v2, mail-taalcheck, auto-draft-spelcheck,
// transcribe) hadden tot nu toe géén enkele import buiten de edge-runtime-types.
// Een client-library toevoegen om drie RPC's te doen maakt hun bundel groter
// dan hun eigen code. De functies die supabase-js al hebben (rag-search,
// hubspot-write, kb-compose) houden dat gewoon; deze helper staat ernaast.
//
// ── Fail closed ─────────────────────────────────────────────────────────────
//
// Geen `sub` ⇒ 403. Een RPC die niet antwoordt ⇒ weigeren, niet "dan maar door":
// `has_capability()` faalt closed en dat is alleen waar als de aanroeper hem
// ook als closed behandelt.
//
// De service-role key is de uitzondering, en een expliciete: server-to-server
// verkeer (een andere Edge Function, een cron) draagt geen gebruiker en heeft
// hier niets te zoeken in het capability-model. `isServiceCall()` laat dat pad
// door zonder capability- en zonder budgetcheck, precies zoals
// `can_manage_dashboard()` dat in de database doet.
// =============================================================================

export const CORS_JSON = {
  'Content-Type': 'application/json',
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

export function gateJson(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: CORS_JSON });
}

/** Claims uit de door de gateway al geverifieerde JWT. Alleen lezen, niet valideren. */
export function jwtClaims(req: Request): { role: string | null; sub: string | null } {
  try {
    const token = (req.headers.get('Authorization') || '').replace(/^Bearer\s+/i, '');
    const payload = JSON.parse(
      atob(token.split('.')[1].replace(/-/g, '+').replace(/_/g, '/')),
    );
    return {
      role: typeof payload.role === 'string' ? payload.role : null,
      sub: typeof payload.sub === 'string' ? payload.sub : null,
    };
  } catch {
    return { role: null, sub: null };
  }
}

/** De user-id van een ingelogde browser, of null. Een service-key heeft er geen. */
export function callerSub(req: Request): string | null {
  const { role, sub } = jwtClaims(req);
  return role === 'authenticated' && sub ? sub : null;
}

function timingSafeEqual(a: string, b: string): boolean {
  if (typeof a !== 'string' || typeof b !== 'string') return false;
  const ea = new TextEncoder().encode(a);
  const eb = new TextEncoder().encode(b);
  if (ea.length !== eb.length) return false;
  let diff = 0;
  for (let i = 0; i < ea.length; i++) diff |= ea[i] ^ eb[i];
  return diff === 0;
}

/** Server-to-server met de service-role key: geen mens, dus geen capability-vraag. */
export function isServiceCall(req: Request): boolean {
  const token = (req.headers.get('Authorization') || '').replace(/^Bearer\s+/i, '').trim();
  const key = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || '';
  return !!token && !!key && timingSafeEqual(token, key);
}

const URL_ENV = () => Deno.env.get('SUPABASE_URL') || '';
const KEY_ENV = () => Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || '';

async function rpc<T>(naam: string, args: Record<string, unknown>): Promise<{ data: T | null; error: string | null }> {
  try {
    const r = await fetch(`${URL_ENV()}/rest/v1/rpc/${naam}`, {
      method: 'POST',
      headers: {
        apikey: KEY_ENV(),
        Authorization: `Bearer ${KEY_ENV()}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(args),
      signal: AbortSignal.timeout(8_000),
    });
    if (!r.ok) return { data: null, error: `${naam}_${r.status}: ${(await r.text()).slice(0, 200)}` };
    return { data: (await r.json()) as T, error: null };
  } catch (err) {
    return { data: null, error: err instanceof Error ? err.message : String(err) };
  }
}

export interface UserGate {
  ok: boolean;
  sub: string | null;
  service: boolean;
  response?: Response;
}

/**
 * Mag deze aanroeper dit? Roept `has_capability(key, sub)` aan met de
 * service-role key: die functie heeft een eigen tak die een browsersessie nooit
 * namens een ander laat vragen, en wij geven de sub uit de JWT door — nooit
 * iets uit de body.
 */
export async function requireCapability(req: Request, key: string): Promise<UserGate> {
  if (isServiceCall(req)) return { ok: true, sub: null, service: true };

  const sub = callerSub(req);
  if (!sub) {
    return {
      ok: false, sub: null, service: false,
      response: gateJson({ ok: false, error: 'login_required' }, 403),
    };
  }

  const { data, error } = await rpc<boolean>('has_capability', { p_key: key, p_user: sub });
  if (error || data !== true) {
    return {
      ok: false, sub, service: false,
      response: gateJson({
        ok: false,
        error: 'forbidden',
        capability: key,
        // Nederlands, want dit komt in beeld bij de gebruiker.
        melding: `Je hebt het recht "${key}" niet. Vraag de owner het aan te vinken bij Organisatie › Rechten.`,
      }, 403),
    };
  }
  return { ok: true, sub, service: false };
}

export interface BudgetState {
  ok?: boolean;
  over?: boolean;
  gepauzeerd?: boolean;
  verbruik_usd?: number;
  plafond_usd?: number;
  [k: string]: unknown;
}

/**
 * Staat deze persoon nog onder zijn maandplafond? Weigert eerlijk — met het
 * bedrag en het plafond erbij, zodat de UI kan zeggen wat er aan de hand is in
 * plaats van "er ging iets mis".
 *
 * De owner wordt gemeten maar niet geremd (beslissing 5: "per member"); dat
 * onderscheid zit in `model_budget_state()`, niet hier.
 */
export async function requireBudget(sub: string | null): Promise<UserGate> {
  if (!sub) return { ok: true, sub, service: true };

  const { data, error } = await rpc<BudgetState>('model_budget_state', { p_user: sub });
  if (error) {
    // Een budgetcheck die niet antwoordt is geen vrijbrief.
    return {
      ok: false, sub, service: false,
      response: gateJson({ ok: false, error: 'budget_check_failed', detail: error }, 503),
    };
  }
  if (data?.over === true) {
    return {
      ok: false, sub, service: false,
      response: gateJson({
        ok: false,
        error: 'budget_exceeded',
        melding: data.gepauzeerd
          ? 'De owner heeft dit account op pauze gezet voor betaalde AI-functies.'
          : `Je maandplafond is bereikt ($${Number(data.verbruik_usd ?? 0).toFixed(2)} van $${Number(data.plafond_usd ?? 0).toFixed(2)}).`,
        stand: data,
      }, 402),
    };
  }
  return { ok: true, sub, service: false };
}

/** Capability én budget in één regel — de volgorde waarin elke betaalde functie ze stelt. */
export async function requirePaidUse(req: Request, key = 'modellen.gebruiken'): Promise<UserGate> {
  const cap = await requireCapability(req, key);
  if (!cap.ok) return cap;
  const budget = await requireBudget(cap.sub);
  if (!budget.ok) return budget;
  return cap;
}

// ── Het grootboek ───────────────────────────────────────────────────────────
//
// Tarieven per miljoen tokens. Er stonden al drie kopieën van zo'n tabel in
// deze repo (rag-chat/agentic.ts, mail-enricher, kb-compose). rag-chat importeert
// bewust niets uit `_shared` (geheugen `rag-chat-is-enige-multifile-edge-function`)
// en mail-enricher is een cron-functie zonder gebruiker; kb-compose gebruikt
// vanaf nu deze tabel in plaats van zijn eigen.

export const PRICE_PER_M: Record<string, { input: number; output: number }> = {
  'gpt-5.4': { input: 2.50, output: 15.00 },
  'gpt-5.4-mini': { input: 0.75, output: 4.50 },
  'gpt-5.4-nano': { input: 0.20, output: 1.25 },
  'gpt-5.2': { input: 1.75, output: 14.00 },
  'gpt-5': { input: 1.25, output: 10.00 },
  'gpt-5-mini': { input: 0.75, output: 4.50 },
  'gpt-5-nano': { input: 0.20, output: 1.25 },
  'gpt-4.1-mini': { input: 0.40, output: 1.60 },
  'gpt-4o-mini': { input: 0.15, output: 0.60 },
  'gpt-4o': { input: 2.50, output: 10.00 },
  'text-embedding-3-large': { input: 0.13, output: 0 },
};

export function estimateCostUsd(model: string, inputTokens = 0, outputTokens = 0): number {
  const p = PRICE_PER_M[model];
  if (!p) return 0;                            // onbekend model ⇒ 0, nooit een verzonnen bedrag
  return (inputTokens / 1e6) * p.input + (outputTokens / 1e6) * p.output;
}

export interface UsageEntry {
  userId: string | null;
  edgeFunction: string;
  provider: 'openai' | 'anthropic' | 'grok' | 'cohere';
  model?: string | null;
  inputTokens?: number | null;
  outputTokens?: number | null;
  costUsd?: number | null;
  ok?: boolean;
}

/**
 * Schrijft één regel in `model_usage_log`. Faalt nooit hard: een grootboek dat
 * de functie erboven kan laten omvallen wordt bij het eerste incident
 * uitgezet, en dan meet je weer niets. Een mislukte schrijfactie logt en gaat
 * door.
 *
 * Geen prompt, geen antwoord, geen mailinhoud — alleen wie, waar, welk model
 * en wat het kostte.
 */
export async function logModelUsage(e: UsageEntry): Promise<void> {
  if (!e.userId) return;                       // cron/service: geen persoon, geen regel
  try {
    const cost = e.costUsd ?? estimateCostUsd(e.model || '', e.inputTokens ?? 0, e.outputTokens ?? 0);
    const r = await fetch(`${URL_ENV()}/rest/v1/model_usage_log`, {
      method: 'POST',
      headers: {
        apikey: KEY_ENV(),
        Authorization: `Bearer ${KEY_ENV()}`,
        'Content-Type': 'application/json',
        Prefer: 'return=minimal',
      },
      body: JSON.stringify({
        user_id: e.userId,
        edge_function: e.edgeFunction,
        provider: e.provider,
        model: e.model ?? null,
        input_tokens: e.inputTokens ?? null,
        output_tokens: e.outputTokens ?? null,
        est_cost_usd: Number(cost.toFixed(6)),
        ok: e.ok !== false,
      }),
      signal: AbortSignal.timeout(8_000),
    });
    if (!r.ok) console.error('[user-gate] model_usage_log', r.status, (await r.text()).slice(0, 200));
  } catch (err) {
    console.error('[user-gate] model_usage_log gooide', err instanceof Error ? err.message : String(err));
  }
}

/** Token-telling uit een OpenAI chat/completions-antwoord, defensief. */
export function openaiUsage(data: any): { input: number; output: number } {
  const u = data?.usage ?? {};
  return {
    input: Number(u.prompt_tokens ?? u.input_tokens ?? 0) || 0,
    output: Number(u.completion_tokens ?? u.output_tokens ?? 0) || 0,
  };
}
