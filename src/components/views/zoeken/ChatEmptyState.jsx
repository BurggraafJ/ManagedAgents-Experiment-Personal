import s from './zoeken.module.css'
import { Ico } from './Icons'
import { CHAT_SUGGESTIONS } from '../../../lib/rag'

// Het lege gesprek: wat Analyse laat zien vóór de eerste vraag. Stond tot
// v1.162 onderaan ChatMode.jsx; dat bestand ging over de 400-regelcap uit
// CLAUDE.md en dit blok heeft geen enkele band met de composer-state ernaast.
// Verplaatst zonder wijziging.
export default function ChatEmptyState({ onPick, suggestions }) {
  // F.1g: dynamische voorbeeldvragen uit rag_prompt_library (DB) met fallback op de statische set.
  const items = (suggestions && suggestions.length) ? suggestions : CHAT_SUGGESTIONS
  return (
    <div className={s.empty}>
      {/* v1.152 (1i, Jelle "ja"): was "Maestro · vector". */}
      <div className={s.emptyBadge}>{Ico.sparkle}<span>Maestro</span></div>
      <h1 className={s.emptyH}>Wat wil je <em>weten</em>?</h1>
      <p className={s.emptySub}>
        Stel je vraag in natuurlijke taal. Maestro zoekt door je mail, HubSpot, Jira en agenda en
        antwoordt met bronverwijzingen.
      </p>
      <div className={s.sugGrid}>
        {items.map((q) => (
          <button key={q} type="button" className={s.sug} onClick={() => onPick(q)}>
            <span className={s.sugIco}>{Ico.sparkle}</span>
            <div className={s.sugMain}>
              <div className={s.sugQ}>{q}</div>
              <div className={s.sugHint}>klik om te vragen</div>
            </div>
          </button>
        ))}
      </div>
    </div>
  )
}
