// =============================================================================
// answerLayers — van één chatbericht naar de vier lagen van P2 "Normaal"
// =============================================================================
// Spoor 08 (Reasoning-UX). Jelle's besluit 2026-09-07: pakket P2, en 1a–1i
// "alles ja" — het jargon verhuist naar de Developer-laag, de klantweergave
// krijgt één vaste verantwoordingsregel. Kosten blijven zichtbaar (zijn
// uitzondering op 1b/1c: bedrag per generatie in cent/euro mag in de normale
// weergave staan).
//
// Alles hier is puur en zonder React, zodat de vier UI-bestanden klein blijven
// en deze afleiding los te lezen (en te testen) is.
//
// De regel is opgebouwd uit velden die de envelop al draagt — er is geen nieuw
// backend-veld voor nodig:
//   basis          ← `coverage.summary` als de envelop die draagt (additief,
//                    vandaag nergens gevuld), anders afgeleid uit de
//                    geciteerde citations, gegroepeerd per bron-type
//   periode        ← min/max van citation.occurred_at (of envelope.sources[].date)
//   niet doorzocht ← envelope.coverage.not_searched
//   duur           ← timing_ms.total (of spent.wall_ms)
//   kosten         ← spent.usd
//
// Wat NIET in deze laag hoort (dat leest TechnicalPanel): chunk-aantallen,
// confidence, similarity, tokens, modelnamen, route-namen, ids.
// =============================================================================
import { makeAnswerParts } from './rag'

// ── bron-typen in gewone taal ────────────────────────────────────────────────
// enkelvoud/meervoud, want "3 mail" en "1 mails" lezen als een bug.
const SRC_WORDS = {
  mail:        ['mail', 'mails'],
  engagement:  ['HubSpot-notitie', 'HubSpot-notities'],
  note:        ['notitie', 'notities'],
  meeting:     ['meeting', 'meetings'],
  event:       ['agenda-item', 'agenda-items'],
  agenda:      ['agenda-item', 'agenda-items'],
  deal:        ['deal', 'deals'],
  company:     ['bedrijfsprofiel', 'bedrijfsprofielen'],
  contact:     ['contactkaart', 'contactkaarten'],
  jira:        ['Jira-kaart', 'Jira-kaarten'],
  confluence:  ['wiki-pagina', "wiki-pagina's"],
  kb_article:  ['kennisartikel', 'kennisartikelen'],
  lesson:      ['les', 'lessen'],
  chunk:       ['fragment', 'fragmenten'],
  web:         ['webpagina', "webpagina's"],
}

// Zelfde bronnen, maar als naam van een vindplaats ("niet doorzocht: agenda").
const PLACE_WORDS = {
  mail: 'mail', engagement: 'HubSpot-notities', note: 'notities', meeting: 'meetings',
  event: 'agenda', agenda: 'agenda', deal: 'deals', company: 'bedrijven', contact: 'contacten',
  jira: 'Jira', confluence: 'de wiki', kb_article: 'de kennisbank', web: 'het web',
  'relatie-tijdlijn': 'de relatie-tijdlijn',
}

const MONTHS = ['januari', 'februari', 'maart', 'april', 'mei', 'juni', 'juli', 'augustus', 'september', 'oktober', 'november', 'december']
const MONTHS_SHORT = ['jan', 'feb', 'mrt', 'apr', 'mei', 'jun', 'jul', 'aug', 'sep', 'okt', 'nov', 'dec']

export const srcWord = (type, n) => (SRC_WORDS[type] || ['bron', 'bronnen'])[n === 1 ? 0 : 1]
export const placeWord = (type) => PLACE_WORDS[type] || String(type)

/** Welke citation-nummers staan echt in de antwoordtekst? */
export function usedCiteNs(m) {
  const set = new Set()
  if (!m?.content) return set
  for (const p of makeAnswerParts(m.content)) {
    if (p.type === 'cite') set.add(p.n)
  }
  return set
}

/** Kosten van één generatie. Onder een cent is "$0,00" onbruikbaar → drie decimalen. */
export function fmtUsd(usd) {
  if (typeof usd !== 'number' || !isFinite(usd) || usd <= 0) return null
  const v = usd >= 0.01 ? usd.toFixed(2) : usd.toFixed(3)
  return `$${v.replace('.', ',')}`
}

export const fmtSeconds = (ms) =>
  (typeof ms === 'number' && ms > 0) ? `${(ms / 1000).toFixed(1).replace('.', ',')} s` : null

