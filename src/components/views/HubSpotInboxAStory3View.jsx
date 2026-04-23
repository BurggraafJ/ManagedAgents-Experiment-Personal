import HubSpotInboxAView from './HubSpotInboxAView'
import ProposalCardV9 from '../ProposalCardV9'

export default function HubSpotInboxAStory3View({ data }) {
  return <HubSpotInboxAView data={data} CardComponent={ProposalCardV9} />
}
