import HubSpotInboxAView from './HubSpotInboxAView'
import ProposalCardCompact from '../../ProposalCardCompact'
import MobileDailyAdmin from './MobileDailyAdmin'
import { useMediaQuery } from '../../../hooks/useMediaQuery'
import { useAdmin } from '../../../hooks/useAdmin'
import { useAgents } from '../../../hooks/useAgents'
import './administratie-maestro.css'

// Daily Admin · Maestro design (sessie ADM, 2026-05-10).
//
// HARD-RULE: oude code is leidend. Mockup levert alleen nieuwe styling.
// Functioneel niets weggehaald — wrapper plaatst HubSpotInboxAView in een
// `theme-maestro adm-app` container zodat administratie-maestro.css de
// styling overneemt via scoped CSS-overlay.
//
// Oude route /administratie blijft gewoon werken (CompactView zonder Maestro).
// Deze wrapper draait op /administratie-maestro en draait er naast.
export default function HubSpotInboxMaestroView({ onRefresh }) {
  const { proposals, pipelines, hubspotUsers, filtered } = useAdmin()
  const { weekStart } = useAgents()
  const isMobile = useMediaQuery('(max-width: 768px)')
  const shared = { proposals, pipelines, hubspotUsers, filtered, weekStart, onRefresh }

  if (isMobile) {
    // Mobile fallback ongewijzigd — Maestro-restyle is desktop-first;
    // mobile heeft een eigen Stack-layout.
    return <MobileDailyAdmin {...shared} />
  }

  return (
    <div className="theme-maestro adm-app">
      <HubSpotInboxAView {...shared} CardComponent={ProposalCardCompact} />
    </div>
  )
}
