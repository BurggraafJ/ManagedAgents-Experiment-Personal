import HubSpotInboxAView from './HubSpotInboxAView'
import ProposalCardStory from '../ProposalCardStory'

// Daily Admin · Story — het winnende narratieve kaart-ontwerp. Versie A-
// layout met conversationele 3-paragraaf-kaart: "Wat er is gebeurd" →
// "Wat wij voorstellen" → "Jouw keuze". Gekleurde underlines onder de
// kopjes als enige proces-nadruk.
export default function HubSpotInboxStoryView({ data }) {
  return <HubSpotInboxAView data={data} CardComponent={ProposalCardStory} />
}
