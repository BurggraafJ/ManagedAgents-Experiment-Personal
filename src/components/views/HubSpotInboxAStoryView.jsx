import HubSpotInboxAView from './HubSpotInboxAView'
import ProposalCardV5 from '../ProposalCardV5'

// Versie A + Card V5 (Story/Timeline). Detail-paneel leest als een verhaal
// in 4 stappen: bron → bekende records → voorstel → jouw beslissing.
export default function HubSpotInboxAStoryView({ data }) {
  return <HubSpotInboxAView data={data} CardComponent={ProposalCardV5} />
}
