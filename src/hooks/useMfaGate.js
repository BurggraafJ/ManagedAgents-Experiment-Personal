import { useCallback, useEffect, useRef, useState } from 'react'
import { fetchMfaStatus, requestMfaCode, verifyMfaCode } from '../lib/mfa'

// useMfaGate — bepaalt of er ná login nog een verificatiecode nodig is.
//
// Statussen:
//   'checking'  → mfa_status wordt opgehaald (of het vertrouwde apparaat wordt
//                 stil afgehandeld)
//   'ok'        → deze sessie mag door (geen enforcement, break-glass, of de
//                 code is al gehaald / het apparaat is vertrouwd)
//   'needs-otp' → MfaGate tonen
//   'error'     → mfa_status faalde; we laten de gebruiker door en de datalaag
//                 doet de rest. Fail-open is hier bewust: de RLS blokkeert al,
//                 dus een kapotte status-call mag geen wit scherm geven.
//
// Deze hook mag maar één keer in de tree gemount worden (CLAUDE.md-regel over
// dubbele hooks) — App.jsx doet dat en geeft het resultaat door als prop.
export function useMfaGate(userId) {
  const [state, setState] = useState('checking')
  const [info, setInfo] = useState(null)          // { expiresAt, ttlSeconds, maxAttempts }
  const [error, setError] = useState(null)
  const [sending, setSending] = useState(false)
  // StrictMode mount de effect 2×; zonder deze guard vuren er twee sends en
  // slaat GoTrue's 60s-cooldown toe met een 429 op de eerste poging.
  const bootstrappedFor = useRef(null)

  const bootstrap = useCallback(async (uid) => {
    setState('checking')
    setError(null)
    let status
    try {
      status = await fetchMfaStatus()
    } catch (err) {
      setError(err.message || String(err))
      setState('error')
      return
    }
    if (!status.enforced || status.session_ok) {
      setState('ok')
      return
    }
    // Enforcement staat aan en deze sessie is nog niet akkoord. Eerst het
    // vertrouwde apparaat proberen — dat stuurt geen mail als het klopt.
    try {
      const res = await requestMfaCode()
      if (res.skipped) {
        setState('ok')
        return
      }
      setInfo({
        expiresAt: res.expiresAt,
        ttlSeconds: res.ttlSeconds,
        maxAttempts: res.maxAttempts,
        cooldownSeconds: res.cooldownSeconds,
      })
      setState('needs-otp')
    } catch (err) {
      // Code kon niet verstuurd worden (rate-limit of mailstoring): scherm
      // wél tonen, met de foutmelding en de mogelijkheid opnieuw te proberen.
      setError(err.code === 'rate_limited'
        ? `Er is net een code verstuurd. Probeer het over ${err.retryAfterSeconds}s opnieuw.`
        : 'De code kon niet verstuurd worden. Probeer het opnieuw of gebruik de noodprocedure.')
      setState('needs-otp')
    }
    void uid
  }, [])

  useEffect(() => {
    if (!userId) { setState('checking'); bootstrappedFor.current = null; return }
    if (bootstrappedFor.current === userId) return
    bootstrappedFor.current = userId
    bootstrap(userId)
  }, [userId, bootstrap])

  const resend = useCallback(async () => {
    setSending(true)
    setError(null)
    try {
      const res = await requestMfaCode()
      if (res.skipped) { setState('ok'); return true }
      setInfo({
        expiresAt: res.expiresAt,
        ttlSeconds: res.ttlSeconds,
        maxAttempts: res.maxAttempts,
        cooldownSeconds: res.cooldownSeconds,
      })
      return true
    } catch (err) {
      setError(err.code === 'rate_limited'
        ? `Nog even wachten — over ${err.retryAfterSeconds}s kun je een nieuwe code aanvragen.`
        : 'De code kon niet verstuurd worden.')
      return false
    } finally {
      setSending(false)
    }
  }, [])

  const verify = useCallback(async (code, remember) => {
    setSending(true)
    setError(null)
    try {
      await verifyMfaCode(code, remember)
      setState('ok')
      return true
    } catch (err) {
      if (err.code === 'code_incorrect') {
        setError(err.attemptsLeft > 0
          ? `Code klopt niet. Nog ${err.attemptsLeft} poging${err.attemptsLeft === 1 ? '' : 'en'}.`
          : 'Code klopt niet. Vraag een nieuwe code aan.')
      } else if (err.code === 'too_many_attempts') {
        setError('Te veel pogingen. Vraag een nieuwe code aan.')
      } else if (err.code === 'no_open_challenge') {
        setError('Deze code is verlopen. Vraag een nieuwe aan.')
      } else {
        setError('Verificatie mislukte. Probeer het opnieuw.')
      }
      return false
    } finally {
      setSending(false)
    }
  }, [])

  return { state, info, error, sending, resend, verify }
}
