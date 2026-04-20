import QuestionCard from '../QuestionCard'
import FeedbackCard from '../FeedbackCard'

export default function Inbox({ questions, feedback }) {
  const openQ = questions.filter(q => q.status === 'open')
  const openF = feedback.filter(f => !f.status || f.status === 'open')
  const doneF = feedback.filter(f => f.status && f.status !== 'open').slice(0, 10)

  const order = { expired: 0, urgent: 1, warning: 2, ok: 3 }
  const sortedQ = [...openQ].sort((a, b) => (order[a.urgency] ?? 4) - (order[b.urgency] ?? 4))

  return (
    <section id="inbox">
      <div className="section__head">
        <h2 className="section__title">
          Open vragen {sortedQ.length > 0 && <span className="section__count">{sortedQ.length}</span>}
        </h2>
      </div>
      {sortedQ.length === 0 ? (
        <div className="empty">Geen openstaande vragen.</div>
      ) : (
        <div className="stack">
          {sortedQ.map(q => <QuestionCard key={q.id} question={q} />)}
        </div>
      )}

      <div className="section__head" style={{ marginTop: 'var(--s-7)' }}>
        <h2 className="section__title">
          Feedback — open {openF.length > 0 && <span className="section__count">{openF.length}</span>}
        </h2>
      </div>
      {openF.length === 0 ? (
        <div className="empty">Geen openstaande feedback.</div>
      ) : (
        <div className="stack">
          {openF.map(f => <FeedbackCard key={f.id} feedback={f} />)}
        </div>
      )}

      {doneF.length > 0 && (
        <>
          <div className="section__head" style={{ marginTop: 'var(--s-7)' }}>
            <h2 className="section__title">Feedback — verwerkt</h2>
          </div>
          <div className="stack">
            {doneF.map(f => <FeedbackCard key={f.id} feedback={f} />)}
          </div>
        </>
      )}
    </section>
  )
}
