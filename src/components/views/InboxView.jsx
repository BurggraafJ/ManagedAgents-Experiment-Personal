import ActionRail from '../sections/ActionRail'
import Inbox      from '../sections/Inbox'

export default function InboxView({ data }) {
  return (
    <div className="stack" style={{ gap: 'var(--s-7)' }}>
      <ActionRail
        questions={data.questions}
        feedback={data.feedback}
        overdueSchedules={data.overdueSchedules}
        expanded
      />
      <Inbox
        questions={data.questions}
        feedback={data.feedback}
      />
    </div>
  )
}
