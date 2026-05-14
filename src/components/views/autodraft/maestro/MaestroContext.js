import { createContext, useContext } from 'react'

// MaestroContext — provider voor genest-renderende componenten binnen het
// Postvak. Vermijdt prop-drilling door drie dingen via context te exposen:
//
//   1. enabled (bool) — of we binnen de Postvak-shell renderen
//      (componenten zoals DraftEditor checken dit voordat ze maestro-only
//      UI tonen — bv. de inline AIPromptBar).
//   2. actions (object) — callbacks waarmee diepere children gedrag in de
//      AutoDraftView state kunnen triggeren. Drie acties:
//        - submitAmend(prompt)      — heartbeat-gebaseerde amend-flow
//        - rewriteDraftSync(prompt) — synchrone Grok-rewrite
//        - dropMailToFolder(...)    — drag-and-drop → ignore-decision
//   3. pendingRewriteMailId — gezet door rewriteDraftSync bij start /
//      gecleared bij eind. MailRow leest het om een "✨ Herschrijven…"
//      badge op de juiste row te tonen tijdens de Grok-call.

export const MaestroContext = createContext({
  enabled: false,
  actions: {},
  pendingRewriteMailId: null,
})

export function useMaestro() {
  return useContext(MaestroContext)
}

export function useMaestroEnabled() {
  return useContext(MaestroContext).enabled
}

export function usePendingRewriteId() {
  return useContext(MaestroContext).pendingRewriteMailId
}
