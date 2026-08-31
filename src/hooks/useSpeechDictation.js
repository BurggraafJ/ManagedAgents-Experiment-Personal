import { useEffect, useRef, useState } from 'react'

// Spraak-dictatie. iOS hangt op continuous=true; korte sessies herstarten
// zolang wantRef. Live interim-stream blijft aan. stop() zet recording meteen
// uit (UI), maar gebruikt rec.stop() i.p.v. abort zodat de laatste woorden
// nog binnenkomen — dat was de "verwerkingstijd" na het vastlopen.
export function useSpeechDictation({ lang = 'nl-NL', onFinal } = {}) {
  const SR = typeof window !== 'undefined'
    ? (window.SpeechRecognition || window.webkitSpeechRecognition)
    : null
  const supported = !!SR
  const [recording, setRecording] = useState(false)
  const [held, setHeld] = useState(false)
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
    if (!SR || !wantRef.current) return
    if (recRef.current) return
    const rec = new SR()
    rec.lang = lang
    rec.continuous = false
    rec.interimResults = true
    rec.maxAlternatives = 1
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
      const text = finalRef.current.trim()
      setTranscript(text)
      setRecording(false)
      if (text && typeof onFinalRef.current === 'function') onFinalRef.current(text)
    }
    recRef.current = rec
    try { rec.start() } catch { recRef.current = null }
  }

  function start() {
    if (!SR || wantRef.current) return
    wantRef.current = true
    finalRef.current = ''
    setHeld(false)
    setTranscript('')
    setRecording(true)
    begin()
  }

  function stop() {
    wantRef.current = false
    setRecording(false)
    setHeld(true)
    try { recRef.current?.stop() } catch { /* al gestopt */ }
  }

  function reset() {
    wantRef.current = false
    setHeld(false)
    setRecording(false)
    finalRef.current = ''
    setTranscript('')
    try { recRef.current?.abort() } catch { /* ignore */ }
    recRef.current = null
  }

  return { supported, recording, held, transcript, start, stop, reset }
}
