import HubSpotInboxAView from './HubSpotInboxAView'
import ProposalCardV6 from '../ProposalCardV6'

export default function HubSpotInboxACompact2View({ data }) {
  return <HubSpotInboxAView data={data} CardComponent={ProposalCardV6} />
}
