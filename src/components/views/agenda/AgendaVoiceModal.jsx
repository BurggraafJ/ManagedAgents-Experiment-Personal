import { useState } from 'react'
import { supabase } from '../../../lib/supabase'
import {
  formatWeekLabel,
  mondayOf,
  toLocalDateKey,
} from '../../../lib/agenda'

/* AgendaVoiceModal — Maestro-styling van AgendaVoiceModal. */
export default function AgendaVoiceModal({ weekStart, onClose }) {
  const [text, setText]     = useState('')
  const [saving, setSaving] = useState(false)
  const [saved, setSaved]   = useState(false)
  const [listening, setListening] = useState(false)
  const recognitionRef = useState(null)

  const startListening = () => {
    const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition
    if (!SpeechRecognition) return
    const rec = new SpeechRecognition()
    rec.lang = 'nl-NL'
    rec.continuous = true
    rec.interimResults = true
    rec.onresult = e => {
      const transcript = Array.from(e.results).map(r => r[0].transcript).join(' ')
      setText(transcript)
    }
    rec.onend = () => setListening(false)
    rec.start()
    recognitionRef[0] = rec
    setListening(true)
  }

  const stopListening = () => {
    recognitionRef[0]?.stop()
    setListening(false)
  }

  const submit = async () => {
    if (!text.trim()) return
    setSaving(true)
    const weekStartStr = toLocalDateKey(mondayOf(weekStart))
    await supabase.from('agenda_voice_notes').insert({
      content: text.trim(),
      week_start: weekStartStr,
    })
    setSaving(false)
    setSaved(true)
    setTimeout(onClose, 1200)
  }

  const hasSpeech = !!(window.SpeechRecognition || window.webkitSpeechRecognition)

  return (
    <div className="ag-voice__backdrop" onClick={onClose}>
      <div className="ag-voice__modal" onClick={e => e.stopPropagation()}>
        <div className="ag-voice__header">
          <h2>Weeknotitie — {formatWeekLabel(weekStart)}</h2>
          <button type="button" className="ag-modal__close" onClick={onClose}>×</button>
        </div>
        <p className="ag-voice__hint">
          Vertel hoe je week eruit ziet — bijv. "maandag ben ik bij klant in Den Bosch, dinsdag thuis".
          De AI gebruikt dit bij de locatieprognose.
        </p>
        <textarea
          className="ag-voice__textarea"
          value={text}
          onChange={e => setText(e.target.value)}
          placeholder="Typ of spreek je weekplanning in…"
          rows={5}
          autoFocus
        />
        <div className="ag-voice__actions">
          {hasSpeech && (
            <button
              type="button"
              className={`ag-btn ag-btn--ghost ag-voice__mic ${listening ? 'is-listening' : ''}`}
              onClick={listening ? stopListening : startListening}
            >
              {listening ? '■ Stop' : '🎤 Spreken'}
            </button>
          )}
          <button
            type="button"
            className="ag-btn ag-btn--primary"
            disabled={saving || !text.trim()}
            onClick={submit}
          >
            {saved ? '✓ Opgeslagen' : saving ? 'Opslaan…' : 'Opslaan'}
          </button>
        </div>
      </div>
    </div>
  )
}
