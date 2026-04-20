import { Component } from 'react'

export default class ErrorBoundary extends Component {
  constructor(props) {
    super(props)
    this.state = { error: null, info: null }
  }

  static getDerivedStateFromError(error) {
    return { error }
  }

  componentDidCatch(error, info) {
    this.setState({ info })
    // eslint-disable-next-line no-console
    console.error('[dashboard] render crashed:', error, info)
  }

  render() {
    if (!this.state.error) return this.props.children

    return (
      <div style={{ minHeight: '100vh', padding: 24, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        <div className="card" style={{ maxWidth: 640, width: '100%' }}>
          <div className="kpi__label" style={{ color: 'var(--error)', marginBottom: 10 }}>
            Dashboard crash
          </div>
          <div style={{ marginBottom: 12 }}>
            Er is een render-fout opgetreden. De rest van de app is gestopt om te voorkomen dat je een zwart scherm ziet.
          </div>
          <pre style={{
            background: 'var(--surface-3)',
            padding: 'var(--s-3)',
            borderRadius: 'var(--r-sm)',
            fontSize: 11,
            overflow: 'auto',
            maxHeight: 240,
            whiteSpace: 'pre-wrap',
            color: 'var(--text-dim)',
          }}>
            {String(this.state.error?.stack || this.state.error?.message || this.state.error)}
          </pre>
          <button className="btn btn--accent" style={{ marginTop: 12 }} onClick={() => window.location.reload()}>
            Opnieuw laden
          </button>
        </div>
      </div>
    )
  }
}
