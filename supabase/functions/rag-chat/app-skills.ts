// =============================================================================
// rag-chat/app-skills.ts — werkwijzen in drie trappen        (v1.156, 04 PR-B)
// =============================================================================
// `public.app_skills` bevat wérkwijzen: "hoe doen wij een overdracht naar de
// Customer Base", "wat staat er in een QBR". Dat is ander materiaal dan
// `org_skills` (zie ./org-skills.ts): een definitie is 200 tekens en hoort bij
// élke vraag mee; een werkwijze is 5.000 tekens en hoort bij één vraag op de
// honderd mee. Alles altijd meesturen zou de prompt verviervoudigen voor een
// belofte die zelden wordt ingelost.
//
// Vandaar drie trappen (Agent-Skills-standaard, docs/agent/SKILLS.md § 3):
//
//   | trap | wat                | wanneer                            | kosten     |
//   |------|--------------------|------------------------------------|------------|
//   |  1   | titel  (≤ 120)     | ALTIJD, op élke route              | ~35 tok/st |
//   |  2   | beschrijving (≤500)| alleen waar `skill_open` bestaat   | ~140 tok/st|
//   |  3   | body   (≤ 20.000)  | alleen ná `skill_open(slug)`       | ~5k, 1×    |
//
// ⛔ Trap 2 staat BEWUST niet op semantic/structured/sweep. Daar bestaat geen
// tool om trap 3 te bereiken, dus een volledige beschrijving is daar betalen
// voor een deur die niet opengaat. Een titellijst kan wél worden ingelost — het
// model kan zeggen "daar is een werkwijze voor vastgelegd" — en dat is precies
// wat de bank op dit punt vraagt. Dit wijkt af van SKILLS.md § 3 zoals dat er
// stond ("beschrijvingen altijd mee"); SKILLS.md is met deze reden bijgewerkt.
//
// ── Waar de blokken staan, en waarom dat een veiligheidsvraag is ────────────
//
// `scope='org'`-tekst varieert alleen met Jelle's bewerking en is identiek voor
// iedereen: die hoort in de gedeelde prefix (de system-prompt). `scope='user'`
// en `scope='role'`-tekst varieert met de VRAGER en hoort achter het
// cache-breekpunt (de eerste user-beurt). Twee onafhankelijke redenen, en de
// tweede is de belangrijkste:
//
//   1. Kosten. Alles op positie 0 dat per gebruiker verschilt is nul cache-hits
//      over gebruikers heen. De agent-lus haalt vandaag gemeten 64-77 % op
//      OpenAI's automatische prefix-cache; dat wil je niet weggooien.
//   2. Veiligheid. Houd je de prefix identiteitsvrij, dan KÁN een ACL-fout daar
//      per constructie niet in landen. Dat is een structureel argument, geen
//      tuning-argument. Zet je caller-gebonden tekst in een gedeelde prefix, dan
//      is de cache-sleutel identiteitsafhankelijk geworden.
//
// Spoor 03a zet straks een expliciete `cache_control`-marker op het laatste
// systeemblok. Deze module levert de ordening die daarop past; er is geen
// afhankelijkheid in beide richtingen, alleen een reviewregel.
//
// ── De ACL zit in de database, niet hier ────────────────────────────────────
//
// `index.ts` bouwt zijn client met de SERVICE-ROLE-key: op dat pad vuurt RLS
// nooit. Deze module leest daarom UITSLUITEND via `app_skills_visible()` en
// `app_skill_open()` (SECURITY DEFINER, migratie 20260908160000) en filtert
// zelf nergens op scope. Eén predicaat, in SQL, te meten met
// `pg_get_functiondef` — zie scripts/agent_skills_acl.cjs.
//
// Faalt de query, dan levert dit een lege set: de vragenbak moet blijven werken
// zonder werkwijzen. Geen throw, geen harde afhankelijkheid.
// =============================================================================

export type AppSkillScope = "org" | "user" | "role";

export type AppSkill = {
  slug: string;
  version: number;
  title: string;
  description: string;
  tool_binding: string | null;
  scope: AppSkillScope;
  triggers: string[];
  sort_order: number;
};

/** Wat er van een blok te melden valt; afkappen is een getal, niet een gevoel. */
export type AppSkillSet = {
  /** De voor deze aanroeper zichtbare set, in prompt-volgorde. */
  skills: AppSkill[];
  /** md5 over `slug:version` van de zichtbare set — 'empty' of 'unavailable'. */
  etag: string;
  /** Wat er niet volledig meeging, met de slug erbij. Leeg = alles ging mee. */
  truncated: Array<{ slug: string; dropped_chars: number }>;
};

