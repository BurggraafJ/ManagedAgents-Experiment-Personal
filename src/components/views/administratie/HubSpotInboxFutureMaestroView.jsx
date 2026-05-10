import HubSpotInboxFutureView from './HubSpotInboxFutureView'
import './administratie-maestro.css'

// Daily Admin · Toekomst Maestro design (sessie ADM, 2026-05-10).
//
// HARD-RULE: oude code is leidend. Wrapper plaatst FutureView in een
// `theme-maestro adm-app` container; alle KennismakingsTable / Recruitment-
// secties + scan-knop blijven onaangeroerd. Pure CSS-overlay.
//
// Oude route /administratie/toekomst blijft werken zonder Maestro.
// Deze wrapper draait op /administratie-maestro/toekomst.
export default function HubSpotInboxFutureMaestroView({ onRefresh }) {
  return (
    <div className="theme-maestro adm-app">
      <HubSpotInboxFutureView onRefresh={onRefresh} />
    </div>
  )
}
