import { useCallback, useEffect, useMemo, useState } from 'react'
import { supabase } from '../lib/supabase'

// =============================================================================
// useFolderPickerPrefs — wat de mapkiezer over jou onthoudt (v1.217, spoor 10)
// =============================================================================
// Twee dingen, allebei lokaal op het toestel en per gebruiker:
//
//   open     welke map-groepen je hebt uitgevouwen. De boom start ingevouwen
//            (58 mappen, zes niveaus — uitgevouwen is dat vier schermen), maar
//            wat jij één keer openklapt blijft open. Jouw mappen, jouw boom.
//   gebruik  hoe vaak je een mail naar welke map hebt verplaatst. Daar komen
//            de drie snelknoppen bovenin uit. Geteld bij een gelúkte
//            verplaatsing, niet bij een tik: een mislukte Outlook-call is geen
//            voorkeur.
//
// ── Opslag ──────────────────────────────────────────────────────────────────
//   localStorage-sleutel  `postvak.mappen.v1:<auth.uid>`   (of `:anon`)
//   waarde                { open: [full_path, …], gebruik: { [full_path]: n } }
//
// Per gebruiker omdat dit een gedeeld dashboard is (member-preset, v1.215): de
// mappen van de één zijn niet de snelknoppen van de ander. De uid komt uit
// `supabase.auth.getUser()` en is er pas na een tick; tot die tijd is de boom
// gewoon dicht en zijn de snelknoppen koud. Niets flitst, want de kiezer staat
// dan nog niet open.
//
// Waarom niet in de database: dit is toestelgedrag ("wat had ik openstaan"),
// geen bedrijfsdata. Een tabel ervoor zou een RLS-policy, een migratie en een
// sync-moment kosten voor iets dat op je laptop niet eens bestaat (daar is de
// mapkiezer een dropdown).
// =============================================================================

const KEY_PREFIX = 'postvak.mappen.v1'

function readPrefs(key) {
  try {
    const raw = localStorage.getItem(key)
    const parsed = raw ? JSON.parse(raw) : null
    return {
      open: new Set(Array.isArray(parsed?.open) ? parsed.open.filter(p => typeof p === 'string') : []),
      gebruik: parsed?.gebruik && typeof parsed.gebruik === 'object' ? { ...parsed.gebruik } : {},
    }
  } catch {
    return { open: new Set(), gebruik: {} }
  }
}

function writePrefs(key, prefs) {
  try {
    localStorage.setItem(key, JSON.stringify({ open: [...prefs.open], gebruik: prefs.gebruik }))
  } catch { /* privé-modus of vol — dan onthoudt hij het gewoon deze sessie */ }
}

export function useFolderPickerPrefs() {
  const [key, setKey] = useState(null)
  const [prefs, setPrefs] = useState(() => ({ open: new Set(), gebruik: {} }))
  const [loaded, setLoaded] = useState(false)

  // Sleutel per gebruiker. Faalt de auth-call, dan `anon` — liever een
  // gedeelde voorkeur op dit toestel dan géén.
  useEffect(() => {
    let cancelled = false
    supabase.auth.getUser()
      .then(({ data }) => { if (!cancelled) setKey(`${KEY_PREFIX}:${data?.user?.id || 'anon'}`) },
        () => { if (!cancelled) setKey(`${KEY_PREFIX}:anon`) })
    return () => { cancelled = true }
  }, [])

  useEffect(() => {
    if (!key) return
    setPrefs(readPrefs(key))
    setLoaded(true)
  }, [key])

  // Eén schrijfmoment, ná elke wijziging — niet in de handlers zelf, anders
  // schrijft een toggle met een verouderde `gebruik` en andersom.
  useEffect(() => {
    if (loaded && key) writePrefs(key, prefs)
  }, [loaded, key, prefs])

  const isOpen = useCallback((path) => prefs.open.has(path), [prefs.open])

  const toggleOpen = useCallback((path) => {
    setPrefs(prev => {
      const open = new Set(prev.open)
      if (open.has(path)) open.delete(path); else open.add(path)
      return { ...prev, open }
    })
  }, [])

  /** Een gelukte verplaatsing naar `path` — telt mee voor de snelknoppen. */
  const bumpUsage = useCallback((path) => {
    if (!path) return
    setPrefs(prev => ({
      ...prev,
      gebruik: { ...prev.gebruik, [path]: (Number(prev.gebruik[path]) || 0) + 1 },
    }))
  }, [])

  /** Paden op volgorde van gebruik (meest eerst). Alleen paden met een teller. */
  const mostUsed = useMemo(
    () => Object.entries(prefs.gebruik)
      .filter(([, n]) => Number(n) > 0)
      .sort((a, b) => (b[1] - a[1]) || a[0].localeCompare(b[0], 'nl'))
      .map(([path]) => path),
    [prefs.gebruik])

  return { loaded, isOpen, toggleOpen, bumpUsage, mostUsed }
}
