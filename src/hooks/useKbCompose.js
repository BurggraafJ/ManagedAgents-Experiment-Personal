import { useState, useCallback, useRef } from 'react'
import { supabase } from '../lib/supabase'

/**
 * useKbCompose — handmatige kennisbank-aanmaak (Kennisbank 2.0, klant-only).
 *  - checkSimilar(): titel+beschrijving → vergelijkbare BESTAANDE artikelen
 *    (kb-compose action='similar'), vóór het genereren.
 *  - generate(): kb-compose schrijft ÉÉN artikel (optioneel met bijstel-
 *    instructie op een eerder resultaat). Geeft { article, similar, context }.
 *  - publish(): publiceert het artikel via RPC create_kb_article
 *    (status 'gevalideerd' = direct live, of 'concept').
 */
export function useKbCompose() {
  const [loading, setLoading] = useState(false)
  const [publishing, setPublishing] = useState(false)
  const [similarLoading, setSimilarLoading] = useState(false)
  const [similar, setSimilar] = useState(null)         // null = nog niet gecheckt
  const [error, setError] = useState(null)
  const [result, setResult] = useState(null)           // { article, similar, context, model }
  const similarSeq = useRef(0)

  const checkSimilar = useCallback(async ({ title, description }) => {
    const seq = ++similarSeq.current
    setSimilarLoading(true)
    try {
      const { data, error: e } = await supabase.functions.invoke('kb-compose', {
        body: { action: 'similar', title, description },
      })
      if (e) throw e
      if (seq === similarSeq.current) setSimilar(data?.ok ? (data.similar || []) : [])
      return { ok: true, similar: data?.similar || [] }
    } catch (e) {
      if (seq === similarSeq.current) setSimilar([])
      return { ok: false, error: e?.message || String(e) }
    } finally {
      if (seq === similarSeq.current) setSimilarLoading(false)
    }
  }, [])

  const generate = useCallback(async ({ title, description, kbCategory, articleType, useContext, instruction, previousBody }) => {
    setLoading(true); setError(null)
    try {
      const { data, error: e } = await supabase.functions.invoke('kb-compose', {
        body: {
          title, description,
          kb_category: kbCategory || null,
          article_type: articleType || null,
          use_context: useContext !== false,
          instruction: instruction || undefined,
          previous_body: previousBody || undefined,
        },
      })
      if (e) throw e
      if (!data?.ok) throw new Error(data?.detail || data?.error || 'Genereren mislukt')
      setResult(data)
      if (Array.isArray(data.similar)) setSimilar(data.similar)
      return { ok: true, data }
    } catch (e) {
      const msg = e?.message || String(e)
      setError(msg)
      return { ok: false, error: msg }
    } finally {
      setLoading(false)
    }
  }, [])

  const publish = useCallback(async ({ article, description, kbCategory, articleType, status, context }) => {
    setPublishing(true)
    try {
      const compose_meta = {
        description,
        model: result?.model || null,
        context_bundle_id: context?.bundle_id || null,
        context_count: context?.count || 0,
      }
      const { data, error: e } = await supabase.rpc('create_kb_article', {
        p_title: article.title, p_body: article.body, p_summary: article.summary,
        p_category: kbCategory || null, p_article_type: articleType || null,
        p_audience: 'klant', p_status: status, p_compose_meta: compose_meta,
      })
      if (e) throw e
      if (data && data.ok === false) throw new Error(data.reason || 'Publiceren mislukt')
      return { ok: true, articleId: data?.article_id, status: data?.status }
    } catch (e) {
      return { ok: false, error: e?.message || String(e) }
    } finally {
      setPublishing(false)
    }
  }, [result])

  const reset = useCallback(() => { setResult(null); setError(null) }, [])

  return { checkSimilar, generate, publish, reset, loading, publishing, similarLoading, similar, error, result }
}
