import { useState, useCallback, useRef, useEffect, useMemo } from 'react'
import { Link } from 'react-router-dom'
import { supabase } from '../../lib/supabase'
import RagChatView from './RagChatView'

// =====================================================================
// RagSearchView v3 — kwaliteit-gericht, categorieen, expandable, feedback
// =====================================================================
// Wat veranderd t.o.v. v2:
//   - Resultaten per source-type gegroepeerd in collapsible sections
//   - Per row: expandable → volledige content + alle 4 score-breakdown
//   - "Nuttig"/"Ruis" feedback-knoppen → log_search_feedback RPC
//   - Toont retrieval_strategy + bundle_id + entity_used + reranked-flag
//   - Per-result: via_edge zichtbaar wanneer entity-pad
//   - Quality-bar met overall stats + link naar IntelligenceQualityView
// =====================================================================

const SOURCE_LABEL = {
  mail:       'Mails',
  engagement: 'Engagements',
  jira:       'Jira issues',
  deal:       'Deals',
  company:    'Bedrijven',
  contact:    'Contacten',
  meeting:    'Meetings',
  event:      'Events',
  lesson:     'Lessons',
}

const SOURCE_ICONS = {
  mail: '✉', engagement: '◆', jira: '◑',
  deal: '★', company: '⌂', contact: '☻',
  meeting: '◐', event: '◇', lesson: '✦',
}

const DATE_PRESETS = [
  { id: 'all',  label: 'Alles',  months: null },
  { id: '12m',  label: '12 mnd', months: 12 },
  { id: '6m',   label: '6 mnd',  months: 6 },
  { id: '3m',   label: '3 mnd',  months: 3 },
  { id: '1m',   label: '1 mnd',  months: 1 },
]

const ALL_SOURCES = ['mail', 'engagement', 'jira', 'deal', 'company', 'contact', 'meeting', 'event']

const ENTITY_TYPES = [
  { id: 'none',    label: 'Geen filter' },
  { id: 'company', label: 'Bedrijf' },
  { id: 'contact', label: 'Contact' },
  { id: 'deal',    label: 'Deal' },
]

// Audience-filter — werkt alleen op mail/engagement (waar from_email beschikbaar is).
// 'all' = geen filter. 'internal' = alleen *@legal-mind.nl afzenders. 'external' =
// klanten/externe partners (alle andere domeinen).
const AUDIENCE_FILTERS = [
  { id: 'all',      label: 'Alle',                 desc: 'Intern + extern' },
  { id: 'internal', label: 'Intern (Legal Mind)',  desc: 'Alleen @legal-mind.nl' },
  { id: 'external', label: 'Extern (klanten)',     desc: 'Alleen externe afzenders' },
]
const INTERNAL_DOMAIN = 'legal-mind.nl'

function relTime(iso) {
  if (!iso) return '–'
  const ms = Date.now() - new Date(iso).getTime()
  if (ms < 0) return 'just now'
  const min = Math.floor(ms / 60_000)
  if (min < 1) return 'just now'
  if (min < 60) return `${min}m`
  const hr = Math.floor(min / 60)
  if (hr < 24) return `${hr}u`
  const day = Math.floor(hr / 24)
  if (day < 30) return `${day}d`
  const mo = Math.floor(day / 30)
  if (mo < 12) return `${mo}mnd`
  return `${Math.floor(mo / 12)}j`
}

function fmtPct(v) {
  if (v == null) return '–'
  return (Number(v) * 100).toFixed(1) + '%'
}

function fmtScore(v) {
  if (v == null) return '–'
  return Number(v).toFixed(3)
}

// Mail-sync slaat vaak de body 2× op: eerst HTML-naar-tekst met \r\n behouden,
// daarna een plain-text variant waar alle whitespace platgeslagen is. Detecteer
// die platgeslagen herhalingsregel en gooi 'm weg.
function dropFlattenedDuplicate(s) {
  if (!s) return s
  const lines = s.split('\n')
  if (lines.length < 3) return s
  let maxIdx = -1, maxLen = 0
  for (let i = 0; i < lines.length; i++) {
    if (lines[i].length > maxLen) { maxLen = lines[i].length; maxIdx = i }
  }
  if (maxLen < 250) return s
  const earlier = lines.slice(0, maxIdx).join(' ').replace(/\s+/g, ' ').trim().toLowerCase()
  if (earlier.length < 80) return s
  const probe = earlier.slice(20, 80)
  const flatLower = lines[maxIdx].toLowerCase()
  if (flatLower.includes(probe)) {
    return lines.filter((_, i) => i !== maxIdx).join('\n').trim()
  }
  return s
}

// Reply-headers (From:/Sent:/To:/Cc:/Subject:) staan vaak aan elkaar geplakt
// in de body; zet een witregel ervoor en break de header-velden onderling.
function formatReplyQuotes(s) {
  if (!s) return s
  return s
    .replace(/(\S)[ \t]+(From:\s+\S)/g, '$1\n\n$2')
    .replace(/(From:\s[^\n]{1,180}?)[ \t]{2,}(Sent:\s)/gi, '$1\n$2')
    .replace(/(Sent:\s[^\n]{1,120}?)[ \t]{2,}(To:\s)/gi, '$1\n$2')
    .replace(/(To:\s[^\n]{1,200}?)[ \t]{2,}(Cc:\s)/gi, '$1\n$2')
    .replace(/(Cc:\s[^\n]{1,200}?)[ \t]{2,}(Subject:\s)/gi, '$1\n$2')
    .replace(/(Subject:\s[^\n]{1,180}?)[ \t]{2,}(Ha |Dag |Beste |Geachte |Hi |Hallo |Goeden|Goedendag)/g, '$1\n\n$2')
}

// Splits body in top-reply en quoted thread-historie.
// Knip-punt: eerste 'Van:' / 'From:' / 'Op <datum> schreef' / '-----Original Message-----'
// die op een eigen regel start. Top = nieuwe inhoud. Quoted = alles eronder.
function splitTopAndQuoted(body) {
  if (!body) return { top: '', quoted: null }
  const re = /(?:^|\n)\s*(Van:\s+\S|From:\s+\S|-----\s*Original Message\s*-----|Op\s+\S.{0,80}schreef\s+)/i
  const m = body.match(re)
  if (!m) return { top: body, quoted: null }
  const cutAt = m.index === 0 ? 0 : m.index + 1
  const top = body.slice(0, cutAt).trimEnd()
  const quoted = body.slice(cutAt).trim()
  if (top.length < 20 || quoted.length < 40) return { top: body, quoted: null }
  return { top, quoted }
}

