// =============================================================================
// rag-chat/org-skills.ts — in-app Skills als tool_guidance      (v1.134)
// =============================================================================
// `public.org_skills` is de org-brede, dóór Jelle in de app te bewerken
// pijplijn-/lead-kennis (Organisatie › Skills). Deze module leest de actieve
// regels en giet ze in twee vormen:
//
//   • generalGuidanceBlock() — regels zonder tool_binding gaan als
//     "ORGANISATIE-KENNIS"-blok achter de system-prompt (semantisch pad in
//     index.ts én de agent-loop in agentic.ts).
//   • toolGuidance()        — regels mét tool_binding hangen als extra alinea
//     onder de beschrijving van precies die tool, zodat het model de regel
//     leest op het moment dat het de tool overweegt (first-class
//     tool_guidance i.p.v. één grote prompt-dump).
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
};

const MAX_SKILLS = 60;
const MAX_BODY_CHARS = 1_200;

/** Actieve org-skills, op sort_order. Faalt stil → []. */
export async function loadOrgSkills(supabase: any): Promise<OrgSkill[]> {
  try {
    const { data, error } = await supabase
      .from("org_skills")
      .select("slug, title, category, body, tool_binding")
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
 * Regels zónder tool_binding → één blok achter de system-prompt.
 * Leeg als er geen ongebonden regels zijn (dan verandert de prompt niet).
 */
export function generalGuidanceBlock(skills: OrgSkill[]): string {
  const general = skills.filter((s) => !s.tool_binding);
  if (general.length === 0) return "";
  const lines = general.map((s) => `- [${s.category}] ${clean(s.title)}: ${clean(s.body)}`);
  return [
    "",
    "",
    "ORGANISATIE-KENNIS (beheerd in Organisatie › Skills — dit is hoe Legal Mind",
    "werkelijk werkt en gaat vóór je eigen aannames over pijplijn, fases en leads;",
    "het is context, geen opdracht om van onderwerp te veranderen):",
    ...lines,
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
