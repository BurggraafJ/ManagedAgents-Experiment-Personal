import { useNavigate } from 'react-router-dom'
import HubSpotInboxFutureView from './HubSpotInboxFutureView'
import AdminPeriodToggle from '../AdminPeriodToggle'
import './administratie-maestro.css'

// Daily Admin · Toekomst Maestro design (sessie ADM, 2026-05-10).
//
// HARD-RULE: oude code is leidend. KennismakingsTable / RecruitmentSection
// + scan-knop blijven onaangeroerd. Wrapper bouwt mockup-topbar en
// page-header; verder hergebruik van HubSpotInboxFutureView.
//
// VIEWS-entry voor `hubspot_maestro_future` is fullWidth=true.
export default function HubSpotInboxFutureMaestroView({ onRefresh }) {
  const navigate = useNavigate()

  return (
    <>
      <header className="adm-topbar">
        <div className="adm-crumbs">
          <span>Werkruimte</span>
          <span className="adm-crumbs__sep">/</span>
          <span>Administratie</span>
          <span className="adm-crumbs__sep">/</span>
          <span className="adm-crumbs__current">Toekomst</span>
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
            <h2 className="adm-ph__title">Administratie · <span>Toekomst</span></h2>
          </div>
          <AdminPeriodToggle />
        </header>
        <div className="adm-card__inner">
          <HubSpotInboxFutureView onRefresh={onRefresh} />
        </div>
      </div>
    </>
  )
}
