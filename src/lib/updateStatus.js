import { useSyncExternalStore } from 'react'

// Gedeelde "update wacht"-status tussen ReloadPrompt (eigenaar van de
// SW-registratie) en de mini-cues op de versie-regel in Sidebar en
// MobileMoreDrawer.
//
// 'Later' (of per ongeluk wegklikken) verbergt alleen de popup (dismissed) —
// waiting blijft true zodat de cue zichtbaar blijft tot er echt herladen is.
// Klik op de cue → reopenUpdatePrompt() → popup verschijnt opnieuw.

let state = { waiting: false, dismissed: false }
const listeners = new Set()

function emit() { listeners.forEach((fn) => fn()) }
function subscribe(fn) { listeners.add(fn); return () => listeners.delete(fn) }
function getSnapshot() { return state }

export function markUpdateWaiting() {
  if (state.waiting) return
  state = { waiting: true, dismissed: false }
  emit()
}

export function dismissUpdatePrompt() {
  if (!state.waiting || state.dismissed) return
  state = { ...state, dismissed: true }
  emit()
}

export function reopenUpdatePrompt() {
  if (!state.waiting || !state.dismissed) return
  state = { ...state, dismissed: false }
  emit()
}

export function useUpdateStatus() {
  return useSyncExternalStore(subscribe, getSnapshot)
}
