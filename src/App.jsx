import { useState } from 'react'
import { useDashboard } from './hooks/useDashboard'
import Header from './components/Header'
import TabNav from './components/TabNav'
import DashboardTab from './components/tabs/DashboardTab'
import InboxTab from './components/tabs/InboxTab'
import ConfigTab from './components/tabs/ConfigTab'

export default function App() {
  const [activeTab, setActiveTab] = useState('dashboard')
  const { data, loading, error, lastRefresh, refresh } = useDashboard()

  if (loading) return <FullScreen message="Data laden uit Supabase…" color="#E86832" />
  if (error) return <FullScreen message={`Fout bij laden: ${error}`} color="#d9534f" />

  const openQuestions = data.questions.filter(q => q.status === 'open')
  const openFeedback = data.feedback.filter(f => !f.status || f.status === 'open')
  const inboxCount = openQuestions.length + openFeedback.length

  return (
    <div style={{ minHeight: '100vh', display: 'flex', flexDirection: 'column' }}>
      <Header lastRefresh={lastRefresh} onRefresh={refresh} />
      <TabNav active={activeTab} onChange={setActiveTab} inboxCount={inboxCount} />
      <main style={{ padding: '28px', maxWidth: 1200, margin: '0 auto', width: '100%', flex: 1 }}>
        {activeTab === 'dashboard' && <DashboardTab data={data} />}
        {activeTab === 'inbox' && <InboxTab questions={openQuestions} feedback={data.feedback} />}
        {activeTab === 'configuratie' && <ConfigTab schedules={data.schedules} />}
      </main>
      <footer style={{
        textAlign: 'center',
        color: '#444',
        fontSize: 10,
        padding: '20px 0 24px',
        borderTop: '1px solid #252525',
        letterSpacing: '0.3px',
      }}>
        Legal Mind B.V. · legal-mind.nl · KVK 93846523 · Agent Dashboard v3.0
      </footer>
    </div>
  )
}

function FullScreen({ message, color }) {
  return (
    <div style={{
      minHeight: '100vh',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      color,
      fontSize: 14,
    }}>{message}</div>
  )
}
