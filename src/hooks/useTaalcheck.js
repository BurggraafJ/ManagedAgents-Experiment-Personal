import { useState } from 'react'
import { supabase } from '../lib/supabase'
import { showToast } from '../components/Toast'
import { diffWords, diffStats } from '../components/views/postvak2/pv2lib'

// useTaalcheck — de taalcheck-met-track-changes, los van elk schrijfvlak.
//
// Stond tot v1.202 in `components/views/postvak2/Pv2Composer.jsx`. Verhuisd toen
// het mobiele Postvak dezelfde taalcheck kreeg (v1.203): een hook die in twee
// schermen draait hoort in `src/hooks/`, niet in de desktop-view van één ervan.
// De logica is letterlijk overgenomen — dezelfde Edge Function (`taalcheck-v2`),
// dezelfde niveaus, dezelfde localStorage-sleutel, zodat de intensiteit die je
// op desktop koos ook op je telefoon geldt.
//
// Niveaus (review-ronde 2, Jelle's definitie):
//   1 = altijd alle fouten eruit, zo min mogelijk herschrijven
//   2 = ook kromme/niet-lopende zinnen beter vormgeven
//   3 = boodschap en stijl behouden maar beter verwoord
export const TC_LEVELS = {
  1: 'Foutloos',
  2: 'Vloeiend',
  3: 'Beter verwoord',
}
export const TC_MAX_LEVEL = 3

export function useTaalcheck({ getBody, setBody }) {
  const [tc, setTc] = useState(null)
  const [busy, setBusy] = useState(false)
  const [level, setLevelState] = useState(() => {
    const v = parseInt(localStorage.getItem('pvk2-tc-level') || '1', 10)
    return v >= 1 && v <= TC_MAX_LEVEL ? v : 1
  })
  const setLevel = (v) => {
    const n = Math.max(1, Math.min(TC_MAX_LEVEL, Number(v) || 1))
    setLevelState(n)
    try { localStorage.setItem('pvk2-tc-level', String(n)) } catch { /* ignore */ }
  }

  async function runOn(original, lvl) {
    if (!original || !original.trim() || busy) return
    setBusy(true)
    try {
      const { data, error } = await supabase.functions.invoke('taalcheck-v2', {
        body: { text: original, level: lvl },
      })
      if (error) throw new Error(error.message)
      if (!data || !data.ok) throw new Error(data?.reason || 'geen resultaat')
      const corrected = data.corrected || ''
      const segments = diffWords(original, corrected)
      const stats = diffStats(segments)
      if (!stats.changed || data.changed === false) {
        showToast({ kind: 'info', message: 'Niets te verbeteren', detail: `Op niveau "${TC_LEVELS[lvl]}" is de tekst al goed.` })
        setTc(null)
      } else {
        setTc({ segments, stats, original, corrected, level: lvl })
      }
    } catch (e) {
      showToast({ kind: 'error', message: 'Taalcheck mislukt', detail: e.message })
    }
    setBusy(false)
  }

  const run = () => runOn(getBody(), level)
  // Opnieuw: zelfde ORIGINELE tekst, met het (evt. net gewijzigde) niveau.
  const rerun = () => { if (tc) runOn(tc.original, level) }

  function accept() {
    if (!tc) return
    setBody(tc.corrected)
    setTc(null)
    showToast({ message: 'Taalcheck overgenomen' })
  }
  function reject() { setTc(null) }
  function copyCorrected() {
    if (!tc) return
    navigator.clipboard.writeText(tc.corrected).then(
      () => showToast({ message: 'Gecorrigeerde tekst gekopieerd' }),
      () => showToast({ kind: 'error', message: 'Kopiëren mislukt' }),
    )
  }

  return {
    tc, taalcheckBusy: busy, runTaalcheck: run, rerunTaalcheck: rerun,
    acceptTaalcheck: accept, rejectTaalcheck: reject, copyTaalcheck: copyCorrected,
    tcLevel: level, setTcLevel: setLevel,
  }
}
