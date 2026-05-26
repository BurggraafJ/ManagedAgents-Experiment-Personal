// updatesHumanize — rauwe git-commit-messages → leesbare changelog-tekst.
// Pure regex-regels, geen LLM. Volgorde:
//   1. conventional prefix weg  (fix: / feat(scope): )
//   2. module/feature-prefix weg als die de module-tag dupliceert
//   3. NL-afkortingen uitschrijven  (i.p.v. → in plaats van)
//   4. de-technify: file-paths, snake_case, property-punten, commit-hashes,
//      Engelse dev-werkwoorden
//   5. losse versie-tokens weg + whitespace/punctuatie + kapitaliseren

const ABBREV = [
  [/\bi\.?\s?p\.?\s?v\.?(\s|$)/gi, 'in plaats van$1'],
  [/\bo\.?\s?b\.?\s?v\.?(\s|$)/gi, 'op basis van$1'],
  [/\bi\.?\s?v\.?\s?m\.?(\s|$)/gi, 'in verband met$1'],
  [/\bm\.?\s?b\.?\s?t\.?(\s|$)/gi, 'met betrekking tot$1'],
  [/\bt\.?\s?o\.?\s?v\.?(\s|$)/gi, 'ten opzichte van$1'],
  [/\bn\.?\s?a\.?\s?v\.?(\s|$)/gi, 'naar aanleiding van$1'],
  [/\bm\.?\s?b\.?\s?v\.?(\s|$)/gi, 'met behulp van$1'],
  [/\bi\.?\s?c\.?\s?m\.?(\s|$)/gi, 'in combinatie met$1'],
  [/\bt\.?\s?b\.?\s?v\.?(\s|$)/gi, 'ten behoeve van$1'],
  [/\bz\.?\s?s\.?\s?m\.?(\s|$)/gi, 'zo snel mogelijk$1'],
  [/\bo\.?\s?a\.?(\s|$)/gi, 'onder andere$1'],
  [/\bd\.?\s?m\.?\s?v\.?(\s|$)/gi, 'door middel van$1'],
  [/\bbijv\.?(\s|$)/gi, 'bijvoorbeeld$1'],
  [/\bevt\.?(\s|$)/gi, 'eventueel$1'],
  [/\bincl\.?(\s|$)/gi, 'inclusief$1'],
  [/\bexcl\.?(\s|$)/gi, 'exclusief$1'],
  [/\bm\.?\s?n\.?(\s|$)/gi, 'met name$1'],
  [/\bv\.?\s?w\.?\s?b\.?(\s|$)/gi, 'voor wat betreft$1'],
]

function expandAbbrev(t) {
  for (const [re, rep] of ABBREV) t = t.replace(re, rep)
  return t
}

// Veilige Engelse dev-werkwoorden → NL. Alleen aan het begin van de zin,
// 1-op-1 zodat de zinsbouw heel blijft.
const DEV_VERBS = [
  [/^bump\s+/i, 'Bijgewerkt: '],
  [/^revert(\s+of)?\s+/i, 'Teruggedraaid: '],
  [/^rename\s+/i, 'Hernoemd: '],
  [/^move(d)?\s+/i, 'Verplaatst: '],
  [/^drop(ped)?\s+/i, 'Verwijderd: '],
  [/^strip(ped)?\s+/i, 'Verwijderd: '],
  [/^remove(d)?\s+/i, 'Verwijderd: '],
  [/^wire\s+up\s+/i, 'Aangesloten: '],
  [/^hook\s+up\s+/i, 'Gekoppeld: '],
]

const CODE_EXT = 'jsx?|tsx?|css|ts|sql|md|json|cjs|mjs|html|svg'

