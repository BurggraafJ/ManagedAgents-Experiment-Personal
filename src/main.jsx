import React from 'react'
import ReactDOM from 'react-dom/client'
import { BrowserRouter } from 'react-router-dom'
import App from './App.jsx'
import ErrorBoundary from './components/ErrorBoundary.jsx'
import './index.css'

// Frontend Security F.3.2 — console-warning bij open devtools.
// Beschermt tegen "paste deze code in console"-social-engineering.
// Alleen in productie (in dev draait de developer zelf).
if (import.meta.env.PROD && typeof window !== 'undefined') {
  const big = 'background:#dc2626;color:#fff;font-size:32px;font-weight:bold;padding:6px 12px;border-radius:4px'
  const txt = 'color:#dc2626;font-size:14px;font-weight:600'
  // eslint-disable-next-line no-console
  console.log('%cSTOP!', big)
  // eslint-disable-next-line no-console
  console.log(
    '%cAls iemand je heeft gevraagd hier iets te plakken, doe dat NIET.\n' +
    'Dit is een ontwikkelaarsconsole. Plakken kan een aanvaller volledige toegang geven\n' +
    'tot je dashboard, mailbox en HubSpot. Sluit dit venster.',
    txt
  )
}

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <ErrorBoundary>
      <BrowserRouter future={{ v7_startTransition: true, v7_relativeSplatPath: true }}>
        <App />
      </BrowserRouter>
    </ErrorBoundary>
  </React.StrictMode>,
)
