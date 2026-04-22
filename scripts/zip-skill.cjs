// Pure-Node zip creator — maakt een .skill (=zip) bundle van een skill-folder.
// Nodig omdat PowerShell Compress-Archive in deze sandbox geen schrijfrechten
// krijgt en er geen zip/7z binary beschikbaar is.
//
// Gebruik: node zip-skill.cjs <source-folder> <output-path>
const fs = require('fs')
const path = require('path')
const zlib = require('zlib')

const [, , src, out] = process.argv
if (!src || !out) {
  console.error('usage: zip-skill.cjs <source-folder> <output-path>')
  process.exit(2)
}

function walk(dir, base = '') {
  const entries = []
  for (const name of fs.readdirSync(dir)) {
    const full = path.join(dir, name)
    const rel = base ? `${base}/${name}` : name
    const st = fs.statSync(full)
    if (st.isDirectory()) {
      entries.push(...walk(full, rel))
    } else {
      entries.push({ rel, full, mtime: st.mtime })
    }
  }
  return entries
}

function crc32(buf) {
  // PKZIP CRC32 — lazy table init.
  if (!crc32.table) {
    const t = new Uint32Array(256)
    for (let n = 0; n < 256; n++) {
      let c = n
      for (let k = 0; k < 8; k++) c = (c & 1) ? (0xedb88320 ^ (c >>> 1)) : (c >>> 1)
      t[n] = c >>> 0
    }
    crc32.table = t
  }
  let c = 0xffffffff
  for (let i = 0; i < buf.length; i++) c = crc32.table[(c ^ buf[i]) & 0xff] ^ (c >>> 8)
  return (c ^ 0xffffffff) >>> 0
}

function dosTime(d) {
  const h = d.getHours(), m = d.getMinutes(), s = Math.floor(d.getSeconds() / 2)
  return (h << 11) | (m << 5) | s
}
function dosDate(d) {
  const y = d.getFullYear() - 1980, mo = d.getMonth() + 1, day = d.getDate()
  return (y << 9) | (mo << 5) | day
}

const folderName = path.basename(src.replace(/[\\\/]+$/, ''))
const srcAbs = path.resolve(src)
const files = walk(srcAbs).map(f => ({ ...f, rel: `${folderName}/${f.rel}` }))

const chunks = []
const centralDir = []
let offset = 0

for (const f of files) {
  const data = fs.readFileSync(f.full)
  const compressed = zlib.deflateRawSync(data)
  const crc = crc32(data)
  const nameBuf = Buffer.from(f.rel, 'utf8')

  const localHeader = Buffer.alloc(30)
  localHeader.writeUInt32LE(0x04034b50, 0)
  localHeader.writeUInt16LE(20, 4)     // version needed
  localHeader.writeUInt16LE(0x0800, 6) // flags — bit 11 utf8
  localHeader.writeUInt16LE(8, 8)      // method deflate
  localHeader.writeUInt16LE(dosTime(f.mtime), 10)
  localHeader.writeUInt16LE(dosDate(f.mtime), 12)
  localHeader.writeUInt32LE(crc, 14)
  localHeader.writeUInt32LE(compressed.length, 18)
  localHeader.writeUInt32LE(data.length, 22)
  localHeader.writeUInt16LE(nameBuf.length, 26)
  localHeader.writeUInt16LE(0, 28)

  chunks.push(localHeader, nameBuf, compressed)

  centralDir.push({
    name: nameBuf, crc,
    compSize: compressed.length, rawSize: data.length,
    mtime: f.mtime, offset,
  })

  offset += localHeader.length + nameBuf.length + compressed.length
}

const cdStart = offset
for (const e of centralDir) {
  const h = Buffer.alloc(46)
  h.writeUInt32LE(0x02014b50, 0)
  h.writeUInt16LE(0x031E, 4)  // made-by: unix, v3.0
  h.writeUInt16LE(20, 6)      // version needed
  h.writeUInt16LE(0x0800, 8)  // flags utf8
  h.writeUInt16LE(8, 10)      // method
  h.writeUInt16LE(dosTime(e.mtime), 12)
  h.writeUInt16LE(dosDate(e.mtime), 14)
  h.writeUInt32LE(e.crc, 16)
  h.writeUInt32LE(e.compSize, 20)
  h.writeUInt32LE(e.rawSize, 24)
  h.writeUInt16LE(e.name.length, 28)
  h.writeUInt16LE(0, 30)
  h.writeUInt16LE(0, 32)
  h.writeUInt16LE(0, 34)
  h.writeUInt16LE(0, 36)
  h.writeUInt32LE(0, 38) // external attrs
  h.writeUInt32LE(e.offset, 42)
  chunks.push(h, e.name)
  offset += h.length + e.name.length
}
const cdSize = offset - cdStart

const eocd = Buffer.alloc(22)
eocd.writeUInt32LE(0x06054b50, 0)
eocd.writeUInt16LE(0, 4)
eocd.writeUInt16LE(0, 6)
eocd.writeUInt16LE(centralDir.length, 8)
eocd.writeUInt16LE(centralDir.length, 10)
eocd.writeUInt32LE(cdSize, 12)
eocd.writeUInt32LE(cdStart, 16)
eocd.writeUInt16LE(0, 20)
chunks.push(eocd)

fs.writeFileSync(out, Buffer.concat(chunks))
console.log(`wrote ${out} (${files.length} files, ${Buffer.concat(chunks).length} bytes)`)
