import { useCallback, useEffect, useState } from 'react'
import { supabase, createRealtimeChannel } from '../lib/supabase'

/**
 * useKbArticle — data voor de /kennisbank artikel-detail (Project Kennisbank).
 * Haalt het gepubliceerde artikel + categorie + de bron-vragen
 * (kb_question_signals) + de bron-mails (RPC kb_get_source_mails) en
 * combineert ze tot transparante "bron-rijen" (vraag + antwoord + mail).
 */
const ARTICLE_COLS =
  'id,article_no,author_name,title,body,summary,kb_category,article_type,audience,status,confidence,' +
  'source_mail_ids,source_signal_ids,last_verified_at,verified_by,review_due_at,' +
  'needs_review_reason,version,created_at,updated_at,origin,compose_meta'

export function useKbArticle(articleId) {
  const [article, setArticle] = useState(null)
  const [category, setCategory] = useState(null)
  const [sources, setSources] = useState([])   // [{ signal, mail }] — vraag/antwoord per bron
  const [extras, setExtras] = useState([])      // overige bron-mails zonder eigen signaal
  const [provenance, setProvenance] = useState(null) // { rationale, evidence } uit het bron-voorstel
  const [loading, setLoading] = useState(true)
  const [notFound, setNotFound] = useState(false)
  const [error, setError] = useState(null)

  const refresh = useCallback(async () => {
    if (!articleId) { setLoading(false); setNotFound(true); return }
    try {
      const { data: art, error: e1 } = await supabase
        .from('kb_articles').select(ARTICLE_COLS).eq('id', articleId).maybeSingle()
      if (e1) throw e1
      if (!art) { setArticle(null); setNotFound(true); setLoading(false); return }
      setNotFound(false)
      setArticle(art)

      const signalIds = Array.isArray(art.source_signal_ids) ? art.source_signal_ids : []
      const mailIds = Array.isArray(art.source_mail_ids) ? art.source_mail_ids : []

      const [{ data: cat }, { data: signals, error: e2 }, { data: mails, error: e3 }, { data: prop }] = await Promise.all([
        supabase.from('kb_categories').select('id,label,review_interval_days').eq('id', art.kb_category).maybeSingle(),
        signalIds.length
          ? supabase.from('kb_question_signals')
              .select('id,mail_id,canonical_question,answer_text,answer_status,generalizable,party_type,topics,received_at')
              .in('id', signalIds)
          : Promise.resolve({ data: [] }),
        mailIds.length
          ? supabase.rpc('kb_get_source_mails', { p_mail_ids: mailIds })
          : Promise.resolve({ data: [] }),
        // Het bron-voorstel (rationale + evidence) — gekoppeld via article_id na goedkeuren.
        supabase.from('kb_article_proposals')
          .select('rationale,evidence,confidence')
          .eq('article_id', articleId).order('reviewed_at', { ascending: false }).limit(1).maybeSingle(),
      ])
      if (e2) throw e2
      if (e3) throw e3

      setCategory(cat || null)
      setProvenance(prop || null)

      const mailById = new Map((mails || []).map(m => [m.mail_id, m]))
      const usedMailIds = new Set()
      const rows = (signals || []).map(sig => {
        const mail = mailById.get(sig.mail_id) || null
        if (mail) usedMailIds.add(mail.mail_id)
        return { signal: sig, mail }
      })
      // Houd dezelfde volgorde aan als de curator (source_signal_ids).
      rows.sort((a, b) => signalIds.indexOf(a.signal.id) - signalIds.indexOf(b.signal.id))
      setSources(rows)
      setExtras((mails || []).filter(m => !usedMailIds.has(m.mail_id)))
      setError(null)
    } catch (e) {
      setError(e?.message || String(e))
    } finally {
      setLoading(false)
    }
  }, [articleId])

  useEffect(() => { setLoading(true); refresh() }, [refresh])

  useEffect(() => {
    if (!articleId) return
    const channel = createRealtimeChannel('kb-article-live')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'kb_articles', filter: `id=eq.${articleId}` }, () => refresh())
      .subscribe()
    return () => supabase.removeChannel(channel)
  }, [articleId, refresh])

  return { article, category, sources, extras, provenance, loading, notFound, error, refresh }
}
