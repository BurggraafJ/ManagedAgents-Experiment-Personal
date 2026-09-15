import { useEffect, useState } from 'react'

/**
 * useNow — "nu", ververst per minuut (v1.216).
 *
 * Een `new Date()` in de render-body is een nieuwe waarde bij élke render, en
 * alles wat er van afhangt (de nu-lijn, "1 over 12 min", `useMemo`-deps)
 * rekent dan bij elke render opnieuw. Eén stukje state dat per minuut tikt is
 * stabiel tussen renders en toch actueel genoeg voor een tijdlijn.
 */
export function useNow(intervalMs = 60000) {
  const [now, setNow] = useState(() => new Date())
  useEffect(() => {
    const id = setInterval(() => setNow(new Date()), intervalMs)
    return () => clearInterval(id)
  }, [intervalMs])
  return now
}
