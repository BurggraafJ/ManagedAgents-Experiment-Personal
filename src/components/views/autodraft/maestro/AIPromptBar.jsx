import { useState } from 'react'
import { useMaestro } from './MaestroContext'

// AIPromptBar — V8.2 (2026-05-13): collapsed by default met sparkle-toggle
// rechtsonder in het schrijfveld (HubSpot-stijl). Klik op sparkle → expand.
// Het uitklap-paneel bevat: quick-prompt chips, AI-rewrite input én een
// shortcut-chip naar de Spelcheck-popover.
//
// Communicatie met Spelcheck:
//   AIPromptBar emit `mcm-open-spelcheck` CustomEvent → MailDetail luistert
//   en opent zijn eigen SpelcheckPopover (state daar gemount). Decoupling
//   zonder lift-state-up refactor.

const QUICK_PROMPTS = [
  'Korter',
  'Vriendelijker',
  'Zakelijker',
  'Voeg dank toe',
  'Vraag om bevestiging',
  'Geen Engelse leenwoorden',
  'Stel een datum voor',
]

function SparkleIcon({ size = 13 }) {
  return (
    <svg viewBox="0 0 24 24" width={size} height={size} fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M9.937 15.5A2 2 0 0 0 8.5 14.063l-6.135-1.582a.5.5 0 0 1 0-.962L8.5 9.936A2 2 0 0 0 9.937 8.5l1.582-6.135a.5.5 0 0 1 .963 0L14.063 8.5A2 2 0 0 0 15.5 9.937l6.135 1.581a.5.5 0 0 1 0 .964L15.5 14.063a2 2 0 0 0-1.437 1.437l-1.582 6.135a.5.5 0 0 1-.963 0z"/>
      <path d="M20 3v4"/>
      <path d="M22 5h-4"/>
    </svg>
  )
}

function SpelcheckIcon({ size = 13 }) {
  return (
    <svg viewBox="0 0 24 24" width={size} height={size} fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="m6 16 6-12 6 12"/>
      <path d="M8 12h8"/>
      <path d="m17 22 5-5"/>
      <path d="m22 22-5-5"/>
    </svg>
  )
}

export default function AIPromptBar() {
  const [open, setOpen] = useState(false)
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
        setOpen(false) // panel sluiten na submit; sparkle blijft beschikbaar
      } finally {
        setBusy(false)
      }
    } else {
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

  function openSpelcheck() {
    // Custom-event-bridge — MailDetail luistert en opent zijn SpelcheckPopover.
    window.dispatchEvent(new CustomEvent('mcm-open-spelcheck'))
    setOpen(false)
  }

  // Collapsed state: alleen sparkle-toggle rechtsonder
  if (!open) {
    return (
      <button
        type="button"
        className="mc-ai-prompt__toggle"
        onClick={() => setOpen(true)}
        title="Vraag Maestro deze mail te herschrijven of doe een spelcheck"
        aria-label="Open Maestro AI-prompt"
      >
        <span className="mc-ai-prompt__toggle-icon" aria-hidden>
          <SparkleIcon size={14} />
        </span>
        <span className="mc-ai-prompt__toggle-label">Maestro</span>
      </button>
    )
  }

  // Expanded state
  return (
    <div className="mc-ai-prompt">
      <div className="mc-ai-prompt__head">
        <span className="mc-ai-prompt__icon" aria-hidden><SparkleIcon /></span>
        <span>Vertel Maestro hoe je deze mail anders wil</span>
        <button
          type="button"
          className="mc-ai-prompt__close"
          onClick={() => setOpen(false)}
          aria-label="Sluiten"
          title="Sluiten"
        >
          <svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <path d="M18 6 6 18"/>
            <path d="m6 6 12 12"/>
          </svg>
        </button>
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
        {/* Spelcheck shortcut — opent Spelcheck-popover via window-event bridge */}
        <button
          type="button"
          className="mc-ai-prompt__chip mc-ai-prompt__chip--alt"
          onClick={openSpelcheck}
          disabled={busy}
          title="Open spelling-check popover voor de huidige draft"
        >
          <SpelcheckIcon /> Spelcheck
        </button>
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
          autoFocus
        />
        <button
          type="button"
          className="mc-ai-prompt__send"
          onClick={handleSubmit}
          disabled={busy || !input.trim()}
        >
          <SparkleIcon />
          {busy ? 'Bezig…' : 'Herschrijf'}
        </button>
      </div>
    </div>
  )
}
