import { useState, useEffect } from 'react'
import { supabase } from '../../../../lib/supabase'

// F.6.d — SchoonButton: indicator + actie. Groen = Postvak gelijk aan Outlook,
// geel = sync wat oud, rood = ghost-rows of stale sync. Klik = direct mail-sync
// + auto-draft scan triggeren via request_mail_sync_now (zelfde RPC als 🔄).
export default function SchoonButton({ onTrigger, busy }) {
  const [health, setHealth] = useState(null)
  const [loading, setLoading] = useState(false)

  async function fetchHealth() {
    try {
      const { data } = await supabase.from('v_postvak_health').select('*').single()
      if (data) setHealth(data)
    } catch { /* ignore */ }
  }

  // Initial fetch + poll elke 30s zodat na sync de status snel groen wordt
  useEffect(() => {
    fetchHealth()
    const id = setInterval(fetchHealth, 30000)
    return () => clearInterval(id)
  }, [])

  // Refetch direct na klik (binnen 5s vaak al up-to-date)
  useEffect(() => {
    if (!busy) return
    const t = setTimeout(fetchHealth, 5000)
    return () => clearTimeout(t)
  }, [busy])

  const verdict = health?.verdict || 'gray'
  const minSync = health?.mail_sync_minutes_ago ?? null
  const minDraft = health?.auto_draft_minutes_ago ?? null
  const ghosts = health?.ghost_rows ?? 0
  const invalidFolder = health?.pending_invalid_folder ?? 0

  const dotColor = {
    green:  '#10b981',
    yellow: '#f59e0b',
    red:    '#ef4444',
    gray:   'var(--text-muted)',
  }[verdict]
  const label = (() => {
    if (verdict === 'gray' || minSync === null) return 'Schoon checken…'
    if (verdict === 'red' && (ghosts > 0 || invalidFolder > 0)) return 'Niet schoon'
    if (verdict === 'green') return 'Schoon'
    if (verdict === 'yellow') return 'Sync wat oud'
    return 'Bijwerken nodig'
  })()
  function fmtMin(m) {
    if (m == null) return ''
    if (m < 1) return 'nu'
    if (m < 60) return `${m}m`
    return `${Math.floor(m/60)}u${m%60 > 0 ? (m%60 + 'm') : ''}`
  }
  const subText = minSync == null ? '' : `${fmtMin(minSync)} sync`

  // Tooltip met volle context
  const tooltip = health
    ? [
        `Mail-sync: ${minSync == null ? '—' : fmtMin(minSync) + ' geleden'}`,
        `Auto-draft scan: ${minDraft == null ? '—' : fmtMin(minDraft) + ' geleden'}`,
        ghosts > 0 ? `⚠ ${ghosts} ghost-rijen` : null,
        invalidFolder > 0 ? `⚠ ${invalidFolder} ongeldige target_folder` : null,
        '',
        'Klik om mail-sync + auto-draft direct te triggeren.',
      ].filter(Boolean).join('\n')
    : 'Klik om sync te forceren'

  async function handleClick() {
    if (busy || loading) return
    setLoading(true)
    try {
      await onTrigger()
    } finally {
      setLoading(false)
      setTimeout(fetchHealth, 2000)
    }
  }

  return (
    <button type="button" onClick={handleClick} title={tooltip}
      disabled={busy || loading}
      style={{
        display: 'inline-flex', alignItems: 'center', gap: 6,
        padding: '6px 10px', borderRadius: 8,
        border: '1px solid var(--border)',
        background: 'var(--surface-1)',
        color: 'var(--text)',
        fontFamily: 'inherit', fontSize: 12, fontWeight: 500,
        cursor: busy ? 'wait' : 'pointer',
        opacity: busy ? 0.7 : 1,
      }}>
      <span style={{
        width: 8, height: 8, borderRadius: '50%',
        background: dotColor,
        boxShadow: verdict === 'green' ? `0 0 4px ${dotColor}` : 'none',
        flexShrink: 0,
      }} />
      <span>{label}</span>
      {subText && <span style={{ color: 'var(--text-muted)', fontVariantNumeric: 'tabular-nums' }}>· {subText}</span>}
    </button>
  )
}
