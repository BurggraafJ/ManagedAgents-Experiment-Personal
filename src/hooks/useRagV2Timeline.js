import { useState, useEffect } from 'react'
import { supabase } from '../lib/supabase'

// Eenvoudige timeline-fetch voor V2 Objects-mode. Haalt voor een entity
// (company of contact) de laatste mails + events + Jira-issues + meetings op
// via rag-search (RAG retrieval met entity-filter) zodat we hetzelfde
// embedding-corpus gebruiken voor de Objects-tijdlijn.
//
// We voeren GEEN aparte SQL uit — de RAG retrieval scoort entity-relevantie
// al, en levert preview/title/source/ts in één hit.
export function useRagV2Timeline(entity) {
  const [items, setItems] = useState([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState(null)

  useEffect(() => {
    if (!entity) { setItems([]); return }
    let cancelled = false
    setLoading(true); setError(null)
    const entityType = entity.kind  // 'company' | 'contact'
    const entityId = entity.kind === 'company' ? entity.company_id : (entity.hubspot_contact_id || entity.contact_id)
    const queryHint = entity.kind === 'company'
      ? (entity.name || entity.domain || 'recent activity')
      : (entity.display_naam || `${entity.voornaam || ''} ${entity.achternaam || ''}`.trim() || entity.email || 'recent activity')

    supabase.functions.invoke('rag-search', {
      body: {
        query: queryHint,
        filter_entity_type: entityType,
        filter_entity_id: entityId,
        top_k: 40,
        min_similarity: 0.0,
        max_per_source: 12,
      },
    }).then(({ data, error: invErr }) => {
      if (cancelled) return
      if (invErr) { setError(invErr.message || 'invoke_error'); setItems([]); setLoading(false); return }
      if (!data?.ok) { setError(data?.error || 'unknown_error'); setItems([]); setLoading(false); return }
      const mapped = (data.matches || [])
        .map(m => ({
          kind: m.source === 'engagement' ? 'mail' : m.source,
          title: m.title || firstLine(m.preview) || '(zonder titel)',
          snip: snippetOf(m.preview, m.title),
          ts: m.ts,
          who: whoLine(m),
          direction: m.meta?.direction || null,
          chunk_id: m.chunk_id,
        }))
        .filter(it => it.ts)
        .sort((a, b) => new Date(b.ts) - new Date(a.ts))
      setItems(mapped)
      setLoading(false)
    })
    return () => { cancelled = true }
  }, [entity])

  return { items, loading, error }
}

function firstLine(s) {
  if (!s) return null
  for (const line of s.split('\n')) {
    const t = line.trim()
    if (!t) continue
    if (t.startsWith('[')) continue
    if (/^(From|To|Cc|Bcc|Date|Subject):/i.test(t)) continue
    return t.slice(0, 140)
  }
  return null
}

function snippetOf(preview, title) {
  if (!preview) return null
  const lines = preview.split('\n').map(l => l.trim()).filter(Boolean)
  // skip headers en titel
  const body = lines.filter(l => !/^(From|To|Cc|Bcc|Date|Subject|Folder|Stage|Name|Conversation):/i.test(l) && l !== title && !l.startsWith('['))
  const out = body.slice(0, 4).join(' ').slice(0, 280)
  return out || null
}

function whoLine(m) {
  const meta = m.meta || {}
  const parts = []
  if (meta.from_name) parts.push(`van ${meta.from_name}`)
  else if (meta.from_email) parts.push(`van ${meta.from_email}`)
  if (meta.thread_count) parts.push(`thread ${meta.thread_count}`)
  return parts.length ? parts.join(' · ') : null
}
