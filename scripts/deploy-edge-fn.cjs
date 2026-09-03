#!/usr/bin/env node
// =============================================================================
// deploy-edge-fn.cjs — deploy een Supabase Edge Function vanaf disk via de
// Management API (geen transcriptie-risico, i.t.t. inline MCP-deploy).
// Gebruik:  SBT=<management_token> node scripts/deploy-edge-fn.cjs <slug> <verify_jwt:true|false>
// Leest supabase/functions/<slug>/index.ts en volgt daarna ALLE relatieve
// imports transitief (buurbestanden én ../_shared/*).
// RAG v2 F.2: toegevoegd om de grote/kritieke chunker veilig te deployen.
//
// v1.140: de bestandslijst was `index.ts` + (bij een _shared-import) heel
// `_shared/`. Buurbestanden binnen de functie-map zelf gingen NIET mee, en
// rag-chat is precies zo opgebouwd: `index.ts` importeert `./agentic.ts`,
// `./analytics.ts` en `./org-skills.ts`. Een rag-chat-deploy via dit script
// miste dus per definitie de helft van de functie. Daarom nu een echte
// import-walk vanaf de entrypoint, die hard faalt op een import die niet op
// disk staat — een ontbrekende module mag geen stille halve deploy worden.
// =============================================================================
const fs = require("fs");
const path = require("path");

const slug = process.argv[2];
const verifyJwt = process.argv[3] === "true";
const ref = process.env.SUPABASE_REF || "ezxihctobrqoklufawim";
const token = process.env.SBT;
const dryRun = process.env.DRY === "1";
if (!slug || (!token && !dryRun)) {
  console.error("usage: SBT=<token> node scripts/deploy-edge-fn.cjs <slug> <true|false>   (DRY=1 = alleen bestandslijst)");
  process.exit(2);
}

const baseDir = path.join("supabase", "functions");
const entry = path.join(baseDir, slug, "index.ts");
if (!fs.existsSync(entry)) { console.error("no index.ts at " + entry); process.exit(2); }

// Alle relatieve specifiers: `from "./x.ts"`, `import "../y.ts"`, `import("./z.ts")`.
// Bare specifiers (npm:, jsr:, https:) laat de bundler zelf ophalen.
const RELATIVE_SPEC = /(?:\bfrom\s*|\bimport\s*\(?\s*|\bexport\s+\*\s+from\s*)["'](\.[^"']*)["']/g;

// Transitieve walk vanaf de entrypoint. `seen` is op absoluut pad, zodat
// dezelfde module via twee paden niet dubbel in de payload landt.
const files = [];
const seen = new Set();
const rootAbs = path.resolve(baseDir);

function addFile(absPath, importedBy) {
  const key = path.resolve(absPath);
  if (seen.has(key)) return;
  if (!key.startsWith(rootAbs + path.sep)) {
    console.error(`import buiten supabase/functions/: ${key} (uit ${importedBy})`);
    process.exit(2);
  }
  if (!fs.existsSync(key)) {
    console.error(`ontbrekende import: ${path.relative(baseDir, key)} (uit ${importedBy}) — deploy afgebroken`);
    process.exit(2);
  }
  seen.add(key);
  const content = fs.readFileSync(key, "utf8");
  files.push({ name: `functions/${path.relative(rootAbs, key).split(path.sep).join("/")}`, content });
  const here = path.dirname(key);
  for (const m of content.matchAll(RELATIVE_SPEC)) {
    addFile(path.resolve(here, m[1]), path.relative(baseDir, key));
  }
}

addFile(entry, "(entrypoint)");

// Superset-vangnet: importeert de functie iets uit _shared, stuur dan heel
// _shared mee — precies het gedrag van vóór v1.140, zodat geen enkele
// bestaande deploy erop achteruit gaat. Ongebruikte files negeert de bundler.
if (files.some((f) => /^functions\/_shared\//.test(f.name))) {
  const sharedDir = path.join(baseDir, "_shared");
  for (const f of fs.readdirSync(sharedDir)) {
    if (!f.endsWith(".ts")) continue;
    const abs = path.resolve(sharedDir, f);
    if (seen.has(abs)) continue;
    seen.add(abs);
    files.push({ name: `functions/_shared/${f}`, content: fs.readFileSync(abs, "utf8") });
  }
}

console.log(`bundle (${files.length} files):`);
for (const f of files) console.log(`  ${f.name}  (${f.content.length} bytes)`);
if (dryRun) process.exit(0);

(async () => {
  const form = new FormData();
  form.append("metadata", JSON.stringify({
    name: slug,
    entrypoint_path: `functions/${slug}/index.ts`,
    verify_jwt: verifyJwt,
  }));
  for (const f of files) {
    form.append("file", new Blob([f.content], { type: "application/typescript" }), f.name);
  }
  const url = `https://api.supabase.com/v1/projects/${ref}/functions/deploy?slug=${encodeURIComponent(slug)}`;
  const res = await fetch(url, { method: "POST", headers: { Authorization: `Bearer ${token}` }, body: form });
  const text = await res.text();
  console.log("HTTP " + res.status);
  console.log(text.slice(0, 1000));
  if (!res.ok) process.exit(1);
  try { const j = JSON.parse(text); console.log("OK version=" + j.version + " verify_jwt=" + j.verify_jwt + " files=" + files.length); } catch {}
})().catch((e) => { console.error("ERR", e.message); process.exit(1); });
