import { useCallback, useEffect, useState } from 'react'
import { themeAt, segmentAt, msUntilNextBoundary } from '../lib/themeClock'

// useTheme — thema volgt standaard de tijd van de dag in Europe/Amsterdam:
// licht van 07:00 tot 19:00, daarbuiten donker (zie lib/themeClock.js).
//
// De thema-knop blijft gewoon werken, maar is nu een OVERRIDE:
//   • hij geldt tot de eerstvolgende 07:00/19:00-grens, óf tot je opnieuw
//     toggelt — wat het eerst komt. Van die twee is de grens de kortste, en dus
//     de eerlijke belofte: een override overleeft nooit een dagdeel-wissel.
//     ("tot je weer toggelt" alléén zou betekenen dat één klik het tijdgebonden
//     thema voorgoed uitzet, en dat is niet wat er gevraagd is.)
//   • toggelen naar het thema dat de klok tóch al wil = terug naar automatisch;
//     dan slaan we niets op.
//
// Persistentie in localStorage onder 'lm-dashboard-theme':
//   {"theme":"dark","segment":"2026-09-03L"}
// `segment` is het dagdeel waarin de override gezet is; zodra het huidige
// dagdeel een andere id heeft, is de override verlopen.
//
// Herberekenen gebeurt op een timer (exact op de grens, en verder minstens elke
// minuut) plus bij visibilitychange — niet alleen bij een page-load. Een tab of
// PWA die de hele dag open staat, kantelt dus vanzelf om 19:00.

const STORAGE_KEY = 'lm-dashboard-theme'

// Nooit langer dan een minuut slapen: dan pikt de app ook een slapende laptop,
// een verzette systeemklok of een DST-sprong binnen 60 s op.
const MAX_TICK_MS = 60_000

function readOverride(now) {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return null
    // Legacy t/m v1.142: kale string 'light' | 'dark' zonder tijdstempel. We
    // weten niet in welk dagdeel die gezet is en kunnen 'm dus niet eerlijk
    // laten verlopen → negeren, de klok neemt het over. De eerstvolgende klik
    // schrijft meteen het nieuwe formaat.
    if (raw === 'light' || raw === 'dark') return null
    const saved = JSON.parse(raw)
    if (saved?.theme !== 'light' && saved?.theme !== 'dark') return null
    return saved.segment === segmentAt(now) ? saved.theme : null
  } catch {
    return null
  }
}

function writeOverride(theme, now) {
  try {
    if (theme === null) localStorage.removeItem(STORAGE_KEY)
    else localStorage.setItem(STORAGE_KEY, JSON.stringify({ theme, segment: segmentAt(now) }))
  } catch {
    // Private mode of volle storage: het thema volgt dan puur de klok. Geen
    // reden om de app te laten crashen op een cosmetische voorkeur.
  }
}

function resolveTheme(now) {
  return readOverride(now) || themeAt(now)
}

export function useTheme() {
  const [theme, setTheme] = useState(() => (
    typeof window === 'undefined' ? 'dark' : resolveTheme(new Date())
  ))

  // Eén zichzelf-herplannende timer: mikt op de eerstvolgende grens en wordt
  // afgetopt op MAX_TICK_MS. Het thema komt elke tick uit de echte klok +
  // opgeslagen override, niet uit een eerder berekende waarde.
  useEffect(() => {
    let timer = null
    const tick = () => {
      const now = new Date()
      setTheme(resolveTheme(now))
      const delay = Math.min(MAX_TICK_MS, Math.max(1000, msUntilNextBoundary(now)))
      timer = setTimeout(tick, delay)
    }
    const recheck = () => {
      if (document.hidden) return
      clearTimeout(timer)
      tick()
    }
    tick()
    // Achtergrond-tabs (en een PWA op iOS) bevriezen hun timers; bij terugkomen
    // meteen bijwerken in plaats van tot de volgende tick wachten.
    document.addEventListener('visibilitychange', recheck)
    return () => {
      clearTimeout(timer)
      document.removeEventListener('visibilitychange', recheck)
    }
  }, [])

  useEffect(() => {
    const root = document.documentElement
    root.classList.toggle('theme-light', theme === 'light')
    root.classList.toggle('theme-dark', theme === 'dark')
  }, [theme])

  const toggle = useCallback(() => {
    const now = new Date()
    const next = theme === 'light' ? 'dark' : 'light'
    writeOverride(next === themeAt(now) ? null : next, now)
    setTheme(next)
  }, [theme])

  return { theme, toggle }
}
