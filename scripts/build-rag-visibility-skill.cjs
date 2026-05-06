// Build rag-visibility.skill ZIP from /tmp/rag-visibility-skill staging dir
// and place on Desktop. Validates description ≤ 1024 chars + path safety.
const fs = require('fs');
const path = require('path');
const archiver = require('archiver');

// Both Write-tool path AND fallback Windows path
const candidateSrcs = ['/tmp/rag-visibility-skill', 'C:/tmp/rag-visibility-skill'];
let SRC = null;
for (const p of candidateSrcs) {
  try { fs.statSync(path.join(p, 'SKILL.md')); SRC = p; break; } catch {}
}
if (!SRC) {
  console.error('Source not found in any candidate path');
  process.exit(1);
}
console.log('SRC =', SRC);

const DEST = 'C:/Users/LM/Desktop/rag-visibility.skill';

// 1. Validate description ≤ 1024 chars
const skillMd = fs.readFileSync(path.join(SRC, 'SKILL.md'), 'utf8');
const fmMatch = skillMd.match(/^---\n([\s\S]*?)\n---/);
if (!fmMatch) { console.error('FAIL: no frontmatter'); process.exit(1); }
const descMatch = fmMatch[1].match(/description:\s*>\n([\s\S]*?)(?=\n[a-z_]+:|$)/);
const descText = descMatch ? descMatch[1].trim() : '';
console.log('description chars:', descText.length, '(max 1024)');
if (descText.length > 1024) { console.error('FAIL: description too long'); process.exit(1); }

// 2. Validate path safety — no invalid chars in DEST
const invalidChars = /[<>:"|?*]/;
const filename = path.basename(DEST);
if (invalidChars.test(filename)) { console.error('FAIL: invalid chars'); process.exit(1); }

// 3. Validate destination is reachable
const destDir = path.dirname(DEST);
if (!fs.existsSync(destDir)) { console.error('FAIL: Desktop not found at', destDir); process.exit(1); }

// 4. Build ZIP
const output = fs.createWriteStream(DEST);
const archive = archiver('zip', { zlib: { level: 9 } });

output.on('close', () => {
  console.log('✓ Built:', DEST);
  console.log('  Size:', archive.pointer(), 'bytes');
  const stats = fs.statSync(DEST);
  console.log('  Created:', stats.mtime.toISOString());
});

archive.on('error', err => { throw err; });
archive.on('warning', err => { if (err.code !== 'ENOENT') throw err; });
archive.pipe(output);

// Single .skill file = ZIP with SKILL.md at root + references/ folder
archive.file(path.join(SRC, 'SKILL.md'), { name: 'SKILL.md' });
archive.directory(path.join(SRC, 'references'), 'references');

archive.finalize();