// Voeg threading-witregels toe in quoted-history voor leesbaarheid: nieuwe
// quote-header krijgt blank line ervoor; header-velden onderling op nieuwe
// regels; groet/aanhef begint nieuw blok.
function paragraphifyQuoted(s) {
  if (!s) return s
  return s
    .replace(/([\.\?\!])\s+(Van:\s+\S)/gi, '$1\n\n$2')
    .replace(/([\.\?\!])\s+(From:\s+\S)/g, '$1\n\n$2')
    .replace(/([\.\?\!])\s+(Op\s+\S.{0,80}?schreef\s+)/gi, '$1\n\n$2')
    .replace(/(Van:\s[^\n]{1,200}?)\s+(Datum:\s)/gi, '$1\n$2')
    .replace(/(Datum:\s[^\n]{1,120}?)\s+(Aan:\s)/gi, '$1\n$2')
    .replace(/(Aan:\s[^\n]{1,200}?)\s+(Cc:\s)/gi, '$1\n$2')
    .replace(/(Cc:\s[^\n]{1,200}?)\s+(Onderwerp:\s)/gi, '$1\n$2')
    .replace(/(Aan:\s[^\n]{1,200}?)\s+(Onderwerp:\s)/gi, '$1\n$2')
    .replace(/(Onderwerp:\s[^\n]{1,180}?)\s+(Ha |Dag |Beste |Geachte |Hi |Hallo |Goeden|Goedendag)/g, '$1\n\n$2')
    .replace(/(From:\s[^\n]{1,200}?)\s+(Sent:\s)/gi, '$1\n$2')
    .replace(/(Sent:\s[^\n]{1,120}?)\s+(To:\s)/gi, '$1\n$2')
    .replace(/(To:\s[^\n]{1,200}?)\s+(Cc:\s)/gi, '$1\n$2')
    .replace(/(Cc:\s[^\n]{1,200}?)\s+(Subject:\s)/gi, '$1\n$2')
    .replace(/(To:\s[^\n]{1,200}?)\s+(Subject:\s)/gi, '$1\n$2')
    .replace(/(Subject:\s[^\n]{1,180}?)\s+(Ha |Dag |Beste |Geachte |Hi |Hallo |Goeden|Goedendag)/g, '$1\n\n$2')
    .replace(/([\.\?\!])\s+(Met vriendelijke groet|Hartelijke groet|Met hartelijke|Vriendelijke groet|Best regards|Kind regards)/gi, '$1\n\n$2')
}

function cleanText(s) {
  if (!s) return ''
  let out = s.replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/(p|div|li|tr|h[1-6])>/gi, '\n')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
    .replace(/\r\n/g, '\n')
    .replace(/[ \t]+/g, ' ')
    .replace(/ *\n */g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
  out = dropFlattenedDuplicate(out)
  out = formatReplyQuotes(out)
  return out
}

// Splits content_with_context in (contextuele-samenvatting, body). Chunker schrijft
// als `<samenvatting>\n\n<originele-content>`; eerste blank-line is de scheider.
function splitAugmented(contentWithContext, content) {
  if (!contentWithContext) return { prefix: null, body: content ?? '' }
  const sepIdx = contentWithContext.indexOf('\n\n')
  if (sepIdx > 0) {
    const prefix = contentWithContext.slice(0, sepIdx).trim()
    const body = contentWithContext.slice(sepIdx + 2)
    if (prefix.length > 0 && prefix.length < contentWithContext.length * 0.6) {
      return { prefix, body }
    }
  }
  return { prefix: null, body: content ?? contentWithContext }
}

// Probeer een leesbare titel uit content/context te halen (per source-type).
function deriveSubject(match) {
  const content = match.preview || ''
  const ctx = match.content_with_context || ''
  const subjMatch = content.match(/^Subject:\s*(.+?)$/im)
  if (subjMatch && subjMatch[1].trim()) return subjMatch[1].trim().slice(0, 140)
  const quoteMatch = ctx.match(/["„]([^"„]{3,140})["„]/)
  if (quoteMatch) return quoteMatch[1].trim()
  const lines = content.split('\n').map(l => l.trim()).filter(Boolean)
  for (const line of lines) {
    if (/^\[.+\]$/.test(line)) continue
    if (/^From:|^To:|^Cc:|^Date:/i.test(line)) continue
    return line.slice(0, 140)
  }
  return null
}

// Splitst mail-style content in {folder, headers, body}.
// Verwacht format: [folder]\nFrom: ...\nSubject: ...\n<body>
function parseMailContent(content) {
  if (!content) return { folder: null, headers: [], body: '' }
  const lines = content.split('\n')
  let folder = null
  const headers = []
  let bodyStart = 0
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim()
    if (i === 0 && /^\[.+\]$/.test(line)) {
      folder = line.replace(/^\[|\]$/g, '')
      bodyStart = i + 1
      continue
    }
    const headerMatch = line.match(/^(From|To|Cc|Bcc|Date|Subject|Folder|Stage|Name|Conversation):\s*(.*)$/i)
    if (headerMatch) {
      headers.push({ key: headerMatch[1], value: headerMatch[2] })
      bodyStart = i + 1
    } else if (line.length === 0 && bodyStart === i) {
      bodyStart = i + 1
    } else {
      break
    }
  }
  const body = lines.slice(bodyStart).join('\n').trim()
  return { folder, headers, body }
}

// =====================================================================
// ScoreBar — toont vector / bm25 / recency / combined als horizontal bar
// =====================================================================
function ScoreBar({ vec, bm25, recency, combined }) {
  const items = [
    { label: 'Combined', value: combined, color: '#22c55e', strong: true },
    { label: 'Vector',   value: vec,      color: '#3b82f6' },
    { label: 'BM25',     value: bm25,     color: '#a855f7' },
    { label: 'Recency',  value: recency,  color: '#f59e0b' },
  ]
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
      {items.map((it) => {
        const pct = Math.min(Math.max(Number(it.value ?? 0) * 100, 0), 100)
        return (
          <div key={it.label} style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 11 }}>
            <span style={{ minWidth: 64, color: it.strong ? 'var(--text)' : 'var(--text-muted)', fontWeight: it.strong ? 600 : 400 }}>
              {it.label}
            </span>
            <div style={{ flex: 1, height: 6, background: 'var(--border)', borderRadius: 3, overflow: 'hidden' }}>
              <div style={{ width: `${pct}%`, height: '100%', background: it.color }} />
            </div>
            <span style={{ minWidth: 48, fontFamily: 'var(--font-mono)', textAlign: 'right', color: 'var(--text-muted)' }}>
              {fmtScore(it.value)}
            </span>
          </div>
        )
      })}
    </div>
  )
}

