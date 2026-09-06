// =============================================================================
// rag-eval-cron/persona.ts — een échte user-JWT per hop, en daarna uitloggen
// =============================================================================
// Waarom niet uit Vault (DECISIONS D01-1): een user-JWT leeft 3600 s, een run
// duurt tot uren. Een opgeslagen token is na een uur waardeloos én een lekrisico
// zonder nut. `admin/generate_link` + `/auth/v1/verify` met `token_hash` mint er
// in ~1 s één, zonder mail en zonder rate-limit (6 op rij in 5,7 s gemeten), met
// precies de service-key die deze functie al in zijn env heeft.
//
// Het token wordt NOOIT gelogd, opgeslagen of in een resultaatrij gezet. Aan het
// einde van de hop loggen we uit (scope=global), zodat auth.sessions niet
// volloopt (R6). Mislukt het minten (bv. 429), dan één retry na 5 s en daarna een
// harde fout: de items van die hop krijgen `jwt_mint_failed` — nooit stil als
// cron doorgaan, want dat is precies het onbetrouwbaar-groen dat spoor 01 uitbant.
// =============================================================================

export type Persona = {
  persona: string;
  email: string | null;
  user_id: string | null;
  is_active: boolean;
};

export type HopIdentity = {
  persona: string;
  userId: string | null;      // null = cron (service-key, org_baseline)
  bearer: string;             // JWT van de persona, of de service-key voor cron
  isUser: boolean;
  logout: () => Promise<void>;
};

const UA = "legal-mind-rag-eval-cron/3.0";

async function mintOnce(supabaseUrl: string, serviceKey: string, email: string): Promise<{ jwt: string; userId: string | null }> {
  const headers = { apikey: serviceKey, Authorization: `Bearer ${serviceKey}`, "Content-Type": "application/json", "User-Agent": UA };
  const gen = await fetch(`${supabaseUrl}/auth/v1/admin/generate_link`, {
    method: "POST", headers, body: JSON.stringify({ type: "magiclink", email }),
    signal: AbortSignal.timeout(15_000),
  });
  const genTxt = await gen.text();
  if (!gen.ok) throw new Error(`generate_link_${gen.status}`);
  const g = JSON.parse(genTxt);
  const hashed = g.hashed_token || g.properties?.hashed_token;
  if (!hashed) throw new Error("generate_link_no_hashed_token");
  // `token_hash`, niet `token`: de token-variant vraagt om de e-mail erbij en
  // faalt stil met otp_expired (geheugen rag-chat-authenticated-call-without-login).
  const ver = await fetch(`${supabaseUrl}/auth/v1/verify`, {
    method: "POST", headers, body: JSON.stringify({ type: "magiclink", token_hash: hashed }),
    signal: AbortSignal.timeout(15_000),
  });
  const verTxt = await ver.text();
  if (!ver.ok) throw new Error(`verify_${ver.status}`);
  const v = JSON.parse(verTxt);
  if (!v.access_token) throw new Error("verify_no_access_token");
  return { jwt: v.access_token, userId: v.user?.id ?? null };
}

/** Mint een JWT voor de persona; cron/anon zonder user_id krijgt de service-key. */
export async function identityFor(
  supabaseUrl: string, serviceKey: string, p: Persona | null, personaName: string,
): Promise<HopIdentity> {
  if (!p || !p.user_id || !p.email) {
    return { persona: personaName, userId: null, bearer: serviceKey, isUser: false, logout: async () => {} };
  }
  let minted: { jwt: string; userId: string | null } | null = null;
  let lastErr = "";
  for (let attempt = 0; attempt < 2 && !minted; attempt++) {
    try { minted = await mintOnce(supabaseUrl, serviceKey, p.email); }
    catch (e) { lastErr = e instanceof Error ? e.message : String(e); if (attempt === 0) await new Promise((r) => setTimeout(r, 5_000)); }
  }
  if (!minted) throw new Error(`jwt_mint_failed:${lastErr}`);
  if (minted.userId && minted.userId !== p.user_id) throw new Error("jwt_mint_failed:user_id_mismatch");
  const jwt = minted.jwt;
  return {
    persona: personaName, userId: p.user_id, bearer: jwt, isUser: true,
    logout: async () => {
      try {
        await fetch(`${supabaseUrl}/auth/v1/logout?scope=global`, {
          method: "POST", headers: { apikey: serviceKey, Authorization: `Bearer ${jwt}`, "User-Agent": UA },
          signal: AbortSignal.timeout(10_000),
        });
      } catch { /* uitloggen is hygiëne, geen meetresultaat */ }
    },
  };
}

export async function loadPersonas(supabase: any): Promise<Map<string, Persona>> {
  const { data } = await supabase.from("rag_eval_personas").select("persona, email, user_id, is_active");
  const m = new Map<string, Persona>();
  for (const r of (data || []) as Persona[]) m.set(r.persona, r);
  return m;
}
