#!/usr/bin/env node
// =============================================================================
// deploy-edge-fn.cjs — deploy een Supabase Edge Function vanaf disk via de
// Management API (geen transcriptie-risico, i.t.t. inline MCP-deploy).
// Gebruik:  SBT=<management_token> node scripts/deploy-edge-fn.cjs <slug> <verify_jwt:true|false>
// Leest supabase/functions/<slug>/index.ts (+ _shared/*.ts indien geïmporteerd).
// RAG v2 F.2: toegevoegd om de grote/kritieke chunker veilig te deployen.
// =============================================================================
const fs = require("fs");
const path = require("path");

const slug = process.argv[2];
const verifyJwt = process.argv[3] === "true";
const ref = process.env.SUPABASE_REF || "ezxihctobrqoklufawim";
const token = process.env.SBT;
if (!slug || !token) {
  console.error("usage: SBT=<token> node scripts/deploy-edge-fn.cjs <slug> <true|false>");
  process.exit(2);
}

const baseDir = path.join("supabase", "functions");
const entry = path.join(baseDir, slug, "index.ts");
if (!fs.existsSync(entry)) { console.error("no index.ts at " + entry); process.exit(2); }

const idx = fs.readFileSync(entry, "utf8");
const files = [{ name: `functions/${slug}/index.ts`, content: idx }];
if (/\.\.\/_shared\//.test(idx)) {
  const sharedDir = path.join(baseDir, "_shared");
  for (const f of fs.readdirSync(sharedDir)) {
    if (f.endsWith(".ts")) files.push({ name: `functions/_shared/${f}`, content: fs.readFileSync(path.join(sharedDir, f), "utf8") });
  }
}

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
