import { useCallback, useEffect, useMemo, useState } from 'react'
import { supabase } from '../lib/supabase'

// Multi-user · de rechten-catalogus, de rol-presets en de persoonlijke
// afwijkingen — de drie tabellen waar `has_capability()` uit rekent.
//
// Drie selects in plaats van 256 RPC-calls: `user_capabilities_overview()` is
// per persoon, en met 8 mensen × 32 rijen zou de matrix acht round-trips doen
// vóór hij iets kan tekenen. De catalogus en de presets zijn voor iedereen
// gelijk; alleen de overrides verschillen. De rekenregel staat in
// lib/capabilities.js en is een letterlijke spiegel van de SQL.
//
// RLS (migratie 20260914143000):
//   capabilities        select: iedereen die is ingelogd
//   role_capabilities   select: iedereen die is ingelogd
//   user_capabilities   select: de eigen rijen, of alles als owner
//                       write : owner (is_admin_or_higher → 2FA vereist)
//
// Een member die deze hook zou draaien ziet dus de catalogus en zijn eigen
// afwijkingen — niet die van een ander. De pagina zelf zit achter de
// owner-gate van OrganisatieView.
export function useCapabilities() {
  const [caps, setCaps] = useState([])
  const [presets, setPresets] = useState([])
  const [overrides, setOverrides] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)

  const fetchAll = useCallback(async () => {
    setLoading(true)
    setError(null)
    const [c, p, o] = await Promise.all([
      supabase.from('capabilities').select('*').order('sort_order'),
      supabase.from('role_capabilities').select('app_role, capability'),
      supabase.from('user_capabilities').select('user_id, capability, effect, granted_at, note'),
    ])
    const err = c.error || p.error || o.error
    if (err) {
      setError(err.message)
      setLoading(false)
      return
    }
    setCaps(c.data || [])
    setPresets(p.data || [])
    setOverrides(o.data || [])
    setLoading(false)
  }, [])

  useEffect(() => { fetchAll() }, [fetchAll])

  // rol → set van capability-keys die de preset geeft.
  const presetByRole = useMemo(() => {
    const m = new Map()
    for (const row of presets) {
      if (!m.has(row.app_role)) m.set(row.app_role, new Set())
      m.get(row.app_role).add(row.capability)
    }
    return m
  }, [presets])

  // user_id → Map(capability → override-rij)
  const overrideByUser = useMemo(() => {
    const m = new Map()
    for (const row of overrides) {
      if (!m.has(row.user_id)) m.set(row.user_id, new Map())
      m.get(row.user_id).set(row.capability, row)
    }
    return m
  }, [overrides])

  // Eén vinkje zetten of weghalen, voor één persoon en één of meer rechten
  // (een bundel is meerdere). De regel die het scherm leesbaar houdt:
  //
  //   nieuwe stand == de rol-standaard  →  de override-rij VERDWIJNT
  //   nieuwe stand != de rol-standaard  →  override 'grant' of 'revoke'
  //
  // Daardoor betekent "oranje" altijd "hier is bewust van de norm afgeweken",
  // en levert "Terug naar de standaard" zichzelf op: rijen weggooien.
  const setCapabilities = useCallback(async ({ userId, capKeys, on, role }) => {
    const preset = presetByRole.get(role) || new Set()
    const toDelete = []
    const toUpsert = []
    for (const key of capKeys) {
      if (preset.has(key) === on) toDelete.push(key)
      else toUpsert.push({ user_id: userId, capability: key, effect: on ? 'grant' : 'revoke' })
    }

    if (toDelete.length) {
      const { error: delErr } = await supabase
        .from('user_capabilities')
        .delete()
        .eq('user_id', userId)
        .in('capability', toDelete)
      if (delErr) throw new Error(delErr.message)
    }
    if (toUpsert.length) {
      const { error: upErr } = await supabase
        .from('user_capabilities')
        .upsert(toUpsert, { onConflict: 'user_id,capability' })
      if (upErr) throw new Error(upErr.message)
    }
    await fetchAll()
  }, [presetByRole, fetchAll])

  // Alle handmatige afwijkingen van één persoon weg — terug naar de preset.
  const resetUser = useCallback(async (userId) => {
    const { error: delErr } = await supabase
      .from('user_capabilities')
      .delete()
      .eq('user_id', userId)
    if (delErr) throw new Error(delErr.message)
    await fetchAll()
  }, [fetchAll])

  return {
    caps, presetByRole, overrideByUser,
    loading, error,
    refresh: fetchAll, setCapabilities, resetUser,
  }
}
