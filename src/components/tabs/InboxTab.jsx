import QuestionCard from '../QuestionCard'
import FeedbackCard from '../FeedbackCard'

export default function InboxTab({ questions, feedback }) {
  const openFeedback = feedback.filter(f => !f.status || f.status === 'open')
  const doneFeedback = feedback.filter(f => f.status && f.status !== 'open').slice(0, 20)

  return (
    <div>
      <h2 style={sectionTitle}>Open vragen {questions.length > 0 && <span style={count}>{questions.length}</span>}</h2>
      {questions.length === 0 ? (
        <Empty text="Geen openstaande vragen — alle agents weten wat ze moeten doen." />
      ) : (
        <div style={grid}>
          {questions.map(q => <QuestionCard key={q.id} question={q} />)}
        </div>
      )}

      <h2 style={sectionTitle}>Feedback — open {openFeedback.length > 0 && <span style={count}>{openFeedback.length}</span>}</h2>
      {openFeedback.length === 0 ? (
        <Empty text="Geen openstaande feedback." />
      ) : (
        <div style={grid}>
          {openFeedback.map(f => <FeedbackCard key={f.id} feedback={f} />)}
        </div>
      )}

      {doneFeedback.length > 0 && (
        <>
          <h2 style={sectionTitle}>Feedback — afgehandeld</h2>
          <div style={grid}>
            {doneFeedback.map(f => <FeedbackCard key={f.id} feedback={f} />)}
          </div>
        </>
      )}
    </div>
  )
}

function Empty({ text }) {
  return (
    <div style={{
      background: '#2B2B2B',
      border: '1px dashed #383838',
      borderRadius: 6,
      padding: '26px',
      textAlign: 'center',
      color: '#666',
      fontSize: 13,
    }}>{text}</div>
  )
}

const sectionTitle = { color: '#E0E0E0', fontWeight: 400, fontSize: 15, letterSpacing: '0.3px', margin: '0 0 14px', textTransform: 'uppercase', display: 'flex', alignItems: 'center', gap: 10 }
const count = { fontSize: 11, background: '#E86832', color: '#fff', padding: '2px 8px', borderRadius: 10, fontWeight: 600, textTransform: 'none', letterSpacing: 0 }
const grid = { display: 'flex', flexDirection: 'column', gap: 12, marginBottom: 28 }
