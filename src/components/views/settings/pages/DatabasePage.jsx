import TruthOfSourcesView from '../../truth-of-sources/TruthOfSourcesView'
import '../../now/now.css'

/**
 * DatabasePage — sync-status van alle bronnen (Outlook, HubSpot, Jira,
 * Fireflies, Agenda, Contactpersonen, JelleMind).
 *
 * Stond voorheen onderaan het Dashboard-overzicht (NowView); per 2026-05-27
 * verhuisd naar een eigen Instellingen-pagina op verzoek van Jelle.
 *
 * De .tos-* card-styling + design-tokens leven scoped onder .now-app in
 * now.css. We wrappen daarom in .now-app (+ --embed modifier die de
 * flex-fill-parent layout neutraliseert) zodat de kaarten er identiek
 * uitzien als voorheen, zonder de CSS te dupliceren.
 */
export default function DatabasePage() {
  return (
    <div className="now-app now-app--embed">
      <TruthOfSourcesView />
    </div>
  )
}