export const EMPTY_APP_SKILLS: AppSkillSet = { skills: [], etag: "empty", truncated: [] };

// ── Budgetten ────────────────────────────────────────────────────────────────
// AANNAME: 40 zichtbare skills. Bij 40 is trap 1 ≈ 1.400 tekens (≈ 400 tokens)
// en trap 2 ≈ 20.000 tekens (≈ 5.700 tokens) — dat laatste zou de agentische
// prompt verdubbelen, dus het beschrijvingsblok heeft een eigen, kleiner budget
// dan de som van de caps. Overschrijding kapt op SKILL-grens af, nooit midden
// in een tekst, en wordt gemeld in `dbg.app_skills_truncated`.
const MAX_SKILLS = 40;
const MAX_TITLES_CHARS = 2_000;
const MAX_DESCRIPTIONS_CHARS = 6_000;
/** Maximaal twee `skill_open`-calls per RUN (niet per hop) — een derde geeft een fout. */
export const MAX_SKILL_OPENS = 2;
/**
 * Wat er van één body werkelijk bij het model komt. De DB-CHECK staat 20.000
 * tekens toe (opslag), maar een toolresultaat in de agent-lus wordt afgekapt op
 * `MAX_TOOL_RESULT_CHARS` = 7.000 (agentic.ts) — en dat gebeurt op de
 * JSON-string, dus midden in een woord én midden in de payload. Een body van
 * 20.000 zou daarmee stil half aankomen, in ongeldige JSON.
 *
 * Dus kappen we hier, expliciet, op regelgrens, met een melding erbij. Precies
 * dezelfde verhouding als bij `org_skills`: de DB bewaart 8.000, het model leest
 * 1.200, en de editor vertelt dat. Wijzig je dit getal, wijzig dan
 * APP_SKILL_BODY_INJECTION_CAP in src/hooks/useAppSkills.js mee.
 */
export const APP_BODY_INJECTION_CAP = 6_000;

const one = (s: unknown, cap: number) => String(s ?? "").replace(/\s+/g, " ").trim().slice(0, cap);

/**
 * De zichtbare set + de etag, in één rondgang.
 *
 * Twee RPC's parallel: `app_skills_visible` levert de rijen,
 * `app_skills_etag` de md5 over `slug:version` van diezelfde set. Beide draaien
 * op hetzelfde predicaat (de etag-functie selecteert uit `app_skills_visible`),
 * dus ze kunnen niet uit elkaar lopen — en de etag is caller-gescopeerd, precies
 * zoals de set.
 *
 * `p_caller_user_id = null` (cron, evalrunner zonder persona, service-to-service)
 * is normaal en levert alleen `scope='org'`. Een lege uitkomst is dus géén bug.
 */
export async function loadAppSkills(supabase: any, callerUserId: string | null): Promise<AppSkillSet> {
  try {
    const [visRes, etagRes] = await Promise.all([
      supabase.rpc("app_skills_visible", { p_caller_user_id: callerUserId ?? null }),
      supabase.rpc("app_skills_etag", { p_caller_user_id: callerUserId ?? null }),
    ]);
    if (visRes.error) return { ...EMPTY_APP_SKILLS, etag: "unavailable" };
    const rows: any[] = Array.isArray(visRes.data) ? visRes.data : [];
    const skills: AppSkill[] = rows.slice(0, MAX_SKILLS).map((r) => ({
      slug: String(r.slug ?? ""),
      version: Number(r.version ?? 1),
      title: one(r.title, 120),
      description: one(r.description, 500),
      tool_binding: r.tool_binding ? String(r.tool_binding) : null,
      scope: (r.scope === "user" || r.scope === "role") ? r.scope : "org",
      triggers: Array.isArray(r.triggers) ? r.triggers.map((t: unknown) => String(t ?? "")).filter(Boolean) : [],
      sort_order: Number(r.sort_order ?? 100),
    })).filter((s) => s.slug && s.title);
    // Boven de 40 is de set zelf afgekapt; dat is óók afkappen en hoort geteld.
    const truncated = rows.slice(MAX_SKILLS)
      .map((r) => ({ slug: String(r.slug ?? "?"), dropped_chars: -1 }));
    const etag = typeof etagRes?.data === "string" && etagRes.data ? etagRes.data : "unavailable";
    return { skills, etag, truncated };
  } catch {
    return { ...EMPTY_APP_SKILLS, etag: "unavailable" };
  }
}