// =====================================================================
// ResultRow — één compacte rij; klik op caret = expand
// =====================================================================
function ResultRow({ match, bundleId, query, onFeedback, feedbackState, linked }) {
  const [expanded, setExpanded] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const occurredRel = relTime(match.occurred_at)
  const { prefix: augPrefix, body: augBody } = splitAugmented(match.content_with_context, match.preview)
  const cleanPrefix = augPrefix ? cleanText(augPrefix) : null
  const parsed = parseMailContent(augBody)
  const cleanBody = cleanText(parsed.body || augBody)
  const { top: bodyTop, quoted: bodyQuoted } = splitTopAndQuoted(cleanBody)
  const quotedFormatted = bodyQuoted ? paragraphifyQuoted(bodyQuoted) : null
  const derivedSubject = deriveSubject(match) || match.subject
  const viaEdge = match.entity_path?.via_edge
  const fb = feedbackState[match.chunk_id]

  const handleFeedback = async (outcome) => {
    if (submitting || fb) return
    setSubmitting(true)
    try {
      await onFeedback(match, outcome)
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <div style={{
      borderBottom: '1px solid var(--border)',
      display: 'flex', flexDirection: 'column',
      background: fb === 'accept' ? 'rgba(34,197,94,0.04)' : fb === 'reject' ? 'rgba(148,163,184,0.05)' : 'transparent',
    }}>
      {/* Compacte rij */}
      <div
        style={{
          display: 'flex', alignItems: 'center', gap: 10,
          padding: '8px 10px', cursor: 'pointer', minHeight: 36,
        }}
        onClick={() => setExpanded(e => !e)}
      >
        <span style={{ fontFamily: 'var(--font-mono)', fontSize: 11, color: 'var(--text-muted)', minWidth: 14 }}>
          {expanded ? '▾' : '▸'}
        </span>
        <span style={{
          fontFamily: 'var(--font-mono)', fontSize: 12, fontWeight: 600,
          color: '#22c55e', minWidth: 56, textAlign: 'right',
        }}>
          {fmtPct(match.similarity)}
        </span>
        <span style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', gap: 1 }}>
          <span style={{ fontSize: 13, fontWeight: 500, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {derivedSubject || <em style={{ color: 'var(--text-muted)' }}>(geen onderwerp)</em>}
          </span>
          {linked && (linked.person || linked.company) && (
            <span style={{ fontSize: 11, color: 'var(--text-muted)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              <span style={{ opacity: 0.7 }}>↳ </span>
              {linked.person && <span>{linked.person}</span>}
              {linked.person && linked.company && <span style={{ margin: '0 4px', opacity: 0.5 }}>·</span>}
              {linked.company && <span>{linked.company}</span>}
              {linked.extra && <span style={{ marginLeft: 4, opacity: 0.6 }}>· {linked.extra}</span>}
            </span>
          )}
        </span>
        <span style={{ fontSize: 11, color: 'var(--text-muted)', minWidth: 56, textAlign: 'right' }}>
          {occurredRel}
        </span>
        {viaEdge && viaEdge !== 'self' && (
          <span style={{
            fontSize: 10, color: 'var(--text-muted)', fontStyle: 'italic',
            padding: '2px 6px', border: '1px solid var(--border)', borderRadius: 3, background: 'var(--bg-input, rgba(0,0,0,0.02))',
            whiteSpace: 'nowrap',
          }}>
            via {viaEdge}
          </span>
        )}
        {/* Feedback-knoppen — altijd zichtbaar, klik tóch toggelt expand niet door stopPropagation */}
        <div style={{ display: 'flex', gap: 4 }} onClick={(e) => e.stopPropagation()}>
          <button
            type="button"
            onClick={() => handleFeedback('accept')}
            disabled={submitting || !!fb}
            title={fb === 'accept' ? 'Gemarkeerd als nuttig' : 'Markeer als nuttig'}
            style={{
              padding: '2px 8px', fontSize: 11, border: '1px solid var(--border)', borderRadius: 3,
              background: fb === 'accept' ? '#22c55e' : 'transparent',
              color: fb === 'accept' ? 'white' : 'var(--text-muted)',
              cursor: submitting || fb ? 'default' : 'pointer',
              opacity: fb && fb !== 'accept' ? 0.4 : 1,
            }}
          >
            ✓
          </button>
          <button
            type="button"
            onClick={() => handleFeedback('reject')}
            disabled={submitting || !!fb}
            title={fb === 'reject' ? 'Gemarkeerd als ruis' : 'Markeer als ruis'}
            style={{
              padding: '2px 8px', fontSize: 11, border: '1px solid var(--border)', borderRadius: 3,
              background: fb === 'reject' ? '#94a3b8' : 'transparent',
              color: fb === 'reject' ? 'white' : 'var(--text-muted)',
              cursor: submitting || fb ? 'default' : 'pointer',
              opacity: fb && fb !== 'reject' ? 0.4 : 1,
            }}
          >
            ✕
          </button>
        </div>
      </div>

      {/* Uitgeklapt detail */}
      {expanded && (
        <div style={{
          padding: '12px 16px 14px 40px', display: 'grid',
          gridTemplateColumns: 'minmax(0, 1fr) 280px', gap: 24,
          background: 'var(--bg-input, rgba(0,0,0,0.02))',
        }}>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            {cleanPrefix && (
              <div style={{
                padding: '8px 12px', borderLeft: '3px solid #a855f7',
                background: 'rgba(168,85,247,0.06)', borderRadius: '0 4px 4px 0',
                display: 'flex', flexDirection: 'column', gap: 4,
              }}>
                <div style={{
                  fontSize: 10, fontWeight: 700, textTransform: 'uppercase',
                  letterSpacing: '0.06em', color: '#a855f7',
                }}>
                  ✦ Contextuele samenvatting
                </div>
                <div style={{
                  fontSize: 12, color: 'var(--text)', fontStyle: 'italic',
                  lineHeight: 1.55, whiteSpace: 'pre-wrap', wordBreak: 'break-word',
                }}>
                  {cleanPrefix}
                </div>
                <div style={{ fontSize: 10, color: 'var(--text-muted)', marginTop: 2 }}>
                  Automatisch gegenereerd door GPT-5-nano bij het chunken — wordt mee-geëmbed en mee-gezocht via BM25 zodat ook losse mailberichten in een breder verband terugkomen.
                </div>
              </div>
            )}
            {(parsed.folder || parsed.headers.length > 0) && (
              <div style={{
                padding: '8px 12px', borderLeft: '3px solid var(--text-muted)',
                background: 'rgba(0,0,0,0.03)', borderRadius: '0 4px 4px 0',
                display: 'grid', gridTemplateColumns: 'minmax(70px, max-content) 1fr',
                rowGap: 4, columnGap: 12, fontSize: 11,
              }}>
                {parsed.folder && (
                  <>
                    <div style={{ color: 'var(--text-muted)', fontWeight: 600 }}>Locatie</div>
                    <div style={{ fontFamily: 'var(--font-mono)' }}>{parsed.folder}</div>
                  </>
                )}
                {parsed.headers.map((h, i) => (
                  <span key={i} style={{ display: 'contents' }}>
                    <div style={{ color: 'var(--text-muted)', fontWeight: 600 }}>{h.key}</div>
                    <div style={{ wordBreak: 'break-word' }}>{h.value || <em style={{ color: 'var(--text-muted)' }}>(leeg)</em>}</div>
                  </span>
                ))}
              </div>
            )}
            {cleanBody ? (
              <div style={{
                fontSize: 13, color: 'var(--text)', lineHeight: 1.65,
                whiteSpace: 'pre-wrap', wordBreak: 'break-word',
                padding: '8px 12px', background: 'var(--bg)',
                border: '1px solid var(--border)', borderRadius: 4,
              }}>
                {bodyTop}
                {quotedFormatted && (
                  <details style={{ marginTop: 12 }}>
                    <summary style={{
                      cursor: 'pointer', fontSize: 11, color: 'var(--text-muted)',
                      padding: '4px 8px', background: 'var(--bg-input, rgba(0,0,0,0.03))',
                      borderRadius: 3, userSelect: 'none', listStyle: 'none',
                      display: 'inline-block', marginBottom: 4,
                    }}>
                      ▸ Vorige berichten in deze thread tonen
                    </summary>
                    <div style={{
                      marginTop: 8, paddingLeft: 10, borderLeft: '2px solid var(--border)',
                      color: 'var(--text-muted)', fontSize: 12, lineHeight: 1.55,
                      whiteSpace: 'pre-wrap', wordBreak: 'break-word',
                    }}>
                      {quotedFormatted}
                    </div>
                  </details>
                )}
              </div>
            ) : (
              <em style={{ fontSize: 12, color: 'var(--text-muted)' }}>(geen body)</em>
            )}
            <div style={{ fontSize: 11, color: 'var(--text-muted)', display: 'flex', flexDirection: 'column', gap: 2, marginTop: 4 }}>
              <div><strong>chunk_type:</strong> {match.chunk_type ?? '–'}</div>
              <div><strong>source_id:</strong> <code>{match.id}</code></div>
              {match.meta && Object.keys(match.meta).length > 0 && (
                <details>
                  <summary style={{ cursor: 'pointer' }}>metadata</summary>
                  <pre style={{ fontSize: 10, marginTop: 4, padding: 6, background: 'var(--bg)', border: '1px solid var(--border)', borderRadius: 3, overflow: 'auto', maxHeight: 200 }}>
                    {JSON.stringify(match.meta, null, 2)}
                  </pre>
                </details>
              )}
            </div>
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            <div style={{ fontSize: 11, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.05em', fontWeight: 600 }}>
              Score-breakdown
            </div>
            <ScoreBar
              vec={match.vector_score}
              bm25={match.bm25_score}
              recency={match.recency_score}
              combined={match.similarity}
            />
            {match.entity_path && match.entity_path.via_edge !== 'self' && (
              <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 6, padding: '6px 8px', border: '1px solid var(--border)', borderRadius: 3 }}>
                <strong>Entity-pad:</strong> via <code>{match.entity_path.via_edge}</code>
                {match.entity_path.confidence != null && (
                  <> · conf {Number(match.entity_path.confidence).toFixed(2)}</>
                )}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  )
}

// =====================================================================
// SourceGroup — collapsible per source-type
// =====================================================================
function SourceGroup({ source, matches, bundleId, query, onFeedback, feedbackState, linkedEntities, defaultOpen = true }) {
  const [open, setOpen] = useState(defaultOpen)
  const label = SOURCE_LABEL[source] || source
  const icon = SOURCE_ICONS[source] || '·'
  const avgSim = matches.reduce((s, m) => s + (m.similarity ?? 0), 0) / matches.length
  return (
    <div className="card" style={{ padding: 0, overflow: 'hidden', borderRadius: 6 }}>
      <button
        type="button"
        onClick={() => setOpen(o => !o)}
        style={{
          width: '100%', display: 'flex', alignItems: 'center', gap: 12,
          padding: '10px 14px', background: 'transparent',
          border: 'none', borderBottom: open ? '1px solid var(--border)' : 'none',
          cursor: 'pointer', textAlign: 'left',
        }}
      >
        <span style={{ fontSize: 14, color: 'var(--text-muted)', minWidth: 14 }}>
          {open ? '▾' : '▸'}
        </span>
        <span style={{ fontSize: 16, color: 'var(--text-muted)' }}>{icon}</span>
        <span style={{ fontSize: 14, fontWeight: 600, color: 'var(--text)' }}>{label}</span>
        <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>· {matches.length} hit{matches.length === 1 ? '' : 's'}</span>
        <span style={{ flex: 1 }} />
        <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>
          gem {fmtPct(avgSim)}
        </span>
      </button>
      {open && (
        <div>
          {matches.map((m, i) => (
            <ResultRow
              key={m.chunk_id || `${m.source}-${m.id}-${i}`}
              match={m}
              bundleId={bundleId}
              query={query}
              onFeedback={onFeedback}
              feedbackState={feedbackState}
              linked={linkedEntities?.[m.chunk_id]}
            />
          ))}
        </div>
      )}
    </div>
  )
}

// =====================================================================
// EntityPicker — autocomplete (zoals v2 maar geinlined)
// =====================================================================
function EntityPicker({ entityType, onTypeChange, selectedEntity, onSelect }) {
  const [searchQuery, setSearchQuery] = useState('')
  const [suggestions, setSuggestions] = useState([])
  const [loading, setLoading] = useState(false)
  const [showDropdown, setShowDropdown] = useState(false)
  const debounceRef = useRef(null)
  const wrapperRef = useRef(null)

  useEffect(() => {
    const onClickOutside = (e) => {
      if (wrapperRef.current && !wrapperRef.current.contains(e.target)) setShowDropdown(false)
    }
    document.addEventListener('mousedown', onClickOutside)
    return () => document.removeEventListener('mousedown', onClickOutside)
  }, [])

  useEffect(() => {
    if (entityType === 'none' || !searchQuery || searchQuery.length < 2) {
      setSuggestions([])
      return
    }
    if (debounceRef.current) clearTimeout(debounceRef.current)
    debounceRef.current = setTimeout(async () => {
      setLoading(true)
      try {
        let result = []
        if (entityType === 'company') {
          const { data } = await supabase.from('hubspot_companies')
            .select('company_id, name, domain').ilike('name', `%${searchQuery}%`).limit(10)
          result = (data ?? []).map(r => ({ id: r.company_id, label: r.name, sub: r.domain }))
        } else if (entityType === 'contact') {
          const { data } = await supabase.from('hubspot_contacts')
            .select('contact_id, firstname, lastname, email, jobtitle')
            .or(`firstname.ilike.%${searchQuery}%,lastname.ilike.%${searchQuery}%,email.ilike.%${searchQuery}%`)
            .limit(10)
          result = (data ?? []).map(r => ({
            id: r.contact_id,
            label: [r.firstname, r.lastname].filter(Boolean).join(' ') || r.email,
            sub: r.email + (r.jobtitle ? ` · ${r.jobtitle}` : ''),
          }))
        } else if (entityType === 'deal') {
          const { data } = await supabase.from('hubspot_deals')
            .select('deal_id, dealname, dealstage, amount')
            .ilike('dealname', `%${searchQuery}%`).eq('is_archived', false).limit(10)
          result = (data ?? []).map(r => ({
            id: r.deal_id, label: r.dealname,
            sub: r.dealstage + (r.amount ? ` · €${r.amount}` : ''),
          }))
        }
        setSuggestions(result)
        setShowDropdown(true)
      } finally { setLoading(false) }
    }, 250)
    return () => debounceRef.current && clearTimeout(debounceRef.current)
  }, [entityType, searchQuery])

  if (selectedEntity) {
    return (
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 12, color: 'var(--text-muted)' }}>
        <span>Entity:</span>
        <span style={{
          display: 'inline-flex', alignItems: 'center', gap: 6,
          padding: '4px 10px', borderRadius: 4,
          background: 'var(--bg-input, rgba(0,0,0,0.05))',
          border: '1px solid var(--text-muted)', color: 'var(--text)',
        }}>
          <span style={{ textTransform: 'uppercase', letterSpacing: '0.05em', fontWeight: 600, fontSize: 10 }}>
            {selectedEntity.type}
          </span>
          <span>{selectedEntity.label}</span>
          <button type="button" onClick={() => onSelect(null)} style={{
            background: 'none', border: 'none', color: 'var(--text-muted)',
            cursor: 'pointer', padding: 0, fontSize: 14, lineHeight: 1,
          }} title="Reset entity-filter">✕</button>
        </span>
      </div>
    )
  }

  return (
    <div ref={wrapperRef} style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12, color: 'var(--text-muted)', position: 'relative' }}>
      <span>Entity:</span>
      <select value={entityType} onChange={(e) => { onTypeChange(e.target.value); setSearchQuery(''); setSuggestions([]); }}
        style={{ padding: '4px 8px', border: '1px solid var(--border)', borderRadius: 4, background: 'var(--bg-input, var(--bg))', color: 'var(--text)', fontSize: 12 }}>
        {ENTITY_TYPES.map(t => <option key={t.id} value={t.id}>{t.label}</option>)}
      </select>
      {entityType !== 'none' && (
        <>
          <input type="text" value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            onFocus={() => suggestions.length > 0 && setShowDropdown(true)}
            placeholder={`zoek ${entityType}…`}
            style={{ padding: '4px 8px', border: '1px solid var(--border)', borderRadius: 4, background: 'var(--bg-input, var(--bg))', color: 'var(--text)', fontSize: 12, width: 220 }}
          />
          {loading && <span style={{ fontSize: 11 }}>…</span>}
          {showDropdown && suggestions.length > 0 && (
            <div style={{
              position: 'absolute', top: '100%', left: 60, marginTop: 4,
              background: 'var(--bg)', border: '1px solid var(--border)', borderRadius: 6,
              boxShadow: '0 4px 12px rgba(0,0,0,0.15)', zIndex: 10,
              minWidth: 320, maxHeight: 320, overflowY: 'auto',
            }}>
              {suggestions.map((item) => (
                <button key={item.id} type="button"
                  onClick={() => { onSelect({ type: entityType, id: item.id, label: item.label, sub: item.sub }); setSearchQuery(''); setShowDropdown(false); }}
                  style={{ display: 'block', width: '100%', textAlign: 'left', padding: '6px 10px', border: 'none', background: 'transparent', cursor: 'pointer', borderBottom: '1px solid var(--border)', color: 'var(--text)', fontSize: 12 }}
                  onMouseEnter={(e) => e.currentTarget.style.background = 'var(--bg-input, rgba(0,0,0,0.05))'}
                  onMouseLeave={(e) => e.currentTarget.style.background = 'transparent'}>
                  <div style={{ fontWeight: 500 }}>{item.label}</div>
                  {item.sub && <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>{item.sub}</div>}
                </button>
              ))}
            </div>
          )}
        </>
      )}
    </div>
  )
}

// =====================================================================
// JelleMindGroup — collapsible source-groep voor JelleMind-regels
// =====================================================================
// Sinds JelleMind Activation (2026-05-04): rag-search retourneert ook
// `knowledge_lessons[]` uit context-build. Toont per scope (jelle/skill/
// legalmind) collapsible blokken — gedraagt zich als de andere source-groups.

const JELLEMIND_SCOPE_META = {
  jelle:     { label: 'Jelle',      accent: '#8b5cf6' },
  legalmind: { label: 'Legal Mind', accent: '#06b6d4' },
  skill:     { label: 'Skills',     accent: '#10b981' },
}

function JelleMindGroup({ lessons, defaultOpen = true }) {
  const [open, setOpen] = useState(defaultOpen)
  const byScope = useMemo(() => {
    const out = new Map()
    for (const l of lessons) {
      const key = l.mind_scope || 'jelle'
      if (!out.has(key)) out.set(key, [])
      out.get(key).push(l)
    }
    return out
  }, [lessons])
  const avgSim = lessons.length === 0
    ? 0
    : lessons.reduce((s, l) => s + (l.similarity ?? 0), 0) / lessons.length
  if (lessons.length === 0) return null
  return (
    <div className="card" style={{
      padding: 0, overflow: 'hidden', borderRadius: 6,
      borderLeft: '3px solid #8b5cf6',
    }}>
      <button
        type="button"
        onClick={() => setOpen(o => !o)}
        style={{
          width: '100%', display: 'flex', alignItems: 'center', gap: 12,
          padding: '10px 14px', background: 'transparent',
          border: 'none', borderBottom: open ? '1px solid var(--border)' : 'none',
          cursor: 'pointer', textAlign: 'left',
        }}
      >
        <span style={{ fontSize: 14, color: 'var(--text-muted)', minWidth: 14 }}>
          {open ? '▾' : '▸'}
        </span>
        <span style={{ fontSize: 16, color: '#8b5cf6' }}>✦</span>
        <span style={{ fontSize: 14, fontWeight: 600, color: 'var(--text)' }}>JelleMind-regels</span>
        <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>
          · {lessons.length} regel{lessons.length === 1 ? '' : 's'} ({byScope.size} scope{byScope.size === 1 ? '' : 's'})
        </span>
        <span style={{ flex: 1 }} />
        <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>gem {fmtPct(avgSim)}</span>
      </button>
      {open && (
        <div className="stack" style={{ gap: 'var(--s-3)', padding: 'var(--s-4)' }}>
          {[...byScope.entries()].map(([scope, items]) => {
            const meta = JELLEMIND_SCOPE_META[scope] || JELLEMIND_SCOPE_META.jelle
            return (
              <div key={scope}>
                <div style={{
                  display: 'flex', alignItems: 'center', gap: 8,
                  marginBottom: 'var(--s-2)', paddingBottom: 4,
                  borderBottom: `1px solid ${meta.accent}33`,
                }}>
                  <span style={{
                    fontSize: 11, fontWeight: 700, letterSpacing: 0.4,
                    textTransform: 'uppercase', color: meta.accent,
                  }}>{meta.label}</span>
                  <span className="muted" style={{ fontSize: 11 }}>{items.length}</span>
                </div>
                <div className="stack" style={{ gap: 'var(--s-2)' }}>
                  {items.map(l => <LessonRow key={l.id} lesson={l} accent={meta.accent} />)}
                </div>
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}

function LessonRow({ lesson, accent }) {
  const [expanded, setExpanded] = useState(false)
  return (
    <div
      style={{
        padding: '8px 10px',
        borderRadius: 6,
        background: 'var(--bg-2)',
        border: '1px solid var(--border)',
        cursor: 'pointer',
      }}
      onClick={() => setExpanded(e => !e)}
    >
      <div style={{ display: 'flex', alignItems: 'flex-start', gap: 8 }}>
        <div style={{ flex: 1, fontSize: 13, lineHeight: 1.5 }}>
          {lesson.lesson_text}
        </div>
        <span className="muted" style={{ fontSize: 11, fontVariantNumeric: 'tabular-nums', flexShrink: 0 }}>
          {fmtPct(lesson.similarity)}
        </span>
      </div>
      {expanded && (
        <div className="stack" style={{ gap: 4, marginTop: 8 }}>
          {lesson.evidence_summary && (
            <div className="muted" style={{ fontSize: 11, lineHeight: 1.4 }}>
              <strong>Voorbeelden:</strong> {lesson.evidence_summary}
            </div>
          )}
          {lesson.applies_to && lesson.applies_to.length > 0 && (
            <div className="muted" style={{ fontSize: 11 }}>
              <strong>Geldt voor:</strong> {lesson.applies_to.includes('*') ? 'alle agents' : lesson.applies_to.join(', ')}
            </div>
          )}
          <div className="muted" style={{ fontSize: 10, fontFamily: 'var(--font-mono)' }}>
            id: {lesson.id}
          </div>
        </div>
      )}
    </div>
  )
}

// =====================================================================
// Quality-bar bovenaan resultaten
// =====================================================================
function QualityBar({ result, feedbackCount }) {
  const sources = useMemo(() => {
    const counts = {}
    for (const m of result.matches || []) counts[m.source] = (counts[m.source] || 0) + 1
    return Object.entries(counts).sort((a, b) => b[1] - a[1])
  }, [result])

  const reranked = result.reranked
  const strategy = result.retrieval_strategy
  const entityUsed = result.entity_used

  return (
    <div className="card" style={{ padding: 'var(--s-4)', display: 'flex', flexDirection: 'column', gap: 10 }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 16, flexWrap: 'wrap' }}>
        <div style={{ display: 'flex', alignItems: 'baseline', gap: 12, flexWrap: 'wrap' }}>
          <h2 style={{ fontSize: 18, fontWeight: 600, margin: 0 }}>
            {result.match_count > 0 ? `${result.match_count} resultaten` : 'Geen resultaten'}
          </h2>
          {sources.length > 0 && (
            <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
              {sources.map(([s, n]) => (
                <span key={s} style={{
                  fontSize: 11, padding: '2px 8px', borderRadius: 3,
                  background: 'var(--bg-input, rgba(0,0,0,0.04))',
                  color: 'var(--text-muted)', border: '1px solid var(--border)',
                }}>
                  {SOURCE_LABEL[s] || s} <strong style={{ color: 'var(--text)' }}>{n}</strong>
                </span>
              ))}
            </div>
          )}
        </div>
        <Link to="/intelligence/quality" style={{ fontSize: 12, color: 'var(--text-muted)' }}>
          Quality dashboard →
        </Link>
      </div>
      <div style={{ fontSize: 11, color: 'var(--text-muted)', display: 'flex', flexWrap: 'wrap', gap: 12, alignItems: 'baseline' }}>
        <span><strong>strategy</strong> <code>{strategy}</code></span>
        {entityUsed && (
          <span>
            <strong>entity</strong> {entityUsed.entity_type}/{entityUsed.entity_id}
            <span style={{ marginLeft: 4, fontStyle: 'italic' }}>(via {entityUsed.via})</span>
          </span>
        )}
        {reranked && <span style={{ color: '#22c55e' }}><strong>✦ reranked</strong></span>}
        <span><strong>tokens</strong> {result.tokens_used}</span>
        <span><strong>embed</strong> {result.timing_ms?.embed}ms</span>
        <span><strong>search</strong> {result.timing_ms?.search}ms</span>
        {result.timing_ms?.rerank > 0 && <span><strong>rerank</strong> {result.timing_ms.rerank}ms</span>}
        {feedbackCount > 0 && (
          <span style={{ color: '#22c55e' }}><strong>{feedbackCount}</strong> feedback gegeven</span>
        )}
        {result.bundle_id && (
          <span style={{ marginLeft: 'auto', fontFamily: 'var(--font-mono)', fontSize: 10 }}>
            bundle {result.bundle_id.slice(0, 8)}…
          </span>
        )}
      </div>
    </div>
  )
}

// =====================================================================
// Hoofdpagina
// =====================================================================
function ManualSearchView() {
  const [query, setQuery] = useState('')
  const [sources, setSources] = useState(ALL_SOURCES)
  const [datePreset, setDatePreset] = useState('12m')
  const [minSim, setMinSim] = useState(0.3)
  const [topK, setTopK] = useState(20)
  const [enableRerank, setEnableRerank] = useState(false)
  const [maxPerSource, setMaxPerSource] = useState(3)
  const [audienceFilter, setAudienceFilter] = useState('all')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState(null)
  const [result, setResult] = useState(null)
  const [feedbackState, setFeedbackState] = useState({})           // chunk_id → 'accept'|'reject'
  const [entityType, setEntityType] = useState('none')
  const [selectedEntity, setSelectedEntity] = useState(null)
  const [linkedEntities, setLinkedEntities] = useState({})         // chunk_id → { person, company, dealName, ... }
  const inputRef = useRef(null)

  useEffect(() => { inputRef.current?.focus() }, [])

  // Batch-resolve "verbonden aan" per match: from_email → contact, domain → company,
  // deal_id/contact_id/company_id → entity-naam. Eén pass na elke search.
  useEffect(() => {
    const matches = result?.matches
    if (!matches || matches.length === 0) { setLinkedEntities({}); return }
    let cancelled = false
    ;(async () => {
      const fromEmails = new Set()
      const fromDomains = new Set()
      const dealIds = new Set()
      const companyIds = new Set()
      const contactIds = new Set()
      for (const m of matches) {
        const meta = m.meta || {}
        if (m.source === 'mail' && meta.from_email) {
          fromEmails.add(meta.from_email.toLowerCase())
          const d = meta.from_email.split('@')[1]?.toLowerCase()
          if (d) fromDomains.add(d)
        }
        if (m.source === 'engagement' && m.id) {
          // engagement.id is engagement_id; primary entity al via entity_path indien aanwezig
        }
        if (m.source === 'deal') dealIds.add(m.id)
        if (m.source === 'company') companyIds.add(m.id)
        if (m.source === 'contact') contactIds.add(m.id)
      }
      const lookups = await Promise.all([
        fromEmails.size > 0
          ? supabase.from('hubspot_contacts').select('contact_id, email, firstname, lastname, jobtitle, associated_company_id')
              .in('email', [...fromEmails])
          : Promise.resolve({ data: [] }),
        fromDomains.size > 0
          ? supabase.from('hubspot_companies').select('company_id, name, domain').in('domain', [...fromDomains])
          : Promise.resolve({ data: [] }),
        dealIds.size > 0
          ? supabase.from('hubspot_deals').select('deal_id, dealname, dealstage').in('deal_id', [...dealIds])
          : Promise.resolve({ data: [] }),
        companyIds.size > 0
          ? supabase.from('hubspot_companies').select('company_id, name, domain, industry').in('company_id', [...companyIds])
          : Promise.resolve({ data: [] }),
        contactIds.size > 0
          ? supabase.from('hubspot_contacts').select('contact_id, firstname, lastname, email, jobtitle, associated_company_id').in('contact_id', [...contactIds])
          : Promise.resolve({ data: [] }),
      ])
      if (cancelled) return
      const contactsByEmail = new Map()
      for (const c of (lookups[0].data ?? [])) {
        if (c.email) contactsByEmail.set(c.email.toLowerCase(), c)
      }
      const companiesByDomain = new Map()
      for (const c of (lookups[1].data ?? [])) {
        if (c.domain) companiesByDomain.set(c.domain.toLowerCase(), c)
      }
      const dealsById = new Map((lookups[2].data ?? []).map(d => [d.deal_id, d]))
      const companiesById = new Map((lookups[3].data ?? []).map(c => [c.company_id, c]))
      const contactsById = new Map((lookups[4].data ?? []).map(c => [c.contact_id, c]))

      // Tweede pass: voor mail/engagement, fallback contact via from_email → contact;
      // voor contact die associated_company_id heeft, lookup company.
      const extraCompanyIds = new Set()
      for (const c of contactsByEmail.values()) {
        if (c.associated_company_id && !companiesById.has(c.associated_company_id)) {
          extraCompanyIds.add(c.associated_company_id)
        }
      }
      for (const c of contactsById.values()) {
        if (c.associated_company_id && !companiesById.has(c.associated_company_id)) {
          extraCompanyIds.add(c.associated_company_id)
        }
      }
      if (extraCompanyIds.size > 0) {
        const { data: extraCompanies } = await supabase.from('hubspot_companies')
          .select('company_id, name, domain').in('company_id', [...extraCompanyIds])
        for (const c of (extraCompanies ?? [])) companiesById.set(c.company_id, c)
      }

      const out = {}
      for (const m of matches) {
        const meta = m.meta || {}
        let person = null, company = null, extra = null
        if ((m.source === 'mail' || m.source === 'engagement') && meta.from_email) {
          const c = contactsByEmail.get(meta.from_email.toLowerCase())
          if (c) {
            person = [c.firstname, c.lastname].filter(Boolean).join(' ') || c.email
            if (c.associated_company_id && companiesById.has(c.associated_company_id)) {
              company = companiesById.get(c.associated_company_id).name
            }
          } else {
            person = meta.from_email
          }
          if (!company) {
            const d = meta.from_email.split('@')[1]?.toLowerCase()
            if (d && companiesByDomain.has(d)) company = companiesByDomain.get(d).name
          }
        } else if (m.source === 'deal' && dealsById.has(m.id)) {
          const d = dealsById.get(m.id)
          person = d.dealname; extra = d.dealstage
        } else if (m.source === 'company' && companiesById.has(m.id)) {
          const c = companiesById.get(m.id)
          person = c.name; extra = c.industry || c.domain
        } else if (m.source === 'contact' && contactsById.has(m.id)) {
          const c = contactsById.get(m.id)
          person = [c.firstname, c.lastname].filter(Boolean).join(' ') || c.email
          extra = c.jobtitle
          if (c.associated_company_id && companiesById.has(c.associated_company_id)) {
            company = companiesById.get(c.associated_company_id).name
          }
        }
        if (person || company || extra) {
          out[m.chunk_id] = { person, company, extra }
        }
      }
      setLinkedEntities(out)
    })()
    return () => { cancelled = true }
  }, [result])

  const toggleSource = (s) => {
    setSources((prev) => prev.includes(s) ? prev.filter(x => x !== s) : [...prev, s])
  }

  const runSearch = useCallback(async () => {
    if (!query.trim() || query.trim().length < 2) {
      setError('Type minstens 2 tekens')
      return
    }
    setLoading(true); setError(null); setFeedbackState({})
    try {
      const filterAfter = (() => {
        const p = DATE_PRESETS.find(x => x.id === datePreset)
        if (!p?.months) return null
        const d = new Date()
        d.setMonth(d.getMonth() - p.months)
        return d.toISOString()
      })()

      const requestBody = {
        query: query.trim(),
        top_k: topK,
        filter_sources: sources.length === ALL_SOURCES.length ? null : sources,
        filter_after: filterAfter,
        min_similarity: minSim,
        enable_rerank: enableRerank,
        max_per_source: maxPerSource,
      }
      if (selectedEntity) {
        requestBody.filter_entity_type = selectedEntity.type
        requestBody.filter_entity_id = selectedEntity.id
      }

      const { data, error: invErr } = await supabase.functions.invoke('rag-search', { body: requestBody })
      if (invErr) throw new Error(invErr.message)
      if (!data?.ok) throw new Error(data?.error || 'unknown_error')
      setResult(data)
    } catch (e) {
      setError(e.message || String(e))
    } finally {
      setLoading(false)
    }
  }, [query, sources, datePreset, minSim, topK, selectedEntity, enableRerank, maxPerSource])

  const onKeyDown = (e) => {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); runSearch() }
  }

  // Audience filter — alleen toepassen op mail/engagement waar from_email bekend is.
  // Andere source-types (deal/company/contact/jira/event/meeting) blijven ongefilterd.
  const filteredMatches = useMemo(() => {
    if (!result?.matches) return []
    if (audienceFilter === 'all') return result.matches
    return result.matches.filter((m) => {
      if (m.source !== 'mail' && m.source !== 'engagement') return true
      const fe = (m.meta?.from_email || '').toLowerCase()
      if (!fe) return audienceFilter === 'external'
      const isInternal = fe.endsWith('@' + INTERNAL_DOMAIN)
      return audienceFilter === 'internal' ? isInternal : !isInternal
    })
  }, [result, audienceFilter])

  // Group matches per source
  const grouped = useMemo(() => {
    if (!filteredMatches || filteredMatches.length === 0) return []
    const groups = {}
    for (const m of filteredMatches) {
      const s = m.source
      if (!groups[s]) groups[s] = []
      groups[s].push(m)
    }
    return Object.entries(groups).sort((a, b) => b[1].length - a[1].length)
  }, [filteredMatches])

  const onFeedback = useCallback(async (match, outcome) => {
    if (!result?.bundle_id || !match.chunk_id) return
    try {
      await supabase.rpc('log_search_feedback', {
        p_bundle_id: result.bundle_id,
        p_chunk_id: match.chunk_id,
        p_chunk_source: match.source,
        p_chunk_score: match.similarity,
        p_outcome: outcome,
        p_query: result.query,
      })
      setFeedbackState((prev) => ({ ...prev, [match.chunk_id]: outcome }))
    } catch (e) {
      // soft fail — show in console
      console.error('feedback failed', e)
    }
  }, [result])

  const feedbackCount = Object.keys(feedbackState).length

  return (
    <div className="stack" style={{ gap: 'var(--s-5)' }}>
      {/* Search bar */}
      <section className="card" style={{ padding: 'var(--s-5)', display: 'flex', flexDirection: 'column', gap: 'var(--s-4)' }}>
        <div style={{ display: 'flex', gap: 8, alignItems: 'stretch' }}>
          <input ref={inputRef} type="text" value={query}
            onChange={(e) => setQuery(e.target.value)} onKeyDown={onKeyDown}
            placeholder="Stel je vraag in natuurlijke taal — bv. 'wat besprak ik recent met Wintertaling'"
            style={{ flex: 1, fontSize: 16, padding: '12px 14px', border: '1px solid var(--border)', borderRadius: 8, background: 'var(--bg-input, var(--bg))', color: 'var(--text)' }}
          />
          <button className="btn btn--accent" onClick={runSearch} disabled={loading || !query.trim()}>
            {loading ? 'Zoeken…' : 'Zoek'}
          </button>
        </div>

        {/* Filter-row 1: source-pills + date + sliders */}
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 'var(--s-4)', alignItems: 'center', fontSize: 12 }}>
          <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
            {ALL_SOURCES.map((s) => {
              const active = sources.includes(s)
              return (
                <button key={s} type="button" className="btn"
                  onClick={() => toggleSource(s)}
                  style={{
                    padding: '4px 10px', fontSize: 12,
                    background: active ? 'var(--bg-input, rgba(0,0,0,0.05))' : 'transparent',
                    color: active ? 'var(--text)' : 'var(--text-muted)',
                    border: `1px solid ${active ? 'var(--text-muted)' : 'var(--border)'}`,
                    opacity: active ? 1 : 0.6,
                  }}
                  title={`${active ? 'Verberg' : 'Toon'} ${SOURCE_LABEL[s]}`}
                >
                  {SOURCE_ICONS[s]} {SOURCE_LABEL[s].replace(/s$/, '')}
                </button>
              )
            })}
          </div>

          <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
            {DATE_PRESETS.map((p) => (
              <button key={p.id} type="button" className="btn" onClick={() => setDatePreset(p.id)}
                style={{
                  padding: '4px 10px', fontSize: 12,
                  background: datePreset === p.id ? 'var(--bg-input, rgba(0,0,0,0.05))' : 'transparent',
                  color: datePreset === p.id ? 'var(--text)' : 'var(--text-muted)',
                  border: `1px solid ${datePreset === p.id ? 'var(--text-muted)' : 'var(--border)'}`,
                }}>
                {p.label}
              </button>
            ))}
          </div>

          <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
            {AUDIENCE_FILTERS.map((f) => (
              <button key={f.id} type="button" className="btn" onClick={() => setAudienceFilter(f.id)}
                title={f.desc}
                style={{
                  padding: '4px 10px', fontSize: 12,
                  background: audienceFilter === f.id ? 'rgba(34,197,94,0.10)' : 'transparent',
                  color: audienceFilter === f.id ? 'var(--text)' : 'var(--text-muted)',
                  border: `1px solid ${audienceFilter === f.id ? '#22c55e' : 'var(--border)'}`,
                }}>
                {f.label}
              </button>
            ))}
          </div>

          <label style={{ display: 'flex', alignItems: 'center', gap: 8, color: 'var(--text-muted)' }}>
            min sim:&nbsp;
            <input type="range" min="0.2" max="0.9" step="0.05" value={minSim}
              onChange={(e) => setMinSim(parseFloat(e.target.value))} style={{ width: 90 }} />
            <span style={{ fontFamily: 'var(--font-mono)', minWidth: 38, textAlign: 'right' }}>
              {(minSim * 100).toFixed(0)}%
            </span>
          </label>

          <label style={{ display: 'flex', alignItems: 'center', gap: 6, color: 'var(--text-muted)' }}>
            top:&nbsp;
            <select value={topK} onChange={(e) => setTopK(parseInt(e.target.value))}
              style={{ padding: '4px 8px', border: '1px solid var(--border)', borderRadius: 4, background: 'var(--bg-input, var(--bg))', color: 'var(--text)' }}>
              {[10, 20, 30, 50].map(n => <option key={n} value={n}>{n}</option>)}
            </select>
          </label>

          <label style={{ display: 'flex', alignItems: 'center', gap: 6, color: 'var(--text-muted)' }}>
            max/source:&nbsp;
            <select value={maxPerSource} onChange={(e) => setMaxPerSource(parseInt(e.target.value))}
              style={{ padding: '4px 8px', border: '1px solid var(--border)', borderRadius: 4, background: 'var(--bg-input, var(--bg))', color: 'var(--text)' }}>
              {[1, 2, 3, 5, 10].map(n => <option key={n} value={n}>{n}</option>)}
            </select>
          </label>

          <label style={{ display: 'flex', alignItems: 'center', gap: 6, color: 'var(--text-muted)', cursor: 'pointer' }}>
            <input type="checkbox" checked={enableRerank} onChange={(e) => setEnableRerank(e.target.checked)} />
            rerank (Haiku)
          </label>
        </div>

        {/* Filter-row 2: entity-picker */}
        <div style={{ borderTop: '1px solid var(--border)', paddingTop: 'var(--s-3)' }}>
          <EntityPicker
            entityType={entityType}
            onTypeChange={setEntityType}
            selectedEntity={selectedEntity}
            onSelect={(e) => { setSelectedEntity(e); if (!e) setEntityType('none') }}
          />
        </div>
      </section>

      {error && (
        <div className="card" style={{ borderLeft: '3px solid #ef4444', color: '#ef4444', padding: 'var(--s-4)' }}>
          {error}
        </div>
      )}

      {result && (
        <>
          <QualityBar result={result} feedbackCount={feedbackCount} />

          <div className="stack" style={{ gap: 'var(--s-4)' }}>
            {result.knowledge_lessons && result.knowledge_lessons.length > 0 && (
              <JelleMindGroup
                lessons={result.knowledge_lessons}
                defaultOpen={result.knowledge_lessons.length <= 5}
              />
            )}

            {result.match_count === 0 && (!result.knowledge_lessons || result.knowledge_lessons.length === 0) ? (
              <div className="card" style={{ textAlign: 'center', padding: 'var(--s-6)', color: 'var(--text-muted)' }}>
                Niets gevonden boven {(result.min_similarity * 100).toFixed(0)}% similarity.<br/>
                <small>Probeer de slider lager te zetten of een volledige zin te typen.</small>
              </div>
            ) : (
              grouped.map(([source, matches]) => (
                <SourceGroup
                  key={source}
                  source={source}
                  matches={matches}
                  bundleId={result.bundle_id}
                  query={result.query}
                  onFeedback={onFeedback}
                  feedbackState={feedbackState}
                  linkedEntities={linkedEntities}
                  defaultOpen={matches.length <= 5}
                />
              ))
            )}
          </div>
        </>
      )}

      {!result && !loading && !error && (
        <div className="card" style={{ textAlign: 'center', padding: 'var(--s-7)', color: 'var(--text-muted)' }}>
          <div style={{ fontSize: 13, marginBottom: 6 }}>Stel een vraag in natuurlijke taal — de RAG zoekt door alle bronnen.</div>
          <div style={{ fontSize: 12, marginBottom: 12 }}>
            <em>"wat besprak ik recent met Wintertaling"</em> · <em>"openstaande offertes Q1"</em> · <em>"betalingsherinneringen"</em>
          </div>
          <div style={{ fontSize: 11, color: 'var(--text-muted)', maxWidth: 600, margin: '0 auto' }}>
            <strong>Tips:</strong> kies een entity (bedrijf/contact/deal) om alleen 1-hop chunks te zien.
            Klik op een rij om volledige content + score-breakdown te zien.
            Markeer per resultaat ✓ (nuttig) of ✕ (ruis) — dit verbetert de quality-loop in <Link to="/intelligence/quality">Intelligence Quality</Link>.
          </div>
        </div>
      )}
    </div>
  )
}

// =====================================================================
// Default export — wrapper met tab-toggle tussen Chat (default) en
// handmatig zoeken. Onderliggende componenten blijven los herbruikbaar.
// =====================================================================
const MODE_KEY = 'rag-view-mode'

export default function RagSearchView() {
  const [mode, setMode] = useState(() => {
    try { return localStorage.getItem(MODE_KEY) || 'chat' } catch { return 'chat' }
  })
  const setModeAndPersist = useCallback((m) => {
    setMode(m)
    try { localStorage.setItem(MODE_KEY, m) } catch { /* ignore */ }
  }, [])

  return (
    <div className="stack" style={{ gap: 'var(--s-4)' }}>
      <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
        <ModeButton active={mode === 'chat'}   onClick={() => setModeAndPersist('chat')}   icon="💬" label="Chat"            sub="Vraag stellen, AI antwoordt met bronnen" />
        <ModeButton active={mode === 'manual'} onClick={() => setModeAndPersist('manual')} icon="🔍" label="Handmatig zoeken" sub="Filter zelf op source, datum, entity" />
        <span style={{ flex: 1 }} />
        <Link to="/instellingen/chat" style={{ fontSize: 12, color: 'var(--text-muted)' }}>
          Chat-instructies →
        </Link>
      </div>
      {mode === 'chat' ? <RagChatView /> : <ManualSearchView />}
    </div>
  )
}

function ModeButton({ active, onClick, icon, label, sub }) {
  return (
    <button
      type="button"
      onClick={onClick}
      style={{
        padding: '8px 14px', display: 'flex', alignItems: 'center', gap: 10,
        background: active ? 'rgba(124,58,237,0.10)' : 'transparent',
        border: `1px solid ${active ? '#7c3aed' : 'var(--border)'}`,
        borderRadius: 6, cursor: 'pointer', textAlign: 'left',
        color: 'inherit', font: 'inherit',
      }}
    >
      <span style={{ fontSize: 18 }}>{icon}</span>
      <span style={{ display: 'flex', flexDirection: 'column' }}>
        <span style={{ fontSize: 13, fontWeight: 600, color: active ? 'var(--text)' : 'var(--text-muted)' }}>{label}</span>
        <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>{sub}</span>
      </span>
    </button>
  )
}
