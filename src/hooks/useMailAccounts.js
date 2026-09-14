import { useCallback, useEffect, useMemo, useState } from 'react'
import { supabase } from '../lib/supabase'

// Multi-user · heeft deze persoon zijn inbox al gekoppeld? (beslissing 4)
//
// Bron: `v_mailbox_link_status` (migratie 20260914150000) — vier vlaggen en
// geen veld meer. De tabel `mail_accounts` zelf is voor de browser gesloten:
// `authenticated` heeft er geen table-grant op, en daar staan composio-id's in.
//
// De view geeft de owner iedereen en een member zichzelf. Valt hij om, dan is
// dat geen blokkade voor het scherm eromheen: de kolom blijft dan leeg in
// plaats van dat de matrix niet laadt. Een mislukte statuskolom mag geen
// rechtenscherm kosten.
export function useMailAccounts() {
  const [rows, setRows] = useState([])
  const [error, setError] = useState(null)
  const [loading, setLoading] = useState(true)

  const fetchRows = useCallback(async () => {
    setLoading(true)
    const { data, error: err } = await supabase
      .from('v_mailbox_link_status')
      .select('user_id, gekoppeld, enabled, paused, last_sync_finished_at, heeft_fout')
    if (err) {
      setError(err.message)
      setRows([])
    } else {
      setError(null)
      setRows(data || [])
    }
    setLoading(false)
  }, [])

  useEffect(() => { fetchRows() }, [fetchRows])

  const byUser = useMemo(
    () => new Map(rows.map(r => [r.user_id, r])),
    [rows],
  )

  return { byUser, loading, error, refresh: fetchRows }
}

// Eén rij → het pilletje in de matrixkop. Pure functie, geen hook-identiteit,
// zodat de memo van de pagina er niet elke render op stuk loopt.
export function mailboxStatus(row) {
  if (!row || !row.gekoppeld) {
    return { cls: '', label: 'geen inbox', title: 'Nog geen eigen mailbox-koppeling. De collega koppelt zelf via Instellingen → Connectors.' }
  }
  if (row.heeft_fout) {
    return { cls: 'is-err', label: 'inbox fout', title: 'De koppeling bestaat maar de laatste synchronisatie gaf een fout.' }
  }
  if (row.paused || !row.enabled) {
    return { cls: 'is-err', label: 'inbox uit', title: row.paused ? 'De koppeling staat gepauzeerd.' : 'De koppeling staat uit.' }
  }
  const laatst = row.last_sync_finished_at
    ? new Date(row.last_sync_finished_at).toLocaleString('nl-NL', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })
    : 'nog niet gedraaid'
  return { cls: 'is-on', label: 'inbox', title: `Eigen mailbox gekoppeld · laatste synchronisatie: ${laatst}` }
}
