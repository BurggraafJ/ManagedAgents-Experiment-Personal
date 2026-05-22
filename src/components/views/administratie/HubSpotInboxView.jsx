import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import MobileDailyAdmin from './MobileDailyAdmin'
import AdminPeriodToggle from '../AdminPeriodToggle'
import HubSpotInboxAView from './HubSpotInboxAView'
import AdminSkeleton from './AdminSkeleton'
import AdminInfoPanel from './AdminInfoPanel'
import Modal from '../../ui/Modal'
import { useMediaQuery } from '../../../hooks/useMediaQuery'
import { useAdmin } from '../../../hooks/useAdmin'
import { useAgents } from '../../../hooks/useAgents'
import './administratie.css'

// Daily Admin · Maestro entry-point. Bevat topbar (crumbs + Informatie +
// Instructies) + page-header (titel + Huidig/Toekomst-toggle) + content-card.
//
// "Informatie"-knop opent een Modal met de drie info-blokken (Laatst verwerkt /
// Andere contactmomenten / Cijfers). Daarvoor stonden die permanent onder de
// inbox, maar dat is verhuisd zodat de actieve inbox meer ruimte krijgt.
export default function HubSpotInboxView({ onRefresh }) {
  const navigate = useNavigate()
  const { proposals, pipelines, hubspotUsers, filtered, loading, mutateProposal } = useAdmin()
  const { weekStart } = useAgents()
  const isMobile = useMediaQuery('(max-width: 768px)')
  const [infoOpen, setInfoOpen] = useState(false)

  const shared = { proposals, pipelines, hubspotUsers, weekStart, onRefresh, mutateProposal }

  if (isMobile) {
    return <MobileDailyAdmin {...shared} filtered={filtered} />
  }

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
            onClick={() => setInfoOpen(true)}
            title="Bekijk laatst verwerkt, andere contactmomenten en cijfers"
          >
            <svg className="lc" viewBox="0 0 24 24" width="13" height="13" aria-hidden>
              <circle cx="12" cy="12" r="10" />
              <path d="M12 16v-4M12 8h.01" />
            </svg>
            Instellingen
          </button>
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
          {isInitialLoad ? <AdminSkeleton /> : <HubSpotInboxAView {...shared} />}
        </div>
      </div>

      <Modal
        open={infoOpen}
        onClose={() => setInfoOpen(false)}
        title="Instellingen · administratie"
        size="lg"
        className="adm-info-modal adm-app"
      >
        <AdminInfoPanel
          proposals={proposals}
          filtered={filtered}
          weekStart={weekStart}
        />
      </Modal>
    </>
  )
}
