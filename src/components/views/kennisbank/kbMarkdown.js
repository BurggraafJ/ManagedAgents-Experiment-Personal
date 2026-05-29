import DOMPurify from 'dompurify'

/**
 * Minimale, veilige markdown → HTML voor kennisbank-artikelen.
 * Dekt de vorm die de curator schrijft: ## / ### headings, bullets,
 * genummerde lijsten, blockquotes, **bold**, `code`, [links](url) en
 * paragrafen. Output gaat door DOMPurify (al een dependency).
 */
export function kbMarkdownToHtml(md) {
  if (!md) return ''
  const esc = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
  const inline = (s) =>
    esc(s)
      .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
      .replace(/`([^`]+?)`/g, '<code>$1</code>')
      // [tekst](http…) — alleen http/https/mailto toelaten
      .replace(/\[([^\]]+)\]\((https?:\/\/[^\s)]+|mailto:[^\s)]+)\)/g, '<a href="$2">$1</a>')

  const lines = String(md).split(/\r?\n/)
  let html = '', listTag = null, inBq = false
  const closeList = () => { if (listTag) { html += `</${listTag}>`; listTag = null } }
  const closeBq = () => { if (inBq) { html += '</blockquote>'; inBq = false } }
  const openList = (tag) => { if (listTag !== tag) { closeList(); html += `<${tag}>`; listTag = tag } }

  for (const raw of lines) {
    const line = raw.trim()
    if (!line) { closeList(); closeBq(); continue }
    let m
    if ((m = line.match(/^(#{1,6})\s+(.*)$/))) {
      closeList(); closeBq()
      const tag = m[1].length <= 2 ? 'h2' : 'h3'
      html += `<${tag}>${inline(m[2])}</${tag}>`; continue
    }
    if (/^([-*_])\1{2,}$/.test(line)) { closeList(); closeBq(); html += '<hr/>'; continue }
    if ((m = line.match(/^>\s?(.*)$/))) {
      closeList(); if (!inBq) { html += '<blockquote>'; inBq = true }
      html += `<p>${inline(m[1])}</p>`; continue
    }
    if ((m = line.match(/^[-*]\s+(.*)$/))) { closeBq(); openList('ul'); html += `<li>${inline(m[1])}</li>`; continue }
    if ((m = line.match(/^\d+\.\s+(.*)$/))) { closeBq(); openList('ol'); html += `<li>${inline(m[1])}</li>`; continue }
    closeList(); closeBq(); html += `<p>${inline(line)}</p>`
  }
  closeList(); closeBq()
  return DOMPurify.sanitize(html, { ADD_ATTR: ['target', 'rel'] })
}
