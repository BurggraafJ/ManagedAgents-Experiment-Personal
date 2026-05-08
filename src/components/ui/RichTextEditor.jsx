import { useRef, useEffect, useState } from 'react'

// RichTextEditor — minimale contentEditable editor voor agent-instructies en
// markdown-vrije-tekst velden. Verhuisd uit views/settings/ naar components/ui/
// in Refactor 16 zodat ProposalCardCompact en MarkdownEditField hem ook zonder
// settings-import kunnen gebruiken.
//
// Doel: Jelle plakt tekst uit ChatGPT en de bold + line breaks blijven staan,
// zonder dat we een volledige editor (toolbar, lists, links, etc.) bouwen.
// Onder water slaan we markdown op (`**bold**`, `*italic*`, line breaks)
// zodat de bestaande skills geen wijziging nodig hebben — die lezen gewoon
// de tekst en zien `**bold**` markers, wat LLM's prima begrijpen.
//
// Geen toolbar in de UI — gewoon contentEditable met paste-sanitisatie en
// Ctrl/Cmd+B / Ctrl/Cmd+I shortcuts. Voor jelle gedraagt het zich als een
// normaal tekstvak.

const ALLOWED_TAGS = new Set(['B', 'STRONG', 'I', 'EM', 'BR', 'P', 'DIV', 'UL', 'OL', 'LI'])

function sanitizeHtmlNode(root) {
  const children = Array.from(root.children)
  for (const child of children) {
    if (!ALLOWED_TAGS.has(child.tagName)) {
      while (child.firstChild) {
        child.parentNode.insertBefore(child.firstChild, child)
      }
      child.remove()
    } else {
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

/**
 * Markdown → HTML — alleen bold/italic/line breaks, bewust simpel.
 * Geëxporteerd zodat callers zoals ProposalCardCompact preview-render kunnen.
 */
export function markdownToHtml(md) {
  if (!md) return ''
  let s = escapeHtml(md)
  s = s.replace(/\*\*([^\n]+?)\*\*/g, '<b>$1</b>')
  s = s.replace(/(^|[^*])\*([^*\n]+?)\*(?!\*)/g, '$1<i>$2</i>')
  s = s.replace(/\n/g, '<br>')
  return s
}

/**
 * HTML → markdown — paste-resultaat van contentEditable terug naar markdown
 * zodat het server-side als plain `**bold**`-text wordt opgeslagen.
 */
export function htmlToMarkdown(html) {
  if (!html) return ''
  let s = html
  s = s.replace(/<\/(p|div|li)\s*>/gi, '\n')
  s = s.replace(/<(p|div)[^>]*>/gi, '')
  s = s.replace(/<br\s*\/?>/gi, '\n')
  s = s.replace(/<li[^>]*>/gi, '- ')
  s = s.replace(/<\/?(ul|ol)[^>]*>/gi, '')
  s = s.replace(/<(b|strong)[^>]*>([\s\S]*?)<\/\1>/gi, '**$2**')
  s = s.replace(/<(i|em)[^>]*>([\s\S]*?)<\/\1>/gi, '*$2*')
  s = s.replace(/<[^>]+>/g, '')
  s = s
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
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
    if ((e.metaKey || e.ctrlKey) && e.shiftKey && e.key === '*') {
      e.preventDefault()
      document.execCommand('insertUnorderedList', false)
      emit()
      return
    }
    if ((e.metaKey || e.ctrlKey) && e.shiftKey && e.key === '&') {
      e.preventDefault()
      document.execCommand('insertOrderedList', false)
      emit()
      return
    }
    // Auto-bullet: typt "- " aan begin van regel → unordered list.
    if (e.key === ' ') {
      const sel = window.getSelection()
      if (sel && sel.rangeCount > 0 && sel.isCollapsed) {
        const range = sel.getRangeAt(0)
        const node = range.startContainer
        if (node.nodeType === Node.TEXT_NODE) {
          const offset = range.startOffset
          const text = node.textContent || ''
          const before = text.slice(0, offset)
          const lineStart = before.lastIndexOf('\n')
          const lineToCursor = before.slice(lineStart + 1)
          const isAtLineStart = lineToCursor === '-'
          const blockText = node.parentElement?.textContent ?? ''
          const isAtBlockStart = blockText === '-' && offset === 1
          if (isAtLineStart || isAtBlockStart) {
            e.preventDefault()
            range.setStart(node, offset - 1)
            range.deleteContents()
            document.execCommand('insertUnorderedList', false)
            emit()
            return
          }
        }
      }
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
