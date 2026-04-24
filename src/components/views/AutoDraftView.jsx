import { useState, useMemo, useEffect, useCallback } from 'react'
import { supabase } from '../../lib/supabase'

const AGENT = 'auto-draft'

// AutoDraftView v4 — volledige mail-inbox in het dashboard.
//
// Elke mail die de auto-draft skill heeft gezien staat links in een lijst,
// rechts detail + draft + 3 knoppen (Verstuur / Negeer / Aanpassingsvoorstel).
// Bij elke beslissing wordt een rij in autodraft_decisions geschreven; de
// auto-draft-execute skill pakt die op en voert uit (verzenden + origineel
// naar target_folder verplaatsen).
//
// Onder de inbox staat:
//   - Categorievoorstellen (skill wil nieuwe categorie toevoegen)
//   - Categoriebeheer (bestaande categorieën + instructies bewerken)
//   - Logboek van verwerkte mails
//   - Geleerde lessen
//   - Systeem-instructies + templates (collapsed, oude config)

export default function AutoDraftView({ data }) {
  const mails       = data.autodraftMails      || []
  const categories  = useMemo(() =>
    (data.autodraftCategories || []).slice().sort((a, b) => (a.sort_order ?? 100) - (b.sort_order ?? 100)),
    [data.autodraftCategories])
  const proposals   = data.autodraftCategoryProposals || []
  const decisions   = data.autodraftDecisions  || []
  const folders     = data.autodraftFolders    || []
  const lessons     = data.autodraftLessons    || []

  const pending   = useMemo(() => mails.filter(m => m.status === 'pending'), [mails])
  const processed = useMemo(() => mails.filter(m => ['sent','ignored','amended','failed'].includes(m.status)), [mails])
  const queued    = useMemo(() => mails.filter(m => String(m.status).startsWith('queued_')), [mails])

  return (
    <div className="stack" style={{ gap: 'var(--s-5)' }}>
      <InboxSplit
        pending={pending}
        queued={queued}
        categories={categories}
        folders={folders}
        lessons={lessons}
      />

      <ProposalsBlock proposals={proposals} lessons={lessons} />
      <CategoriesBlock categories={categories} folders={folders} />
      <InboxLog processed={processed} queued={queued} decisions={decisions} />
      <LessonsBlock lessons={lessons} categories={categories} />
      <SystemInstructionsBlock data={data} />
      <DebugBlock data={data} />
    </div>
  )
}

// =====================================================================
// INBOX SPLIT — lijst links + detail rechts
// =====================================================================

function InboxSplit({ pending, queued, categories, folders, lessons }) {
  // Groepeer op Vandaag / Gisteren / Deze week / Ouder
  const buckets = useMemo(() => groupByAge(pending), [pending])
  const all = useMemo(() => [...buckets.today, ...buckets.yesterday, ...buckets.week, ...buckets.older], [buckets])

  const [selectedId, setSelectedId] = useState(null)
  useEffect(() => {
    if (!selectedId && all.length > 0) setSelectedId(all[0].mail_id)
    if (selectedId && !all.find(m => m.mail_id === selectedId)) setSelectedId(all[0]?.mail_id || null)
  }, [all, selectedId])

  const selected = all.find(m => m.mail_id === selectedId) || null
  const queueCount = queued.length

  return (
    <section>
      <div className="ad-inbox-head">
        <h2 className="section__title" style={{ margin: 0 }}>
          Postvak <span className="section__count">{pending.length}</span>
        </h2>
        {queueCount > 0 && (
          <span className="ad-queued-pill" title="Beslissingen wachten op verzending">
            ⏳ {queueCount} in wachtrij
          </span>
        )}
        <span className="muted" style={{ fontSize: 11, marginLeft: 'auto' }}>
          je hoeft niet meer in Outlook te kijken — klik je postvak leeg
        </span>
      </div>

      <div className="va-split">
        <aside className="va-list">
          {all.length === 0 ? (
            <div className="empty empty--compact" style={{ padding: 40, textAlign: 'center', fontSize: 13 }}>
              🎉 Postvak leeg<br />
              <span className="muted" style={{ fontSize: 11 }}>Nieuwe mails verschijnen hier automatisch bij de volgende auto-draft run.</span>
            </div>
          ) : (
            <>
              {buckets.today.length > 0       && <BucketHead label="Vandaag"     count={buckets.today.length} />}
              {buckets.today.map(m     => <MailRow key={m.mail_id} mail={m} categories={categories} selected={m.mail_id === selectedId} onSelect={() => setSelectedId(m.mail_id)} />)}
              {buckets.yesterday.length > 0   && <BucketHead label="Gisteren"    count={buckets.yesterday.length} />}
              {buckets.yesterday.map(m => <MailRow key={m.mail_id} mail={m} categories={categories} selected={m.mail_id === selectedId} onSelect={() => setSelectedId(m.mail_id)} />)}
              {buckets.week.length > 0        && <BucketHead label="Deze week"   count={buckets.week.length} />}
              {buckets.week.map(m      => <MailRow key={m.mail_id} mail={m} categories={categories} selected={m.mail_id === selectedId} onSelect={() => setSelectedId(m.mail_id)} />)}
              {buckets.older.length > 0       && <BucketHead label="Ouder"       count={buckets.older.length} />}
              {buckets.older.map(m     => <MailRow key={m.mail_id} mail={m} categories={categories} selected={m.mail_id === selectedId} onSelect={() => setSelectedId(m.mail_id)} />)}
            </>
          )}
        </aside>
        <main className="va-detail">
          {selected ? (
            <MailDetail
              key={selected.mail_id}
              mail={selected}
              categories={categories}
              folders={folders}
              lessons={lessons}
            />
          ) : (
            <div className="empty empty--compact" style={{ padding: 60 }}>
              Selecteer een mail links, of wacht tot auto-draft nieuwe mails heeft gescand.
            </div>
          )}
        </main>
      </div>
    </section>
  )
}

