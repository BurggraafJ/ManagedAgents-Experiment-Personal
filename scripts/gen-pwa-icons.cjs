#!/usr/bin/env node
// Rasteriseert de PWA-iconen in public/ naar PNG via headless Chrome.
//
//   node scripts/gen-pwa-icons.cjs            → schrijft de PNG's in public/
//   node scripts/gen-pwa-icons.cjs --sheet    → ook een contactvel (home-screen-preview)
//
// Waarom PNG naast SVG: iOS negeert een SVG als apple-touch-icon en toont dan
// een grijze schermafdruk op het beginscherm. Android/Chrome willen voor de
// manifest-iconen ook liever PNG (192/512 + maskable). De SVG's in public/
// blijven de bron; draai dit script na élke wijziging aan pwa-icon*.svg.
//
// Geen sharp/resvg op deze box, wél google-chrome. Chrome mist ~1 op 3 shots
// (leeg bestand), dus elke render heeft een retry-lus.
const fs = require('node:fs')
const path = require('node:path')
const os = require('node:os')
const { spawnSync } = require('node:child_process')

const ROOT = path.resolve(__dirname, '..')
const PUBLIC = path.join(ROOT, 'public')
const CHROME = process.env.CHROME_BIN || 'google-chrome'
const TMP = fs.mkdtempSync(path.join(process.env.CLAUDE_JOB_DIR ? path.join(process.env.CLAUDE_JOB_DIR, 'tmp') : os.tmpdir(), 'pwa-icons-'))

// { uitvoer, bron-SVG, pixelmaat }
const TARGETS = [
  // iOS knipt zelf de hoeken → full-bleed (maskable-bron), vast 180×180.
  { out: 'apple-touch-icon.png', src: 'pwa-icon-maskable.svg', size: 180 },
  // Manifest 'any': afgeronde hoeken met transparante buitenrand.
  { out: 'pwa-192.png',          src: 'pwa-icon.svg',          size: 192 },
  { out: 'pwa-512.png',          src: 'pwa-icon.svg',          size: 512 },
  // Manifest 'maskable': full-bleed, het OS legt zijn eigen masker.
  { out: 'pwa-maskable-512.png', src: 'pwa-icon-maskable.svg', size: 512 },
]

function shoot(html, w, h, outPng, attempts = 4) {
  const htmlPath = path.join(TMP, `${path.basename(outPng, '.png')}.html`)
  fs.writeFileSync(htmlPath, html)
  for (let i = 1; i <= attempts; i++) {
    fs.rmSync(outPng, { force: true })
    const r = spawnSync(CHROME, [
      '--headless=new', '--no-sandbox', '--disable-gpu', '--hide-scrollbars',
      '--default-background-color=00000000',
      `--user-data-dir=${path.join(TMP, `ud-${i}`)}`,
      `--window-size=${w},${h}`,
      `--screenshot=${outPng}`,
      `file://${htmlPath}`,
    ], { encoding: 'utf8', timeout: 60_000 })
    const size = fs.existsSync(outPng) ? fs.statSync(outPng).size : 0
    if (r.status === 0 && size > 200) return size
    process.stderr.write(`  retry ${i}/${attempts} voor ${path.basename(outPng)} (status ${r.status}, ${size} B)\n`)
  }
  throw new Error(`Chrome leverde geen bruikbare PNG voor ${outPng}`)
}

function iconHtml(svgFile, size) {
  const svg = fs.readFileSync(path.join(PUBLIC, svgFile), 'utf8')
  return `<!doctype html><html><head><meta charset="utf-8"><style>
    html,body{margin:0;padding:0;background:transparent;width:${size}px;height:${size}px;overflow:hidden}
    svg{display:block;width:${size}px;height:${size}px}
  </style></head><body>${svg}</body></html>`
}

// Contactvel: hoe het icoon er op een iOS-beginscherm (60 pt) en in de
// Android-lade (48 dp) uitziet, op donker en licht, plus de 180-versie groot.
function sheetHtml() {
  const svgAny = fs.readFileSync(path.join(PUBLIC, 'pwa-icon.svg'), 'utf8')
  const svgFull = fs.readFileSync(path.join(PUBLIC, 'pwa-icon-maskable.svg'), 'utf8')
  const fav = fs.readFileSync(path.join(PUBLIC, 'favicon.svg'), 'utf8')
  const tile = (bg, fg) => `
    <div class="tile" style="background:${bg};color:${fg}">
      <div class="app"><div class="ios">${svgFull}</div><span>Maestro</span></div>
      <div class="app"><div class="android">${svgFull}</div><span>Maestro</span></div>
      <div class="app"><div class="tab">${fav}<b>Maestro</b></div><span>tab</span></div>
    </div>`
  return `<!doctype html><html><head><meta charset="utf-8"><style>
    body{margin:0;width:720px;height:420px;background:#f5f4f0;font:500 12px "Instrument Sans",system-ui,sans-serif;display:grid;grid-template-columns:1fr 1fr;grid-template-rows:200px 220px}
    .tile{display:flex;gap:36px;align-items:center;justify-content:center;padding:16px}
    .app{display:flex;flex-direction:column;align-items:center;gap:8px}
    .ios{width:60px;height:60px;border-radius:13.5px;overflow:hidden}
    .android{width:48px;height:48px;border-radius:50%;overflow:hidden}
    .ios svg,.android svg{display:block;width:100%;height:100%}
    .tab{display:flex;align-items:center;gap:6px;padding:6px 10px;border-radius:8px;background:rgba(255,255,255,.7);color:#121212}
    .tab svg{width:16px;height:16px}
    .big{grid-column:1/3;display:flex;gap:32px;align-items:center;justify-content:center;background:#fff}
    .big svg{display:block}
    .big .a{width:180px;height:180px} .big .b{width:120px;height:120px} .big .c{width:32px;height:32px}
  </style></head><body>
    ${tile('#0e0e10', '#f4f4f4')}
    ${tile('#e9eef7', '#121212')}
    <div class="big"><div class="a">${svgFull}</div><div class="b">${svgAny}</div><div class="c">${fav}</div></div>
  </body></html>`
}

for (const t of TARGETS) {
  const out = path.join(PUBLIC, t.out)
  const bytes = shoot(iconHtml(t.src, t.size), t.size, t.size, out)
  console.log(`✓ ${t.out}  ${t.size}×${t.size}  ${bytes} B  (uit ${t.src})`)
}

if (process.argv.includes('--sheet')) {
  const out = path.join(TMP, 'contact-sheet.png')
  shoot(sheetHtml(), 720, 420, out)
  console.log(`✓ contactvel → ${out}`)
}
