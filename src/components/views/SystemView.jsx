import Schedules        from '../sections/Schedules'
import LinkedInProgress from '../sections/LinkedInProgress'
import Config           from '../sections/Config'
import SkillSecrets     from '../sections/SkillSecrets'

export default function SystemView({ data }) {
  return (
    <div className="stack" style={{ gap: 'var(--s-7)' }}>
      <Schedules schedules={data.schedules} />
      <SkillSecrets secrets={data.skillSecrets} />
      <LinkedInProgress rows={data.linkedin} />
      <Config />
    </div>
  )
}
