// =============================================================================
// agent_skills_prompt_probe.ts — lekt een werkwijze in de PROMPT?  (04 PR-B)
// =============================================================================
// `scripts/agent_skills_acl.cjs` bewijst de ACL op de DATALAAG: welke rijen
// `app_skills_visible()` en `app_skill_open()` per persona teruggeven. Dat is de
// poort, maar het is niet het hele oppervlak. De tekst die het model ziet wordt
// één laag hoger gebouwd — in `rag-chat/app-skills.ts` — en juist daar zit de
// splitsing die het makkelijkst stil fout gaat: org-scope hoort in de gedeelde
// system-prefix, caller-scope in de user-beurt. Verwissel die twee en de ACL is
// nog steeds gaaf terwijl de prompt van persona B de titel van persona A draagt.
//
// Deze probe importeert dus de ÉCHTE modulefuncties, met een echte
// service-role-client op productie, en kijkt in de gerenderde blokken:
//
//   • ziet persona A zijn eigen titel, en persona B die van A niet (en omgekeerd)
//   • staat caller-gebonden tekst NOOIT in het org-blok (de gedeelde prefix)
//   • geeft `skill_open` de body van de eigen skill, en niets van de ander
//   • is de reden bij "niet zichtbaar" letterlijk gelijk aan die bij
//     "bestaat niet", en komt de gevraagde slug er niet in terug
//
// Wat deze probe NIET is: een HTTP-call naar de gedeployde `rag-chat`. Poort K5
// vraagt dat wél, en dat kan pas na de deploy (die op PR #53 wacht). Dit is de
// sterkste meting die zónder deploy bestaat: dezelfde code, dezelfde RPC's,
// dezelfde twee persona's — alleen niet via de gateway.
//
// Draaien:
//   SUPABASE_URL=https://<ref>.supabase.co \
//   SERVICE_KEY=<service_role_key> \
//   deno run --allow-net --allow-env scripts/agent_skills_prompt_probe.ts
//
// De sleutel staat NIET in dit bestand en hoort niet in git (publieke repo).
// Exit 0 = alles groen, exit 1 = minstens één assertie rood.
// =============================================================================
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.4";
import {
  loadAppSkills, splitByScope, appSkillTitlesBlock, appSkillDescriptionsBlock, openAppSkill,
} from "../supabase/functions/rag-chat/app-skills.ts";

const URL_ = Deno.env.get("SUPABASE_URL");
const KEY = Deno.env.get("SERVICE_KEY");
if (!URL_ || !KEY) {
  console.error("zet SUPABASE_URL en SERVICE_KEY (service_role)");
  Deno.exit(2);
}
const sb = createClient(URL_, KEY, { auth: { persistSession: false } });
const PREFIX = "zz-probe-";

const results: Array<{ id: string; wat: string; ok: boolean; gemeten: string }> = [];
function assert(id: string, wat: string, ok: boolean, gemeten: string) {
  results.push({ id, wat, ok, gemeten });
  console.log(`${ok ? " OK " : "ROOD"}  ${id.padEnd(4)} ${wat.padEnd(58)} ${gemeten}`);
}

async function personas() {
  const { data } = await sb.from("user_roles").select("user_id, app_role").order("created_at");
  const owner = (data ?? []).find((r: any) => r.app_role === "owner");
  const member = (data ?? []).find((r: any) => r.app_role === "member");
  if (!owner || !member) throw new Error("geen owner- én member-persona in user_roles");
  return { a: owner.user_id as string, b: member.user_id as string };
}

// De drie blokken zoals run.ts en agentic.ts ze werkelijk samenstellen.
function render(set: Awaited<ReturnType<typeof loadAppSkills>>) {
  const { org, caller } = splitByScope(set);
  const systemBlok = appSkillTitlesBlock(org, { canOpen: true }).block + appSkillDescriptionsBlock(org).block;
  const userBlok = appSkillTitlesBlock(caller, { canOpen: true, personal: true }).block + appSkillDescriptionsBlock(caller).block;
  return { systemBlok, userBlok, alles: systemBlok + userBlok, etag: set.etag, n: set.skills.length };
}

