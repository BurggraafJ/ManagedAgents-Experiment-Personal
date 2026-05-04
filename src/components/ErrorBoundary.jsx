import { Component } from 'react'
import { supabase } from '../lib/supabase'

// Frontend Security F.4.3 — best-effort log naar security_client_errors.
// RLS-policy is_app_owner_insert garandeert dat alleen de owner kan schrijven;
// als auth nog niet rond is faalt de insert stilletjes — niet erger dan voorheen.
async function logClientError(error, info) {
  try {
    await supabase.from('security_client_errors').insert({
      message: String(error?.message || error || 'unknown'),
      stack: error?.stack ? String(error.stack).slice(0, 8000) : null,
      component_stack: info?.componentStack ? String(info.componentStack).slice(0, 4000) : null,
      url: typeof window !== 'undefined' ? window.location.href : null,
      user_agent: typeof navigator !== 'undefined' ? navigator.userAgent : null,
      raw: {
        name: error?.name,
        message: error?.message,
      },
    })
  } catch {
    // network down / not authenticated — geen escalatie
  }
}

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
    // Best-effort persistentie naar Supabase voor Health-pagina-feed
    logClientError(error, info)
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
