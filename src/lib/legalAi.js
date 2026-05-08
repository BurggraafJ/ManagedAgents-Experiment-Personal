// Pure helpers + constanten voor LegalAIView (Legal AI Thought Leadership).
// Geen React; geen Supabase.

import DOMPurify from 'dompurify'

export const TRACKS = [
  {
    key: 'advocatuur',
    label: 'Advocatuur',
    accent: '#8b5cf6',
    tagline: 'Hoe Legal AI advocaten verandert — Harvey, Clio, Spellbook, Robin AI, …',
  },
  {
    key: 'bedrijfsleven',
    label: 'Bedrijfsleven (MKB)',
    accent: '#06b6d4',
    tagline: 'Legal Operations / Legal AI in de business — Ironclad, LinkSquares, Juro, …',
  },
]

export const TRACK_BY_KEY = Object.fromEntries(TRACKS.map(t => [t.key, t]))

/**
 * ISO-datum (YYYY-MM-DD) voor vandaag in lokale tijdzone.
 */
export function todayIso() {
  return new Date().toISOString().slice(0, 10)
}

/**
 * Lichtgewicht markdown → HTML conversie + DOMPurify-sanitize. Geen full
 * library — alleen headings, bold, italic, lists en paragrafen.
 */
export function mdToHtml(md) {
  if (!md) return ''
  const escaped = String(md)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
  const html = escaped
    .replace(/^### (.+)$/gm, '<h3>$1</h3>')
    .replace(/^## (.+)$/gm, '<h2>$1</h2>')
    .replace(/^# (.+)$/gm, '<h1>$1</h1>')
    .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
    .replace(/\*(.+?)\*/g, '<em>$1</em>')
    .replace(/^- (.+)$/gm, '<li>$1</li>')
    .replace(/(<li>.*<\/li>)/s, '<ul>$1</ul>')
    .replace(/\n\n/g, '</p><p>')
    .replace(/^([^<].*)$/gm, '<p>$1</p>')
  return DOMPurify.sanitize(html, {
    FORBID_TAGS: ['script', 'style', 'iframe', 'object', 'embed', 'form'],
    FORBID_ATTR: ['onload', 'onerror', 'onclick', 'onmouseover'],
    ALLOWED_URI_REGEXP: /^(?:(?:https?|mailto):)/i,
  })
}
