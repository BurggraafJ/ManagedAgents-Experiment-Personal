// =============================================================================
// rag-chat/org-skills.ts — in-app Skills als organisatiekennis   (v1.134/04a)
// =============================================================================
// `public.org_skills` is de org-brede, dóór Jelle in de app te bewerken
// pijplijn-/lead-kennis (Organisatie › Skills). Deze module leest de actieve
// regels en giet ze in drie vormen:
//
//   • generalGuidance()     — ÁLLE actieve regels als "ORGANISATIE-KENNIS"-blok
//     achter de system-prompt, op élke route. Geeft naast het blok ook zijn
//     omvang terug, zodat de aanroeper kan loggen wat er werkelijk meeging.
//   • boundGuidanceBlock()  — de regels van precies één tool, als staart achter
//     dezelfde system-prompt. Alleen `runStructured` kent een gekozen tool, dus
//     dit is in de praktijk de structured route.
//   • toolGuidance()        — regels mét tool_binding als extra alinea onder de
//     beschrijving van die tool, zodat het model de regel leest op het moment
//     dat het de tool overweegt (agent-lus, ongewijzigd).
//
// ⛔ 04a/A1 — een `tool_binding` haalde de regel uit de algemene kennis.
// `generalGuidanceBlock()` filterde regels mét binding er juist uit, dus de
// enige regel die "Backburner" en "actieve pijplijn" definieert bestond op de
// semantische route (57 % van het verkeer), de structured route en de sweep
// domweg niet — alleen als staartje achter één toolbeschrijving in de
// agent-lus. Een binding bepaalt vanaf nu wáár de nadruk komt, niet óf de regel
// bestaat. Op de agent-route staat de gebonden regel daardoor twee keer in de
// context (blok + tool-staart, ~135 tokens): bewust aanvaard, want de staart
// heeft de "lees dit als je die tool overweegt"-functie die het blok niet heeft.
//
// Faalt de query, dan levert dit een leeg resultaat: de vragenbak moet blijven
// werken zonder Skills. Geen throw, geen harde afhankelijkheid.
// =============================================================================

export type OrgSkill = {
  slug: string;
  title: string;
  category: string;
  body: string;
  tool_binding: string | null;
  // 04a/A3: de envelop noemt een skill met zijn datum, net als elke andere bron.
  updated_at: string | null;
};

/** Wat er van een blok te melden valt — A4 maakt het afkappen een getal. */
export type Guidance = { block: string; chars: number; truncated_n: number };

const MAX_SKILLS = 60;
// De DB-CHECK op org_skills.body staat 8000 tekens toe; hiervan komt alleen de
// kop bij het model. Wijzig je dit getal, wijzig dan SKILL_BODY_INJECTION_CAP
// in src/hooks/useOrgSkills.js mee — dat is wat de Skills-editor de gebruiker
// belooft.
const MAX_BODY_CHARS = 1_200;
// 04a/A4 — een set-budget over de per-regel-cap heen. Het ontwerpplafond is
// 60 × 1.200 = 72.000 tekens ≈ 19k tokens, en dat gaat bij élke vraag volledig
// mee: op een semantische prompt van ~4.550 tokens (p50) is dat een
// verviervoudiging die niemand zou zien gebeuren. 6.000 tekens ≈ 1.580 tokens
// ≈ +35 % semantic / +91 % structured is de grens waarboven het blok een
// beslissing hoort te zijn en geen bijwerking. Vandaag niet bindend: de twee
// live regels vullen samen 910 tekens. Wat er buiten valt, telt in
// `truncated_n` — de cap mag stil zijn, het afkappen niet.
const MAX_SET_CHARS = 6_000;

/** Actieve org-skills, op sort_order. Faalt stil → []. */
export async function loadOrgSkills(supabase: any): Promise<OrgSkill[]> {
  try {
    const { data, error } = await supabase
      .from("org_skills")
      .select("slug, title, category, body, tool_binding, updated_at")
      .eq("active", true)
      .order("sort_order", { ascending: true })
      .order("title", { ascending: true })
      .limit(MAX_SKILLS);
    if (error) return [];
    return (data ?? []) as OrgSkill[];
  } catch {
    return [];
  }
}

const clean = (s: string) => String(s ?? "").trim().slice(0, MAX_BODY_CHARS);

