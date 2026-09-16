import { Link } from 'react-router-dom'
import SkillsPage from '../../admin/pages/SkillsPage'

import '../../admin/admin.css'
import '../../admin/admin-components.css'

/**
 * SkillsSettingsPage — Instellingen › Skills (v1.225).
 *
 * Skills stonden alleen onder Organisatie, achter `organisatie.skills`. Dat is
 * het recht van een beheerder, en dus zag een member nergens wat de vragenbak
 * over Legal Mind weet — terwijl die kennis wél zijn eigen antwoorden stuurt.
 * Deze pagina is de leeskant daarvan, achter `instellingen.eigen` (het recht
 * dat in de member-preset zit, hetzelfde als Connectors en de Uitleg-pagina's).
 *
 * Wat je hier ziet is geen tweede kopie van de data: het is dezelfde SkillsPage
 * met dezelfde twee panels en dezelfde hooks, in `readOnly`. Wat je ervan te
 * zien krijgt bepaalt de RLS, niet dit scherm:
 *
 *   org_skills   `org_skills_read using (true)`         — elke ingelogde
 *                gebruiker ziet alle begrippen; ze gaan bij élke vraag mee.
 *   app_skills   `app_skills_read` → `app_skills_visible()` — een member ziet
 *                precies de actieve werkwijzen die bij hém in de prompt komen
 *                (org-breed, op zijn rol, of persoonlijk op zijn uid); een
 *                beheerder ziet alles, ook wat uit staat.
 *
 * Schrijven verandert hier niets aan: `*_admin_write` eist nog steeds
 * `is_admin_or_higher()` mét geldige tweede factor. De knoppen staan niet
 * gedimd maar wég — zie AppSkillsPanel.jsx voor waarom.
 *
 * De chrome is die van OrganisatieView: de panels tekenen met `.admin-*` en die
 * classes hangen onder `.admin-main`, dus dezelfde embed-wrapper eromheen.
 * `.theme-maestro` staat erbij omdat de tokens daaronder gescoped zijn.
 */
export default function SkillsSettingsPage({ canManage = false, organisatiePath = '/organisatie/skills' }) {
  const actions = canManage
    ? <Link className="admin-btn admin-btn--sm" to={organisatiePath}>Beheren in Organisatie</Link>
    : null

  return (
    <div className="theme-maestro admin-main admin-main--embed">
      <div className="admin-frame admin-frame--embed">
        <SkillsPage readOnly actions={actions} />
      </div>
    </div>
  )
}