/**
 * De set gesplitst naar waar hij in de prompt hoort.
 *
 * `org` → gedeelde prefix (system). `user`/`role` → eerste user-beurt. Dit is de
 * enige plek waar op scope wordt gesplitst, en het is een PLAATSINGS-vraag, geen
 * toegangsvraag: wat hier binnenkomt mag de aanroeper al zien (dat besloot
 * `app_skills_visible`). Zou je hier per ongeluk iets doorlaten, dan is dat een
 * cache-fout — geen lek.
 */
export function splitByScope(set: AppSkillSet): { org: AppSkill[]; caller: AppSkill[] } {
  const org: AppSkill[] = [];
  const caller: AppSkill[] = [];
  for (const s of set.skills) (s.scope === "org" ? org : caller).push(s);
  return { org, caller };
}

// Budget over een lijst regels, afgekapt op regelgrens. Geeft de regels terug
// die passen plus wat er wegviel — nooit een halve regel, nooit stil.
function fit(
  items: AppSkill[],
  line: (s: AppSkill) => string,
  max: number,
): { lines: string[]; dropped: Array<{ slug: string; dropped_chars: number }> } {
  const lines: string[] = [];
  const dropped: Array<{ slug: string; dropped_chars: number }> = [];
  let spent = 0;
  for (const s of items) {
    const l = line(s);
    if (lines.length > 0 && spent + l.length > max) { dropped.push({ slug: s.slug, dropped_chars: l.length }); continue; }
    spent += l.length;
    lines.push(l);
  }
  return { lines, dropped };
}

export type Block = { block: string; chars: number; dropped: Array<{ slug: string; dropped_chars: number }> };
const EMPTY_BLOCK: Block = { block: "", chars: 0, dropped: [] };

/**
 * Trap 1 — de titellijst. Op élke route, voor de org-scope in de system-prompt
 * en voor de caller-scope in de user-beurt.
 *
 * `canOpen` bepaalt de laatste regel, en dat is het hele punt van de trap:
 * bestaat `skill_open` (agent-route), dan is de opdracht "open hem"; bestaat hij
 * niet (semantic/structured/sweep), dan is de opdracht "zeg dat hij bestaat en
 * verzin de stappen niet". Beloof nooit een deur die er niet is.
 */
export function appSkillTitlesBlock(skills: AppSkill[], opts: { canOpen: boolean; personal?: boolean }): Block {
  if (skills.length === 0) return EMPTY_BLOCK;
  const { lines, dropped } = fit(skills, (s) => `- ${s.slug}: ${s.title}`, MAX_TITLES_CHARS);
  if (lines.length === 0) return EMPTY_BLOCK;
  const kop = opts.personal
    ? "VASTGELEGDE WERKWIJZEN, ALLEEN VOOR JOU (Organisatie › Skills):"
    : "VASTGELEGDE WERKWIJZEN (Organisatie › Skills) — dit zijn de procedures die";
  const kop2 = opts.personal ? [] : ["Legal Mind zelf heeft vastgelegd, op titel:"];
  const staart = opts.canOpen
    ? [
        "Raakt de vraag een van deze werkwijzen, ROEP DAN skill_open MET DIE SLUG AAN",
        "vóór je de stappen beschrijft. Verzin geen stappenplan dat er al ligt.",
      ]
    : [
        "Raakt de vraag een van deze werkwijzen, zeg dan dát hij is vastgelegd en",
        "onder welke titel. Verzin de stappen niet: je hebt hier alleen de titels.",
      ];
  const block = ["", "", kop, ...kop2, ...lines, ...staart].join("\n");
  return { block, chars: block.length, dropped };
}

/**
 * Trap 2 — de beschrijvingen. ALLEEN op de route waar `skill_open` bestaat.
 * Dit is de "wanneer open ik welke"-laag van de Agent-Skills-standaard; de
 * beschrijving is model-facing en hoort te zeggen wanneer je hem nodig hebt.
 */
