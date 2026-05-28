import { useCallback, useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'

// useInboxOptimistic — bundelt de drie optimistic-UI-maps voor InboxPanel:
//   • actionedIds        — mails die de gebruiker net verstuurd/genegeerd heeft;
//                          verbergt ze direct uit de lijst tot de DB-sync klopt.
//   • categoryOverrides  — categorie-wissels die meteen de chip kleuren én
//                          de wacht-bucket bijwerken; opgeruimd zodra mails-prop
//                          de nieuwe key reflecteert.
//   • flagOverrides      — pin/unpin met TTL-cleanup (30s) zodat snel-klikken
//                          niet flickert wanneer mail_messages-refetch vóór de
//                          DB-update binnenkomt.
//
// Elke map heeft een eigen useEffect-cleanup die de override wegruimt zodra
// de DB de waarde bevestigt. Alle handlers retourneren useCallback's zodat
// child-components stabiele referenties krijgen.
export function useInboxOptimistic({ mails, mailMessages }) {
  // ---- actionedIds ----
  const [actionedIds, setActionedIds] = useState(() => new Set())
  const markActioned = useCallback((mailId) => {
    setActionedIds(prev => {
      const next = new Set(prev)
      next.add(mailId)
      return next
    })
  }, [])
  const unmarkActioned = useCallback((mailId) => {
    setActionedIds(prev => {
      const next = new Set(prev)
      next.delete(mailId)
      return next
    })
  }, [])
  useEffect(() => {
    setActionedIds(prev => {
      if (prev.size === 0) return prev
      const next = new Set()
      for (const id of prev) {
        const m = mails.find(x => x.mail_id === id)
        if (m && (m.status === 'pending' || m.status === 'amended')) next.add(id)
      }
      return next
    })
  }, [mails])

  // ---- categoryOverrides ----
  const [categoryOverrides, setCategoryOverrides] = useState(() => new Map())
  const changeCategoryOptimistic = useCallback(async (mailId, newKey) => {
    setCategoryOverrides(prev => { const n = new Map(prev); n.set(mailId, newKey || ''); return n })
    // Best-effort persist — awaiting (uitgaande) mails hebben vaak geen
    // autodraft_mails-row, dan landt de RPC niets. UI blijft de keuze tonen;
    // cleanup-effect ruimt de override op zodra de mails-prop de waarde bevat.
    try {
      await supabase.rpc('set_autodraft_mail_category', {
        p_mail_id: mailId, p_category_key: newKey || null,
      })
    } catch { /* best-effort persist */ }
  }, [])
  useEffect(() => {
    setCategoryOverrides(prev => {
      if (prev.size === 0) return prev
      let changed = false
      const next = new Map(prev)
      for (const [id, key] of prev.entries()) {
        const m = mails.find(x => x.mail_id === id)
        if (m && (m.category_key || '') === (key || '')) { next.delete(id); changed = true }
      }
      return changed ? next : prev
    })
  }, [mails])

  // ---- flagOverrides ----
  // TTL-cleanup voorkomt de "ster vinkt direct uit"-bug: bij snel-klikken kon
  // mail_messages-refetch eerder binnenkomen dan de DB-flag was bijgewerkt door
  // de execute-skill. We houden de override 30s vast en verwijderen pas zodra
  // de DB-status klopt — anders schakelt de UI tussen oude en nieuwe waarde.
  const [flagOverrides, setFlagOverrides] = useState(() => new Map())
  const handleToggleFlag = useCallback(async (mailId, newVal) => {
    setFlagOverrides(prev => {
      const next = new Map(prev)
      next.set(mailId, { val: newVal, setAt: Date.now() })
      return next
    })
    try {
      const { data, error } = await supabase.rpc('set_mail_flag', { p_mail_id: mailId, p_flag: newVal })
      if (error || (data && data.ok === false)) {
        setFlagOverrides(prev => {
          const next = new Map(prev)
          next.delete(mailId)
          return next
        })
      }
    } catch {
      setFlagOverrides(prev => {
        const next = new Map(prev)
        next.delete(mailId)
        return next
      })
    }
  }, [])
  useEffect(() => {
    const interval = setInterval(() => {
      setFlagOverrides(prev => {
        if (prev.size === 0) return prev
        const now = Date.now()
        const dbFlagged = new Set()
        for (const m of (mailMessages || [])) {
          if (m.flag_status === 'flagged') dbFlagged.add(m.id)
        }
        let changed = false
        const next = new Map(prev)
        for (const [id, entry] of prev.entries()) {
          const ageMs = now - (entry?.setAt || 0)
          if (ageMs > 30000 && entry?.val === dbFlagged.has(id)) {
            next.delete(id)
            changed = true
          }
        }
        return changed ? next : prev
      })
    }, 5000)
    return () => clearInterval(interval)
  }, [mailMessages])

  return {
    actionedIds, markActioned, unmarkActioned,
    categoryOverrides, changeCategoryOptimistic,
    flagOverrides, handleToggleFlag,
  }
}