/** "mei–aug 2026" · "augustus 2026" · "nov 2025–mrt 2026" */
export function fmtPeriod(dates) {
  const ds = dates.filter(Boolean).map(d => String(d).slice(0, 10)).filter(d => /^\d{4}-\d{2}-\d{2}$/.test(d)).sort()
  if (ds.length === 0) return null
  const a = ds[0], b = ds[ds.length - 1]
  const [ay, am] = [Number(a.slice(0, 4)), Number(a.slice(5, 7)) - 1]
  const [by, bm] = [Number(b.slice(0, 4)), Number(b.slice(5, 7)) - 1]
  if (ay === by && am === bm) return `${MONTHS[am]} ${ay}`
  if (ay === by) return `${MONTHS_SHORT[am]}–${MONTHS_SHORT[bm]} ${ay}`
  return `${MONTHS_SHORT[am]} ${ay}–${MONTHS_SHORT[bm]} ${by}`
}

/** "3 mails en 1 meeting" — max drie soorten, de rest als "en 2 andere bronnen". */
function describeSources(cites) {
  const counts = {}
  for (const c of cites) {
    const t = c.source || c.type || 'chunk'
    counts[t] = (counts[t] || 0) + 1
  }
  const parts = Object.entries(counts)
    .sort((x, y) => y[1] - x[1])
    .map(([t, n]) => `${n} ${srcWord(t, n)}`)
  if (parts.length === 0) return null
  if (parts.length > 3) {
    const rest = parts.slice(3).length
    return `${parts.slice(0, 3).join(', ')} en ${rest} andere ${rest === 1 ? 'bron' : 'bronnen'}`
  }
  if (parts.length === 1) return parts[0]
  return `${parts.slice(0, -1).join(', ')} en ${parts[parts.length - 1]}`
}

/**
 * De verantwoordingsregel. Vaste vorm op élke route (H1), altijd zonder
 * techniek: basis · periode · niet doorzocht · duur · kosten.
 */
export function buildProvenance(m) {
  const cites = Array.isArray(m?.citations) ? m.citations : []
  const used = usedCiteNs(m)
  const usedCites = cites.filter(c => used.has(c.n))
  const cov = m?.envelope?.coverage || null
  const analytics = m?.analytics || null
  const rows = analytics ? (analytics.rows || []) : []

  // ── basis ──
  // v1.155 (I1): "Gebaseerd op" is weg. Drie woorden ceremonie onder élk
  // antwoord, terwijl de positie — direct onder de tekst, achter een haarlijn —
  // het al zegt. Bij een telling blijft er wél een werkwoord staan, want daar
  // spreekt het niet vanzelf: "exact geteld" is de claim zelf.
  let basis = null
  let basisNote = null
  // Draagt de envelop een eigen dekkingszin (het additieve veld
  // `coverage.summary`), dan is die leidend: de backend weet beter wat er is
  // doorzocht dan wij uit de teruggegeven citaties kunnen afleiden. Bestaat het
  // veld niet — vandaag is dat het geval op elke route — dan leiden we de zin
  // hieronder zelf af, zodat de regel op 100 % van de antwoorden staat (U4).
  const summary = typeof cov?.summary === 'string' ? cov.summary.trim() : ''
  if (summary) {
    basis = summary
  } else if (rows.length > 0) {
    basis = `${rows.length} ${rows.length === 1 ? 'rij' : 'rijen'}, exact geteld`
  } else if (usedCites.length > 0) {
    basis = describeSources(usedCites)
  } else if (cites.length > 0) {
    // 62 % van de semantische antwoorden citeert niets. Niet stil doen alsof
    // de bronnen gebruikt zijn (ASK-JELLE punt 4).
    basis = describeSources(cites)
    basisNote = 'niets expliciet geciteerd'
  }

  // ── periode ──
  const dateOf = (c) => c.occurred_at || c.ts || c.date || null
  const period = fmtPeriod((usedCites.length > 0 ? usedCites : cites).map(dateOf))

  // ── niet doorzocht ──
  const notSearchedRaw = Array.isArray(cov?.not_searched) ? cov.not_searched : []
  const notSearched = notSearchedRaw.map(placeWord)
  const notSearchedLabel = notSearched.length === 0
    ? null
    : notSearched.length <= 3
      ? notSearched.join(', ')
      : `${notSearched.slice(0, 3).join(', ')} en ${notSearched.length - 3} ${notSearched.length - 3 === 1 ? 'andere bron' : 'andere bronnen'}`

  // ── duur + kosten ──
  const totalMs = (typeof m?.timing_ms === 'object' && m.timing_ms) ? m.timing_ms.total : m?.timing_ms
  const duration = fmtSeconds(typeof totalMs === 'number' ? totalMs : m?.spent?.wall_ms)
  const cost = fmtUsd(m?.spent?.usd)

  return {
    basis, basisNote, period, notSearchedLabel, duration, cost,
    // Leeg = geen regel; dan draagt CoverageNote het verhaal al.
    empty: !basis && !period && !notSearchedLabel && !duration && !cost,
  }
}