// deTechnify — maakt code-jargon leesbaarder zonder de betekenis te raken.
function deTechnify(t) {
  // file-path met code-extensie → kale bestandsnaam (zonder pad + extensie)
  t = t.replace(new RegExp(`\\b(?:[\\w.-]+\\/)+([\\w-]+)\\.(?:${CODE_EXT})\\b`, 'gi'), '$1')
  // losse bestandsnaam met code-extensie → zonder extensie
  t = t.replace(new RegExp(`\\b([\\w-]+)\\.(?:${CODE_EXT})\\b`, 'gi'), '$1')
  // trailing commit-hash tussen haakjes  "(abc1234)" / "(commit abc1234)"
  t = t.replace(/\s*\((?:commit\s+)?[0-9a-f]{7,40}\)\s*$/i, '')
  // dev-werkwoord aan het begin
  for (const [re, rep] of DEV_VERBS) t = t.replace(re, rep)
  // snake_case → spaties  (agent_runs_health → agent runs health)
  t = t.replace(/([a-z0-9])_([a-z0-9])/gi, '$1 $2')
  t = t.replace(/([a-z0-9])_([a-z0-9])/gi, '$1 $2') // 2e pass voor opvolgende underscores
  // property-toegang met punt tussen letters → spatie  (payload.value)
  t = t.replace(/([a-z])\.([a-z])/gi, '$1 $2')
  return t
}

function stripModulePrefix(t, moduleName) {
  if (!moduleName) return t
  const m = moduleName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  const re = new RegExp(`^${m}\\s*(v?\\d+(\\.\\d+)*)?\\s*[:\\u2014-]\\s*`, 'i')
  return t.replace(re, '')
}

function polish(t) {
  if (!t) return ''
  t = t.replace(/(^|\s)v\d+(\.\d+)*(?=\s|$)/gi, '$1')          // losse versie-tokens
  t = t.replace(/\s{2,}/g, ' ').replace(/\s+([.,;:)])/g, '$1') // dubbele spaties + spatie vóór leesteken
  t = t.replace(/\(\s+/g, '(').replace(/[\s—-]+$/, '').trim()
  if (t) t = t.charAt(0).toUpperCase() + t.slice(1)
  return t
}

function normCmp(s) { return (s || '').toLowerCase().replace(/[^a-z0-9]/g, '') }

// splitMessage — kop + optionele sub-zin. moduleName (optioneel) laat de
// module-prefix strippen zodat "Klantverlies v2: inline notitie-edit" met
// module-tag Klantverlies gewoon "Inline notitie-edit" wordt.
export function splitMessage(msg, moduleName) {
  if (!msg) return { head: '—', sub: '' }
  let cleaned = msg.replace(/^[a-z]+(\([^)]+\))?:\s*/i, '')
  cleaned = stripModulePrefix(cleaned, moduleName)
  cleaned = expandAbbrev(cleaned)
  cleaned = deTechnify(cleaned)
  // Splits alleen op een écht zin-einde: ". " / ".\n" / " — " — niet op een
  // punt midden in een token (payload.value, v2.0).
  const brk = cleaned.match(/\.\s|\.$|\s[—–]\s|\n/)
  const firstBreak = brk ? brk.index : -1
  const breakLen = brk ? brk[0].length : 0
  let head, sub
  if (firstBreak > 12 && firstBreak < cleaned.length - 1) {
    head = cleaned.slice(0, firstBreak).trim()
    sub = cleaned.slice(firstBreak + breakLen).trim()
  } else {
    head = cleaned
    sub = ''
  }
  head = polish(head)
  sub = polish(sub)
  // Sub droppen als die de kop in essentie herhaalt
  if (sub) {
    const h = normCmp(head)
    const s = normCmp(sub)
    if (h && s && (h === s || h.includes(s) || s.includes(h))) sub = ''
  }
  return { head: head || '—', sub }
}

// prettyLabel — schoonmaak voor een titel die geen losse zin is
// (bv. een feature-key zoals "Klantverlies v2").
export function prettyLabel(text, moduleName) {
  if (!text) return '—'
  let t = stripModulePrefix(text, moduleName)
  t = expandAbbrev(t)
  t = deTechnify(t)
  t = polish(t)
  return t || text
}
