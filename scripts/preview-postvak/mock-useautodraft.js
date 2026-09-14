// useAutoDraft-stub voor de Postvak-shots. Zelfde retourvorm als de echte hook
// (src/hooks/useAutoDraft.js), zodat desktop én mobiel door hun eigen code
// lopen en alleen de data verzonnen is.
import {
  MAIL_MESSAGES, SENT_MESSAGES, AUTODRAFT_MAILS, CATEGORIES, FOLDERS, MAIL_SYNC_STATE,
} from './mock-data.js'

// ?rule=oud — reconstructie van de lijst van vóór v1.197: hetzelfde component,
// maar gevoed met uitsluitend de mails die de oude mobiele regel doorliet
// (`autodraft_mails` met status pending/amended én audience 'for_you'). Het is
// een reconstructie, geen historische opname; het getal eronder — 1 van 16 —
// komt uit de poort (`postvak_list_smoke.cjs`, P3b), niet uit deze shot.
const OUDE_REGEL = new URLSearchParams(location.search).get('rule') === 'oud'
const DOORGELATEN = new Set(AUTODRAFT_MAILS
  .filter(a => (a.status === 'pending' || a.status === 'amended') && a.audience === 'for_you')
  .map(a => a.mail_id))

export function useAutoDraft() {
  const inbox = OUDE_REGEL ? MAIL_MESSAGES.filter(m => DOORGELATEN.has(m.id)) : MAIL_MESSAGES
  return {
    mails: AUTODRAFT_MAILS,
    decisions: [],
    categories: CATEGORIES,
    categoryProposals: [],
    folders: FOLDERS,
    lessons: [],
    lessonProposals: [],
    mailMessages: [...inbox, ...SENT_MESSAGES],
    ignoreRules: [],
    awaitingDismissed: [],
    hubspotCustomerEmails: [],
    agentInstructions: [],
    awaitingReplyIndex: [],
    manualCategoryOverrides: [],
    mailSyncState: MAIL_SYNC_STATE,
    loading: false,
    error: null,
    refresh: () => {},
  }
}