try {
  console.log("app_skills prompt-probe — " + new Date().toISOString() + "\n");
  const { a, b } = await personas();

  await sb.from("app_skills").delete().like("slug", `${PREFIX}%`);
  const { error: insErr } = await sb.from("app_skills").insert([
    { slug: `${PREFIX}a`, title: "Probe A titel", description: "Probe A beschrijving.", body: "Probe A body regel.", scope: "user", scope_user_id: a, sort_order: 910 },
    { slug: `${PREFIX}b`, title: "Probe B titel", description: "Probe B beschrijving.", body: "Probe B body regel.", scope: "user", scope_user_id: b, sort_order: 911 },
    { slug: `${PREFIX}org`, title: "Probe org titel", description: "Probe org beschrijving.", body: "Probe org body regel.", scope: "org", sort_order: 912 },
  ]);
  if (insErr) throw new Error(`fixtures: ${insErr.message}`);

  const setA = await loadAppSkills(sb, a);
  const setB = await loadAppSkills(sb, b);
  const setCron = await loadAppSkills(sb, null);
  const pA = render(setA), pB = render(setB), pCron = render(setCron);

  // ── De vier metingen, nu op de PROMPT-tekst ───────────────────────────────
  assert("P1", "prompt van A draagt de titel van A", pA.alles.includes("Probe A titel"),
    `${pA.n} skills, ${pA.alles.length} tekens  [POSITIEVE CONTROLE]`);
  assert("P2", "prompt van B draagt de titel van B", pB.alles.includes("Probe B titel"),
    `${pB.n} skills, ${pB.alles.length} tekens  [POSITIEVE CONTROLE]`);
  assert("P3", "prompt van A draagt niets van B",
    !pA.alles.includes("Probe B") && !pA.alles.includes(`${PREFIX}b`), "geen B-slug en geen B-titel");
  assert("P4", "prompt van B draagt niets van A",
    !pB.alles.includes("Probe A") && !pB.alles.includes(`${PREFIX}a`), "geen A-slug en geen A-titel");

  // ── De splitsing: caller-gebonden tekst mag NOOIT in de gedeelde prefix ───
  assert("P5", "caller-scope staat niet in het system-blok",
    !pA.systemBlok.includes(`${PREFIX}a`) && !pB.systemBlok.includes(`${PREFIX}b`),
    `system A ${pA.systemBlok.length}ch / B ${pB.systemBlok.length}ch`);
  assert("P5b", "en het system-blok is voor A en B identiek (cache-prefix)",
    pA.systemBlok === pB.systemBlok, `${pA.systemBlok.length} == ${pB.systemBlok.length} tekens`);
  assert("P5c", "org-scope staat wél in het system-blok",
    pA.systemBlok.includes(`${PREFIX}org`), "org-slug aanwezig");

  // ── De aanroeper zonder identiteit ────────────────────────────────────────
  assert("P6", "cron-aanroeper (uid null) krijgt alleen de org-skill",
    pCron.alles.includes(`${PREFIX}org`) && !pCron.alles.includes(`${PREFIX}a`) && !pCron.alles.includes(`${PREFIX}b`),
    `${pCron.n} skills zichtbaar`);
  assert("P6b", "en zijn user-blok is leeg", pCron.userBlok === "", `${pCron.userBlok.length} tekens`);

  // ── Trap 3 ────────────────────────────────────────────────────────────────
  const openOwn = await openAppSkill(sb, `${PREFIX}a`, a);
  const openOther = await openAppSkill(sb, `${PREFIX}a`, b);
  const openGhost = await openAppSkill(sb, "bestaat-echt-niet-xyz", b);
  assert("P7", "skill_open geeft de eigen body", openOwn.ok === true && (openOwn as any).body.includes("Probe A body"),
    openOwn.ok ? `${(openOwn as any).body.length} tekens body` : `mislukt: ${(openOwn as any).reason}`);
  assert("P8", "skill_open geeft niets van de ander", openOther.ok === false,
    openOther.ok ? "LEK: body geleverd" : "geweigerd");
  assert("P9", "reden bij onzichtbaar == reden bij onbestaand",
    openOther.ok === false && openGhost.ok === false && (openOther as any).reason === (openGhost as any).reason,
    openOther.ok === false ? `"${(openOther as any).reason}"` : "n/a");
  assert("P9b", "en die reden echoot de gevraagde slug niet",
    openOther.ok === false && !(openOther as any).reason.includes(`${PREFIX}a`), "slug niet in de tekst");

  // ── De etag ───────────────────────────────────────────────────────────────
  assert("P10", "etag is caller-gescopeerd", pA.etag !== pB.etag && pA.etag !== "unavailable",
    `A=${pA.etag.slice(0, 8)}… B=${pB.etag.slice(0, 8)}…`);
  await sb.from("app_skills").update({ description: "Probe org beschrijving, gewijzigd." }).eq("slug", `${PREFIX}org`);
  const etagNa = (await loadAppSkills(sb, a)).etag;
  assert("P10b", "etag beweegt na één bewerking", etagNa !== pA.etag,
    `${pA.etag.slice(0, 8)}… → ${etagNa.slice(0, 8)}…`);

  // ── Afkappen is een getal ─────────────────────────────────────────────────
  await sb.from("app_skills").update({ body: "x".repeat(9000) }).eq("slug", `${PREFIX}org`);
  const big = await openAppSkill(sb, `${PREFIX}org`, a);
  assert("P11", "een body boven de injectie-cap wordt gemeld, niet stil afgekapt",
    big.ok === true && (big as any).dropped_chars > 0 && (big as any).body.length <= 6000,
    big.ok ? `${(big as any).body.length} mee, ${(big as any).dropped_chars} weggelaten` : "open mislukt");
} finally {
  await sb.from("app_skills").delete().like("slug", `${PREFIX}%`);
  const { count } = await sb.from("app_skills").select("slug", { count: "exact", head: true }).like("slug", `${PREFIX}%`);
  assert("P12", "fixtures opgeruimd", (count ?? 0) === 0, `${count ?? 0} rijen over`);
}

const rood = results.filter((r) => !r.ok);
console.log("\n" + "=".repeat(110));
console.log(`${results.length - rood.length}/${results.length} groen`);
if (rood.length) {
  console.log("ROOD: " + rood.map((r) => r.id).join(", "));
  Deno.exit(1);
}
console.log("prompt-probe groen");
