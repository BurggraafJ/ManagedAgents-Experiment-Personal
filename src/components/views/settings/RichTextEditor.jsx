import { useRef, useEffect, useState } from 'react'

// RichTextEditor — minimale contentEditable editor voor agent-instructies.
//
// Doel: Jelle plakt tekst uit ChatGPT en de bold + line breaks blijven staan,
// zonder dat we een volledige editor (toolbar, lists, links, etc.) bouwen.
// Onder water slaan we markdown op (`**bold**`, `*italic*`, line breaks)
// zodat de bestaande skills geen wijziging nodig hebben — die lezen gewoon
// de tekst en zien `**bold**` markers, wat LLM's prima begrijpen.
//
// Geen toolbar in de UI — gewoon contentEditable met paste-sanitisatie en
// Ctrl/Cmd+B shortcut. Als je niets weet van rich text, gedraagt het zich
// als een normaal tekstvak.

const ALLOWED_TAGS = new Set(['B', 'STRONG', 'I', 'EM', 'BR', 'P', 'DIV', 'UL', 'OL', 'LI'])

function sanitizeHtmlNode(root) {
  // Diepe walk; vervang niet-toegestane tags door hun children.
  const children = Array.from(root.children)
  for (const child of children) {
    if (!ALLOWED_TAGS.has(child.tagName)) {
      while (child.firstChild) {
        child.parentNode.insertBefore(child.firstChild, child)
      }
      child.remove()
    } else {
      // Strip ALL attributes — geen styling, klassen, ids overgenomen.
      while (child.attributes.length > 0) {
        child.removeAttribute(child.attributes[0].name)
      }
      sanitizeHtmlNode(child)
    }
  }
}

function sanitizeHtml(html) {
  const tmp = document.createElement('div')
  tmp.innerHTML = html || ''
  // Verwijder script/style/comment-nodes die getOptionalText kan binnenhalen
  for (const sel of ['script', 'style']) {
    for (const el of tmp.querySelectorAll(sel)) el.remove()
  }
  sanitizeHtmlNode(tmp)
  return tmp.innerHTML
}

function escapeHtml(s) {
  return (s || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
}

// Markdown ↔ HTML converters — bewust simpel, alleen wat we ondersteunen:
// bold, italic, line breaks, paragrafen, optioneel lijsten.
export function markdownToHtml(md) {
  if (!md) return ''
  // Eerst escapen, daarna markers vervangen door tags. Bold vóór italic
  // zodat `**...**` niet als twee italics gepakt wordt.
  let s = escapeHtml(md)
  s = s.replace(/\*\*([^\n]+?)\*\*/g, '<b>$1</b>')
  s = s.replace(/(^|[^*])\*([^*\n]+?)\*(?!\*)/g, '$1<i>$2</i>')
  // Behoud dubbele newlines als paragraaf-scheidingen door dubbele <br>;
  // simpeler dan echte <p>-blocks en cursor-vriendelijker bij contentEditable.
  s = s.replace(/\n/g, '<br>')
  return s
}

export function htmlToMarkdown(html) {
  if (!html) return ''
  let s = html
  // Block-tags → newlines
  s = s.replace(/<\/(p|div|li)\s*>/gi, '\n')
  s = s.replace(/<(p|div)[^>]*>/gi, '')
  s = s.replace(/<br\s*\/?>/gi, '\n')
  s = s.replace(/<li[^>]*>/gi, '- ')
  s = s.replace(/<\/?(ul|ol)[^>]*>/gi, '')
  // Inline emphasis
  s = s.replace(/<(b|strong)[^>]*>([\s\S]*?)<\/\1>/gi, '**$2**')
  s = s.replace(/<(i|em)[^>]*>([\s\S]*?)<\/\1>/gi, '*$2*')
  // Strip overgebleven tags
  s = s.replace(/<[^>]+>/g, '')
  // Decode basale entities
  s = s
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
  // Max 2 newlines achter elkaar — voorkomt enorme lege gaten na plakken
  s = s.replace(/\n{3,}/g, '\n\n')
  return s.trimEnd()
}

export default function RichTextEditor({
  valueMd,
  onChangeMd,
  placeholder,
  minHeight = 320,
  resetKey,
  disabled,
}) {
  const ref = useRef(null)
  const [empty, setEmpty] = useState(!valueMd || !valueMd.trim())

  // Initiele content + reset bij agent-wissel. Niet bij elke render — anders
  // springt de cursor weg tijdens typen.
  useEffect(() => {
    if (!ref.current) return
    const html = markdownToHtml(valueMd || '')
    ref.current.innerHTML = html
    setEmpty(!valueMd || !valueMd.trim())
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [resetKey])

  function emit() {
    if (!ref.current) return
    const md = htmlToMarkdown(ref.current.innerHTML)
    setEmpty(!md.trim())
    onChangeMd(md)
  }

  function onPaste(e) {
    e.preventDefault()
    const dt = e.clipboardData
    const html = dt.getData('text/html')
    const plain = dt.getData('text/plain')
    let toInsert
    if (html) {
      toInsert = sanitizeHtml(html)
    } else {
      toInsert = escapeHtml(plain).replace(/\n/g, '<br>')
    }
    // execCommand is deprecated maar nog steeds de meest betrouwbare manier
    // om HTML op de cursor-positie in een contentEditable te injecteren.
    // Selection-API alternatief is fragiel met undo-stack.
    document.execCommand('insertHTML', false, toInsert)
    emit()
  }

  function onKeyDown(e) {
    if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'b') {
      e.preventDefault()
      document.execCommand('bold', false)
      emit()
      return
    }
    if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'i') {
      e.preventDefault()
      document.execCommand('italic', false)
      emit()
      return
    }
    // Ctrl+Shift+8 — unordered list (zoals Google Docs / Notion)
    if ((e.metaKey || e.ctrlKey) && e.shiftKey && e.key === '*') {
      e.preventDefault()
      document.execCommand('insertUnorderedList', false)
      emit()
      return
    }
    // Ctrl+Shift+7 — ordered list
    if ((e.metaKey || e.ctrlKey) && e.shiftKey && e.key === '&') {
      e.preventDefault()
      document.execCommand('insertOrderedList', false)
      emit()
      return
    }
  }

  function onInput() { emit() }

  return (
    <div className="rte-wrap">
      <div
        ref={ref}
        className="rte"
        contentEditable={!disabled}
        suppressContentEditableWarning
        spellCheck={true}
        onInput={onInput}
        onPaste={onPaste}
        onKeyDown={onKeyDown}
        style={{ minHeight }}
        aria-multiline="true"
        role="textbox"
      />
      {empty && placeholder && (
        <div className="rte-placeholder" aria-hidden>
          {placeholder}
        </div>
      )}
    </div>
  )
}
