import { useEffect, useRef, useState } from 'react'

// Spraak-dictatie via SpeechRecognition. iOS hangt op continuous=true, dus
// we herstarten korte sessies zolang de gebruiker opneemt. onFinal(tekst)
// vuurt pas bij een echte stop (tweede tik), niet bij een tussen-einde.
export function useSpeechDictation({ lang = 'nl-NL', onFinal } = {}) {
  const SR = typeof window !== 'undefined'
    ? (window.SpeechRecognition || window.webkitSpeechRecognition)
    : null
  const supported = !!SR
  const [recording, setRecording] = useState(false)
  const [transcript, setTranscript] = useState('')
  const recRef = useRef(null)
  const wantRef = useRef(false)
  const finalRef = useRef('')
  const onFinalRef = useRef(onFinal)
  onFinalRef.current = onFinal

  useEffect(() => () => {
    wantRef.current = false
    onFinalRef.current = null
    try { recRef.current?.abort() } catch { /* al gestopt */ }
  }, [])

  function begin() {
    if (!SR) return
    try { recRef.current?.abort() } catch { /* ignore */ }
    const rec = new SR()
    rec.lang = lang
    rec.continuous = false
    rec.interimResults = true
    rec.onresult = (e) => {
      let interim = ''
      for (let i = e.resultIndex; i < e.results.length; i++) {
        const res = e.results[i]
        if (res.isFinal) finalRef.current = `${finalRef.current} ${res[0].transcript}`.trim()
        else interim += res[0].transcript
      }
      setTranscript(`${finalRef.current} ${interim}`.trim())
    }
    rec.onerror = () => { /* no-speech/aborted → onend */ }
    rec.onend = () => {
      recRef.current = null
      if (wantRef.current) {
        begin()
        return
      }
      setRecording(false)
      const text = finalRef.current.trim()
      setTranscript(text)
      if (text && typeof onFinalRef.current === 'function') onFinalRef.current(text)
    }
    recRef.current = rec
    try { rec.start() } catch { recRef.current = null }
  }

  function start() {
    if (!SR || wantRef.current) return
    wantRef.current = true
    finalRef.current = ''
    setTranscript('')
    setRecording(true)
    begin()
  }

  function stop() {
    wantRef.current = false
    try { recRef.current?.stop() } catch { /* al gestopt */ }
  }

  return { supported, recording, transcript, start, stop }
}
