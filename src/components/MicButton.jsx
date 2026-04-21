import { useVoiceInput } from '../hooks/useVoiceInput'

// MicButton — rond knopje naast/in een textarea. onTranscript krijgt de
// getranscribeerde tekst en plakt 'm in de textarea.

export default function MicButton({ onTranscript, title = 'Spreek in' }) {
  const voice = useVoiceInput(onTranscript)
  if (!voice.supported) return null

  const stateClass = `mic-btn--${voice.state}`
  const label =
    voice.state === 'recording'    ? <RecordingIcon />
    : voice.state === 'transcribing' ? <Spinner />
    : voice.state === 'error'      ? <AlertIcon />
    : <MicIcon />

  return (
    <button
      type="button"
      className={`mic-btn ${stateClass}`}
      onClick={voice.toggle}
      disabled={voice.state === 'transcribing'}
      title={voice.err || (voice.state === 'recording' ? 'Klik om opname te stoppen' : title)}
      aria-label={voice.state === 'recording' ? 'Stop opname' : 'Start spraakopname'}
    >
      {label}
    </button>
  )
}

function MicIcon() {
  return (
    <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor"
         strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <rect x="9" y="3" width="6" height="11" rx="3" />
      <path d="M5 11a7 7 0 0 0 14 0" />
      <line x1="12" y1="18" x2="12" y2="22" />
      <line x1="9"  y1="22" x2="15" y2="22" />
    </svg>
  )
}

function RecordingIcon() {
  // Stop-vierkantje + pulserend rood dot onderin via CSS (op de button)
  return (
    <svg viewBox="0 0 24 24" width="14" height="14" fill="currentColor" aria-hidden="true">
      <rect x="6" y="6" width="12" height="12" rx="2" />
    </svg>
  )
}

function Spinner() {
  return (
    <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor"
         strokeWidth="2" strokeLinecap="round" aria-hidden="true" className="spin">
      <path d="M21 12a9 9 0 1 1-6.2-8.55" />
    </svg>
  )
}

function AlertIcon() {
  return (
    <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor"
         strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M12 9v4" />
      <path d="M12 17h.01" />
      <circle cx="12" cy="12" r="9" />
    </svg>
  )
}
