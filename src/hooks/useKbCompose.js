import { useState, useCallback } from 'react'
import { supabase } from '../lib/supabase'

/**
 * useKbCompose — handmatige kennisbank-aanmaak.
 *  - generate(): roept de kb-compose Edge Function aan (context-zoeker + 2 varianten).
 *    Slaat niets op; geeft { variants, context, model } terug.
 *  - publish(): publiceert de gekozen variant via RPC create_kb_article
 *    (status 'gevalideerd' = direct live, of 'concept' = parkeren).
 */
export function useKbCompose() {
  const [loading, setLoading] = useState(false)       // bezig met genereren
  const [publishing, setPublishing] = useState(false)
  const [error, setError] = useState(null)
  const [result, setResult] = useState(null)          // { variants, context, model }

  const generate = useCallback(async ({ description, audience, kbCategory, articleType, useContext }) => {
    setLoading(true); setError(null)
    try {
      const { data, error: e } = await supabase.functions.invoke('kb-compose', {
        body: {
          description, audience,
          kb_category: kbCategory || null,
          article_type: articleType || null,
          use_context: useContext !== false,
        },
      })
      if (e) throw e
      if (!data?.ok) throw new Error(data?.detail || data?.error || 'Genereren mislukt')
      setResult(data)
      return { ok: true, data }
    } catch (e) {
      const msg = e?.message || String(e)
      setError(msg)
      return { ok: false, error: msg }
    } finally {
      setLoading(false)
    }
  }, [])

  const publish = useCallback(async ({ variant, description, audience, kbCategory, articleType, status, context }) => {
    setPublishing(true)
    try {
      const compose_meta = {
        description,
        variant_key: variant.key,
        model: variant.model || result?.model || null,
        context_bundle_id: context?.bundle_id || null,
        context_count: context?.count || 0,
      }
      const { data, error: e } = await supabase.rpc('create_kb_article', {
        p_title: variant.title, p_body: variant.body, p_summary: variant.summary,
        p_category: kbCategory || null, p_article_type: articleType || null,
        p_audience: audience, p_status: status, p_compose_meta: compose_meta,
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

  return { generate, publish, reset, loading, publishing, error, result }
}
