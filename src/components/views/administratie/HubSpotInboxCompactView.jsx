import HubSpotInboxAView from './HubSpotInboxAView'
import ProposalCardCompact from '../../ProposalCardCompact'
import MobileDailyAdmin from './MobileDailyAdmin'
import { useMediaQuery } from '../../../hooks/useMediaQuery'
import { useAdmin } from '../../../hooks/useAdmin'
import { useAgents } from '../../../hooks/useAgents'

// Daily Admin entry-point: kiest op basis van viewport tussen mobile en
// desktop layout. De Huidig/Toekomst-toggle staat rechtsboven in de page-header
// (App.jsx), niet hier — dit component rendert puur de inhoud.
// - Mobile (≤768px): MobileDailyAdmin — "Stack"-layout.
// - Desktop (>768px): HubSpotInboxAView — "Zen"-split (inbox-lijst + grote
//   detail-card + bottom blocks).
//
// Refactor 21 — hook-migratie: data-prop weg. Beide sub-views krijgen scoped
// props uit useAdmin (Refactor 02) + useAgents.weekStart (voor metrics).
export default function HubSpotInboxCompactView({ onRefresh }) {
  const { proposals, pipelines, hubspotUsers, filtered } = useAdmin()
  const { weekStart } = useAgents()
  const isMobile = useMediaQuery('(max-width: 768px)')
  const shared = { proposals, pipelines, hubspotUsers, filtered, weekStart, onRefresh }
  if (isMobile) {
    return <MobileDailyAdmin {...shared} />
  }
  return <HubSpotInboxAView {...shared} CardComponent={ProposalCardCompact} />
}
