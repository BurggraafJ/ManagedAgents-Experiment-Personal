import { useEffect, useMemo, useState } from 'react'
import { FILTER_PRESETS, AUDIENCE_PRESETS, groupByAge } from '../lib/autodraft'

const PAGE = 25

// Filter → groep → paginate. Output is alles wat de lijst nodig heeft:
// buckets (label → items), flat (alle items in render-volgorde), visibleFlat
// (eerste N), hasMore en de loadMore-handler. Pinned krijgt een eigen bucket
// bovenaan wanneer de audience 'for_you' is en er gepinde mails staan.
export function useInboxBuckets({ pool, filter, audience, query, flaggedMailIds, resetKey }) {
  const filtered = useMemo(() => {
    const preset = FILTER_PRESETS.find(f => f.id === filter) || FILTER_PRESETS[0]
    const audPreset = AUDIENCE_PRESETS.find(f => f.id === audience) || AUDIENCE_PRESETS[0]
    const q = (query || '').trim().toLowerCase()
    return pool.filter(m => {
      if (!audPreset.match(m)) return false
      if (!preset.match(m)) return false
      if (!q) return true
      const bodyText = m.body_text || ''
      const bodyHtmlStripped = m.body_html ? String(m.body_html).replace(/<[^>]+>/g, ' ') : ''
      return (m.subject || '').toLowerCase().includes(q) ||
             (m.from_email || '').toLowerCase().includes(q) ||
             (m.from_name  || '').toLowerCase().includes(q) ||
             (m.body_preview || '').toLowerCase().includes(q) ||
             bodyText.toLowerCase().includes(q) ||
             bodyHtmlStripped.toLowerCase().includes(q)
    })
  }, [pool, filter, audience, query])

  const buckets = useMemo(() => {
    if (audience !== 'for_you' || !flaggedMailIds || flaggedMailIds.size === 0) {
      return groupByAge(filtered)
    }
    const pinned = filtered.filter(m => flaggedMailIds.has(m.mail_id))
    const rest   = filtered.filter(m => !flaggedMailIds.has(m.mail_id))
    if (pinned.length === 0) return groupByAge(rest)
    const restBuckets = groupByAge(rest)
    return {
      ...restBuckets,
      '📌 Pinned': pinned,
      __order: ['📌 Pinned', ...(restBuckets.__order || [])],
    }
  }, [audience, filtered, flaggedMailIds])

  const flat = useMemo(() => {
    const out = []
    for (const k of buckets.__order || []) out.push(...buckets[k])
    return out
  }, [buckets])

  const [visibleCount, setVisibleCount] = useState(PAGE)
  useEffect(() => { setVisibleCount(PAGE) }, [resetKey])
  const visibleFlat = useMemo(() => flat.slice(0, visibleCount), [flat, visibleCount])
  const hasMore = flat.length > visibleCount
  const loadMore = () => setVisibleCount(c => c + PAGE)

  return { filtered, buckets, flat, visibleFlat, visibleCount, hasMore, loadMore, pageSize: PAGE }
}
