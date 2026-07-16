import { useCallback, useEffect, useRef, useState } from 'react'
import { supabase } from '../lib/supabase'
import { showToast } from '../components/Toast'

/* usePv2Outlook — drie kleine hooks voor Postvak variant 2 (review-ronde 3):
 *
 * 1. usePv2BucketOverrides — handmatig Prioriteit/Overige verplaatsen.
 *    Outlook's eigen Prioriteit/Overige-vlag wordt (nog) niet gesynct;
 *    dit is de gebruikers-override die van de AI-audience wint.
 * 2. usePv2Drafts — de échte Outlook Concepten-map, live via Edge Function
 *    `outlook-live` (mail-sync synct die map niet).
 * 3. usePv2Signature — handtekening in agent_config, onder elke mail. */

export function usePv2BucketOverrides() {
  const [overrides, setOverrides] = useState(() => new Map())

  const refresh = useCallback(async () => {
    try {
      const { data } = await supabase.from('postvak_bucket_overrides')
        .select('mail_id,bucket').limit(1000)
      setOverrides(new Map((data || []).map(r => [r.mail_id, r.bucket])))
    } catch { /* override is nice-to-have */ }
  }, [])
  useEffect(() => { refresh() }, [refresh])

  const setBucket = useCallback(async (mailId, bucket) => {
    setOverrides(prev => { const n = new Map(prev); n.set(mailId, bucket); return n })
    try {
      const { data, error } = await supabase.rpc('set_mail_bucket', { p_mail_id: mailId, p_bucket: bucket })
      if (error || (data && data.ok === false)) throw new Error(error?.message || data?.reason || 'mislukt')
      showToast({ message: bucket === 'overig' ? 'Naar Overige verplaatst' : 'Naar Prioriteit verplaatst' })
    } catch (e) {
      setOverrides(prev => { const n = new Map(prev); n.delete(mailId); return n })
      showToast({ kind: 'error', message: 'Verplaatsen mislukt', detail: e.message })
    }
  }, [])

  return { bucketOverrides: overrides, setBucket }
}

const DRAFTS_TTL_MS = 60 * 1000

export function usePv2Drafts(active) {
  const [drafts, setDrafts] = useState(null)   // null = nog niet geladen
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState(null)
  const lastFetch = useRef(0)

  const refresh = useCallback(async (force) => {
    if (loading) return
    if (!force && Date.now() - lastFetch.current < DRAFTS_TTL_MS) return
    setLoading(true)
    try {
      const { data, error: e } = await supabase.functions.invoke('outlook-live', { body: { action: 'drafts' } })
      if (e) throw new Error(e.message)
      if (!data || !data.ok) throw new Error(data?.reason || 'geen resultaat')
      setDrafts(Array.isArray(data.drafts) ? data.drafts : [])
      setError(null)
      lastFetch.current = Date.now()
    } catch (e2) {
      setError(e2.message)
      if (drafts === null) setDrafts([])
    }
    setLoading(false)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loading, drafts])

  useEffect(() => { if (active) refresh(false) }, [active, refresh])

  return { drafts, draftsLoading: loading, draftsError: error, refreshDrafts: () => refresh(true) }
}

// Inline (cid:) afbeeldingen per mail, on-demand + gecached per sessie.
const cidCache = new Map()
export function usePv2InlineImages() {
  const [byMsg, setByMsg] = useState(() => new Map())
  const pending = useRef(new Set())

  const load = useCallback(async (messageId) => {
    if (!messageId || cidCache.has(messageId) || pending.current.has(messageId)) return
    pending.current.add(messageId)
    try {
      const { data, error } = await supabase.functions.invoke('outlook-live', {
        body: { action: 'inline_images', message_id: messageId },
      })
      const images = (data && data.ok && data.images) ? data.images : {}
      if (error) throw new Error(error.message)
      cidCache.set(messageId, images)
      setByMsg(prev => { const n = new Map(prev); n.set(messageId, images); return n })
    } catch {
      cidCache.set(messageId, {})
    } finally {
      pending.current.delete(messageId)
    }
  }, [])

  const get = useCallback(messageId => byMsg.get(messageId) || cidCache.get(messageId) || null, [byMsg])
  return { loadInlineImages: load, getInlineImages: get }
}

export function usePv2Signature() {
  const [signature, setSignature] = useState('')
  const [loaded, setLoaded] = useState(false)

  useEffect(() => {
    let cancel = false
    supabase.from('agent_config').select('config_value')
      .eq('agent_name', 'auto-draft').eq('config_key', 'postvak_signature').maybeSingle()
      .then(({ data }) => {
        if (cancel) return
        const v = data?.config_value
        setSignature(typeof v === 'string' ? v : (v?.text || ''))
        setLoaded(true)
      })
    return () => { cancel = true }
  }, [])

  const save = useCallback(async (text) => {
    const clean = String(text || '').trim()
    setSignature(clean)
    try {
      const { error } = await supabase.rpc('upsert_agent_config', {
        p_agent_name: 'auto-draft',
        p_config_key: 'postvak_signature',
        p_config_value: { text: clean },
        p_updated_by: 'dashboard-postvak2',
      })
      if (error) throw new Error(error.message)
      showToast({ message: 'Handtekening opgeslagen', detail: 'Wordt onder elke mail gezet.' })
    } catch (e) {
      showToast({ kind: 'error', message: 'Opslaan mislukt', detail: e.message })
    }
  }, [])

  return { signature, signatureLoaded: loaded, saveSignature: save }
}

// Handtekening onder een body plakken (idempotent — niet dubbel toevoegen).
export function withSignature(body, signature) {
  const b = String(body || '').trimEnd()
  const s = String(signature || '').trim()
  if (!s) return b
  if (b.includes(s)) return b
  return `${b}\n\n${s}`
}
