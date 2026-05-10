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
  // theme-maestro + adm-app classes worden door App.jsx op <main> gezet
  // zodat ook de view__header en surface-wrapper binnen scope vallen.
  return <HubSpotInboxFutureView onRefresh={onRefresh} />
}
