import { useEffect, useRef, useState } from 'react'

// Spraak-dictatie. iOS hangt op continuous=true; korte sessies herstarten
// zolang wantRef. stop() maakt recording meteen false — niet wachten op onend,
// anders blijft de UI vastzitten na de tweede tik.
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
  const doneRef = useRef(false)
  const onFinalRef = useRef(onFinal)
  onFinalRef.current = onFinal

  useEffect(() => () => {
    wantRef.current = false
    onFinalRef.current = null
    try { recRef.current?.abort() } catch { /* al gestopt */ }
  }, [])

  function finish() {
    if (doneRef.current) return
    doneRef.current = true
    wantRef.current = false
    setRecording(false)
    const text = finalRef.current.trim()
    setTranscript(text)
    try { recRef.current?.abort() } catch { /* ignore */ }
    recRef.current = null
    if (text && typeof onFinalRef.current === 'function') onFinalRef.current(text)
  }

  function begin() {
    if (!SR || !wantRef.current) return
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
      if (wantRef.current) begin()
      else finish()
    }
    recRef.current = rec
    try { rec.start() } catch { recRef.current = null }
  }

  function start() {
    if (!SR || wantRef.current) return
    wantRef.current = true
    doneRef.current = false
    finalRef.current = ''
    setTranscript('')
    setRecording(true)
    begin()
  }

  function stop() {
    wantRef.current = false
    finish()
  }

  return { supported, recording, transcript, start, stop }
}
