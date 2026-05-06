import { useEffect, useState } from 'react'

// Lichtgewicht toast-systeem zonder dependencies. Module-level subscription
// zodat showToast() vanuit elk bestand werkt — geen Provider-tree nodig.
//
// Gebruik:
//   import { showToast } from './Toast'
//   showToast('Concept geplaatst — check Outlook over enkele minuten.')
//   showToast({ kind: 'error', message: 'Kon niet opslaan' })

const listeners = new Set()
let counter = 0

export function showToast(input) {
  const t = typeof input === 'string' ? { message: input } : (input || {})
  const toast = {
    id: ++counter,
    kind: t.kind || 'success',          // 'success' | 'error' | 'info'
    message: t.message || '',
    detail: t.detail || null,
    duration: t.duration ?? 4000,
  }
  for (const fn of listeners) fn(toast)
  return toast.id
}

export default function ToastHost() {
  const [toasts, setToasts] = useState([])

  useEffect(() => {
    function add(toast) {
      setToasts(prev => [...prev, toast])
      if (toast.duration > 0) {
        setTimeout(() => {
          setToasts(prev => prev.filter(x => x.id !== toast.id))
        }, toast.duration)
      }
    }
    listeners.add(add)
    return () => { listeners.delete(add) }
  }, [])

  if (toasts.length === 0) return null

  return (
    <div
      style={{
        position: 'fixed', top: 16, right: 16, zIndex: 9999,
        display: 'flex', flexDirection: 'column', gap: 8,
        pointerEvents: 'none',
      }}
      aria-live="polite"
    >
      {toasts.map(t => (
        <ToastItem key={t.id} toast={t} onClose={() =>
          setToasts(prev => prev.filter(x => x.id !== t.id))
        } />
      ))}
    </div>
  )
}

function ToastItem({ toast, onClose }) {
  const palette = toast.kind === 'error'
    ? { bg: '#fef2f2', border: '#fecaca', icon: '⚠️', accent: '#b91c1c' }
    : toast.kind === 'info'
      ? { bg: '#eff6ff', border: '#bfdbfe', icon: 'ℹ️', accent: '#1d4ed8' }
      : { bg: '#f0fdf4', border: '#bbf7d0', icon: '✓', accent: '#15803d' }

  return (
    <div
      role="status"
      style={{
        pointerEvents: 'auto',
        minWidth: 280, maxWidth: 380,
        background: palette.bg,
        border: `1px solid ${palette.border}`,
        borderLeft: `4px solid ${palette.accent}`,
        borderRadius: 8,
        padding: '10px 14px',
        boxShadow: '0 8px 24px rgba(15, 23, 42, 0.10)',
        display: 'flex', alignItems: 'flex-start', gap: 10,
        fontFamily: 'inherit', fontSize: 13, lineHeight: 1.45,
        color: '#0f172a',
        animation: 'lm-toast-in 180ms ease-out',
      }}
    >
      <span aria-hidden style={{ fontSize: 16, lineHeight: 1.2, color: palette.accent }}>
        {palette.icon}
      </span>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontWeight: 600, color: '#0f172a' }}>{toast.message}</div>
        {toast.detail && (
          <div style={{ marginTop: 2, fontSize: 12, color: '#475569' }}>
            {toast.detail}
          </div>
        )}
      </div>
      <button
        type="button"
        onClick={onClose}
        title="Sluit"
        aria-label="Sluit melding"
        style={{
          background: 'transparent', border: 'none', cursor: 'pointer',
          color: '#64748b', fontSize: 16, lineHeight: 1, padding: 2,
        }}
      >×</button>
    </div>
  )
}
