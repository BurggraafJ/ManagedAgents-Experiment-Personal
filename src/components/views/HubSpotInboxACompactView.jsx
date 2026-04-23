import HubSpotInboxAView from './HubSpotInboxAView'
import ProposalCardV3 from '../ProposalCardV3'

// Versie A + Card V3 (Compact). Zelfde layout als Versie A; detail-paneel
// gebruikt de compacte kaart met acties-dominant en kleine confidence-pill.
export default function HubSpotInboxACompactView({ data }) {
  return <HubSpotInboxAView data={data} CardComponent={ProposalCardV3} />
}
