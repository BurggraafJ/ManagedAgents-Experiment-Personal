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
  let html = '', listTag = null, inBq = false, inConfirm = false
  const closeList = () => { if (listTag) { html += `</${listTag}>`; listTag = null } }
  const closeBq = () => { if (inBq) { html += '</blockquote>'; inBq = false } }
  const closeConfirm = () => { if (inConfirm) { closeList(); html += '</div>'; inConfirm = false } }
  const openList = (tag) => { if (listTag !== tag) { closeList(); html += `<${tag}>`; listTag = tag } }
  // De curator zet onbevestigde Legal-Mind-feiten in een "> TE BEVESTIGEN"-blok.
  // Dat renderen we als een opvallende callout i.p.v. een platte blockquote.
  const CONFIRM = /^\**\s*TE BEVESTIGEN\b/i

  for (const raw of lines) {
    const line = raw.trim()
    if (!line) { closeList(); closeBq(); closeConfirm(); continue }
    let m
    const bq = line.match(/^>\s?(.*)$/)
    const inner = bq ? bq[1].trim() : ''

    // Start van een TE BEVESTIGEN-callout
    if (bq && CONFIRM.test(inner)) {
      closeList(); closeBq(); closeConfirm()
      const lbl = inner.replace(/\*\*/g, '').replace(/:+\s*$/, '')
      html += `<div class="kb-confirm"><div class="kb-confirm__lbl">${esc(lbl)}</div>`
      inConfirm = true; continue
    }
    // Vervolgregels binnen de callout (bullets, met of zonder '>' ervoor)
    if (inConfirm) {
      const t = bq ? inner : line
      if ((m = t.match(/^[-*]\s+(.*)$/))) { openList('ul'); html += `<li>${inline(m[1])}</li>` }
      else { closeList(); html += `<p>${inline(t)}</p>` }
      continue
    }

    if ((m = line.match(/^(#{1,6})\s+(.*)$/))) {
      closeList(); closeBq()
      const tag = m[1].length <= 2 ? 'h2' : 'h3'
      html += `<${tag}>${inline(m[2])}</${tag}>`; continue
    }
    if (/^([-*_])\1{2,}$/.test(line)) { closeList(); closeBq(); html += '<hr/>'; continue }
    if (bq) {
      closeList(); if (!inBq) { html += '<blockquote>'; inBq = true }
      html += `<p>${inline(inner)}</p>`; continue
    }
    if ((m = line.match(/^[-*]\s+(.*)$/))) { closeBq(); openList('ul'); html += `<li>${inline(m[1])}</li>`; continue }
    if ((m = line.match(/^\d+\.\s+(.*)$/))) { closeBq(); openList('ol'); html += `<li>${inline(m[1])}</li>`; continue }
    closeList(); closeBq(); html += `<p>${inline(line)}</p>`
  }
  closeList(); closeBq(); closeConfirm()
  return DOMPurify.sanitize(html, { ADD_ATTR: ['target', 'rel'] })
}