// ── het onderzoek als één zin (H3 / 1g) ──────────────────────────────────────
// De kop was "9 stappen · 2 gedachten · 5 tool-calls". Dat is een telling, geen
// mededeling. Deze zin zegt wát er is nagekeken, en noemt expliciet wat leeg
// bleef of mislukte — dat is precies de informatie die eerder alleen in de
// dichtgeklapte tabel stond.
export const stepKind = (step) => {
  if (step?.stage === 'think') return 'think'
  const d = String(step?.detail || '')
  if (/^mislukt:/i.test(d)) return 'fail'
  if (/^0 resultaten\b/.test(d)) return 'empty'
  return 'ok'
}

// De labels uit rag-chat eindigen op een werkwoord ("Jira doorzocht",
// "HubSpot-notities opgehaald"). Voor een zin over die stap is het onderwerp
// nodig, niet de hele mededeling — anders krijg je "jira doorzocht gaf niets".
const TRAILING_VERB = /\s+(doorzocht|opgehaald|uitgevoerd|nagelopen|geraadpleegd|meegenomen|gevonden|geselecteerd)\s*$/i
const subjectOf = (step) => String(step?.label || '').replace(TRAILING_VERB, '').trim()

export function buildResearchSentence(m) {
  const steps = Array.isArray(m?.steps) ? m.steps : []
  const cov = m?.envelope?.coverage || null
  const searched = Array.isArray(cov?.searched) ? cov.searched : []
  const cites = Array.isArray(m?.citations) ? m.citations : []

  // De periode staat in de verantwoordingsregel en nergens anders: twee
  // perioden bij één antwoord (de doorzochte range vs. de range van de
  // gebruikte bronnen) is precies één vraag te veel.
  const parts = []
  if (searched.length > 0) {
    const names = searched.map(placeWord)
    const head = names.length <= 3 ? names.join(', ') : `${names.slice(0, 3).join(', ')} en ${names.length - 3} andere bronnen`
    parts.push(`${head} doorzocht`)
  } else if (cites.length > 0) {
    parts.push(`Kennisindex doorzocht: ${cites.length} ${cites.length === 1 ? 'fragment' : 'fragmenten'}, ${usedCiteNs(m).size} gebruikt`)
  }

  const empties = steps.filter(st => stepKind(st) === 'empty')
  if (empties.length === 1) parts.push(`${subjectOf(empties[0])} leverde niets op`)
  else if (empties.length > 1) parts.push(`${empties.length} zoekacties leverden niets op`)

  const fails = steps.filter(st => stepKind(st) === 'fail')
  if (fails.length === 1) parts.push(`${subjectOf(fails[0])} mislukte`)
  else if (fails.length > 1) parts.push(`${fails.length} zoekacties mislukten`)

  if (parts.length === 0) return null
  return `${upperFirst(parts.join('; '))}.`
}

const upperFirst = (s) => (s ? s.charAt(0).toUpperCase() + s.slice(1) : s)

// ── verwachte duur tijdens het wachten (H4, ASK-JELLE punt 5) ────────────────
// Wachten zonder verwachting is de gemeten pijn: eerste stap na 1,8 s, een
// semantisch antwoord rond 12 s, agent-onderzoek 30 s met p95 op 67 s — en een
// oplopende teller die niets belooft.
//
// De grens komt uit de route (of, zolang die nog niet gekozen is, uit het
// effort-woord). Bij een onbekende route staat er de mediaan: het semantische
// pad is de meerderheid van de vragen, dus dat is de eerlijkste gok en niet
// "misschien lang". AANNAME: deze twee banden zijn hard-coded uit RESEARCH §2
// (meting 2026-09-05) en niet uit de dagcijfers; een route-gemiddelde per dag
// hoort in agent_config als de dogfood-week uitwijst dat dit scheef staat.
export function expectedDuration(m) {
  const route = m?.route || m?.envelope?.route || m?.analytics?.route || null
  const effort = m?.effort || null
  if (route === 'agentic' || effort === 'high') return 'kan 30–60 seconden duren'
  if (effort === 'xhigh') return 'kan een paar minuten duren'
  return 'meestal 10–15 seconden'
}
