#!/usr/bin/env node
// =============================================================================
// extract-eszip-sourcemap.cjs — haalt de ORIGINELE source uit een Supabase
// eszip-bundle via de meegebakken sourcemap.
// =============================================================================
// Waarom dit bestaat (security review 2026-09-02, F-14):
//   pull-edge-functions.sh schrijft de rauwe eszip-bytes naar index.ts. Dat is
//   een binair archief, geen source: niet reviewbaar en levensgevaarlijk om
//   terug te deployen. extract-eszip-source.cjs doet een best-effort tekstknip
//   op markers.
//
//   Maar de eszip bevat per module een sourcemap met `sourcesContent` — en dat
//   is byte-exact de originele TypeScript. Die halen we hier op. Dat is precies
//   wat de hard-rule "repo-file 1:1" nodig heeft: geen reconstructie.
//
// Gebruik:
//   node scripts/r1-repo-hygiene/extract-eszip-sourcemap.cjs <dir-met-eszips> [outdir]
//
//   <dir> mag een map met per-function subdirs zijn (elk met index.ts die
//   in werkelijkheid een eszip is), of één bestand.
// =============================================================================

const fs = require('fs')
const path = require('path')

function extractSources(buf) {
  const text = buf.toString('latin1')
  const out = []
  // Sourcemaps staan als losse JSON-objecten in de bundle. Zoek elk
  // {"version":3,...} blok en parse het met een balans-scan op accolades.
  let idx = 0
  while (true) {
    const start = text.indexOf('{"version":3', idx)
    if (start < 0) break
    let depth = 0
    let inStr = false
    let esc = false
    let end = -1
    for (let i = start; i < text.length; i++) {
      const ch = text[i]
      if (inStr) {
        if (esc) { esc = false; continue }
        if (ch === '\\') { esc = true; continue }
        if (ch === '"') inStr = false
        continue
      }
      if (ch === '"') { inStr = true; continue }
      if (ch === '{') depth++
      else if (ch === '}') {
        depth--
        if (depth === 0) { end = i + 1; break }
      }
    }
    if (end < 0) break
    const raw = Buffer.from(text.slice(start, end), 'latin1').toString('utf8')
    try {
      const map = JSON.parse(raw)
      const sources = map.sources || []
      const contents = map.sourcesContent || []
      sources.forEach((src, i) => {
        if (typeof contents[i] === 'string' && contents[i].length > 0) {
          out.push({ source: src, content: contents[i] })
        }
      })
    } catch { /* geen geldige sourcemap — volgende */ }
    idx = end
  }
  return out
}

function main() {
  const target = process.argv[2]
  const outDir = process.argv[3] || null
  if (!target) {
    console.error('gebruik: node extract-eszip-sourcemap.cjs <dir|file> [outdir]')
    process.exit(2)
  }
  const st = fs.statSync(target)
  const jobs = []
  if (st.isFile()) {
    jobs.push({ slug: path.basename(path.dirname(target)), file: target })
  } else {
    for (const name of fs.readdirSync(target)) {
      const p = path.join(target, name)
      if (!fs.statSync(p).isDirectory()) continue
      for (const cand of ['index.ts', '_bundle.eszip']) {
        const f = path.join(p, cand)
        if (fs.existsSync(f)) { jobs.push({ slug: name, file: f }); break }
      }
    }
  }

  let ok = 0
  let fail = 0
  for (const job of jobs) {
    const buf = fs.readFileSync(job.file)
    if (buf.length < 64) {
      console.log(`✗ ${job.slug}: bundle is ${buf.length} bytes — leeg, niets te extraheren`)
      fail++
      continue
    }
    const found = extractSources(buf)
    // Alleen de user-source, niet de meegebundelde npm-modules. Sommige
    // bundles prefixen met de runtime-map (user_fn_<ref>_<uuid>_<n>/).
    const user = found
      .filter(f => /(^|\/)(source|_shared)\//.test(f.source))
      .map(f => ({
        ...f,
        source: f.source.replace(/^.*?(source|_shared)\//, (_m, g) => g + '/'),
      }))
    if (user.length === 0) {
      console.log(`✗ ${job.slug}: geen source/*-sourcemap gevonden (${found.length} maps totaal)`)
      fail++
      continue
    }
    for (const u of user) {
      const rel = u.source.startsWith('_shared/')
        ? path.join('..', u.source)
        : u.source.replace(/^source\//, '')
      const dest = outDir
        ? path.join(outDir, job.slug, rel)
        : path.join(path.dirname(job.file), rel)
      fs.mkdirSync(path.dirname(dest), { recursive: true })
      fs.writeFileSync(dest, u.content)
      console.log(`✓ ${job.slug}: ${rel} (${u.content.length} tekens) → ${path.relative(process.cwd(), dest)}`)
    }
    ok++
  }
  console.log(`\nklaar: ${ok} bundles geëxtraheerd, ${fail} mislukt`)
}

main()
