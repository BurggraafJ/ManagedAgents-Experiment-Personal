// =============================================================================
// edge-bundle.cjs — lees de GEDEPLOYDE bundel van een Edge Function
// =============================================================================
// Waarom dit bestaat: M3 in `multi_user_acl_eval.cjs` las tot v1.218 de
// repo-bron van een `verify_jwt`-functie. Dat meet de verkeerde kant. Op
// 2026-09-14 stond die poort zeven uur groen terwijl productie de óngepoorte
// bundels draaide — de repo had de poort, de deploy niet (SECURITY-READY §1,
// S11). Een poort die de repo leest bewijst dat iemand de regel heeft
// opgeschreven, niet dat hij aanstaat.
//
// De Management API geeft de gedeployde eszip terug op
// `GET /v1/projects/{ref}/functions/{slug}/body`. Gemeten op 2026-09-15: die
// bytes beginnen met `ESZIP2.3` en de module-bronnen zitten er ONGECOMPRIMEERD
// in (geen gzip-member in het hele bestand, 44 kB – 2,1 MB per functie). We
// hoeven dus niets uit te pakken: `latin1` erover en zoeken. Geheugen
// `edge-bundle-source-recovery` zegt hetzelfde vanaf de sourcemap-kant.
//
// ⚠ latin1, niet utf8. De eszip is binair; utf8-decoding vervangt ongeldige
// reeksen door U+FFFD en kan dan midden in een token snijden. latin1 is
// byte-voor-byte omkeerbaar, en de tokens die we zoeken zijn ASCII.
//
// Cache: per (slug, version), want een bundel is onveranderlijk zolang de
// versie niet opschuift. Alleen de UITKOMST wordt bewaard (welke tokens erin
// staan, hoeveel bytes), nooit de bundel zelf — die hoort niet op schijf rond
// te slingeren en is bij een volgende versie toch waardeloos.
// =============================================================================
const fs = require('fs');
const os = require('os');
const path = require('path');

const CACHE_DIR = path.join(os.tmpdir(), 'legal-mind-edge-bundle-cache');
const TIMEOUT_MS = 30_000;
const POGINGEN = 2;          // één herkansing; daarna is het rood mét reden

function cachePad(ref, slug, version) {
  return path.join(CACHE_DIR, `${ref}__${slug}__v${version}.json`);
}

/**
 * Haalt de gedeployde bundel op en past `probes` erop toe.
 *
 * @param {object}   o
 * @param {string}   o.ref      project-ref
 * @param {string}   o.token    management-token
 * @param {string}   o.slug     functie-slug
 * @param {number}   o.version  gedeployde versie (de cache-sleutel)
 * @param {(tekst: string) => object} o.probes  krijgt de bundel als latin1-string
 *                 en geeft een JSON-bare uitkomst terug (booleans, arrays, getallen)
 * @param {boolean} [o.geenCache]
 * @returns {Promise<{ok: true, bytes: number, uit: object, uitCache: boolean}
 *                  | {ok: false, reden: string}>}
 *
 * Faalt NOOIT stil: kan de bundel niet gelezen worden, dan komt er
 * `{ok:false, reden}` terug en is het aan de aanroeper om dat rood te maken.
 * Een onbereikbare bundel is geen bewijs dat de poort erin zit.
 */
async function leesBundel({ ref, token, slug, version, probes, geenCache = false }) {
  const pad = cachePad(ref, slug, version);
  if (!geenCache) {
    try {
      const c = JSON.parse(fs.readFileSync(pad, 'utf8'));
      if (c && c.probeVersie === probes.versie) {
        return { ok: true, bytes: c.bytes, uit: c.uit, uitCache: true };
      }
    } catch { /* geen cache = gewoon ophalen */ }
  }

  let laatste = '';
  for (let poging = 1; poging <= POGINGEN; poging++) {
    try {
      const r = await fetch(`https://api.supabase.com/v1/projects/${ref}/functions/${slug}/body`, {
        headers: { Authorization: `Bearer ${token}`, 'User-Agent': 'legal-mind-dashboard-claude/1.0' },
        signal: AbortSignal.timeout(TIMEOUT_MS),
      });
      if (!r.ok) { laatste = `HTTP ${r.status}`; continue; }
      const buf = Buffer.from(await r.arrayBuffer());
      if (buf.length < 16 || buf.slice(0, 5).toString('latin1') !== 'ESZIP') {
        // Geen eszip = we weten niet wát we lezen. Doorgaan zou de tokens in een
        // foutpagina kunnen zoeken en stil groen worden.
        laatste = `geen eszip (${buf.slice(0, 12).toString('latin1').replace(/[^\x20-\x7e]/g, '.')})`;
        continue;
      }
      const uit = probes(buf.toString('latin1'));
      try {
        fs.mkdirSync(CACHE_DIR, { recursive: true });
        fs.writeFileSync(pad, JSON.stringify({ bytes: buf.length, uit, probeVersie: probes.versie }));
      } catch { /* cache is comfort, geen eis */ }
      return { ok: true, bytes: buf.length, uit, uitCache: false };
    } catch (e) {
      laatste = (e && e.name === 'TimeoutError') ? `timeout na ${TIMEOUT_MS / 1000}s` : String(e && e.message || e).slice(0, 60);
    }
  }
  return { ok: false, reden: laatste || 'onbekend' };
}

/** Kleine pool zodat 19 bundels niet 19 keer achter elkaar wachten. */
async function inPool(items, n, fn) {
  const uit = new Array(items.length);
  let i = 0;
  await Promise.all(Array.from({ length: Math.min(n, items.length) }, async () => {
    while (i < items.length) { const k = i++; uit[k] = await fn(items[k], k); }
  }));
  return uit;
}

module.exports = { leesBundel, inPool, CACHE_DIR };
