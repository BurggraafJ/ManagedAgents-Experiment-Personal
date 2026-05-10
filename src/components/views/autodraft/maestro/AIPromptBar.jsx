import { useState } from 'react'
import { useMaestro } from './MaestroContext'

// AIPromptBar — inline AI-prompt-bar onderaan composer (mockup `.ai-prompt`).
//
// Sessie MCM-V6 (2026-05-10): nieuwe component voor de mockup-conform
// inline AI-rewrite-flow. Vervangt de modal-only flow van MailImproverModal
// met een snellere chip + input combo.
//
// Mockup-bron: Downloads/Postvak (1).html regel 1846-1860.
//
// Chips zijn quick-prompts die het input-veld vullen. User kan zelf typen,
// drukt Enter of klikt "Herschrijf" → fire callback via MaestroContext
// (submitAmend). MailDetail's submit('amend') flow wordt gereuset met de
// prompt als amend-tekst — bestaande RPC-binding blijft intact.

const QUICK_PROMPTS = [
  'Korter',
  'Vriendelijker',
  'Zakelijker',
  'Voeg dank toe',
  'Vraag om bevestiging',
  'Geen Engelse leenwoorden',
  'Stel een datum voor',
]

export default function AIPromptBar() {
  const [input, setInput] = useState('')
  const [busy, setBusy]   = useState(false)
  const { actions } = useMaestro()

  function handleChip(text) {
    setInput(prev => (prev && prev.trim() ? prev + ' · ' + text : text))
  }

  async function handleSubmit() {
    const prompt = input.trim()
    if (!prompt || busy) return
    if (typeof actions.submitAmend === 'function') {
      setBusy(true)
      try {
        await actions.submitAmend(prompt)
        setInput('')
      } finally {
        setBusy(false)
      }
    } else {
      // Geen actions wired (visual-only fallback) — toon hint via console
      // eslint-disable-next-line no-console
      console.warn('[AIPromptBar] no submitAmend action wired — prompt:', prompt)
      setInput('')
    }
  }

  function handleKey(e) {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      handleSubmit()
    }
  }

  return (
    <div className="mc-ai-prompt">
      <div className="mc-ai-prompt__head">
        <span className="mc-ai-prompt__icon" aria-hidden>
          <svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
            <path d="M9.937 15.5A2 2 0 0 0 8.5 14.063l-6.135-1.582a.5.5 0 0 1 0-.962L8.5 9.936A2 2 0 0 0 9.937 8.5l1.582-6.135a.5.5 0 0 1 .963 0L14.063 8.5A2 2 0 0 0 15.5 9.937l6.135 1.581a.5.5 0 0 1 0 .964L15.5 14.063a2 2 0 0 0-1.437 1.437l-1.582 6.135a.5.5 0 0 1-.963 0z"/>
            <path d="M20 3v4"/>
            <path d="M22 5h-4"/>
          </svg>
        </span>
        <span>Vertel Maestro hoe je deze mail anders wil</span>
      </div>
      <div className="mc-ai-prompt__chips">
        {QUICK_PROMPTS.map(p => (
          <button
            key={p}
            type="button"
            className="mc-ai-prompt__chip"
            onClick={() => handleChip(p)}
            disabled={busy}
          >
            {p}
          </button>
        ))}
      </div>
      <div className="mc-ai-prompt__row">
        <input
          className="mc-ai-prompt__input"
          type="text"
          value={input}
          onChange={e => setInput(e.target.value)}
          onKeyDown={handleKey}
          placeholder="bv. 'Maak korter en open met dank voor de aanvullingen'…"
          aria-label="AI-prompt voor herschrijven"
          disabled={busy}
        />
        <button
          type="button"
          className="mc-ai-prompt__send"
          onClick={handleSubmit}
          disabled={busy || !input.trim()}
        >
          <svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <path d="M9.937 15.5A2 2 0 0 0 8.5 14.063l-6.135-1.582a.5.5 0 0 1 0-.962L8.5 9.936A2 2 0 0 0 9.937 8.5l1.582-6.135a.5.5 0 0 1 .963 0L14.063 8.5A2 2 0 0 0 15.5 9.937l6.135 1.581a.5.5 0 0 1 0 .964L15.5 14.063a2 2 0 0 0-1.437 1.437l-1.582 6.135a.5.5 0 0 1-.963 0z"/>
          </svg>
          {busy ? 'Bezig…' : 'Herschrijf'}
        </button>
      </div>
    </div>
  )
}
