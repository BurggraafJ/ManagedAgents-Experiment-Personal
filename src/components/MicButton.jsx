import { useVoiceInput } from '../hooks/useVoiceInput'

// MicButton — klein rondknopje naast een textarea. onTranscript krijgt de
// getranscribeerde tekst (al getrimd) en plakt 'm in de textarea.
//
// Usage:
//   <MicButton onTranscript={text => setValue(prev => (prev + ' ' + text).trim())} />

export default function MicButton({ onTranscript, title = 'Spreek in' }) {
  const voice = useVoiceInput(onTranscript)

  if (!voice.supported) return null

  const label = voice.state === 'recording'    ? '⏺ stop'
              : voice.state === 'transcribing' ? '…'
              : voice.state === 'error'        ? '!'
              : '🎙'

  const stateClass = `mic-btn--${voice.state}`

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
