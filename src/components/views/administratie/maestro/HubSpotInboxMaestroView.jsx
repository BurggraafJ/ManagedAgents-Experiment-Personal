import { useNavigate } from 'react-router-dom'
import MobileDailyAdmin from '../MobileDailyAdmin'
import AdminPeriodToggle from '../../AdminPeriodToggle'
import HubSpotInboxAMaestroView from './HubSpotInboxAMaestroView'
import AdminMaestroSkeleton from './AdminMaestroSkeleton'
import { useMediaQuery } from '../../../../hooks/useMediaQuery'
import { useAdmin } from '../../../../hooks/useAdmin'
import { useAgents } from '../../../../hooks/useAgents'
import './administratie-maestro.css'

// Daily Admin · Maestro entry-point (sessie ADM-V2 step 1).
// Mirrors HubSpotInboxCompactView qua rol (mobile/desktop switch + topbar +
// page-header + content). Mockup-classes: .adm-topbar, .adm-crumbs, .adm-card,
// .adm-ph. Inhoud-component is HubSpotInboxAMaestroView (mockup-native JSX).
//
// VIEWS-entry voor `hubspot_maestro` is fullWidth=true → App.jsx rendert geen
// view__header en geen header-actions; deze wrapper neemt het over.
export default function HubSpotInboxMaestroView({ onRefresh }) {
  const navigate = useNavigate()
  const { proposals, pipelines, hubspotUsers, filtered, loading } = useAdmin()
  const { weekStart } = useAgents()
  const isMobile = useMediaQuery('(max-width: 768px)')

  const shared = { proposals, pipelines, hubspotUsers, filtered, weekStart, onRefresh }

  if (isMobile) {
    // Mobile fallback ongewijzigd — Maestro-restyle is desktop-first; mobile
    // heeft een eigen Stack-layout.
    return <MobileDailyAdmin {...shared} />
  }

  // Initial loading-state: nog geen proposals binnen → AdminMaestroSkeleton.
  // Topbar + page-header rendert direct zodat de navigatie meteen werkt.
  const isInitialLoad = loading && (!proposals || proposals.length === 0)

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
            className="adm-topbar__btn adm-topbar__btn--ghost"
            onClick={() => navigate('/instellingen/administratie')}
            title="Beheer note-templates en tone-of-voice voor Daily Admin"
          >
            <svg className="lc" viewBox="0 0 24 24" width="13" height="13" aria-hidden>
              <path d="M12 20h9" />
              <path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z" />
            </svg>
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
          {isInitialLoad ? <AdminMaestroSkeleton /> : <HubSpotInboxAMaestroView {...shared} />}
        </div>
      </div>
    </>
  )
}
