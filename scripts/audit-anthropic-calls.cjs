#!/usr/bin/env node
// =============================================================================
// audit-anthropic-calls.cjs — vindt directe Anthropic-aanroepen die NIET via de
// centrale wrapper supabase/functions/_shared/anthropic-fetch.ts lopen.
//
// Doel: voorkomt dat skills/Edge Functions per ongeluk Helicone-routering missen
// door direct naar api.anthropic.com te fetchen of Anthropic SDK direct te
// instantiëren.
//
// Gebruik:
//   node scripts/audit-anthropic-calls.cjs
//   node scripts/audit-anthropic-calls.cjs <repo-root>
//
// Exit codes:
//   0 — schoon, geen directe call-sites gevonden
//   1 — er staan directe call-sites buiten de wrapper — fix vóór push
//
// Zie Confluence: Project — Token Cost Counter & Helicone-traces (450101261).
// =============================================================================

const { readdirSync, statSync, readFileSync, existsSync } = require('node:fs');
const { join, relative } = require('node:path');

const ROOT = process.argv[2]
  ? require('node:path').resolve(process.argv[2])
  : require('node:path').resolve(__dirname, '..');

const SKIP_DIRS = new Set([
  'node_modules', '.git', 'dist', 'build', '.vercel', '.next', 'out',
  '.vite', 'coverage', '.turbo',
]);

// Path is normalized to forward-slashes — works on Windows + POSIX.
const ALLOWED_PATHS = new Set([
  'supabase/functions/_shared/anthropic-fetch.ts',
  // audit-script zelf — heeft de patterns in de regex literals
  'scripts/audit-anthropic-calls.cjs',
]);

const PATTERNS = [
  { name: 'direct-fetch',  re: /https:\/\/api\.anthropic\.com/g },
  { name: 'sdk-import-js', re: /from\s+['"]@anthropic-ai\/sdk['"]/g },
  { name: 'new-Anthropic', re: /new\s+Anthropic\s*\(/g },
  { name: 'sdk-import-py', re: /^\s*(from\s+anthropic\b|import\s+anthropic\b)/gm },
];

const findings = [];

function walk(dir) {
  let entries;
  try { entries = readdirSync(dir); } catch { return; }
  for (const e of entries) {
    const p = join(dir, e);
    let st;
    try { st = statSync(p); } catch { continue; }
    if (st.isDirectory()) {
      if (SKIP_DIRS.has(e)) continue;
      walk(p);
    } else if (/\.(ts|tsx|js|jsx|mjs|cjs|py)$/.test(e)) {
      const rel = relative(ROOT, p).split('\\').join('/');
      if (ALLOWED_PATHS.has(rel)) continue;
      let text;
      try { text = readFileSync(p, 'utf8'); } catch { continue; }
      for (const pat of PATTERNS) {
        // Reset regex state because patterns use the /g flag.
        pat.re.lastIndex = 0;
        let m;
        while ((m = pat.re.exec(text)) !== null) {
          const line = text.slice(0, m.index).split('\n').length;
          findings.push({ file: rel, line, pattern: pat.name, match: m[0].trim() });
        }
      }
    }
  }
}

if (!existsSync(ROOT)) {
  console.error(`Root path does not exist: ${ROOT}`);
  process.exit(2);
}

walk(ROOT);

if (findings.length === 0) {
  console.log('audit-anthropic-calls: OK — geen directe Anthropic-aanroepen buiten _shared/anthropic-fetch.ts');
  process.exit(0);
}

console.log(`audit-anthropic-calls: FAIL — ${findings.length} directe call-site(s) gevonden:`);
for (const f of findings) {
  console.log(`  ${f.file}:${f.line}  [${f.pattern}]  ${f.match}`);
}
console.log('');
console.log('Fix: route via supabase/functions/_shared/anthropic-fetch.ts. Claude Code-sessies');
console.log('worden gelogd via scripts/parse-claude-session.cjs. Zie project 450101261.');
process.exit(1);
