import { useEffect, useRef, useState } from 'react'

// Spraak-dictatie via de browser SpeechRecognition API (webkit-prefixed op
// Chrome/Android). Levert een live transcript tijdens de opname en roept
// onFinal(tekst) aan zodra de opname stopt — handmatig óf doordat de browser
// zelf afrondt na stilte. Gebruikt door MobileAdmin (drive-mode dicteren).
export function useSpeechDictation({ lang = 'nl-NL', onFinal } = {}) {
  const SR = typeof window !== 'undefined'
    ? (window.SpeechRecognition || window.webkitSpeechRecognition)
    : null
  const supported = !!SR
  const [recording, setRecording] = useState(false)
  const [transcript, setTranscript] = useState('')
  const recRef = useRef(null)
  const finalRef = useRef('')
  const onFinalRef = useRef(onFinal)
  onFinalRef.current = onFinal

  useEffect(() => () => {
    // Unmount tijdens opname: geen onFinal meer afvuren op een dode component.
    onFinalRef.current = null
    try { recRef.current?.abort() } catch { /* al gestopt */ }
  }, [])

  function start() {
    if (!SR || recRef.current) return
    const rec = new SR()
    rec.lang = lang
    rec.continuous = true
    rec.interimResults = true
    finalRef.current = ''
    setTranscript('')
    rec.onresult = (e) => {
      let interim = ''
      for (let i = e.resultIndex; i < e.results.length; i++) {
        const res = e.results[i]
        if (res.isFinal) finalRef.current = `${finalRef.current} ${res[0].transcript}`.trim()
        else interim += res[0].transcript
      }
      setTranscript(`${finalRef.current} ${interim}`.trim())
    }
    rec.onerror = () => { /* no-speech/aborted → onend rondt af */ }
    rec.onend = () => {
      recRef.current = null
      setRecording(false)
      const text = finalRef.current.trim()
      setTranscript(text)
      if (text && typeof onFinalRef.current === 'function') onFinalRef.current(text)
    }
    recRef.current = rec
    try { rec.start(); setRecording(true) } catch { recRef.current = null }
  }

  function stop() {
    try { recRef.current?.stop() } catch { /* al gestopt */ }
  }

  return { supported, recording, transcript, start, stop }
}
