import HubSpotInboxAView from './HubSpotInboxAView'
import ProposalCardCompact from '../ProposalCardCompact'

// Daily Admin · Compact — het winnende kaart-ontwerp. Versie A-layout
// (KPI-row + inbox split + log/filtered bottom) met banner-top action-cards
// (ingekleurde banner met icon + type + title, schone content eronder met
// label-kolom en body als quote-blok).
export default function HubSpotInboxCompactView({ data }) {
  return <HubSpotInboxAView data={data} CardComponent={ProposalCardCompact} />
}