function BucketHead({ label, count }) {
  return (
    <div className="va-list-group__head va-list-group__head--muted" style={{ marginTop: 8 }}>
      {label} <span>{count}</span>
    </div>
  )
}

function MailRow({ mail, categories, selected, onSelect }) {
  const cat = categories.find(c => c.category_key === mail.category_key)
  const isSkip = mail.suggested_action === 'skip'
  const conf = Number(mail.confidence || 0)
  const tone = conf >= 0.75 ? 'high' : conf >= 0.5 ? 'mid' : 'low'
  return (
    <button type="button"
      className={`va-row ad-row ad-row--${tone} ${selected ? 'is-selected' : ''} ${isSkip ? 'ad-row--skip' : ''}`}
      onClick={onSelect}>
      <div className="va-row__top">
        <span className={`ad-dot ad-dot--${cat?.category_key || 'onbekend'}`} aria-hidden="true" />
        <span className="va-row__subject">{mail.subject || '(geen onderwerp)'}</span>
        {isSkip && <span className="ad-row__hint">negeer</span>}
      </div>
      <div className="va-row__meta">
        <span className="ad-row__from">{mail.from_name || mail.from_email || '—'}</span>
        {cat && <span className="ad-row__cat">{cat.label}</span>}
        <span className="va-row__time">{formatRelative(mail.received_at)}</span>
      </div>
    </button>
  )
}

// =====================================================================
// MAIL DETAIL
// =====================================================================

