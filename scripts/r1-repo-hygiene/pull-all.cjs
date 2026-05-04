#!/usr/bin/env node
// =============================================================================
// R.1 — Pull all missing edge functions + RAG-RPC's (Node, geen jq nodig)
// =============================================================================
// Gebruikt SUPABASE_MANAGEMENT_TOKEN uit env. Project-ref ezxihctobrqoklufawim.
//
// 1. Edge functions: list → vergelijk met repo → pull missende → schrijf
//    naar supabase/functions/<slug>/{index.ts,README.md,deno.json}
// 2. RAG RPC's: pg_get_functiondef per known RPC → schrijf migration-bestand
//
// Run: node scripts/r1-repo-hygiene/pull-all.cjs
// =============================================================================

const fs = require('fs')
const path = require('path')
const https = require('https')
const zlib = require('zlib')

const TOKEN = process.env.SUPABASE_MANAGEMENT_TOKEN
const PROJECT_REF = 'ezxihctobrqoklufawim'
const API = `https://api.supabase.com/v1/projects/${PROJECT_REF}`
const REPO_ROOT = path.resolve(__dirname, '../..')
const FN_DIR = path.join(REPO_ROOT, 'supabase/functions')
const MIG_DIR = path.join(REPO_ROOT, 'migrations')

if (!TOKEN) { console.error('SUPABASE_MANAGEMENT_TOKEN missing'); process.exit(1) }

function req(url, opts = {}) {
  return new Promise((resolve, reject) => {
    const u = new URL(url)
    const r = https.request({
      hostname: u.hostname, path: u.pathname + u.search, method: opts.method || 'GET',
      headers: { 'Authorization': `Bearer ${TOKEN}`, 'Content-Type': 'application/json', ...(opts.headers || {}) },
    }, res => {
      const chunks = []
      res.on('data', c => chunks.push(c))
      res.on('end', () => {
        const buf = Buffer.concat(chunks)
        if (res.statusCode >= 400) return reject(new Error(`HTTP ${res.statusCode} on ${u.pathname}: ${buf.slice(0, 500)}`))
        resolve({ buf, headers: res.headers, status: res.statusCode })
      })
    })
    r.on('error', reject)
    if (opts.body) r.write(opts.body)
    r.end()
  })
}

