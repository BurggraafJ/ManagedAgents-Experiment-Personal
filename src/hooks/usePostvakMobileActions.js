import { useCallback, useMemo, useState } from 'react'
import { supabase } from '../lib/supabase'
import { showToast } from '../components/Toast'
import { bucketOf } from '../lib/postvakContract'
import useOutlookMail from './useOutlookMail'

// =============================================================================
// usePostvakMobileActions — wat je met een mail kunt doen op de telefoon
// =============================================================================
// Alle mutaties van `MobilePostvak` bij elkaar, plus de drie lokale overlays die
// de lijst bij de werkelijkheid houden zolang de mail-sync (±15 min) hem nog
// niet heeft ingehaald. Gescheiden van de UI omdat het scherm anders over de
// 400-regel-cap ging, en omdat "wat gebeurt er als ik veeg" niets met opmaak te
// maken heeft (projectregel: hooks scheiden van UI).
//
// ── Drie overlays, drie soorten ─────────────────────────────────────────────
//   actioned  Set   weg uit de lijst (verwijderd, verplaatst)
//   readIds   Set   eenrichting: openen markeert gelezen, nooit andersom
//   pinned    Map   twee kanten op, dus id → true/false en niet "staat erin"
//
// Alle drie zijn **optimistisch met terugdraaien**. Mislukt de Outlook-call, dan
// gaat de rij terug zoals hij was en zegt een toast waarom. Wat er niet gebeurt
// is een lijst die iets anders toont dan de mailbox en dat volhoudt.
//
// ── Twee routes naar Outlook, met opzet ─────────────────────────────────────
// Verwijderen loopt via `submit_autodraft_decision` (zoals desktop), omdat daar
// de hele beslis-administratie aan hangt. Verplaatsen, gelezen en pin lopen
// rechtstreeks via `outlook-live`: dat zijn geen voorstellen om te beoordelen,
// en de lokale execute-baan die de beslissingen oppakt stond tussen 2026-09-10
// en nu stil (OUTLOOK-WRITE-IMPL-NOTES §10). Een veeg hoort niet in een wachtrij
// te belanden die misschien niet draait.

export default function usePostvakMobileActions({ bucketOverrides, setBucket, refresh }) {
  const { markRead, moveToFolder, setPin } = useOutlookMail()
  const [actioned, setActioned] = useState(() => new Set())
  const [readIds, setReadIds] = useState(() => new Set())
  const [pinned, setPinned] = useState(() => new Map())
  const [syncing, setSyncing] = useState(false)
  const [moving, setMoving] = useState(false)

  const hide = useCallback((id) => setActioned(prev => new Set(prev).add(id)), [])
  const unhide = useCallback((id) => setActioned(prev => {
    const n = new Set(prev); n.delete(id); return n
  }), [])

  /** De overlays over de gebouwde rijen heen, vóór splitsen en sorteren. */
  const applyOverlays = useCallback((rows) => {
    if (readIds.size === 0 && pinned.size === 0) return rows
    return rows.map(m => {
      const pin = pinned.get(m.mail_id)
      if (!readIds.has(m.mail_id) && pin === undefined) return m
      return {
        ...m,
        is_read: readIds.has(m.mail_id) ? true : m.is_read,
        is_pinned: pin === undefined ? m.is_pinned : pin,
      }
    })
  }, [readIds, pinned])

  const isPinned = useCallback(
    (m) => (m ? (pinned.get(m.mail_id) ?? m.is_pinned === true) : false), [pinned])

  const forceSync = useCallback(async () => {
    setSyncing(true)
    try {
      const { data, error } = await supabase.rpc('request_mail_sync_now')
      if (error || (data && data.ok === false)) throw new Error(error?.message || data?.reason || 'Sync mislukt')
      setTimeout(() => refresh(), 4000)
    } catch (e) {
      showToast({ kind: 'error', message: 'Sync mislukt', detail: e.message })
    } finally {
      setTimeout(() => setSyncing(false), 4000)
    }
  }, [refresh])

  const remove = useCallback(async (m) => {
    hide(m.mail_id)
    try {
      const { data, error } = await supabase.rpc('submit_autodraft_decision', {
        p_mail_id: m.mail_id, p_action: 'ignore',
        p_target_folder: 'Verwijderde items', p_decision_kind: 'delete',
      })
      if (error || (data && data.ok === false)) throw new Error(error?.message || data?.reason || 'geweigerd')
      showToast({ kind: 'info', message: 'Mail verwijderd', detail: 'Naar Verwijderde items.' })
    } catch (e) {
      unhide(m.mail_id)
      showToast({ kind: 'error', message: 'Verwijderen mislukt', detail: e.message })
    }
  }, [hide, unhide])

  const swapBucket = useCallback((m) => {
    const now = bucketOf(m, { bucketOverrides })
    setBucket(m.mail_id, now === 'overig' ? 'prio' : 'overig')
  }, [bucketOverrides, setBucket])

  const moveMail = useCallback(async (m, targetFolder) => {
    if (!m || !targetFolder) return false
    setMoving(true)
    hide(m.mail_id)
    try {
      await moveToFolder(m.mail_id, targetFolder)
      showToast({ kind: 'info', message: 'Verplaatst', detail: `Naar ${targetFolder}.` })
      return true
    } catch (e) {
      unhide(m.mail_id)
      showToast({ kind: 'error', message: 'Verplaatsen mislukt', detail: routeCopy(e) })
      return false
    } finally {
      setMoving(false)
    }
  }, [moveToFolder, hide, unhide])

  /** Openen = gelezen, ook in Outlook. Alleen voor een mail die dat nog niet is. */
  const openAndRead = useCallback((m) => {
    if (!m || m.is_read !== false || readIds.has(m.mail_id)) return
    setReadIds(prev => new Set(prev).add(m.mail_id))
    markRead(m.mail_id, true).catch(() => {
      setReadIds(prev => { const n = new Set(prev); n.delete(m.mail_id); return n })
    })
  }, [markRead, readIds])

  const togglePin = useCallback(async (m) => {
    const next = !isPinned(m)
    setPinned(prev => new Map(prev).set(m.mail_id, next))
    try {
      const r = await setPin(m.mail_id, next)
      // De Edge Function leest de property ná de schrijfactie terug. Zegt
      // Outlook iets anders dan wij dachten, dan wint Outlook.
      if (typeof r.pinned === 'boolean' && r.pinned !== next) {
        setPinned(prev => new Map(prev).set(m.mail_id, r.pinned))
      }
    } catch (e) {
      setPinned(prev => { const n = new Map(prev); n.delete(m.mail_id); return n })
      showToast({
        kind: 'error', message: next ? 'Vastmaken mislukt' : 'Losmaken mislukt', detail: routeCopy(e),
      })
    }
  }, [isPinned, setPin])

  return useMemo(() => ({
    actioned, syncing, moving,
    applyOverlays, isPinned,
    forceSync, remove, swapBucket, moveMail, openAndRead, togglePin,
  }), [actioned, syncing, moving, applyOverlays, isPinned,
    forceSync, remove, swapBucket, moveMail, openAndRead, togglePin])
}

/**
 * `unknown_action` betekent niet "stuk" maar "deze versie van outlook-live
 * staat nog niet op de server". Dat is een andere mededeling, en hij komt
 * gegarandeerd voor tussen het mergen van deze PR en de edge-deploy.
 */
function routeCopy(e) {
  return e?.reason === 'unknown_action'
    ? 'Deze route staat nog niet op de server — de Edge Function is nog niet uitgerold.'
    : e?.message || 'mislukt'
}