function MailDetail({ mail, categories, folders, lessons }) {
  const [draftBody, setDraftBody]       = useState(mail.draft_body || '')
  const [draftSubject, setDraftSubject] = useState(mail.draft_subject || '')
  const [targetFolder, setTargetFolder] = useState(mail.target_folder || '')
  const [categoryKey, setCategoryKey]   = useState(mail.category_key || '')
  const [amendText, setAmendText]       = useState('')
  const [mode, setMode]                 = useState(null) // null | 'amend'
  const [showOriginal, setShowOriginal] = useState(false)
  const [busy, setBusy]                 = useState(null)
  const [err, setErr]                   = useState(null)

  // Low-confidence of skip → start ingeklapt zodat de 'Negeer'-knop visueel dominant is
  const isSkipSuggested = mail.suggested_action === 'skip'
  const [collapsed, setCollapsed] = useState(isSkipSuggested)

  useEffect(() => {
    setDraftBody(mail.draft_body || '')
    setDraftSubject(mail.draft_subject || '')
    setTargetFolder(mail.target_folder || '')
    setCategoryKey(mail.category_key || '')
    setAmendText('')
    setMode(null)
    setShowOriginal(false)
    setCollapsed(mail.suggested_action === 'skip')
    setErr(null)
  }, [mail.mail_id])

  const cat = categories.find(c => c.category_key === categoryKey)
  const folderOptions = useMemo(() => {
    const fromFolders = folders.map(f => f.full_path || f.display_name).filter(Boolean)
    const fromCategories = categories.map(c => c.default_target_folder).filter(Boolean)
    const unique = Array.from(new Set([...fromFolders, ...fromCategories]))
    unique.sort()
    return unique
  }, [folders, categories])

  const activeLessons = useMemo(() => lessons.filter(l =>
    (l.scope === 'global') ||
    (l.scope === 'category' && l.scope_value === categoryKey) ||
    (l.scope === 'domain' && mail.from_email && mail.from_email.endsWith('@' + l.scope_value)) ||
    (l.scope === 'sender' && l.scope_value === mail.from_email)
  ), [lessons, categoryKey, mail.from_email])

  const submit = useCallback(async (action) => {
    if (busy) return
    setErr(null); setBusy(action)
    try {
      const { data: rpcRes, error } = await supabase.rpc('submit_autodraft_decision', {
        p_mail_id: mail.mail_id,
        p_action: action,
        p_amend: action === 'amend' ? amendText : null,
        p_final_subject: action === 'send' ? draftSubject : null,
        p_final_body:    action === 'send' ? draftBody    : null,
        p_target_folder: targetFolder || null,
      })
      if (error) setErr(error.message)
      else if (rpcRes && rpcRes.ok === false) setErr(rpcRes.reason || 'mislukt')
    } catch (e) { setErr(e.message) }
    setBusy(null)
  }, [busy, mail.mail_id, amendText, draftSubject, draftBody, targetFolder])

  const changeCategory = useCallback(async (newKey) => {
    setCategoryKey(newKey)
    try {
      await supabase.rpc('set_autodraft_mail_category', { p_mail_id: mail.mail_id, p_category_key: newKey })
    } catch { /* best-effort */ }
  }, [mail.mail_id])

  return (
    <div className="ad-detail">
      {/* Header */}
      <div className="ad-detail__head">
        <div style={{ flex: 1, minWidth: 0 }}>
          <div className="ad-detail__from">
            <strong>{mail.from_name || '—'}</strong>{' '}
            <span className="muted">&lt;{mail.from_email || '—'}&gt;</span>
            <span className="muted" style={{ marginLeft: 8 }}>· {formatDateTime(mail.received_at)}</span>
          </div>
          <div className="ad-detail__subject">{mail.subject || '(geen onderwerp)'}</div>
        </div>
        <div className="ad-conf" title={`Confidence: ${Math.round((mail.confidence || 0) * 100)}%`}>
          <span className={`ad-conf__ring ad-conf__ring--${confTone(mail.confidence)}`}>
            {Math.round((mail.confidence || 0) * 100)}%
          </span>
        </div>
      </div>

      {/* Skill-reasoning */}
      {mail.suggested_reasoning && (
        <div className="ad-reasoning">
          <span className="ad-reasoning__label">Skill denkt:</span>{' '}
          {mail.suggested_reasoning}
        </div>
      )}

      {/* Categorie + doelmap */}
      <div className="ad-meta-row">
        <label className="ad-meta-field">
          <span className="ad-meta-field__label">Categorie</span>
          <select
            value={categoryKey}
            onChange={e => changeCategory(e.target.value)}
            disabled={!!busy}
            className="ad-select"
          >
            <option value="">— niet gecategoriseerd —</option>
            {categories.filter(c => c.active !== false).map(c => (
              <option key={c.category_key} value={c.category_key}>{c.label}</option>
            ))}
          </select>
          {cat?.handling_instructions && (
            <span className="ad-meta-field__hint" title={cat.handling_instructions}>
              ℹ️ instructies
            </span>
          )}
        </label>
        <label className="ad-meta-field">
          <span className="ad-meta-field__label">Na verwerken: map</span>
          <input
            type="text"
            value={targetFolder}
            onChange={e => setTargetFolder(e.target.value)}
            list="ad-folder-suggestions"
            disabled={!!busy}
            placeholder={cat?.default_target_folder || 'bv. Klanten/Afgehandeld'}
            className="ad-input"
          />
          <datalist id="ad-folder-suggestions">
            {folderOptions.map(f => <option key={f} value={f} />)}
          </datalist>
        </label>
      </div>

      {/* Collapse toggle bij skip-suggestie */}
      {isSkipSuggested && (
        <div className="ad-skip-banner">
          <span>🗂️ Skill stelt voor: <strong>negeren en archiveren</strong>.</span>
          <button type="button" className="btn btn--ghost" onClick={() => setCollapsed(v => !v)} style={{ fontSize: 11, padding: '2px 8px' }}>
            {collapsed ? 'toch draft tonen' : 'weer inklappen'}
          </button>
        </div>
      )}

      {/* Originele mail */}
      <div className="ad-section">
        <button
          type="button"
          className="ad-section__head"
          onClick={() => setShowOriginal(v => !v)}
        >
          {showOriginal ? '▾' : '▸'} Originele mail
        </button>
        {showOriginal && (
          <div className="ad-original" dangerouslySetInnerHTML={{
            __html: sanitizeHtml(mail.body_html || `<pre>${escapeHtml(mail.body_text || mail.body_preview || '')}</pre>`)
          }} />
        )}
        {!showOriginal && mail.body_preview && (
          <div className="ad-preview muted">{mail.body_preview.slice(0, 240)}{mail.body_preview.length > 240 ? '…' : ''}</div>
        )}
      </div>

      {/* Draft — alleen tonen als niet collapsed */}
      {!collapsed && (
        <div className="ad-section ad-draft">
          <div className="ad-section__head ad-section__head--static">
            Voorgestelde antwoord
            {activeLessons.length > 0 && (
              <span className="muted" style={{ fontSize: 11, marginLeft: 8 }}>
                · {activeLessons.length} lesson(s) toegepast
              </span>
            )}
          </div>
          <input
            type="text"
            value={draftSubject}
            onChange={e => setDraftSubject(e.target.value)}
            disabled={!!busy}
            className="ad-input ad-input--subject"
            placeholder="Onderwerp"
          />
          <textarea
            value={draftBody}
            onChange={e => setDraftBody(e.target.value)}
            disabled={!!busy}
            rows={Math.max(6, Math.min(20, (draftBody.split('\n').length || 1) + 2))}
            className="ad-textarea"
            placeholder="Skill heeft nog geen draft gemaakt — typ zelf je antwoord."
          />
        </div>
      )}

      {/* Actieknoppen */}
      <div className="ad-actions">
        <button
          type="button"
          className={`btn ad-btn ad-btn--send ${collapsed ? 'ad-btn--dim' : 'ad-btn--primary'}`}
          disabled={!!busy || collapsed || !draftBody.trim()}
          onClick={() => submit('send')}
        >
          {busy === 'send' ? 'Verzenden…' : '▶ Verstuur'}
        </button>
        <button
          type="button"
          className={`btn ad-btn ad-btn--ignore ${collapsed ? 'ad-btn--primary' : ''}`}
          disabled={!!busy}
          onClick={() => submit('ignore')}
          title={cat?.default_target_folder ? `verplaats naar ${targetFolder || cat.default_target_folder}` : 'archiveer'}
        >
          {busy === 'ignore' ? 'Archiveren…' : '🗂️ Negeer'}
        </button>
        <button
          type="button"
          className={`btn ad-btn ad-btn--amend ${mode === 'amend' ? 'ad-btn--primary' : ''}`}
          disabled={!!busy}
          onClick={() => setMode(m => m === 'amend' ? null : 'amend')}
        >
          ✎ Aanpassingsvoorstel
        </button>
        {err && <span style={{ color: 'var(--error)', fontSize: 12, marginLeft: 8 }}>⚠ {err}</span>}
      </div>

      {/* Amend-invoer */}
      {mode === 'amend' && (
        <div className="ad-amend">
          <label className="ad-meta-field__label" style={{ marginBottom: 4 }}>
            Wat moet anders? De skill herschrijft op basis van je correctie bij de volgende run.
          </label>
          <textarea
            value={amendText}
            onChange={e => setAmendText(e.target.value)}
            disabled={!!busy}
            rows={3}
            className="ad-textarea"
            placeholder={'bv. "Korter", "Tutoyeren", "Voorstel een concreet moment volgende week", "Verwijs naar de trial-uitnodiging van 15 april"…'}
          />
          <div style={{ display: 'flex', gap: 8, marginTop: 8 }}>
            <button
              type="button"
              className="btn btn--accent"
              disabled={!!busy || !amendText.trim()}
              onClick={() => submit('amend')}
            >
              {busy === 'amend' ? 'Indienen…' : 'Stuur naar skill'}
            </button>
            <button
              type="button"
              className="btn btn--ghost"
              onClick={() => { setMode(null); setAmendText('') }}
              disabled={!!busy}
            >
              Annuleer
            </button>
          </div>
        </div>
      )}
    </div>
  )
}

