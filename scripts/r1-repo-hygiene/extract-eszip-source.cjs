#!/usr/bin/env node
// Best-effort extract van user-source uit Supabase eszip-bundles.
// De bundle bevat externe imports + user code + sourcemaps. We zoeken het
// blok user-code op basis van markers (---EDGE-RUNTIME-METADATA--- en
// //# sourceMappingURL).
//
// Werkt goed voor single-file functions. Voor multi-file: zie de raw
// _bundle.eszip + _bundle_preview.txt.

const fs = require('fs')
const path = require('path')

const FN_DIR = path.resolve(__dirname, '../../supabase/functions')
const dirs = fs.readdirSync(FN_DIR).filter(n => {
  const p = path.join(FN_DIR, n)
  return fs.statSync(p).isDirectory()
    && !n.startsWith('_')
    && fs.existsSync(path.join(p, '_bundle.eszip'))
})

console.log(`Extracting from ${dirs.length} bundles\n`)

for (const slug of dirs) {
  const bundlePath = path.join(FN_DIR, slug, '_bundle.eszip')
  const buf = fs.readFileSync(bundlePath)
  const text = buf.toString('utf8')

  // 1. Find ---EDGE-RUNTIME-METADATA--- marker
  const mMarker = '---EDGE-RUNTIME-METADATA---'
  const mIdx = text.indexOf(mMarker)
  if (mIdx < 0) {
    console.log(`✗ ${slug}: no EDGE-RUNTIME-METADATA marker — skip`)
    continue
  }

  // 2. Search after marker for first plausible code start
  const after = text.slice(mIdx + mMarker.length)
  const startPatterns = [
    /\n\/\/ [A-Za-z0-9]/,     // line comment with content
    /\nimport \{/,             // ES import
    /\nimport \w/,
    /\nconst \w+ ?=/,
    /\nexport /,
    /\/\/ [A-Za-z0-9]/,        // top-level comment without leading newline
  ]
  let codeStart = -1
  for (const p of startPatterns) {
    const m = after.match(p)
    if (m && m.index !== undefined) {
      if (codeStart < 0 || m.index < codeStart) codeStart = m.index
    }
  }
  if (codeStart < 0) {
    console.log(`✗ ${slug}: no code start found — skip`)
    continue
  }

  let userText = after.slice(codeStart)

  // 3. Find end: last //# sourceMappingURL of user code
  // (the bundle has many sourcemap markers — last one is the user's index.ts map)
  const smIdx = userText.lastIndexOf('//# sourceMappingURL=')
  if (smIdx > 0) {
    // Cut after the sourcemap line
    const lineEnd = userText.indexOf('\n', smIdx)
    userText = userText.slice(0, lineEnd > 0 ? lineEnd : userText.length)
  }

  // 4. Sanity check: must contain reasonable amount of code
  if (userText.length < 200) {
    console.log(`✗ ${slug}: extracted only ${userText.length} chars — likely wrong region`)
    continue
  }

  // 5. Strip control chars from start/end (eszip metadata noise)
  userText = userText
    .replace(/^[\x00-\x08\x0B\x0C\x0E-\x1F]+/, '')
    .replace(/[\x00-\x08\x0B\x0C\x0E-\x1F]+$/, '')
    .trim()

  // 6. Sanity: should look like TS/JS
  const hasImport = /\bimport\s/.test(userText)
  const hasFunction = /\bfunction\s|\bconst\s|\bclass\s|\basync\s/.test(userText)
  if (!hasImport && !hasFunction) {
    console.log(`✗ ${slug}: extracted text doesn't look like code`)
    continue
  }

  // 7. Write to index.ts (with extraction-marker on top)
  const out = `// =============================================================================
// Best-effort extracted from Supabase eszip bundle on ${new Date().toISOString().slice(0, 10)}
// Bundle (binary) + raw preview blijven in deze directory voor referentie.
// Bij twijfel over completeness: pull origineel via \`supabase functions download ${slug}\`.
// =============================================================================

${userText}
`
  fs.writeFileSync(path.join(FN_DIR, slug, 'index.ts'), out)
  console.log(`✓ ${slug}: ${userText.length} chars → index.ts`)
}

console.log('\nDone.')