async function pullEdgeFunctions() {
  console.log('\n=== EDGE FUNCTIONS ===\n')

  const list = JSON.parse((await req(`${API}/functions`)).buf.toString())
  console.log(`Live functions: ${list.length}`)

  const inRepo = new Set(fs.existsSync(FN_DIR)
    ? fs.readdirSync(FN_DIR).filter(n => fs.statSync(path.join(FN_DIR, n)).isDirectory() && !n.startsWith('_'))
    : [])

  const missing = list.filter(f => !inRepo.has(f.slug))
  if (missing.length === 0) {
    console.log('✓ All functions already in repo')
    return { pulled: [], failed: [] }
  }

  console.log(`Missing in repo: ${missing.length}`)
  missing.forEach(f => console.log(`  - ${f.slug} (v${f.version})`))

  const pulled = []
  const failed = []

  for (const fn of missing) {
    const slug = fn.slug
    console.log(`\n→ ${slug}`)
    const dir = path.join(FN_DIR, slug)
    fs.mkdirSync(dir, { recursive: true })

    try {
      // Body endpoint geeft bij Supabase een eszip-bundle (binary) of JSON met files-array
      const bodyRes = await req(`${API}/functions/${slug}/body`)
      const ct = bodyRes.headers['content-type'] || ''

      if (ct.includes('application/json')) {
        // Multi-file JSON
        const j = JSON.parse(bodyRes.buf.toString())
        const files = j.files || j
        if (Array.isArray(files)) {
          for (const file of files) {
            const fp = path.join(dir, file.name || 'index.ts')
            fs.mkdirSync(path.dirname(fp), { recursive: true })
            fs.writeFileSync(fp, file.content || file.body || '')
            console.log(`  + ${file.name}`)
          }
        } else {
          // Object met file-name → content
          for (const [name, content] of Object.entries(files)) {
            const fp = path.join(dir, name)
            fs.mkdirSync(path.dirname(fp), { recursive: true })
            fs.writeFileSync(fp, typeof content === 'string' ? content : JSON.stringify(content, null, 2))
            console.log(`  + ${name}`)
          }
        }
      } else if (ct.includes('eszip') || ct.includes('octet-stream') || bodyRes.buf[0] === 0x45) {
        // Eszip bundle — schrijf raw + extract-poging
        fs.writeFileSync(path.join(dir, '_bundle.eszip'), bodyRes.buf)
        console.log(`  + _bundle.eszip (${bodyRes.buf.length} bytes) — needs eszip-extract for full source`)
        // Probeer met deno_emit/deno-eszip te decoderen — niet beschikbaar in node alleen
        // Dump raw met markers zodat reviewer ziet wat erin zit
        const printable = bodyRes.buf.toString('utf8').replace(/[^\x09\x0a\x0d\x20-\x7e]/g, '·')
        fs.writeFileSync(path.join(dir, '_bundle_preview.txt'), printable.slice(0, 50000))
      } else {
        // Plain text body
        fs.writeFileSync(path.join(dir, 'index.ts'), bodyRes.buf.toString())
        console.log(`  + index.ts (plain, ${bodyRes.buf.length} bytes)`)
      }

      // README
      const readme = `# ${slug}

> **Gepulled uit live Supabase op ${new Date().toISOString().slice(0, 10)}** als onderdeel van Fase R.1 (Repo-hygiëne).
> Project — Intelligence Architecture (zie \`skills/datascience/references/current_architecture.md\`).

## Metadata bij pull

| Veld | Waarde |
|---|---|
| Slug | \`${slug}\` |
| Versie (Supabase) | ${fn.version || '?'} |
| Status | ${fn.status || '?'} |
| Aangemaakt | ${fn.created_at || '?'} |
| Laatste update (live) | ${fn.updated_at || '?'} |
| verify_jwt | ${fn.verify_jwt ?? '?'} |
| entrypoint | ${fn.entrypoint_path || 'index.ts'} |

## Wat doet deze function?

> _TODO bij review:_ vul deze sectie in met een korte beschrijving van wat de function doet, hoe vaak ze draait, en welke tabellen ze raakt.

## Cron / triggers

> _TODO_

## Schema-impact

> _TODO_

## Source-of-truth

Deze repo is per ${fn.updated_at || new Date().toISOString().slice(0, 10)} (laatste live update) de source-of-truth.
Toekomstige wijzigingen: edit hier + redeploy via Supabase Management API of \`supabase functions deploy ${slug}\`.
`
      fs.writeFileSync(path.join(dir, 'README.md'), readme)
      console.log(`  + README.md`)

      // deno.json default als die er nog niet is
      const denoPath = path.join(dir, 'deno.json')
      if (!fs.existsSync(denoPath)) {
        fs.writeFileSync(denoPath, JSON.stringify({
          imports: { '@supabase/supabase-js': 'https://esm.sh/@supabase/supabase-js@2' }
        }, null, 2))
        console.log(`  + deno.json (default)`)
      }

      pulled.push(slug)
    } catch (err) {
      console.error(`  ✗ ${slug} failed:`, err.message)
      failed.push({ slug, error: err.message })
    }
  }

  return { pulled, failed }
}

