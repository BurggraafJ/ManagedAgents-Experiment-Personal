import s from './zoeken.module.css'
import { Ico } from './Icons'

// Splits Grok's antwoord in (main, followups).
// Grok krijgt instructie om antwoord te eindigen met:
//   ## Vervolgvragen
//   - vraag 1
//   - vraag 2
//   - vraag 3
// Deze helper extracten dat blok en geeft de vragen als array terug.
const HEADER_RE = /(^|\n)#{1,3}\s*(Vervolgvragen|Follow-?ups?|Volgende vragen)\s*\n/i

export function splitFollowUps(text) {
  if (!text) return { main: '', followups: [] }
  const m = text.match(HEADER_RE)
  if (!m) return { main: text, followups: [] }
  const cut = m.index + (m[1] ? 1 : 0)   // behoud newline vóór header bij main
  const main = text.slice(0, cut).trimEnd()
  const followBlock = text.slice(m.index + m[0].length)
  const followups = followBlock
    .split('\n')
    .map(line => line.trim())
    .filter(line => /^[-*\d.]/.test(line))
    .map(line => line.replace(/^[-*]\s+/, '').replace(/^\d+\.\s+/, '').trim())
    .filter(Boolean)
    .slice(0, 2)   // max 2 — minder druk
  return { main, followups }
}

// Renderer — chips onder een antwoord die klikbaar zijn (geeft prompt door).
export function FollowupChips({ items, onPick }) {
  if (!items || items.length === 0) return null
  return (
    <div className={s.followups}>
      <span className={s.followupsLbl}>{Ico.sparkle} Vervolgvragen</span>
      <div className={s.followupsCol}>
        {items.map((q, i) => (
          <button key={i} type="button" className={s.followupChip} onClick={() => onPick(q)}>
            {q}
          </button>
        ))}
      </div>
    </div>
  )
}
