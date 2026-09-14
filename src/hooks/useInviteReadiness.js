import { useCallback, useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'

// Multi-user M2 — "niet uitnodigen tot de poorten dicht zijn", gemeten in
// plaats van opgeschreven.
//
// Die zin staat sinds mei 2026 op de Confluence-projectpagina en sinds
// 2026-09-14 in DECISIONS als beslissing 1. Tot nu toe was het een afspraak:
// niets in de app controleerde het, en de vier klaarstaande accounts wachtten
// op één klik. `invite_readiness()` (migratie 20260914180000) meet de vier
// structurele poorten op het moment dat die klik valt — uit dezelfde
// configuratie als `scripts/multi_user_acl_eval.cjs`, zodat de knop en de
// pre-flight niet uit elkaar kunnen lopen.
//
// De vier poorten zijn blokkerend. De persoonsregels (heeft hij een mailbox,
// welke rechten leveren hem vandaag niets) zijn een waarschuwing: iemand
// uitnodigen die zijn Outlook nog moet koppelen is de normale volgorde, geen
// fout.
//
// Fail-CLOSED, anders dan `useMyCapabilities`. Hier is dat wél de goede kant:
// een navigatiefilter die hapert kost je een menu-item, een invite die je
// verstuurt terwijl de meting niet lukte kost je een mailbox vol andermans
// gegevens. Bij een fout staat de knop dus dicht, met de foutmelding erbij.
export function useInviteReadiness(userId = null) {
  const [stand, setStand] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)

  const meet = useCallback(async () => {
    setLoading(true)
    const { data, error: err } = await supabase.rpc('invite_readiness', { p_user_id: userId })
    if (err) {
      setError(err.message)
      setStand(null)
    } else {
      setError(null)
      setStand(data || null)
    }
    setLoading(false)
  }, [userId])

  useEffect(() => { meet() }, [meet])

  const poorten = stand?.poorten || []
  const rood = poorten.filter(p => !p.ok)

  return {
    stand,
    poorten,
    rood,
    loading,
    error,
    persoon: stand?.persoon || null,
    // Geen meting (nog bezig, of omgevallen) ⇒ niet uitnodigen.
    magUitnodigen: !loading && !error && !!stand && stand.blokkerend === false,
    refresh: meet,
  }
}
