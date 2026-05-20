import s from './zoeken-v2.module.css'
import { makeAnswerParts } from '../../../../lib/rag'

// Mini-markdown renderer voor RAG-chat antwoorden.
// Geen externe dependency — handled inline: headings (#/##/###), bold,
// italic, inline code, code-blocks, lists (- / 1.), blockquotes, links
// en paragraphs. Citations ([bron #N]) blijven door makeAnswerParts gaan
// zodat ze klikbare buttons worden.
//
// Tolereert partial markdown tijdens streaming — een ongesloten **bold**
// wordt gewoon als asterisken getoond, geen crash.

export default function V2Markdown({ text, onCiteClick }) {
  if (!text) return null
  const blocks = parseBlocks(text)
  return (
    <div className={s.mdRoot}>
      {blocks.map((block, i) => renderBlock(block, i, onCiteClick))}
    </div>
  )
}

// =====================================================================
// Block-level parser
// =====================================================================
function parseBlocks(text) {
  const lines = text.split('\n')
  const blocks = []
  let i = 0
  while (i < lines.length) {
    const line = lines[i]

    // Code-block ```lang ... ```
    if (line.startsWith('```')) {
      const lang = line.slice(3).trim()
      const buf = []
      i++
      while (i < lines.length && !lines[i].startsWith('```')) {
        buf.push(lines[i]); i++
      }
      i++  // skip closing ```
      blocks.push({ kind: 'code', lang, content: buf.join('\n') })
      continue
    }

    // Heading
    const h = line.match(/^(#{1,4})\s+(.+?)\s*$/)
    if (h) {
      blocks.push({ kind: 'heading', level: h[1].length, content: h[2] })
      i++; continue
    }

    // Blockquote (vangt aaneengesloten > lijnen)
    if (line.startsWith('> ')) {
      const buf = []
      while (i < lines.length && lines[i].startsWith('> ')) {
        buf.push(lines[i].slice(2)); i++
      }
      blocks.push({ kind: 'quote', content: buf.join('\n') })
      continue
    }

    // Unordered list
    if (/^[-*]\s+/.test(line)) {
      const items = []
      while (i < lines.length && /^[-*]\s+/.test(lines[i])) {
        items.push(lines[i].replace(/^[-*]\s+/, '')); i++
      }
      blocks.push({ kind: 'ul', items })
      continue
    }

    // Ordered list
    if (/^\d+\.\s+/.test(line)) {
      const items = []
      while (i < lines.length && /^\d+\.\s+/.test(lines[i])) {
        items.push(lines[i].replace(/^\d+\.\s+/, '')); i++
      }
      blocks.push({ kind: 'ol', items })
      continue
    }

    // Lege regel = paragraph break
    if (line.trim() === '') {
      i++; continue
    }

    // Paragraph (verzamel tot lege regel of speciaal block)
    const buf = []
    while (i < lines.length && lines[i].trim() !== '' &&
           !lines[i].startsWith('#') && !lines[i].startsWith('> ') &&
           !lines[i].startsWith('```') &&
           !/^[-*]\s+/.test(lines[i]) && !/^\d+\.\s+/.test(lines[i])) {
      buf.push(lines[i]); i++
    }
    if (buf.length > 0) {
      blocks.push({ kind: 'p', content: buf.join('\n') })
    }
  }
  return blocks
}

function renderBlock(block, key, onCiteClick) {
  if (block.kind === 'heading') {
    const Tag = `h${Math.min(block.level + 1, 6)}`   // h1 in source → h2 in render (visuele hiërarchie binnen chat)
    return <Tag key={key} className={s[`mdH${block.level}`]}>{renderInline(block.content, onCiteClick)}</Tag>
  }
  if (block.kind === 'p') {
    return <p key={key} className={s.mdP}>{renderInline(block.content, onCiteClick)}</p>
  }
  if (block.kind === 'ul') {
    return (
      <ul key={key} className={s.mdUl}>
        {block.items.map((it, i) => <li key={i}>{renderInline(it, onCiteClick)}</li>)}
      </ul>
    )
  }
  if (block.kind === 'ol') {
    return (
      <ol key={key} className={s.mdOl}>
        {block.items.map((it, i) => <li key={i}>{renderInline(it, onCiteClick)}</li>)}
      </ol>
    )
  }
  if (block.kind === 'quote') {
    return <blockquote key={key} className={s.mdQuote}>{renderInline(block.content, onCiteClick)}</blockquote>
  }
  if (block.kind === 'code') {
    return (
      <pre key={key} className={s.mdCode} data-lang={block.lang || ''}>
        <code>{block.content}</code>
      </pre>
    )
  }
  return null
}

// =====================================================================
// Inline parser — bold/italic/code/links + [bron #N] citations
// =====================================================================
function renderInline(text, onCiteClick) {
  if (!text) return null
  const parts = makeAnswerParts(text)   // splits citations uit
  const out = []
  let keyCount = 0
  for (const p of parts) {
    if (p.type === 'cite') {
      out.push(
        <button
          key={`c-${keyCount++}`}
          type="button"
          className={s.cite}
          onClick={() => onCiteClick?.(p.n)}
          title={`Spring naar bron #${p.n}`}
        >
          {p.n}
        </button>
      )
    } else {
      out.push(...renderInlineMarkdown(p.value, keyCount))
      keyCount += 10
    }
  }
  return out
}

// Simple regex-driven inline-markdown render. Geen perfecte parser maar
// dekt de gebruikelijke gevallen die Grok produceert.
function renderInlineMarkdown(text, baseKey) {
  // Eerst code-spans extracten (anders parseren we **/* binnen code-blocks)
  // Patroon: groepen van {type, value} tokens.
  const tokens = tokenizeInline(text)
  return tokens.map((t, i) => {
    const k = `i-${baseKey}-${i}`
    if (t.type === 'code') return <code key={k} className={s.mdInlineCode}>{t.value}</code>
    if (t.type === 'bold') return <strong key={k}>{renderBoldChildren(t.value)}</strong>
    if (t.type === 'italic') return <em key={k}>{t.value}</em>
    if (t.type === 'link') return <a key={k} href={t.href} target="_blank" rel="noopener noreferrer" className={s.mdLink}>{t.value}</a>
    return <span key={k}>{t.value}</span>
  })
}

// Voor bold kunnen italic-nested zijn: **dit is *cursief* binnen bold**
function renderBoldChildren(text) {
  const parts = text.split(/(\*[^*\n]+\*|_[^_\n]+_)/g)
  return parts.map((p, i) => {
    if (/^\*[^*\n]+\*$/.test(p) || /^_[^_\n]+_$/.test(p)) {
      return <em key={i}>{p.slice(1, -1)}</em>
    }
    return p
  })
}

function tokenizeInline(text) {
  const tokens = []
  let i = 0
  while (i < text.length) {
    const rest = text.slice(i)

    // Inline code `...`
    let m = rest.match(/^`([^`\n]+)`/)
    if (m) { tokens.push({ type: 'code', value: m[1] }); i += m[0].length; continue }

    // Bold **...** (greedy maar binnen één regel)
    m = rest.match(/^\*\*([^\n]+?)\*\*/)
    if (m) { tokens.push({ type: 'bold', value: m[1] }); i += m[0].length; continue }

    // Italic *...* of _..._
    m = rest.match(/^\*([^*\n]+?)\*/)
    if (m) { tokens.push({ type: 'italic', value: m[1] }); i += m[0].length; continue }
    m = rest.match(/^_([^_\n]+?)_/)
    if (m) { tokens.push({ type: 'italic', value: m[1] }); i += m[0].length; continue }

    // Markdown link [text](url)
    m = rest.match(/^\[([^\]]+)\]\(([^)]+)\)/)
    if (m) { tokens.push({ type: 'link', value: m[1], href: m[2] }); i += m[0].length; continue }

    // Plain text — neem tot volgende special char
    const next = rest.search(/[`*_\[]/)
    if (next < 0) {
      tokens.push({ type: 'text', value: rest }); break
    }
    if (next === 0) {
      tokens.push({ type: 'text', value: rest[0] }); i++; continue
    }
    tokens.push({ type: 'text', value: rest.slice(0, next) })
    i += next
  }
  return tokens
}
