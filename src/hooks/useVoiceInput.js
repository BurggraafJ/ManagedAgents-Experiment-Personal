import { useCallback, useEffect, useRef, useState } from 'react'
import { supabase } from '../lib/supabase'

// useVoiceInput — opname + Whisper-transcriptie via Supabase Edge Function.
//
// Usage:
//   const voice = useVoiceInput(text => setText(prev => (prev + ' ' + text).trim()))
//   <button onClick={voice.toggle} disabled={!voice.supported}>
//     {voice.state === 'recording' ? 'stop' : 'mic'}
//   </button>
//
// State-machine: idle -> recording -> transcribing -> idle
// Bij fouten: state='error', err=string, auto-reset na 5s.

export function useVoiceInput(onTranscript) {
  const [state, setState] = useState('idle') // idle | recording | transcribing | error
  const [err, setErr]     = useState(null)
  const recorderRef = useRef(null)
  const chunksRef   = useRef([])
  const streamRef   = useRef(null)

  const supported = typeof window !== 'undefined'
    && typeof navigator !== 'undefined'
    && !!navigator.mediaDevices
    && !!window.MediaRecorder

  const cleanupStream = () => {
    if (streamRef.current) {
      streamRef.current.getTracks().forEach(t => t.stop())
      streamRef.current = null
    }
  }

  const start = useCallback(async () => {
    if (!supported) return
    setErr(null)
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true })
      streamRef.current = stream
      chunksRef.current = []

      // Kies een MIME-type die de browser ondersteunt
      const candidates = [
        'audio/webm;codecs=opus',
        'audio/webm',
        'audio/ogg;codecs=opus',
        'audio/mp4',
      ]
      const mimeType = candidates.find(c => MediaRecorder.isTypeSupported(c)) || ''
      const rec = mimeType ? new MediaRecorder(stream, { mimeType }) : new MediaRecorder(stream)
      recorderRef.current = rec

      rec.ondataavailable = e => { if (e.data && e.data.size > 0) chunksRef.current.push(e.data) }
      rec.onstop = async () => {
        cleanupStream()
        const blob = new Blob(chunksRef.current, { type: rec.mimeType || 'audio/webm' })
        if (blob.size < 1000) {
          setState('error'); setErr('opname te kort')
          setTimeout(() => { setState('idle'); setErr(null) }, 3000)
          return
        }
        setState('transcribing')
        try {
          const form = new FormData()
          form.append('audio', blob, `clip.${blob.type.includes('mp4') ? 'mp4' : 'webm'}`)
          const { data, error } = await supabase.functions.invoke('transcribe', { body: form })
          if (error) throw error
          const text = (data && data.text) ? String(data.text).trim() : ''
          if (text) onTranscript?.(text)
          setState('idle')
        } catch (e) {
          setState('error'); setErr(e.message || 'transcriptie mislukt')
          setTimeout(() => { setState('idle'); setErr(null) }, 5000)
        }
      }

      rec.start()
      setState('recording')
    } catch (e) {
      cleanupStream()
      setState('error'); setErr(e.message || 'microfoon niet beschikbaar')
      setTimeout(() => { setState('idle'); setErr(null) }, 5000)
    }
  }, [onTranscript, supported])

  const stop = useCallback(() => {
    if (recorderRef.current && state === 'recording') {
      recorderRef.current.stop()
    }
  }, [state])

  const toggle = useCallback(() => {
    if (state === 'recording') stop()
    else if (state === 'idle') start()
  }, [state, start, stop])

  // Cleanup on unmount
  useEffect(() => () => {
    if (recorderRef.current && recorderRef.current.state === 'recording') {
      try { recorderRef.current.stop() } catch {}
    }
    cleanupStream()
  }, [])

  return { supported, state, err, start, stop, toggle }
}
