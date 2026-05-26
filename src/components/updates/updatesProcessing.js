// updatesProcessing — pure helpers voor classificatie, module-mapping,
// periode-grouping en de transformatie van rauwe platform_updates-dagen
// naar het view-model dat UpdatesTimeline rendert. Geen JSX, geen React.

// ---------- Classify ----------

const SMALL_PREFIX_RE = /^(fix|style|chore|refactor|polish|docs|test|cleanup|tweak|nit|build|ci|deps|typo)[:(]/i

export function isSmallCommit(c) {
  const msg = c?.message || ''
  if (SMALL_PREFIX_RE.test(msg)) return true
  const fileCount = Array.isArray(c?.files) ? c.files.length : 0
  if (fileCount <= 2 && msg.length <= 80) return true
  return false
}

export function tagFromMessage(msg) {
  if (!msg) return 'imp'
  if (/^fix[:(]/i.test(msg)) return 'fix'
  if (/^(feat|feature|add|new)[:(]/i.test(msg)) return 'new'
  if (/^revert[:(]/i.test(msg)) return 'fix'
  return 'imp'
}

export const TAG_LABEL = { new: 'Nieuw', imp: 'Verbeterd', fix: 'Opgelost', beta: 'Beta' }

export function featureKey(msg) {
  if (!msg) return null
  let head = msg.split(/[:—]| - /)[0].trim()
  if (/^[a-z]+$/.test(head)) return null
  head = head.replace(/\s+v?\d+(\.\d+)+\s*$/i, '').trim()
  head = head.replace(/[\s\-_]v?\d+(\.\d+)*\s*$/i, '').trim()
  head = head.replace(/\s+(ronde|sessie|batch|stap|fase)\s+\d+\s*$/i, '').trim()
  if (head.length < 3) return null
  return head
}

export function trimFeaturePrefix(msg, key) {
  if (!msg || !key) return msg
  const re = new RegExp(`^${key.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}[\\s.\\dv]*[:\\u2014\\-]\\s*`, 'i')
  return msg.replace(re, '').trim() || msg
}

export function splitMessage(msg) {
  if (!msg) return { head: '—', sub: '' }
  const cleaned = msg.replace(/^[a-z]+(\([^)]+\))?:\s*/i, '')
  const firstBreak = cleaned.search(/[.\n—]/)
  if (firstBreak > 12 && firstBreak < cleaned.length - 1) {
    return { head: cleaned.slice(0, firstBreak).trim(), sub: cleaned.slice(firstBreak + 1).trim() }
  }
  return { head: cleaned, sub: '' }
}

// ---------- Module mapping ----------

const MODULE_PATTERNS = [
  { test: /^src\/components\/views\/autodraft\//, name: 'Postvak', icon: 'mail' },
  { test: /^src\/components\/views\/agenda\//, name: 'Agenda', icon: 'calendar' },
  { test: /^src\/components\/views\/klantverlies/, name: 'Klantverlies', icon: 'user-x' },
  { test: /^src\/components\/views\/taken-v2\//, name: 'Taken', icon: 'check' },
  { test: /^src\/components\/views\/jellemind\//, name: 'JelleMind', icon: 'brain' },
  { test: /^src\/components\/views\/intelligence\//, name: 'Zoeken', icon: 'search' },
  { test: /^src\/components\/views\/zoeken\//, name: 'Zoeken', icon: 'search' },
  { test: /^src\/components\/views\/admin\//, name: 'Beheercentrum', icon: 'shield' },
  { test: /^src\/components\/views\/settings\//, name: 'Instellingen', icon: 'settings' },
  { test: /^src\/components\/views\/health\//, name: 'Health', icon: 'heart' },
  { test: /^src\/components\/views\/security\//, name: 'Beveiliging', icon: 'shield' },
  { test: /^src\/components\/views\/updates\//, name: 'Wat is nieuw', icon: 'sparkles' },
  { test: /^src\/components\/views\/now\//, name: 'Dashboard', icon: 'grid' },
  { test: /^src\/components\/views\/legal-ai\//, name: 'Legal AI', icon: 'scale' },
  { test: /^src\/components\/views\/linkedin\//, name: 'LinkedIn', icon: 'link' },
  { test: /^src\/components\/views\/kennisbank\//, name: 'Kennisbank', icon: 'book' },
  { test: /^src\/components\/views\/kilometers\//, name: 'Kilometers', icon: 'car' },
  { test: /^src\/components\/views\/truth-of-sources\//, name: 'Bronnen', icon: 'database' },
  { test: /^src\/components\/views\/road-notes\//, name: 'Notities', icon: 'edit' },
  { test: /^src\/components\/views\/administratie\//, name: 'Administratie', icon: 'briefcase' },
  { test: /^src\/components\/updates\//, name: 'Wat is nieuw', icon: 'sparkles' },
  { test: /^src\/components\/shell\//, name: 'Shell', icon: 'layout' },
  { test: /^src\/components\/ui\//, name: 'UI', icon: 'box' },
  { test: /^src\/components\/rag-details\//, name: 'Zoeken', icon: 'search' },
  { test: /^src\/components\/sections\//, name: 'Dashboard', icon: 'grid' },
  { test: /^src\/hooks\//, name: 'Hooks', icon: 'plug' },
  { test: /^src\/lib\//, name: 'Lib', icon: 'package' },
  { test: /^supabase\/functions\//, name: 'Backend', icon: 'server' },
  { test: /^supabase\/migrations\//, name: 'Database', icon: 'database' },
  { test: /^skills\//, name: 'Skills', icon: 'sparkles' },
  { test: /^\.github\//, name: 'Tooling', icon: 'tool' },
  { test: /^scripts\//, name: 'Tooling', icon: 'tool' },
]

export function moduleForCommit(c) {
  const files = Array.isArray(c?.files) ? c.files : []
  if (files.length === 0) return { name: 'Algemeen', icon: 'globe' }
  const tally = new Map()
  for (const f of files) {
    for (const p of MODULE_PATTERNS) {
      if (p.test.test(f)) {
        const cur = tally.get(p.name) || { count: 0, icon: p.icon }
        tally.set(p.name, { count: cur.count + 1, icon: p.icon })
        break
      }
    }
  }
  if (tally.size === 0) return { name: 'Algemeen', icon: 'globe' }
  let best = null
  for (const [name, info] of tally) {
    if (!best || info.count > best.count) best = { name, icon: info.icon }
  }
  return best
}

// Visual color voor Major-cards — afwisseling per index zodat een rij cards
// niet allemaal hetzelfde gevoel geeft. Tag forceert kleur waar relevant.
export function majorVisualClass(idx, tag) {
  if (tag === 'fix') return 'is-green'
  if (tag === 'new') return 'is-warm'
  const palette = ['is-blue', 'is-purple', 'is-warm', 'is-green']
  return palette[idx % palette.length]
}

// ---------- Date helpers ----------

export function parseDate(iso) {
  if (!iso) return null
  const d = new Date(iso + 'T00:00:00')
  return isNaN(d.getTime()) ? null : d
}

export const MONTHS_NL = ['januari', 'februari', 'maart', 'april', 'mei', 'juni', 'juli', 'augustus', 'september', 'oktober', 'november', 'december']
const MONTHS_NL_SHORT = ['jan', 'feb', 'mrt', 'apr', 'mei', 'jun', 'jul', 'aug', 'sep', 'okt', 'nov', 'dec']

export function shortDate(iso) {
  const d = parseDate(iso); if (!d) return iso || '—'
  return `${d.getDate()} ${MONTHS_NL_SHORT[d.getMonth()]}`
}

export function dayMonthLong(iso) {
  const d = parseDate(iso); if (!d) return iso || '—'
  return `${d.getDate()} ${MONTHS_NL[d.getMonth()]}`
}

const WEEKDAYS_NL = ['zondag', 'maandag', 'dinsdag', 'woensdag', 'donderdag', 'vrijdag', 'zaterdag']

function capitalize(s) { return s ? s.charAt(0).toUpperCase() + s.slice(1) : s }

// dayLabel — elke release_date is een eigen dag-release. Label = relatieve
// dag (Vandaag / Gisteren) of de weekdag; de exacte datum staat als 'num'
// in de date-head eronder zodat het altijd ondubbelzinnig blijft.
export function dayLabel(iso, today) {
  const d = parseDate(iso); if (!d) return { label: 'Onbekend' }
  const diff = Math.floor((today.getTime() - d.getTime()) / 86400000)
  if (diff <= 0) return { label: 'Vandaag' }
  if (diff === 1) return { label: 'Gisteren' }
  return { label: capitalize(WEEKDAYS_NL[d.getDay()]) }
}

// ---------- View-model builder ----------

function summarizePeriod({ hero, features, modules, smalls }) {
  const majorCount = (hero ? 1 : 0) + features.length
  const looseCount = modules.reduce((s, m) => s + m.items.length, 0)
  const smallCount = smalls.length
  const parts = []
  if (majorCount > 0) parts.push(`${majorCount} hoofdupdate${majorCount === 1 ? '' : 's'}`)
  if (looseCount > 0) parts.push(`${looseCount} losse wijziging${looseCount === 1 ? '' : 'en'}`)
  if (smallCount > 0) parts.push(`${smallCount} klein`)
  return parts.join(' · ') || 'geen wijzigingen'
}

export function processData(days, today) {
  const all = []
  for (const day of days) {
    for (const area of ['platform', 'admin']) {
      const a = day.areas[area]
      if (!a) continue
      for (const c of a.commits || []) {
        if (!c) continue
        all.push({ ...c, release_date: day.release_date, area })
      }
    }
  }

  // Eén sectie per dag — elke release_date is een aparte release. Geen
  // week- of maand-stacking meer; nieuwste dag bovenaan.
  const dayMap = new Map()
  for (const c of all) {
    const key = c.release_date
    if (!dayMap.has(key)) {
      dayMap.set(key, {
        id: key,
        release_date: key,
        ...dayLabel(key, today),
        commits: [],
        dateRange: { min: key, max: key },
      })
    }
    dayMap.get(key).commits.push(c)
  }

  const periods = Array.from(dayMap.values())
    .sort((a, b) => (b.release_date || '').localeCompare(a.release_date || ''))

  let heroAssigned = false
  for (const period of periods) {
    const big = []
    const small = []
    for (const c of period.commits) {
      if (isSmallCommit(c)) small.push(c); else big.push(c)
    }

    const buckets = new Map()
    const loose = []
    for (const c of big) {
      const k = featureKey(c.message)
      if (!k) { loose.push(c); continue }
      if (!buckets.has(k)) buckets.set(k, [])
      buckets.get(k).push(c)
    }

    const features = []
    for (const [k, items] of buckets) {
      if (items.length >= 2) {
        items.sort((a, b) => (b.timestamp || '').localeCompare(a.timestamp || ''))
        const first = items[0]
        const mod = moduleForCommit(first)
        features.push({
          key: k,
          items,
          tag: tagFromMessage(first.message),
          module: mod,
          adminOnly: items.every(x => x.area === 'admin'),
          mixedArea: items.some(x => x.area === 'admin') && items.some(x => x.area === 'platform'),
          latestDate: first.release_date,
          author: first.author,
        })
      } else {
        loose.push(...items)
      }
    }
    features.sort((a, b) =>
      (b.latestDate || '').localeCompare(a.latestDate || '') || b.items.length - a.items.length
    )

    let hero = null
    if (!heroAssigned && (features.length > 0 || loose.length > 0)) {
      if (features.length > 0) {
        hero = features.shift()
        hero.isHero = true
      } else {
        loose.sort((a, b) => (b.release_date || '').localeCompare(a.release_date || ''))
        const top = loose.shift()
        const mod = moduleForCommit(top)
        hero = {
          key: splitMessage(top.message).head,
          items: [top],
          tag: tagFromMessage(top.message),
          module: mod,
          adminOnly: top.area === 'admin',
          mixedArea: false,
          latestDate: top.release_date,
          author: top.author,
          isHero: true,
          isSingleton: true,
        }
      }
      heroAssigned = true
    }

    const modBuckets = new Map()
    for (const c of loose) {
      const mod = moduleForCommit(c)
      const key = mod.name
      if (!modBuckets.has(key)) modBuckets.set(key, { name: mod.name, icon: mod.icon, items: [] })
      modBuckets.get(key).items.push(c)
    }
    const modules = Array.from(modBuckets.values())
    for (const m of modules) {
      m.items.sort((a, b) => (b.release_date || '').localeCompare(a.release_date || ''))
      const tagCounts = { new: 0, imp: 0, fix: 0, admin: 0 }
      for (const c of m.items) {
        if (c.area === 'admin') tagCounts.admin++
        else tagCounts[tagFromMessage(c.message)]++
      }
      m.tagCounts = tagCounts
    }
    modules.sort((a, b) => b.items.length - a.items.length)

    small.sort((a, b) => (b.release_date || '').localeCompare(a.release_date || ''))

    period.hero = hero
    period.features = features
    period.modules = modules
    period.smalls = small
    period.summary = summarizePeriod({ hero, features, modules, smalls: small })
  }

  return periods
}
