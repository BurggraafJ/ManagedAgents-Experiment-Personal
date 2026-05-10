import { useNavigate } from 'react-router-dom'
import HubSpotInboxAView from './HubSpotInboxAView'
import ProposalCardCompact from '../../ProposalCardCompact'
import MobileDailyAdmin from './MobileDailyAdmin'
import AdminPeriodToggle from '../AdminPeriodToggle'
import ListRowMaestro from './maestro/ListRowMaestro'
import { useMediaQuery } from '../../../hooks/useMediaQuery'
import { useAdmin } from '../../../hooks/useAdmin'
import { useAgents } from '../../../hooks/useAgents'
import './maestro/administratie-maestro.css'

// Daily Admin · Maestro design (sessie ADM, 2026-05-10).
//
// HARD-RULE: oude code is leidend. Mockup levert alleen nieuwe styling.
// Inhoud (HubSpotInboxAView, ProposalCardCompact, LogBlock, MetricsBlock,
// FilteredBlock) is 100% hergebruikt. Wrapper bouwt zelf:
//   - mockup-topbar (crumbs + Instructies-knop)
//   - mockup-page-header (.adm-ph) met titel + Huidig/Toekomst-toggle
//   - .adm-card wrapper (witte card met border-radius)
//
// VIEWS-entry voor `hubspot_maestro` is fullWidth=true → App.jsx rendert
// geen view__header en geen header-actions; deze wrapper neemt het over.
export default function HubSpotInboxMaestroView({ onRefresh }) {
  const navigate = useNavigate()
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
    <>
      <header className="adm-topbar">
        <div className="adm-crumbs">
          <span>Werkruimte</span>
          <span className="adm-crumbs__sep">/</span>
          <span>Administratie</span>
          <span className="adm-crumbs__sep">/</span>
          <span className="adm-crumbs__current">Huidig</span>
        </div>
        <div className="adm-topbar__actions">
          <button
            type="button"
            className="btn btn--ghost btn--sm"
            onClick={() => navigate('/instellingen/administratie')}
            title="Beheer note-templates en tone-of-voice voor Daily Admin"
          >
            <span aria-hidden style={{ marginRight: 6 }}>📝</span>
            Instructies
          </button>
        </div>
      </header>
      <div className="adm-card">
        <header className="adm-ph">
          <div className="adm-ph__text">
            <h2 className="adm-ph__title">Administratie · <span>Huidig</span></h2>
          </div>
          <AdminPeriodToggle />
        </header>
        <div className="adm-card__inner">
          <HubSpotInboxAView {...shared} CardComponent={ProposalCardCompact} ListRowComponent={ListRowMaestro} />
        </div>
      </div>
    </>
  )
}
