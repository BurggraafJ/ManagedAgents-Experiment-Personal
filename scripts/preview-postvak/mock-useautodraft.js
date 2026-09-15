// useAutoDraft-stub voor de Postvak-shots. Zelfde retourvorm als de echte hook
// (src/hooks/useAutoDraft.js), zodat desktop én mobiel door hun eigen code
// lopen en alleen de data verzonnen is.
import {
  MAIL_MESSAGES, SENT_MESSAGES, AUTODRAFT_MAILS, CATEGORIES, FOLDERS, MAIL_SYNC_STATE,
} from './mock-data.js'

const QS = new URLSearchParams(location.search)

// ?rule=oud — reconstructie van de lijst van vóór v1.197: hetzelfde component,
// maar gevoed met uitsluitend de mails die de oude mobiele regel doorliet
// (`autodraft_mails` met status pending/amended én audience 'for_you'). Het is
// een reconstructie, geen historische opname; het getal eronder — 1 van 16 —
// komt uit de poort (`postvak_list_smoke.cjs`, P3b), niet uit deze shot.
const OUDE_REGEL = QS.get('rule') === 'oud'
const DOORGELATEN = new Set(AUTODRAFT_MAILS
  .filter(a => (a.status === 'pending' || a.status === 'amended') && a.audience === 'for_you')
  .map(a => a.mail_id))

// ?swr=warm|koud — de open-ervaring van v1.223, bevroren op één moment:
//   warm  de cache van de vorige sessie staat er, de verse ronde loopt nog
//         (stale + revalidating → het "Bijwerken…"-chipje, geen overlay)
//   koud  nog niets: geen cache, fetch loopt (loading → skeleton; desktop
//         mount daarbovenop de boot-overlay, die pas weggaat op data)
// Zonder ?swr is de hook "klaar": verse data, niets aan het laden.
const SWR = QS.get('swr') || ''

export function useAutoDraft() {
  const inbox = OUDE_REGEL ? MAIL_MESSAGES.filter(m => DOORGELATEN.has(m.id)) : MAIL_MESSAGES
  const koud = SWR === 'koud'
  return {
    mails: koud ? [] : AUTODRAFT_MAILS,
    decisions: [],
    categories: CATEGORIES,
    categoryProposals: [],
    folders: koud ? [] : FOLDERS,
    lessons: [],
    lessonProposals: [],
    mailMessages: koud ? [] : [...inbox, ...SENT_MESSAGES],
    ignoreRules: [],
    awaitingDismissed: [],
    hubspotCustomerEmails: [],
    agentInstructions: [],
    awaitingReplyIndex: [],
    manualCategoryOverrides: [],
    mailSyncState: koud ? [] : MAIL_SYNC_STATE,
    loading: koud,
    stale: SWR === 'warm',
    revalidating: SWR === 'warm' || koud,
    error: null,
    refresh: () => {},
  }
}
