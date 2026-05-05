import HubSpotInboxAView from './HubSpotInboxAView'
import ProposalCardCompact from '../ProposalCardCompact'
import MobileDailyAdmin from './mobile/MobileDailyAdmin'
import { useMediaQuery } from '../../hooks/useMediaQuery'

// Daily Admin entry-point: kiest op basis van viewport tussen mobile en
// desktop layout. De Huidig/Toekomst-toggle staat rechtsboven in de page-header
// (App.jsx), niet hier — dit component rendert puur de inhoud.
// - Mobile (≤768px): MobileDailyAdmin — "Stack"-layout (één kaart fullscreen
//   + bottom-tabbar). Eigen CSS-namespace `.mda-*`.
// - Desktop (>768px): HubSpotInboxAView — "Zen"-split (inbox-lijst + grote
//   detail-card + bottom blocks). Huidige CSS-namespace `.pcv7-*` / `.va-*`.
export default function HubSpotInboxCompactView({ data, onRefresh }) {
  const isMobile = useMediaQuery('(max-width: 768px)')
  if (isMobile) {
    return <MobileDailyAdmin data={data} onRefresh={onRefresh} />
  }
  return <HubSpotInboxAView data={data} onRefresh={onRefresh} CardComponent={ProposalCardCompact} />
}
