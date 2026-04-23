import HubSpotInboxAView from './HubSpotInboxAView'
import ProposalCardV4 from '../ProposalCardV4'

// Versie A + Card V4 (Split). Detail-paneel toont meta links en acties
// rechts. Benut de breedte van het detail.
export default function HubSpotInboxASplitView({ data }) {
  return <HubSpotInboxAView data={data} CardComponent={ProposalCardV4} />
}
