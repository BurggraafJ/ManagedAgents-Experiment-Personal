import HubSpotInboxAView from './HubSpotInboxAView'
import ProposalCardV8 from '../ProposalCardV8'

export default function HubSpotInboxAStory2View({ data }) {
  return <HubSpotInboxAView data={data} CardComponent={ProposalCardV8} />
}
