import { useNavigate, useParams, Navigate } from 'react-router-dom'
import MobileAdminHub from './MobileAdminHub'
import MobileAdminUsers from './MobileAdminUsers'
import MobileAdminHealth from './MobileAdminHealth'
import MobileAdminSecurity from './MobileAdminSecurity'
import '../../mobile-settings.css'
import '../../mobile-admin.css'

/**
 * MobileAdminPortal (v1.128, design A "iOS drill-in") — het owner-portaal
 * /organisatie/* op de telefoon (tot v1.171 /admin/*). Zelfde taal als de
 * mobiele Instellingen (m-set-*): full-screen hub met inset-groepen per taak,
 * drill-in per pagina, gedockte actiebalk boven de tabbar. Desktop rendert
 * dezelfde routes als overlay-pane (OrganisatieView) — Dashboard kiest op
 * isMobile.
 *
 * Route /organisatie/<slug>:
 *   ''            hub — Toegang · Bewaking · Alleen op desktop
 *   gebruikers    lijst + edit-modal + gestippelde rijen "Gebruiker
 *                 aanmaken" (geen mail) en "Member uitnodigen" (wel mail)
 *   health        agent-health lijst (agent_runs_health_7d)
 *   security      open bevindingen afhandelen
 *
 * Desktop-only paden (pijplijn, platform, api-keys, updates, legalai)
 * landen op de hub — daar staan ze als gemarkeerde rijen zonder chevron.
 */
const BASE = '/organisatie'

export default function MobileAdminPortal({ isOwner, isLoadingRole, badges }) {
  const navigate = useNavigate()
  const slug = useParams()['*'] || ''

  // Tijdens role-load niets renderen (geen flikker); member → weg.
  if (isLoadingRole) return <div className="m-dash m-set" />
  if (!isOwner) return <Navigate to="/" replace />

  const go = (p) => navigate(p ? `${BASE}/${p}` : BASE)
  const back = () => go('')

  if (slug === '') return <MobileAdminHub go={go} badges={badges} />
  if (slug === 'gebruikers') return <MobileAdminUsers onBack={back} />
  if (slug === 'health' || slug.startsWith('health/')) return <MobileAdminHealth onBack={back} />
  if (slug === 'security') return <MobileAdminSecurity onBack={back} />
  return <Navigate to={BASE} replace />
}
