import { useState, useMemo, useEffect } from 'react'
import { supabase } from '../../../../lib/supabase'
import { SettingsPage } from '../SettingsLayout'

/**
 * ExternePartijenPage — beheert de centrale `external_party_directory`.
 *
 * Doel: lijst van partners / vendors / recruiters / etc. die agents (daily-admin,
 * auto-draft, daily-admin-future) anders moeten behandelen — typisch filteren
 * zodat er geen voorstel van komt. Vervangt de ad-hoc `agent_config.partner_domains`
 * met een gedeelde directory die alle agents consumeren via classify_external_party().
 *
 * CRUD via RPCs: list_external_parties / upsert_external_party / delete_external_party.
 */
const CLASSIFICATIONS = [
  { id: 'partner',    label: 'Partner',         hint: 'Strategic partner (Heliview, Influx, NewMedia Seton)' },
  { id: 'vendor',     label: 'Leverancier',     hint: 'We kopen iets van ze' },
  { id: 'recruiter',  label: 'Recruiter',       hint: 'Recruitment-bureau (Noyce e.d.)' },
  { id: 'competitor', label: 'Concurrent',      hint: 'Concurrent in de markt' },
  { id: 'community',  label: 'Community',       hint: 'Newsletter, forum, AI-community' },
  { id: 'press',      label: 'Press',           hint: 'Media / journalist / podcast' },
  { id: 'spam',       label: 'Spam',            hint: 'Cold-pitch zonder waarde' },
  { id: 'internal',   label: 'Intern',          hint: 'Eigen domein (legal-mind.nl)' },
]

