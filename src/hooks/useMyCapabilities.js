import { useCallback, useEffect, useMemo, useState } from 'react'
import { supabase } from '../lib/supabase'

// Multi-user · mijn eigen effectieve rechten — de eerste lezer van
// `my_capabilities()`, de RPC die P0 bouwde en die tot nu toe door niets werd
// aangeroepen (migratie 20260914143000).
//
// De RPC rekent met `has_capability()`: preset(rol) Δ override(persoon), met
// een eigen tak voor niet-uitdeelbare rechten. Hij faalt closed op een
// onbekende key, een lege uid en een onbekende rol.
//
// ── Waarom dit scherm fail-OPEN leest en dat geen fout is ───────────────────
// Deze hook voedt één ding: welke rijen de Organisatie-navigatie toont. Dat is
// een cosmetische filter áchter twee echte poorten — de `isOwner`-gate van
// OrganisatieView en de RLS onder elke pagina. Valt de RPC om (netwerk, een
// sessie die net verliep), dan is `ready` false en toont de nav alles; de
// poorten eronder blijven staan.
//
// Andersom zou het misgaan: fail-closed op een cosmetische filter sluit de
// owner buiten zijn eigen portaal zodra één query hapert, terwijl er niets te
// beschermen viel — de echte afscherming zit niet hier.
//
// ⚠ Zodra `has_capability()` wél in policies komt te staan, verandert dat niet:
// de handhaving hoort in de database, niet in deze hook.
// `enabled: false` slaat de query over. Dat is er voor componenten die de hook
// ook als prop kunnen krijgen (OrganisatieView sinds v1.198): dan draait er één
// instantie per tree in plaats van twee — pre-flight-regel 4.
export function useMyCapabilities({ enabled = true } = {}) {
  const [rows, setRows] = useState([])
  const [loading, setLoading] = useState(enabled)
  const [error, setError] = useState(null)

  const fetchCaps = useCallback(async () => {
    if (!enabled) { setLoading(false); return }
    setLoading(true)
    const { data, error: err } = await supabase.rpc('my_capabilities')
    if (err) {
      setError(err.message)
      setRows([])
    } else {
      setError(null)
      setRows(data || [])
    }
    setLoading(false)
  }, [enabled])

  useEffect(() => { fetchCaps() }, [fetchCaps])

  const actief = useMemo(
    () => new Set(rows.filter(r => r.actief).map(r => r.capability)),
    [rows],
  )

  return {
    rows,
    loading,
    error,
    // Pas als dit true is mag er iets verborgen worden. Zolang hij false is
    // toont de nav alles — zie de fail-open-uitleg hierboven.
    ready: !loading && !error && rows.length > 0,
    has: useCallback((key) => actief.has(key), [actief]),
    refresh: fetchCaps,
  }
}
