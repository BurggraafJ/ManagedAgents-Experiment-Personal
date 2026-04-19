export default function App() {
  return (
    <div style={{
      minHeight: '100vh',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      textAlign: 'center',
    }}>
      <div>
        <h1 style={{ fontWeight: 300, letterSpacing: '-0.5px', fontSize: 38, margin: '0 0 12px' }}>
          legal <span style={{ color: '#E86832' }}>mind</span> dashboard
        </h1>
        <p style={{ color: '#4caf50', fontWeight: 500 }}>
          React app live via GitHub → Vercel auto-deploy
        </p>
        <p style={{ color: '#bbb' }}>
          Build-moment: <span>{new Date().toISOString()}</span>
        </p>
        <p style={{ color: '#666', fontSize: 12, marginTop: 20 }}>
          Componenten volgen in volgende commit — Legal Mind B.V.
        </p>
      </div>
    </div>
  )
}