async function pullRagRpcs() {
  console.log('\n=== RAG RPC SNAPSHOT ===\n')

  const RPCS = [
    'match_all_sources',
    'match_chunks',
    'sync_health',
    'sync_health_all',
    'assert_freshness',
    'match_jellemind_lessons',
    'submit_jellemind_decision',
    'get_skill_secret_service',
    'search_contactpersonen',
    'suggest_task_project',
    'detect_task_completion_candidates',
    'strip_html_inline',
    'autodraft_purge_old_mails',
    'submit_autodraft_decision',
    'trigger_autodraft_scan',
    'trigger_autodraft_execute',
    'reset_autodraft_mail_to_pending',
    'set_autodraft_mail_category',
    'set_autodraft_target_folder',
    'accept_autodraft_category_proposal',
    'reject_autodraft_category_proposal',
    'accept_autodraft_lesson_proposal',
    'reject_autodraft_lesson_proposal',
    'upsert_autodraft_category',
  ]

  fs.mkdirSync(MIG_DIR, { recursive: true })
  const stamp = new Date().toISOString().slice(0, 10).replace(/-/g, '_')
  const file = path.join(MIG_DIR, `rag_rpcs_documentation_${stamp}.sql`)

  let out = `-- =============================================================================
-- RAG RPC documentation snapshot
-- Gegenereerd: ${new Date().toISOString()}
-- Onderdeel van Fase R.1 (Repo-hygiëne) — zie current_architecture.md §7
-- =============================================================================
--
-- DOEL: single source of truth voor RPC-definities die de Intelligence-stack
-- draaiend houden. Eerder leefden deze in Supabase Studio zonder versie-controle.
-- Vanaf nu: edit dit bestand → \`supabase db push\` (of via Management API).
--
-- BIJWERKEN bij wijziging: edit de relevante CREATE OR REPLACE en commit.
-- Niet opnieuw genereren — dat overschrijft handmatige verbeteringen.
-- =============================================================================

`

  let found = 0
  let missing = 0

  for (const rpc of RPCS) {
    const sql = `SELECT
  pg_get_function_identity_arguments(p.oid) AS args,
  pg_get_functiondef(p.oid) AS def
FROM pg_proc p JOIN pg_namespace n ON p.pronamespace = n.oid
WHERE n.nspname = 'public' AND p.proname = '${rpc}'
ORDER BY p.oid`

    try {
      const res = await req(`${API}/database/query`, {
        method: 'POST',
        body: JSON.stringify({ query: sql }),
      })
      const rows = JSON.parse(res.buf.toString())
      if (!Array.isArray(rows) || rows.length === 0) {
        console.log(`  ⚠ ${rpc}: not found`)
        out += `\n-- ${'='.repeat(77)}\n-- ${rpc}: NOT FOUND on ${stamp}\n-- ${'='.repeat(77)}\n\n`
        missing++
      } else {
        console.log(`  + ${rpc}: ${rows.length} overload(s)`)
        out += `\n-- ${'='.repeat(77)}\n-- ${rpc}\n-- ${'='.repeat(77)}\n`
        for (const r of rows) {
          out += `\n-- args: ${r.args}\n${r.def};\n`
        }
        found++
      }
    } catch (err) {
      console.error(`  ✗ ${rpc}: query error: ${err.message}`)
      out += `\n-- ${rpc}: QUERY ERROR — ${err.message}\n\n`
    }
  }

  fs.writeFileSync(file, out)
  console.log(`\n✓ Migration: ${file}`)
  console.log(`  Found: ${found}, Missing: ${missing}`)
  return { file, found, missing }
}

;(async () => {
  console.log(`R.1 pull starting — project ${PROJECT_REF}`)
  console.log(`Repo: ${REPO_ROOT}`)

  const ef = await pullEdgeFunctions()
  const rpc = await pullRagRpcs()

  // Log
  const logPath = path.join(__dirname, `pulled_log_${new Date().toISOString().slice(0, 10)}.json`)
  fs.writeFileSync(logPath, JSON.stringify({
    timestamp: new Date().toISOString(),
    project_ref: PROJECT_REF,
    edge_functions: ef,
    rpcs: rpc,
  }, null, 2))

  console.log('\n================================================================')
  console.log('R.1 PULL DONE')
  console.log(`  Edge functions pulled: ${ef.pulled.length}`)
  console.log(`  Edge functions failed: ${ef.failed.length}`)
  console.log(`  RPC's documented:      ${rpc.found}`)
  console.log(`  RPC's missing:         ${rpc.missing}`)
  console.log(`  Log: ${logPath}`)
  console.log('================================================================')
})().catch(e => { console.error('FATAL:', e); process.exit(1) })