// =====================================================================
// CATEGORIEVOORSTELLEN
// =====================================================================

function ProposalsBlock({ proposals, lessons }) {
  const [open, setOpen] = useState(proposals.length > 0)
  if (proposals.length === 0 && lessons.length === 0) {
    return (
      <section className="va-block ad-proposals-empty">
        <div className="va-block__head" style={{ cursor: 'default' }}>
          <span className="va-block__caret">·</span>
          <span className="va-block__title">Categorievoorstellen</span>
          <span className="muted va-block__hint">geen voorstellen — skill meldt zich hier als hij iets nieuws herkent</span>
        </div>
      </section>
    )
  }
  return (
    <section className="va-block">
      <button type="button" className="va-block__head" onClick={() => setOpen(v => !v)}>
        <span className="va-block__caret">{open ? '▾' : '▸'}</span>
        <span className="va-block__title">Categorievoorstellen</span>
        <span className="va-block__count">{proposals.length}</span>
        <span className="muted va-block__hint">skill stelt nieuwe categorie voor · jij accepteert of wijst af</span>
      </button>
      {open && (
        <div className="va-block__body">
          {proposals.length === 0 ? (
            <div className="empty empty--compact" style={{ padding: 14, fontSize: 12 }}>
              Geen openstaande voorstellen.
            </div>
          ) : proposals.map(p => <ProposalCard key={p.id} proposal={p} />)}
        </div>
      )}
    </section>
  )
}

