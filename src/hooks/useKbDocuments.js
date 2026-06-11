import { useCallback, useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'

/**
 * useKbDocuments — documenten bij de kennisbank.
 *
 * Twee niveaus, gedeeld via dezelfde tabel `kb_documents` + bucket `kennisbank`:
 *  - BIBLIOTHEEK : {}                → article_id IS NULL (losse docs)
 *  - BIJLAGEN    : { articleId }     → article_id = articleId (bij één artikel)
 * Kennisbank 2.0: één kennisbank (klant) — audience is geen filter meer.
 *
 * Geen realtime: documenten muteren alleen door Jelle zelf → simpele refetch
 * na upload/verwijderen (vermijdt het channel-naam-risico uit CLAUDE.md).
 * Download via signed URL (private bucket, RLS = is_app_owner()).
 */
const BUCKET = 'kennisbank'
const COLS = 'id,audience,article_id,title,description,storage_path,file_name,mime_type,size_bytes,created_at'

function safeName(name) {
  return String(name || 'bestand').normalize('NFD').replace(/[^\w.\- ]+/g, '').replace(/\s+/g, '_').slice(0, 120) || 'bestand'
}

export function useKbDocuments({ articleId = null } = {}) {
  const [docs, setDocs] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const [busy, setBusy] = useState(false)

  const refresh = useCallback(async () => {
    try {
      let q = supabase.from('kb_documents').select(COLS).order('created_at', { ascending: false })
      q = articleId ? q.eq('article_id', articleId) : q.is('article_id', null)
      const { data, error: e } = await q
      if (e) throw e
      setDocs(data || [])
      setError(null)
    } catch (e) {
      setError(e?.message || String(e))
    } finally {
      setLoading(false)
    }
  }, [articleId])

  useEffect(() => { setLoading(true); refresh() }, [refresh])

  // Upload één bestand → storage + rij in kb_documents.
  const upload = useCallback(async (file, { title } = {}) => {
    if (!file) return { ok: false, error: 'geen bestand' }
    setBusy(true)
    try {
      const uuid = crypto.randomUUID()
      const path = `klant/${articleId || 'library'}/${uuid}-${safeName(file.name)}`
      const { error: upErr } = await supabase.storage.from(BUCKET).upload(path, file, {
        cacheControl: '3600', upsert: false, contentType: file.type || undefined,
      })
      if (upErr) throw upErr
      const { error: insErr } = await supabase.from('kb_documents').insert({
        audience: 'klant', article_id: articleId,
        title: (title || file.name || 'Document').slice(0, 200),
        storage_path: path, file_name: file.name || 'bestand',
        mime_type: file.type || null, size_bytes: file.size ?? null,
      })
      if (insErr) { await supabase.storage.from(BUCKET).remove([path]).catch(() => {}); throw insErr }
      await refresh()
      return { ok: true }
    } catch (e) {
      return { ok: false, error: e?.message || String(e) }
    } finally {
      setBusy(false)
    }
  }, [articleId, refresh])

  // Verwijder een document → storage + rij.
  const remove = useCallback(async (doc) => {
    if (!doc) return { ok: false }
    setBusy(true)
    try {
      await supabase.storage.from(BUCKET).remove([doc.storage_path]).catch(() => {})
      const { error: e } = await supabase.from('kb_documents').delete().eq('id', doc.id)
      if (e) throw e
      await refresh()
      return { ok: true }
    } catch (e) {
      return { ok: false, error: e?.message || String(e) }
    } finally {
      setBusy(false)
    }
  }, [refresh])

  // Tijdelijke download-URL voor een privaat bestand.
  const getUrl = useCallback(async (doc) => {
    const { data, error: e } = await supabase.storage.from(BUCKET).createSignedUrl(doc.storage_path, 60)
    if (e) return { ok: false, error: e.message }
    return { ok: true, url: data?.signedUrl }
  }, [])

  return { docs, loading, error, busy, upload, remove, getUrl, refresh }
}
