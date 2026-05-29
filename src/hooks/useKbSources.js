import { useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'

/**
 * useKbSources — lazy: haalt bron-vragen (kb_question_signals) + bron-mails
 * (RPC kb_get_source_mails) op zodra `enabled` true wordt, en combineert ze
 * tot transparante bron-rijen. Gebruikt door de review-queue (per voorstel,
 * pas bij uitklappen) zodat we niet 121× upfront fetchen.
 */
export function useKbSources(signalIds, mailIds, enabled) {
  const [sources, setSources] = useState([])
  const [extras, setExtras] = useState([])
  const [loading, setLoading] = useState(false)
  const [done, setDone] = useState(false)

  const sigKey = (signalIds || []).join(',')
  const mailKey = (mailIds || []).join(',')

  useEffect(() => {
    if (!enabled || done) return
    let cancelled = false
    const sIds = Array.isArray(signalIds) ? signalIds : []
    const mIds = Array.isArray(mailIds) ? mailIds : []
    if (sIds.length === 0 && mIds.length === 0) { setDone(true); return }

    setLoading(true)
    Promise.all([
      sIds.length
        ? supabase.from('kb_question_signals')
            .select('id,mail_id,canonical_question,answer_text,answer_status,generalizable,party_type,topics,received_at')
            .in('id', sIds)
        : Promise.resolve({ data: [] }),
      mIds.length ? supabase.rpc('kb_get_source_mails', { p_mail_ids: mIds }) : Promise.resolve({ data: [] }),
    ]).then(([{ data: signals }, { data: mails }]) => {
      if (cancelled) return
      const mailById = new Map((mails || []).map(m => [m.mail_id, m]))
      const used = new Set()
      const rows = (signals || []).map(sig => {
        const mail = mailById.get(sig.mail_id) || null
        if (mail) used.add(mail.mail_id)
        return { signal: sig, mail }
      })
      rows.sort((a, b) => sIds.indexOf(a.signal.id) - sIds.indexOf(b.signal.id))
      setSources(rows)
      setExtras((mails || []).filter(m => !used.has(m.mail_id)))
      setDone(true)
    }).catch(() => { if (!cancelled) setDone(true) })
      .finally(() => { if (!cancelled) setLoading(false) })

    return () => { cancelled = true }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled, sigKey, mailKey])

  return { sources, extras, loading }
}