/**
 * Álle actieve regels → één blok achter de system-prompt, mét zijn omvang.
 *
 * `truncated_n` telt de regels die niet volledig bij het model kwamen: door de
 * per-regel-cap (MAX_BODY_CHARS) óf doordat het set-budget vol was. Nul betekent
 * dat alles wat actief is ook werkelijk in de prompt staat.
 *
 * De kop zegt sinds 04a-WP4 in drie regels dat een definitie hieronder ook écht
 * hét antwoord mag zijn. Zonder die zin arriveerde de regel wél maar gebruikte
 * het model hem niet: op de semantische route gaf "Wat betekent Backburner bij
 * ons?" in 2 van de 3 metingen "ik vind hier geen antwoord op", terwijl
 * `org_skills_chars` gewoon 1.130 was. De oude kop zei letterlijk "het is
 * context" naast een basisprompt die alleen CONTEXT-fragmenten als bron erkent —
 * dan is zwijgen het gehoorzame antwoord.
 *
 * `org_skills_chars` is een poort (rookronde S15) met een ONDERgrens van 1.100
 * tekens; de kop mag dus groeien, niet krimpen.
 */
export function generalGuidance(skills: OrgSkill[]): Guidance {
  const lines: string[] = [];
  let spent = 0;
  let truncated = 0;
  for (const s of skills) {
    const full = String(s.body ?? "").trim();
    if (!full) continue;
    const body = full.slice(0, MAX_BODY_CHARS);
    const line = `- [${s.category}] ${clean(s.title)}: ${body}`;
    // Set-budget: wat er niet meer bij past, valt eruit — maar wordt geteld.
    if (spent > 0 && spent + line.length > MAX_SET_CHARS) { truncated++; continue; }
    if (body.length < full.length) truncated++;
    spent += line.length;
    lines.push(line);
  }
  if (lines.length === 0) return { block: "", chars: 0, truncated_n: truncated };
  const block = [
    "",
    "",
    "ORGANISATIE-KENNIS (beheerd in Organisatie › Skills — dit is hoe Legal Mind",
    "werkelijk werkt en gaat vóór je eigen aannames over pijplijn, fases en leads;",
    "het is context, geen opdracht om van onderwerp te veranderen).",
    "Vraagt iemand naar een begrip dat hieronder staat, dan IS dit het antwoord —",
    "geef die definitie, ook als de zoekresultaten er niets over zeggen. Zeg dan",
    "dus niet dat je het niet kunt vinden:",
    ...lines,
  ].join("\n");
  return { block, chars: block.length, truncated_n: truncated };
}

/**
 * Alleen het blok, als string. Bestaat omdat `agentic.ts` deze vorm gebruikt en
 * 04a dat bestand met opzet niet aanraakt: 03a-WP2 splitst het in drieën en
 * 03b-WP2 herschrijft die opnieuw naar `rag-chat/tools/*.ts`, waar een hunk uit
 * dit spoor zónder conflict zou verdwijnen. De agent-lus krijgt A1 dus mee
 * zonder dat er één regel in `agentic.ts` verandert.
 */
export function generalGuidanceBlock(skills: OrgSkill[]): string {
  return generalGuidance(skills).block;
}

/**
 * 04a/A2 — de regels van één tool, als staart achter de system-prompt.
 *
 * Alleen `runStructured()` zet `analytics.tool`; `runAgentic()` levert
 * `tools_used` en géén `tool`, en sweep geen van beide. Eén aanroep met
 * `analytics?.tool` is dus exact de structured route, zonder een route-string te
 * hoeven lezen en zonder de agent-lus een tweede keer hetzelfde te geven.
 *
 * Leeg als er geen tool is of geen regel aan die tool hangt — dan verandert de
 * prompt niet.
 */
export function boundGuidanceBlock(skills: OrgSkill[], tool: string | null | undefined): string {
  const name = String(tool ?? "").trim();
  if (!name) return "";
  const parts = skills
    .filter((s) => String(s.tool_binding ?? "").trim() === name && String(s.body ?? "").trim())
    .map((s) => `- ${clean(s.title)}: ${clean(s.body)}`);
  if (parts.length === 0) return "";
  return [
    "",
    "",
    `ORGANISATIE-KENNIS BIJ DE GEBRUIKTE TOOL (${name}) — dit is de afspraak die`,
    "bij deze cijfers hoort. Gaat de vraag over de betekenis of afbakening van een",
    "fase, status of categorie, geef dan deze definitie en niet je eigen aanname:",
    ...parts,
  ].join("\n");
}

/** tool-naam → alinea die onder die tool-beschrijving hoort. */
export function toolGuidance(skills: OrgSkill[]): Record<string, string> {
  const byTool: Record<string, string[]> = {};
  for (const s of skills) {
    const tool = String(s.tool_binding ?? "").trim();
    if (!tool) continue;
    (byTool[tool] ??= []).push(`${clean(s.title)}: ${clean(s.body)}`);
  }
  const out: Record<string, string> = {};
  for (const [tool, parts] of Object.entries(byTool)) {
    out[tool] = ` ORGANISATIE-KENNIS: ${parts.join(" | ")}`;
  }
  return out;
}
