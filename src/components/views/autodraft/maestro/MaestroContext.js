import { createContext, useContext } from 'react'

// MaestroContext — laat geneste componenten weten of we in maestro-mode zijn,
// zodat ze zonder prop-drilling Maestro-only UI kunnen tonen.
//
// Sessie MCM-V6 (2026-05-10): toegevoegd om DraftEditor (en eventueel andere
// genest-renderende componenten) in staat te stellen Maestro-only featurevlak
// te tonen — zoals de inline AI-prompt-bar — zonder dat tussenliggende lagen
// (MailDetail / InboxPanel) een doorlooppropreglas hoeven te kennen.
//
// HARD-RULE: oude code is leidend. Default = false (geen maestro-mode), dus
// /postvak route gedraagt zich exact als voorheen. AutoDraftMaestroView wraps
// children met value=true.
//
// Optionele actions object — biedt callbacks die maestro-componenten kunnen
// aanroepen om gedrag in MailDetail/DraftEditor te triggeren (bv. een
// AI-prompt indienen). Voor V6 alleen `submitAmend(prompt)` ondersteund.

export const MaestroContext = createContext({
  enabled: false,
  actions: {},
})

export function useMaestro() {
  return useContext(MaestroContext)
}

export function useMaestroEnabled() {
  return useContext(MaestroContext).enabled
}