export default function ExternePartijenPage() {
  const [rows, setRows] = useState([])
  const [loading, setLoading] = useState(true)
  const [err, setErr] = useState(null)
  const [filter, setFilter] = useState('')
  const [addingNew, setAddingNew] = useState(false)
  const [editingId, setEditingId] = useState(null)
  // Categorie-tab — verschijnt pas zodra de lijst groot genoeg is (≥50)
  // zodat we niet alles ineens hoeven te renderen.
  const [activeTab, setActiveTab] = useState('all')

  async function fetchRows() {
    setLoading(true)
    const { data, error } = await supabase.rpc('list_external_parties', { p_filter_text: filter || null })
    if (error) setErr(error.message)
    else { setRows(data || []); setErr(null) }
    setLoading(false)
  }
  useEffect(() => { fetchRows() /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [filter])

  const grouped = useMemo(() => {
    const out = {}
    for (const r of rows) {
      const c = r.classification || 'overig'
      if (!out[c]) out[c] = []
      out[c].push(r)
    }
    return out
  }, [rows])

  // Toon tabs pas vanaf ~50 rijen — daaronder is gegroepeerd genoeg.
  const showTabs = rows.length >= 50
  const tabDefs = useMemo(
    () => [{ id: 'all', label: 'Alle' }, ...CLASSIFICATIONS.map(c => ({ id: c.id, label: c.label }))],
    [],
  )
  const tabCounts = useMemo(() => {
    const out = { all: rows.length }
    for (const c of CLASSIFICATIONS) out[c.id] = (grouped[c.id] || []).length
    return out
  }, [grouped, rows.length])

  return (
    <SettingsPage
      title="Externe partijen"
      intro="Partners, vendors, recruiters en andere externe domeinen die agents moeten herkennen — typisch om ze automatisch te filteren zodat er geen voorstel van komt. Daily Admin, Auto Draft en Daily Admin Future lezen deze lijst bij elke run."
      right={
        <button
          type="button"
          className="set-btn set-btn--primary"
          onClick={() => { setAddingNew(true); setEditingId(null) }}
        >
          + Nieuw domein
        </button>
      }
    >
      <div className="set-toolbar">
        <input
          type="search"
          className="set-input"
          placeholder="Zoek op domein, naam of categorie…"
          value={filter}
          onChange={e => setFilter(e.target.value)}
        />
      </div>

      {showTabs && (
        <div className="set-tabs" role="tablist" aria-label="Filter op categorie">
          {tabDefs.map(t => (
            <button
              key={t.id}
              type="button"
              role="tab"
              aria-selected={activeTab === t.id}
              className={'set-tab' + (activeTab === t.id ? ' is-active' : '')}
              onClick={() => setActiveTab(t.id)}
              disabled={t.id !== 'all' && (tabCounts[t.id] || 0) === 0}
            >
              {t.label}
              <span className={'set-tab__dot' + ((tabCounts[t.id] || 0) === 0 ? ' is-empty' : '')} />
              {tabCounts[t.id] || 0}
            </button>
          ))}
        </div>
      )}

      {err && <div className="set-error">{err}</div>}

      {addingNew && (
        <EditRow
          mode="add"
          onCancel={() => setAddingNew(false)}
          onSaved={() => { setAddingNew(false); fetchRows() }}
        />
      )}

      {loading && rows.length === 0 ? (
        <div className="set-stub"><div className="set-stub__title">Laden…</div></div>
      ) : rows.length === 0 && !addingNew ? (
        <div className="set-stub">
          <div className="set-stub__title">Nog geen partijen geregistreerd</div>
          <div className="set-stub__hint">
            Klik <strong>+ Nieuw domein</strong> om er één toe te voegen.<br/>
            Voorbeeld: <code>heliview.com</code> als partner — daily-admin filtert dan automatisch.
          </div>
        </div>
      ) : (
        <div className="set-panel">
          {CLASSIFICATIONS
            .filter(c => (grouped[c.id] || []).length > 0)
            .filter(c => !showTabs || activeTab === 'all' || activeTab === c.id)
            .map(c => (
              <GroupTable
                key={c.id}
                category={c}
                rows={grouped[c.id]}
                editingId={editingId}
                setEditingId={setEditingId}
                fetchRows={fetchRows}
              />
            ))}
        </div>
      )}
    </SettingsPage>
  )
}

// Eén categorie-groep met paginatie (25 rijen per pagina) zodat lange lijsten
// als 'Leverancier' (120+) niet ineens scrollen. Bij ≤25 rijen geen pager.
function GroupTable({ category, rows, editingId, setEditingId, fetchRows }) {
  const PAGE_SIZE = 25
  const [page, setPage] = useState(0)
  const totalPages = Math.max(1, Math.ceil(rows.length / PAGE_SIZE))
  // Reset naar pagina 0 als filter de rij-set verkleint onder de huidige pagina
  useEffect(() => {
    if (page > totalPages - 1) setPage(0)
  }, [totalPages, page])
  const start = page * PAGE_SIZE
  const visible = rows.slice(start, start + PAGE_SIZE)
  const showPager = rows.length > PAGE_SIZE

  return (
    <div className="set-group">
      <div className="set-group__head">
        <strong>{category.label}</strong>
        <span className="set-group__hint">{category.hint}</span>
        <span className="set-group__count">{rows.length}</span>
      </div>
      <table className="set-table">
        <thead>
          <tr>
            <th>Scope</th>
            <th>Naam</th>
            <th>Filter daily-admin</th>
            <th>Notitie</th>
            <th className="is-right">Acties</th>
          </tr>
        </thead>
        <tbody>
          {visible.map(r => editingId === r.id ? (
            <EditRow
              key={r.id}
              mode="edit"
              row={r}
              onCancel={() => setEditingId(null)}
              onSaved={() => { setEditingId(null); fetchRows() }}
            />
          ) : (
            <tr key={r.id}>
              <td>
                {r.email
                  ? <><span className="set-badge">persoon</span> <code>{r.email}</code></>
                  : <><span className="set-badge">bedrijf</span> <code>{r.domain}</code></>}
              </td>
              <td>{r.canonical_name || <em className="set-muted">—</em>}</td>
              <td>
                {r.skip_proposal
                  ? <span className="set-badge set-badge--success">✓ filter aan</span>
                  : <span className="set-badge">— filter uit</span>}
              </td>
              <td className="set-cell-truncate" title={r.notes || ''}>{r.notes || <em className="set-muted">—</em>}</td>
              <td className="is-right">
                <button type="button" className="set-btn-icon" onClick={() => setEditingId(r.id)} title="Bewerken">✎</button>
                <DeleteBtn target={r.email || r.domain} onDeleted={fetchRows} />
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      {showPager && (
        <div className="set-pager">
          <button
            type="button"
            className="set-btn"
            onClick={() => setPage(p => Math.max(0, p - 1))}
            disabled={page === 0}
          >
            ← Vorige
          </button>
          <span className="set-pager__info">
            Pagina {page + 1} van {totalPages} · {rows.length} partijen
          </span>
          <button
            type="button"
            className="set-btn"
            onClick={() => setPage(p => Math.min(totalPages - 1, p + 1))}
            disabled={page >= totalPages - 1}
          >
            Volgende →
          </button>
        </div>
      )}
    </div>
  )
}

function EditRow({ mode, row, onCancel, onSaved }) {
  // Scope: 'domain' (heel bedrijf) of 'email' (alleen één persoon)
  const initialScope = row?.email ? 'email' : 'domain'
  const [scope, setScope] = useState(initialScope)
  const [domain, setDomain] = useState(row?.domain || '')
  const [email, setEmail] = useState(row?.email || '')
  const [canonicalName, setCanonicalName] = useState(row?.canonical_name || '')
  const [classification, setClassification] = useState(row?.classification || 'partner')
  const [skipProposal, setSkipProposal] = useState(row?.skip_proposal ?? true)
  const [skipAutodraft, setSkipAutodraft] = useState(row?.skip_autodraft ?? false)
  const [skipAdminFuture, setSkipAdminFuture] = useState(row?.skip_admin_future ?? true)
  const [notes, setNotes] = useState(row?.notes || '')
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState(null)

  async function save() {
    const target = scope === 'email' ? email.trim() : domain.trim()
    if (!target) { setErr(`${scope === 'email' ? 'Emailadres' : 'Domein'} verplicht`); return }
    if (scope === 'email' && !target.includes('@')) { setErr('Geldig emailadres met @'); return }
    setBusy(true); setErr(null)
    const { data, error } = await supabase.rpc('upsert_external_party', {
      p_domain: scope === 'domain' ? domain.trim() : null,
      p_email:  scope === 'email'  ? email.trim()  : null,
      p_canonical_name: canonicalName.trim() || null,
      p_classification: classification,
      p_skip_proposal: skipProposal,
      p_skip_autodraft: skipAutodraft,
      p_skip_admin_future: skipAdminFuture,
      p_notes: notes.trim() || null,
      p_source: mode === 'add' ? 'manual' : 'manual_edit',
    })
    if (error) { setErr(error.message); setBusy(false); return }
    if (data?.ok === false) { setErr(data.reason || 'mislukt'); setBusy(false); return }
    setBusy(false)
    onSaved()
  }

  return (
    <tr className="set-row-edit">
      <td colSpan={5}>
        <div className="set-edit-grid">
          <div className="set-edit-field set-edit-field--full">
            <span>Scope</span>
            <div style={{ display:'flex', gap:8 }}>
              <label style={{ display:'flex', alignItems:'center', gap:6, fontSize:12.5 }}>
                <input type="radio" checked={scope === 'domain'} onChange={() => setScope('domain')} disabled={mode === 'edit'} />
                Hele bedrijf (domein)
              </label>
              <label style={{ display:'flex', alignItems:'center', gap:6, fontSize:12.5 }}>
                <input type="radio" checked={scope === 'email'} onChange={() => setScope('email')} disabled={mode === 'edit'} />
                Alleen één persoon (e-mail)
              </label>
            </div>
          </div>
          {scope === 'domain' ? (
            <label className="set-edit-field">
              <span>Domein</span>
              <input type="text" value={domain} onChange={e => setDomain(e.target.value)} placeholder="bv. heliview.com" autoFocus disabled={mode === 'edit'} />
            </label>
          ) : (
            <label className="set-edit-field">
              <span>E-mailadres</span>
              <input type="email" value={email} onChange={e => setEmail(e.target.value)} placeholder="bv. hans@heliview.com" autoFocus disabled={mode === 'edit'} />
            </label>
          )}
          <label className="set-edit-field">
            <span>Naam</span>
            <input type="text" value={canonicalName} onChange={e => setCanonicalName(e.target.value)} placeholder={scope === 'email' ? 'bv. Hans de Werd' : 'bv. Heliview'} />
          </label>
          <label className="set-edit-field">
            <span>Categorie</span>
            <select value={classification} onChange={e => setClassification(e.target.value)}>
              {CLASSIFICATIONS.map(c => <option key={c.id} value={c.id}>{c.label}</option>)}
            </select>
          </label>
          <label className="set-edit-field set-edit-field--full">
            <span>Notitie</span>
            <input type="text" value={notes} onChange={e => setNotes(e.target.value)} placeholder="optioneel — waarom op de lijst" />
          </label>
          <div className="set-edit-flags">
            <label><input type="checkbox" checked={skipProposal} onChange={e => setSkipProposal(e.target.checked)} /> Filter Daily Admin (geen voorstel)</label>
            <label><input type="checkbox" checked={skipAdminFuture} onChange={e => setSkipAdminFuture(e.target.checked)} /> Filter Toekomst-flow</label>
            <label><input type="checkbox" checked={skipAutodraft} onChange={e => setSkipAutodraft(e.target.checked)} /> Filter Auto Draft</label>
          </div>
          {err && <div className="set-error">{err}</div>}
          <div className="set-edit-actions">
            <button type="button" className="set-btn" onClick={onCancel} disabled={busy}>Annuleren</button>
            <button type="button" className="set-btn set-btn--primary" onClick={save} disabled={busy || !domain.trim()}>
              {busy ? 'Opslaan…' : (mode === 'add' ? 'Toevoegen' : 'Opslaan')}
            </button>
          </div>
        </div>
      </td>
    </tr>
  )
}

function DeleteBtn({ target, onDeleted }) {
  const [busy, setBusy] = useState(false)
  async function del() {
    if (!window.confirm(`${target} verwijderen uit lijst?`)) return
    setBusy(true)
    const { error } = await supabase.rpc('delete_external_party', { p_domain_or_email: target })
    setBusy(false)
    if (error) window.alert(error.message)
    else onDeleted()
  }
  return (
    <button type="button" className="set-btn-icon set-btn-icon--danger" onClick={del} disabled={busy} title="Verwijderen">×</button>
  )
}