function ProposalCard({ proposal }) {
  const [keyVal, setKeyVal]     = useState(proposal.proposed_key)
  const [label, setLabel]       = useState(proposal.proposed_label)
  const [instr, setInstr]       = useState(proposal.proposed_instructions || '')
  const [folder, setFolder]     = useState(proposal.proposed_folder || '')
  const [busy, setBusy]         = useState(null)
  const [err, setErr]           = useState(null)
  const [rejectReason, setRR]   = useState('')
  const [mode, setMode]         = useState(null) // null | 'reject'

  async function accept() {
    setBusy('accept'); setErr(null)
    try {
      const { data, error } = await supabase.rpc('accept_autodraft_category_proposal', {
        p_proposal_id: proposal.id,
        p_category_key_override: keyVal,
        p_label_override: label,
        p_instructions_override: instr,
        p_folder_override: folder,
        p_reviewed_by: 'dashboard',
      })
      if (error) setErr(error.message)
      else if (data && data.ok === false) setErr(data.reason || 'mislukt')
    } catch (e) { setErr(e.message) }
    setBusy(null)
  }

  async function reject() {
    setBusy('reject'); setErr(null)
    try {
      const { data, error } = await supabase.rpc('reject_autodraft_category_proposal', {
        p_proposal_id: proposal.id,
        p_reason: rejectReason || null,
        p_reviewed_by: 'dashboard',
      })
      if (error) setErr(error.message)
      else if (data && data.ok === false) setErr(data.reason || 'mislukt')
    } catch (e) { setErr(e.message) }
    setBusy(null)
  }

  return (
    <div className="ad-proposal">
      <div className="ad-proposal__head">
        <span className="mono" style={{ fontSize: 11, color: 'var(--text-muted)' }}>
          {new Date(proposal.created_at).toLocaleString('nl-NL', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' })}
        </span>
        <strong style={{ marginLeft: 10 }}>{proposal.proposed_label}</strong>
      </div>
      {proposal.reasoning && (
        <div className="ad-proposal__reasoning">
          <span className="ad-reasoning__label">Waarom:</span> {proposal.reasoning}
        </div>
      )}
      {proposal.example_subjects?.length > 0 && (
        <ul className="ad-proposal__examples">
          {proposal.example_subjects.slice(0, 3).map((s, i) => <li key={i}>{s}</li>)}
        </ul>
      )}
      <div className="ad-proposal__edit">
        <label><span>key</span><input value={keyVal} onChange={e => setKeyVal(e.target.value)} className="ad-input" /></label>
        <label><span>label</span><input value={label} onChange={e => setLabel(e.target.value)} className="ad-input" /></label>
        <label style={{ gridColumn: '1 / -1' }}><span>instructies</span>
          <textarea value={instr} onChange={e => setInstr(e.target.value)} rows={3} className="ad-textarea" />
        </label>
        <label><span>map</span><input value={folder} onChange={e => setFolder(e.target.value)} className="ad-input" /></label>
      </div>
      <div className="ad-proposal__actions">
        <button className="btn btn--accent" disabled={!!busy} onClick={accept}>
          {busy === 'accept' ? 'Accepteren…' : '✓ Accepteer categorie'}
        </button>
        <button className="btn btn--ghost" disabled={!!busy} onClick={() => setMode(m => m === 'reject' ? null : 'reject')}>
          ✕ Afwijzen
        </button>
        {err && <span style={{ color: 'var(--error)', fontSize: 12 }}>⚠ {err}</span>}
      </div>
      {mode === 'reject' && (
        <div className="ad-amend">
          <textarea value={rejectReason} onChange={e => setRR(e.target.value)} rows={2}
            className="ad-textarea" placeholder="reden (optioneel)" />
          <div style={{ display: 'flex', gap: 8, marginTop: 8 }}>
            <button className="btn btn--accent" disabled={!!busy} onClick={reject}>Bevestig afwijzing</button>
            <button className="btn btn--ghost" onClick={() => setMode(null)} disabled={!!busy}>Annuleer</button>
          </div>
        </div>
      )}
    </div>
  )
}

// =====================================================================
// CATEGORIEBEHEER
// =====================================================================

function CategoriesBlock({ categories, folders }) {
  const [open, setOpen] = useState(false)
  const [editingKey, setEditingKey] = useState(null)
  return (
    <section className="va-block">
      <button type="button" className="va-block__head" onClick={() => setOpen(v => !v)}>
        <span className="va-block__caret">{open ? '▾' : '▸'}</span>
        <span className="va-block__title">Categorieën</span>
        <span className="va-block__count">{categories.length}</span>
        <span className="muted va-block__hint">instructies per type · doelmap · actief/uit</span>
      </button>
      {open && (
        <div className="va-block__body">
          <div className="ad-cat-grid">
            {categories.map(c => (
              <button key={c.category_key}
                type="button"
                className={`ad-cat-chip ${c.active === false ? 'is-off' : ''} ${editingKey === c.category_key ? 'is-selected' : ''}`}
                onClick={() => setEditingKey(c.category_key)}
              >
                <div className="ad-cat-chip__label">{c.label}</div>
                <div className="ad-cat-chip__key mono">{c.category_key}</div>
                <div className="ad-cat-chip__meta">
                  {c.default_action} · {c.default_target_folder || '(geen map)'}
                </div>
              </button>
            ))}
            <button type="button" className="ad-cat-chip ad-cat-chip--new" onClick={() => setEditingKey('__new__')}>
              + nieuwe categorie
            </button>
          </div>
          {editingKey && (
            <CategoryEditor
              key={editingKey}
              category={editingKey === '__new__' ? null : categories.find(c => c.category_key === editingKey)}
              onDone={() => setEditingKey(null)}
              folders={folders}
            />
          )}
        </div>
      )}
    </section>
  )
}

function CategoryEditor({ category, onDone, folders }) {
  const [keyVal, setKeyVal]         = useState(category?.category_key || '')
  const [label, setLabel]           = useState(category?.label || '')
  const [description, setDescr]     = useState(category?.description || '')
  const [instructions, setInstr]    = useState(category?.handling_instructions || '')
  const [folder, setFolder]         = useState(category?.default_target_folder || '')
  const [defaultAction, setDA]      = useState(category?.default_action || 'draft')
  const [active, setActive]         = useState(category?.active !== false)
  const [busy, setBusy] = useState(false)
  const [err, setErr]   = useState(null)
  const [ok, setOk]     = useState(false)

  async function save() {
    setBusy(true); setErr(null); setOk(false)
    try {
      const { data, error } = await supabase.rpc('upsert_autodraft_category', {
        p_category_key: keyVal,
        p_label: label,
        p_description: description,
        p_handling_instructions: instructions,
        p_default_target_folder: folder || null,
        p_default_action: defaultAction,
        p_active: active,
        p_sort_order: category?.sort_order ?? 100,
        p_updated_by: 'dashboard',
      })
      if (error) setErr(error.message)
      else if (data && data.ok === false) setErr(data.reason || 'mislukt')
      else { setOk(true); setTimeout(onDone, 600) }
    } catch (e) { setErr(e.message) }
    setBusy(false)
  }

  return (
    <div className="ad-cat-editor">
      <div className="ad-proposal__edit">
        <label><span>key</span>
          <input value={keyVal} onChange={e => setKeyVal(e.target.value)} className="ad-input"
            disabled={!!category} placeholder="bv. klant_offerte" />
        </label>
        <label><span>label</span>
          <input value={label} onChange={e => setLabel(e.target.value)} className="ad-input" />
        </label>
        <label style={{ gridColumn: '1 / -1' }}><span>korte beschrijving</span>
          <input value={description} onChange={e => setDescr(e.target.value)} className="ad-input" />
        </label>
        <label style={{ gridColumn: '1 / -1' }}><span>instructies (hoe behandelt de skill mails in deze categorie?)</span>
          <textarea value={instructions} onChange={e => setInstr(e.target.value)} rows={5} className="ad-textarea" />
        </label>
        <label><span>default map</span>
          <input value={folder} onChange={e => setFolder(e.target.value)} className="ad-input"
            list="ad-folder-suggestions" />
        </label>
        <label><span>default actie</span>
          <select value={defaultAction} onChange={e => setDA(e.target.value)} className="ad-select">
            <option value="draft">draft schrijven</option>
            <option value="skip">negeren/archiveren</option>
            <option value="flag">vraag aan Jelle stellen</option>
          </select>
        </label>
        <label>
          <span>status</span>
          <label style={{ display: 'flex', gap: 6, alignItems: 'center', fontSize: 13 }}>
            <input type="checkbox" checked={active} onChange={e => setActive(e.target.checked)} />
            actief
          </label>
        </label>
      </div>
      <div className="ad-proposal__actions">
        <button className="btn btn--accent" disabled={busy || !keyVal || !label} onClick={save}>
          {busy ? 'Opslaan…' : 'Opslaan'}
        </button>
        <button className="btn btn--ghost" onClick={onDone} disabled={busy}>Annuleer</button>
        {ok  && <span style={{ color: 'var(--success)', fontSize: 12 }}>✓ opgeslagen</span>}
        {err && <span style={{ color: 'var(--error)', fontSize: 12 }}>⚠ {err}</span>}
      </div>
    </div>
  )
}

// =====================================================================
// LOG & LESSONS
// =====================================================================

function InboxLog({ processed, queued, decisions }) {
  const [open, setOpen] = useState(false)
  const all = useMemo(() => {
    const items = [...queued.map(m => ({ ...m, _kind: 'queued' })), ...processed.map(m => ({ ...m, _kind: 'processed' }))]
    items.sort((a, b) => new Date(b.updated_at || b.scanned_at) - new Date(a.updated_at || a.scanned_at))
    return items.slice(0, 50)
  }, [processed, queued])

  const latestDecisionByMail = useMemo(() => {
    const m = new Map()
    for (const d of decisions) {
      if (!m.has(d.mail_id)) m.set(d.mail_id, d)
    }
    return m
  }, [decisions])

  return (
    <section className="va-block">
      <button type="button" className="va-block__head" onClick={() => setOpen(v => !v)}>
        <span className="va-block__caret">{open ? '▾' : '▸'}</span>
        <span className="va-block__title">Logboek · Verwerkt</span>
        <span className="va-block__count">{processed.length + queued.length}</span>
        <span className="muted va-block__hint">alles wat uit je postvak is — verstuurd, genegeerd, of wacht op volgende skill-run</span>
      </button>
      {open && (
        <div className="va-block__body">
          {all.length === 0 ? (
            <div className="empty empty--compact" style={{ padding: 14, fontSize: 11 }}>Nog niks verwerkt.</div>
          ) : (
            <div className="va-log-list">
              {all.map(m => {
                const d = latestDecisionByMail.get(m.mail_id)
                return <LogLine key={m.mail_id} mail={m} decision={d} />
              })}
            </div>
          )}
        </div>
      )}
    </section>
  )
}

const STATUS_META = {
  queued_send:   { label: 'Wacht op verzending',     cls: 'amended' },
  queued_ignore: { label: 'Wacht op archivering',    cls: 'amended' },
  queued_amend:  { label: 'Wacht op herschrijf',     cls: 'accepted' },
  sent:          { label: 'Verstuurd ✓',             cls: 'executed' },
  ignored:       { label: 'Gearchiveerd',            cls: 'rejected' },
  amended:       { label: 'Herschreven — nieuw voorstel', cls: 'accepted' },
  failed:        { label: 'Gefaald',                 cls: 'failed' },
  stale:         { label: 'Verdwenen',               cls: 'rejected' },
}

function LogLine({ mail, decision }) {
  const [open, setOpen] = useState(false)
  const meta = STATUS_META[mail.status] || { label: mail.status, cls: 'rejected' }
  const when = mail.updated_at || mail.scanned_at
  const hasDetails = !!decision
  return (
    <div className={`va-log-line va-log-line--${meta.cls} ${open ? 'is-open' : ''}`}>
      <button type="button" className="va-log-line__row" disabled={!hasDetails}
        onClick={() => hasDetails && setOpen(v => !v)}>
        <span className="va-log-line__caret">{hasDetails ? (open ? '▾' : '▸') : ''}</span>
        <span className="va-log-line__status">{meta.label}</span>
        <span className="va-log-line__subject">{mail.subject || '(geen onderwerp)'}</span>
        <span className="va-log-line__time">{formatDateTime(when)}</span>
      </button>
      {open && decision && (
        <div className="va-log-line__body">
          <div style={{ fontSize: 12, display: 'grid', gap: 4 }}>
            <div><span className="muted">Actie:</span> {decision.action}</div>
            {decision.target_folder && <div><span className="muted">Map:</span> {decision.target_folder}</div>}
            {decision.amend_instructions && <div><span className="muted">Jouw correctie:</span> <em>{decision.amend_instructions}</em></div>}
            {decision.execution_error && <div style={{ color: 'var(--error)' }}>⚠ {decision.execution_error}</div>}
            {decision.executed_at && <div className="muted">Uitgevoerd: {formatDateTime(decision.executed_at)}</div>}
          </div>
        </div>
      )}
    </div>
  )
}

function LessonsBlock({ lessons, categories }) {
  const [open, setOpen] = useState(false)
  const grouped = useMemo(() => {
    const m = new Map()
    for (const l of lessons) {
      const key = l.scope === 'category' ? (l.scope_value || 'onbekend') : l.scope
      if (!m.has(key)) m.set(key, [])
      m.get(key).push(l)
    }
    return m
  }, [lessons])

  return (
    <section className="va-block">
      <button type="button" className="va-block__head" onClick={() => setOpen(v => !v)}>
        <span className="va-block__caret">{open ? '▾' : '▸'}</span>
        <span className="va-block__title">Geleerde regels</span>
        <span className="va-block__count">{lessons.length}</span>
        <span className="muted va-block__hint">uit amendments · auto-draft leest ze bij elke run</span>
      </button>
      {open && (
        <div className="va-block__body">
          {lessons.length === 0 ? (
            <div className="empty empty--compact" style={{ padding: 14, fontSize: 11 }}>
              Nog geen lessen. Zodra je een aanpassingsvoorstel indient, condenseert de leer-skill er regels uit.
            </div>
          ) : (
            <div className="stack stack--sm">
              {[...grouped.entries()].map(([scope, items]) => {
                const cat = categories.find(c => c.category_key === scope)
                return (
                  <div key={scope}>
                    <div className="kpi__label" style={{ marginBottom: 6 }}>
                      {cat ? cat.label : scope}
                    </div>
                    <ul className="ad-lessons">
                      {items.map(l => (
                        <li key={l.id}>
                          <span>{l.lesson}</span>
                          <span className="muted" style={{ fontSize: 11 }}>
                            {l.times_applied}× toegepast
                          </span>
                        </li>
                      ))}
                    </ul>
                  </div>
                )
              })}
            </div>
          )}
        </div>
      )}
    </section>
  )
}

// =====================================================================
// SYSTEEM-INSTRUCTIES (oude config, nu ingeklapt onderaan)
// =====================================================================

function SystemInstructionsBlock({ data }) {
  const [open, setOpen] = useState(false)
  const instructionsRow = (data.agentInstructions || []).find(r => r.agent_name === AGENT)
  const [text, setText] = useState(instructionsRow?.config_value?.text || '')
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState(null)
  const [saved, setSaved] = useState(false)

  useEffect(() => {
    setText(instructionsRow?.config_value?.text || '')
    setErr(null); setSaved(false)
  }, [instructionsRow?.updated_at])

  const dirty = text !== (instructionsRow?.config_value?.text || '')

  async function save() {
    setBusy(true); setErr(null); setSaved(false)
    try {
      const { data: rpcRes, error } = await supabase.rpc('upsert_agent_instructions', {
        p_agent_name: AGENT, p_instructions: text, p_updated_by: 'dashboard',
      })
      if (error) setErr(error.message)
      else if (rpcRes && rpcRes.ok === false) setErr(rpcRes.reason || 'mislukt')
      else setSaved(true)
    } catch (e) { setErr(e.message) }
    setBusy(false)
  }

  return (
    <section className="va-block">
      <button type="button" className="va-block__head" onClick={() => setOpen(v => !v)}>
        <span className="va-block__caret">{open ? '▾' : '▸'}</span>
        <span className="va-block__title">Systeem-instructies</span>
        <span className="muted va-block__hint">globaal · wordt door elke auto-draft run bovenop de categorieën gelezen</span>
      </button>
      {open && (
        <div className="va-block__body" style={{ display: 'grid', gap: 10 }}>
          <textarea
            value={text}
            onChange={e => setText(e.target.value)}
            disabled={busy}
            rows={8}
            className="ad-textarea"
            placeholder={'Bijvoorbeeld:\n- Nederlandse mails altijd tutoyeren.\n- Max 6 zinnen tenzij de mail lang is.\n- Nooit mijn telefoonnummer sturen.'}
          />
          <div style={{ display: 'flex', gap: 8 }}>
            <button className="btn btn--accent" onClick={save} disabled={busy || !dirty}>
              {busy ? 'Opslaan…' : 'Opslaan'}
            </button>
            {saved && <span style={{ color: 'var(--success)', fontSize: 12 }}>✓ opgeslagen</span>}
            {err   && <span style={{ color: 'var(--error)', fontSize: 12 }}>⚠ {err}</span>}
          </div>
        </div>
      )}
    </section>
  )
}

function DebugBlock({ data }) {
  const [open, setOpen] = useState(false)
  const runs = (data.recentRuns || []).filter(r => r.agent_name === AGENT || r.agent_name === 'auto-draft-execute' || r.agent_name === 'auto-draft-learn').slice(0, 20)
  return (
    <section className="va-block">
      <button type="button" className="va-block__head" onClick={() => setOpen(v => !v)}>
        <span className="va-block__caret">{open ? '▾' : '▸'}</span>
        <span className="va-block__title">Debug · recente runs</span>
        <span className="muted va-block__hint">normaal niet nodig — alleen om te zien waar iets faalt</span>
      </button>
      {open && (
        <div className="va-block__body">
          {runs.length === 0 ? (
            <div className="empty empty--compact" style={{ padding: 10 }}>Geen runs.</div>
          ) : (
            <div className="table-wrap">
              <table className="table">
                <thead><tr><th>Skill</th><th>Start</th><th>Status</th><th>Opmerking</th></tr></thead>
                <tbody>
                  {runs.map(r => {
                    const s = r.stats || {}
                    const note = s.error || s.blocker || s.skip_reason || s.note || ''
                    return (
                      <tr key={r.id || r.started_at}>
                        <td className="mono" style={{ fontSize: 11 }}>{r.agent_name}</td>
                        <td className="mono" style={{ fontSize: 11 }}>
                          {new Date(r.started_at).toLocaleString('nl-NL', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' })}
                        </td>
                        <td><span className={`pill s-${r.status}`}>{r.status}</span></td>
                        <td className="muted" style={{ fontSize: 11, maxWidth: 400 }}>
                          {typeof note === 'string' ? note.slice(0, 120) : ''}
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}
    </section>
  )
}

// =====================================================================
// UTILS
// =====================================================================

function groupByAge(mails) {
  const now = new Date()
  const todayStart = new Date(now); todayStart.setHours(0, 0, 0, 0)
  const yStart = new Date(todayStart); yStart.setDate(yStart.getDate() - 1)
  const wStart = new Date(todayStart); wStart.setDate(wStart.getDate() - 6)
  const out = { today: [], yesterday: [], week: [], older: [] }
  for (const m of mails) {
    const d = new Date(m.received_at)
    if (d >= todayStart) out.today.push(m)
    else if (d >= yStart) out.yesterday.push(m)
    else if (d >= wStart) out.week.push(m)
    else out.older.push(m)
  }
  return out
}

function formatRelative(iso) {
  if (!iso) return ''
  const d = new Date(iso)
  const now = new Date()
  const diffMs = now - d
  const min = Math.round(diffMs / 60000)
  if (min < 1) return 'net'
  if (min < 60) return `${min}m`
  const h = Math.round(min / 60)
  if (h < 24) return `${h}u`
  return d.toLocaleDateString('nl-NL', { day: '2-digit', month: 'short' })
}

function formatDateTime(iso) {
  if (!iso) return ''
  return new Date(iso).toLocaleString('nl-NL', {
    day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit',
  })
}

function confTone(c) {
  const n = Number(c || 0)
  if (n >= 0.75) return 'high'
  if (n >= 0.5) return 'mid'
  return 'low'
}

function escapeHtml(s) {
  return String(s || '').replace(/[&<>"']/g, ch => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  }[ch]))
}

// Minimal sanitize — strip script/style/on* handlers. Mails komen uit Graph
// dus zijn al behoorlijk schoon, maar we gooien defense-in-depth erop.
function sanitizeHtml(html) {
  return String(html || '')
    .replace(/<script[\s\S]*?<\/script>/gi, '')
    .replace(/<style[\s\S]*?<\/style>/gi, '')
    .replace(/ on\w+="[^"]*"/gi, '')
    .replace(/ on\w+='[^']*'/gi, '')
    .replace(/javascript:/gi, '')
}
