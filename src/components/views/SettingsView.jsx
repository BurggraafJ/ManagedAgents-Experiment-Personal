import Schedules        from '../sections/Schedules'
import LinkedInProgress from '../sections/LinkedInProgress'
import Config           from '../sections/Config'
import SkillSecrets     from '../sections/SkillSecrets'

// Settings — overkoepelende systeem- en infrastructuur-configuratie. Bereikbaar
// via gear-icoon rechtsbovenin de view-header. Bevat:
//  - Schedules (cadence + aan/uit per agent — ook bewerkbaar via ⋯-menu op
//    de agent-card op het hoofd-dashboard)
//  - Skill-secrets (API-tokens, alleen via service-role muteerbaar)
//  - LinkedIn voortgang (operationele metric, leeft ook hier voor gemak)
//  - Algemene config (anon-key, env-flags, etc.)
//
// Inhoudelijke "wat moet de agent weten" hoort niet hier maar in Instructies.
export default function SettingsView({ data }) {
  return (
    <div className="stack" style={{ gap: 'var(--s-7)' }}>
      <Schedules schedules={data.schedules} />
      <SkillSecrets secrets={data.skillSecrets} />
      <LinkedInProgress rows={data.linkedin} />
      <Config />
    </div>
  )
}
