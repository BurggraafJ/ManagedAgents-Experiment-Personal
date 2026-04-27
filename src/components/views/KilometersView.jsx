import { useState } from 'react'
import AgentCard from '../AgentCard'
import { supabase } from '../../lib/supabase'

const INBOX_STATUS_LABEL = {
  pending:    'wacht op agent',
  processing: 'wordt verwerkt',
  done:       'verwerkt',
  error:      'fout',
  skipped:    'overgeslagen',
}

const INBOX_STATUS_CLASS = {
  pending:    's-idle',
  processing: 's-warning',
  done:       's-success',
  error:      's-error',
  skipped:    's-idle',
}

function todayIso() {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

// Kilometers-view — minimale pagina voor een agent die maar 1× per maand draait.
// Sinds Fase 2.c: quick-capture invoer bovenaan vervangt Slack #kilometerregistratie
// als input-bron. Agent leest uit km_trips_inbox bij volgende run.
export default function KilometersView({ data }) {
  const schedule  = (data.schedules || []).find(s => s.agent_name === 'kilometerregistratie')
  const latestRun = (data.latestRuns || {})['kilometerregistratie']
  const history   = (data.history    || {})['kilometerregistratie'] || []
  const inbox     = data.kmTripsInbox || []

  // Recente runs uit recentRuns / weekRuns gefilterd op deze agent
  const allRuns = (data.rangeRuns || data.recentRuns || []).filter(
    r => r.agent_name === 'kilometerregistratie'
  ).slice(0, 12)

  // Quick-capture state
  const [datum, setDatum] = useState(todayIso())
  const [van, setVan] = useState('')
  const [naar, setNaar] = useState('')
  const [doel, setDoel] = useState('')
  const [parkeerkosten, setParkeerkosten] = useState('')
  const [submitState, setSubmitState] = useState('idle')
  const [submitError, setSubmitError] = useState(null)

  async function submit() {
    if (submitState === 'submitting') return
    if (!datum) {
      setSubmitError('Datum is verplicht')
      setSubmitState('error')
      setTimeout(() => setSubmitState('idle'), 3000)
      return
    }
    if (!van.trim()) {
      setSubmitError('Van is verplicht')
      setSubmitState('error')
      setTimeout(() => setSubmitState('idle'), 3000)
      return
    }
    setSubmitState('submitting')
    setSubmitError(null)
    const { error } = await supabase.rpc('submit_km_trip', {
      p_datum: datum,
      p_van: van.trim(),
      p_naar: naar.trim() || null,
      p_doel: doel.trim() || null,
      p_parkeerkosten: parkeerkosten ? Number(parkeerkosten) : null,
    })
    if (error) {
      setSubmitError(error.message)
      setSubmitState('error')
      setTimeout(() => setSubmitState('idle'), 4000)
      return
    }
    // Reset form (datum behouden voor batch-invoer)
    setVan('')
    setNaar('')
    setDoel('')
    setParkeerkosten('')
    setSubmitState('ok')
    setTimeout(() => setSubmitState('idle'), 2000)
  }

  function onKeyDown(e) {
    if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
      e.preventDefault()
      submit()
    }
  }

  // Recente unieke "van/naar" voor datalist (autocomplete)
  const recentPlaces = Array.from(new Set(
    inbox.flatMap(i => [i.van, i.naar].filter(Boolean))
  )).slice(0, 30)

  return (
    <div className="stack" style={{ gap: 'var(--s-7)' }}>

      {/* Quick-capture — vervangt Slack #kilometerregistratie als input-bron */}
      <section>
        <div className="section__head">
          <h2 className="section__title">Nieuwe rit</h2>
          <span className="section__hint">agent verzamelt en verwerkt op de 2e van de maand</span>
        </div>
        <div className="card" style={{ padding: 'var(--s-5)' }}>
          <datalist id="km-places">
            {recentPlaces.map(p => <option key={p} value={p} />)}
          </datalist>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))', gap: 'var(--s-3)' }}>
            <label style={{ display: 'flex', flexDirection: 'column', gap: 4, fontSize: 12 }}>
              <span className="muted">Datum</span>
              <input
                type="date"
                value={datum}
                onChange={e => setDatum(e.target.value)}
                onKeyDown={onKeyDown}
                style={fieldStyle}
              />
            </label>
            <label style={{ display: 'flex', flexDirection: 'column', gap: 4, fontSize: 12 }}>
              <span className="muted">Van *</span>
              <input
                type="text"
                value={van}
                onChange={e => setVan(e.target.value)}
                onKeyDown={onKeyDown}
                list="km-places"
                placeholder="Deil (thuis)"
                style={fieldStyle}
              />
            </label>
            <label style={{ display: 'flex', flexDirection: 'column', gap: 4, fontSize: 12 }}>
              <span className="muted">Naar</span>
              <input
                type="text"
                value={naar}
                onChange={e => setNaar(e.target.value)}
                onKeyDown={onKeyDown}
                list="km-places"
                placeholder="Amsterdam"
                style={fieldStyle}
              />
            </label>
            <label style={{ display: 'flex', flexDirection: 'column', gap: 4, fontSize: 12 }}>
              <span className="muted">Doel</span>
              <input
                type="text"
                value={doel}
                onChange={e => setDoel(e.target.value)}
                onKeyDown={onKeyDown}
                placeholder="Klantbezoek Joosten"
                style={fieldStyle}
              />
            </label>
            <label style={{ display: 'flex', flexDirection: 'column', gap: 4, fontSize: 12 }}>
              <span className="muted">Parkeerkosten (€)</span>
              <input
                type="number"
                step="0.01"
                min="0"
                value={parkeerkosten}
                onChange={e => setParkeerkosten(e.target.value)}
                onKeyDown={onKeyDown}
                placeholder="0,00"
                style={fieldStyle}
              />
            </label>
          </div>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: 'var(--s-4)', fontSize: 12 }}>
            <span className="muted">* Datum + Van verplicht. Ctrl/⌘+Enter om te versturen.</span>
            <div style={{ display: 'flex', gap: 'var(--s-3)', alignItems: 'center' }}>
              {submitState === 'ok' && <span className="s-success">✓ opgeslagen</span>}
              {submitState === 'error' && <span className="s-error" title={submitError}>✗ {submitError}</span>}
              <button
                type="button"
                className="btn btn--accent"
                onClick={submit}
                disabled={submitState === 'submitting'}
              >
                {submitState === 'submitting' ? 'Versturen…' : 'Rit toevoegen'}
              </button>
            </div>
          </div>
        </div>

        {inbox.length > 0 && (
          <div style={{ marginTop: 'var(--s-4)' }}>
            <div className="section__hint" style={{ marginBottom: 'var(--s-3)' }}>
              Wachtrij {inbox.filter(i => i.status === 'pending').length} pending · totaal {inbox.length}
            </div>
            <div className="card" style={{ padding: 0 }}>
              {inbox.slice(0, 10).map(item => (
                <div
                  key={item.id}
                  style={{
                    padding: '10px 14px',
                    borderBottom: '1px solid var(--border)',
                    display: 'grid',
                    gridTemplateColumns: '90px 1fr 90px 90px',
                    gap: 12,
                    alignItems: 'center',
                    fontSize: 13,
                  }}
                >
                  <span className="muted mono" style={{ fontSize: 11 }}>
                    {item.datum || formatShortDate(item.created_at)}
                  </span>
                  <span style={{ color: 'var(--text)' }}>
                    {item.van || '—'}
                    {item.naar && <span className="muted"> → {item.naar}</span>}
                    {item.doel && <span className="muted" style={{ marginLeft: 8, fontSize: 11 }}>· {item.doel}</span>}
                  </span>
                  <span className="muted" style={{ fontSize: 12, textAlign: 'right' }}>
                    {item.parkeerkosten != null ? `€ ${Number(item.parkeerkosten).toFixed(2)}` : '—'}
                  </span>
                  <span
                    className={`pill ${INBOX_STATUS_CLASS[item.status] || 's-idle'}`}
                    style={{ fontSize: 10, justifySelf: 'end' }}
                  >
                    {INBOX_STATUS_LABEL[item.status] || item.status}
                  </span>
                </div>
              ))}
            </div>
          </div>
        )}
      </section>

      <div className="grid grid--agents">
        <AgentCard
          agent="kilometerregistratie"
          schedule={schedule}
          latestRun={latestRun}
          history={history}
          openQuestions={[]}
        />
      </div>

      <section>
        <div className="section__head">
          <h2 className="section__title">Hoe gebruik ik dit?</h2>
        </div>
        <div className="card" style={{ padding: 'var(--s-5)', lineHeight: 1.6, color: 'var(--text-dim)' }}>
          <p style={{ marginTop: 0 }}>
            Standaard draait de agent op de <strong>2e van elke maand</strong> en verwerkt automatisch
            de vorige maand uit je Outlook-agenda + de ritten die je hier hebt toegevoegd.
            Resultaat landt in <span className="mono">reiskosten_2026.xlsx</span>.
          </p>
          <p style={{ marginBottom: 0 }}>
            Voeg ritten direct toe via het invoerblok hierboven — agent leest ze bij de volgende run.
            Wil je een specifieke maand handmatig laten verwerken? Klik op <strong>↻ Run nu</strong> in het
            ⋯-menu rechts op de kaart.
          </p>
        </div>
      </section>

      <section>
        <div className="section__head">
          <h2 className="section__title">
            Recente runs <span className="section__count">{allRuns.length}</span>
          </h2>
        </div>
        {allRuns.length === 0 ? (
          <div className="empty">Nog geen recente runs.</div>
        ) : (
          <div className="card" style={{ padding: 0 }}>
            {allRuns.map(r => (
              <div
                key={r.id}
                style={{
                  padding: '12px 16px',
                  borderBottom: '1px solid var(--border)',
                  display: 'grid',
                  gridTemplateColumns: '110px 1fr 80px',
                  gap: 12,
                  alignItems: 'center',
                  fontSize: 13,
                }}
              >
                <span className="muted mono" style={{ fontSize: 11 }}>
                  {new Date(r.started_at).toLocaleString('nl-NL', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' })}
                </span>
                <span style={{ color: 'var(--text)' }}>{r.summary || '—'}</span>
                <span
                  className={`s-${r.status}`}
                  style={{
                    fontSize: 11, textAlign: 'right', textTransform: 'uppercase',
                    letterSpacing: 0.4, fontWeight: 600,
                  }}
                >
                  {r.status}
                </span>
              </div>
            ))}
          </div>
        )}
      </section>
    </div>
  )
}

const fieldStyle = {
  background: 'var(--surface-3)',
  border: '1px solid var(--border)',
  borderRadius: 'var(--r-md)',
  padding: '8px 10px',
  color: 'var(--text)',
  fontSize: 14,
  fontFamily: 'var(--font)',
}

function formatShortDate(iso) {
  if (!iso) return '—'
  return new Date(iso).toLocaleString('nl-NL', { day: '2-digit', month: 'short' })
}