export function appSkillDescriptionsBlock(skills: AppSkill[]): Block {
  const met = skills.filter((s) => s.description);
  if (met.length === 0) return EMPTY_BLOCK;
  const { lines, dropped } = fit(met, (s) => `- ${s.slug}: ${s.description}`, MAX_DESCRIPTIONS_CHARS);
  if (lines.length === 0) return EMPTY_BLOCK;
  const block = ["", "", "WANNEER JE WELKE WERKWIJZE OPENT:", ...lines].join("\n");
  return { block, chars: block.length, dropped };
}

/**
 * Trap 3 — de body van één skill, via `app_skill_open`.
 *
 * De RPC en niet context-build: een directe select is milliseconden, terwijl
 * context-build 10-20 s doet en in ~12 % van de calls op `semantic_search`
 * time-out t. Een `skill_open` via die route zou net zo hard stilvallen, en dan
 * is de hele laag onbetrouwbaar.
 *
 * "Bestaat niet" en "niet van jou" komen hier als hetzelfde terug — de RPC geeft
 * in beide gevallen 0 rijen, en deze functie voegt daar geen onderscheid aan toe.
 */
export async function openAppSkill(
  supabase: any,
  slug: string,
  callerUserId: string | null,
): Promise<
  | { ok: true; slug: string; version: number; title: string; body: string; dropped_chars: number }
  | { ok: false; reason: string }
> {
  const s = String(slug ?? "").trim().toLowerCase().slice(0, 64);
  if (!s) return { ok: false, reason: "slug verplicht" };
  try {
    const { data, error } = await supabase.rpc("app_skill_open", { p_slug: s, p_caller_user_id: callerUserId ?? null });
    if (error) return { ok: false, reason: `skill_open_failed: ${String(error.message).slice(0, 160)}` };
    const rows: any[] = Array.isArray(data) ? data : [];
    if (rows.length === 0) {
      // Eén tekst voor beide gevallen. Noemt de slug NIET terug: een foutmelding
      // die de gevraagde slug echoot maakt van een gok een bevestiging.
      return { ok: false, reason: "geen werkwijze met die naam beschikbaar voor deze gebruiker" };
    }
    const r = rows[0];
    const full = String(r.body ?? "");
    // Afkappen op regelgrens, en het aantal weggevallen tekens meegeven: de cap
    // mag stil zijn, het afkappen niet.
    let body = full;
    if (full.length > APP_BODY_INJECTION_CAP) {
      const cut = full.slice(0, APP_BODY_INJECTION_CAP);
      const nl = cut.lastIndexOf("\n");
      body = nl > APP_BODY_INJECTION_CAP * 0.5 ? cut.slice(0, nl) : cut;
    }
    return {
      ok: true,
      slug: String(r.slug ?? s),
      version: Number(r.version ?? 1),
      title: one(r.title, 120),
      body,
      dropped_chars: full.length - body.length,
    };
  } catch (e) {
    return { ok: false, reason: `skill_open_threw: ${(e instanceof Error ? e.message : String(e)).slice(0, 160)}` };
  }
}

/**
 * D04-7 — de deterministische route-override, achter een vlag die UIT staat.
 *
 * Gemeten (2026-09-07, twee rondes): alle 12 `skills`-bankitems routeerden
 * `semantic`, inclusief het poort-item dat letterlijk om progressive disclosure
 * vraagt. Bouw je `skill_open` alleen als agent-tool, dan is hij voor precies
 * die vragen onbereikbaar terwijl de laag er wél is.
 *
 * Dus: een expliciete trefwoordlijst per skill (`triggers`), en bij een match op
 * de ZICHTBARE set wordt semantic/sweep → agentic. De zichtbare set is geen
 * detail: een override op de trigger van een skill die de vrager niet mag zien,
 * verraadt het bestaan via het gedrag — dezelfde vraag gedraagt zich dan anders
 * voor twee mensen.
 *
 * Geen fuzzy match en geen embedding: een expliciete lijst is auditeerbaar. De
 * vlag staat uit omdat de override vragen naar de duurste route duwt
 * (semantic p50 ≈ $0,005 tegen agentic p50 ≈ $0,05); aanzetten is een eigen
 * meting.
 */
export function appSkillTriggerHit(skills: AppSkill[], message: string): string | null {
  const q = String(message ?? "").toLowerCase();
  if (!q) return null;
  for (const s of skills) {
    for (const t of s.triggers) {
      const needle = String(t ?? "").trim().toLowerCase();
      if (needle.length >= 3 && q.includes(needle)) return s.slug;
    }
  }
  return null;
}
