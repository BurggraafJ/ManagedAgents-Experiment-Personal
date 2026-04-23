import HubSpotInboxAView from './HubSpotInboxAView'
import ProposalCardV7 from '../ProposalCardV7'

export default function HubSpotInboxACompact3View({ data }) {
  return <HubSpotInboxAView data={data} CardComponent={ProposalCardV7} />
}
