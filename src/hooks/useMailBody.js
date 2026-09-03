import { useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'

/**
 * useMailBody — haalt de volledige mail-body lazy op uit mail_messages.
 *
 * mail_messages is truth-of-source voor bodies; autodraft_mails is dat niet.
 * Twee redenen waarom een detail-view nooit op de lijst-row mag leunen:
 *   1. useAutoDraft() selecteert uit mail_messages alleen body_preview — en die
 *      kapt Outlook/Graph af op ~255 tekens (eindigt zichtbaar op "…").
 *   2. writeCache() in useAutoDraft strips body_html/body_text uit de
 *      autodraft_mails-rijen vóór de localStorage-write (slimMails), dus na een
 *      cache-hydrate zijn ze sowieso weg.
 * Desktop (Pv2Detail) doet deze fetch al inline voor de hele conversatie; deze
 * hook is dezelfde bron voor losse mails (mobiel detail-sheet).
 *
 * Key: mail_messages.id === autodraft_mails.mail_id.
 *
 * @param {string|null} mailId
 * @returns {{ full: object|null, loading: boolean }}
 */
export function useMailBody(mailId) {
  const [full, setFull] = useState(null)
  const [loading, setLoading] = useState(!!mailId)

  useEffect(() => {
    if (!mailId) {
      setFull(null)
      setLoading(false)
      return undefined
    }
    let cancelled = false
    setFull(null)
    setLoading(true)
    supabase.from('mail_messages')
      .select('id,body_html,body_text,body_truncated')
      .eq('id', mailId)
      .maybeSingle()
      .then(({ data }) => {
        if (cancelled) return
        setFull(data || null)
        setLoading(false)
      }, () => {
        // Netwerkfout — val stil terug op wat de lijst-row had (preview).
        if (!cancelled) setLoading(false)
      })
    return () => { cancelled = true }
  }, [mailId])

  return { full, loading }
}
