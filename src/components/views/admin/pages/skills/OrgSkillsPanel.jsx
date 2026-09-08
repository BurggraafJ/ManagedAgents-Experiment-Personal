import { useState } from 'react'
import Modal from '../../../../ui/Modal'
import { showToast } from '../../../../Toast'
import { useOrgSkills, SKILL_CATEGORIES, TOOL_BINDINGS, SKILL_BODY_INJECTION_CAP, SKILL_SET_INJECTION_CAP, categoryLabel, slugify } from '../../../../../hooks/useOrgSkills'
import SkillEditor from './SkillEditor'

// OrgSkillsPanel — het tabblad "Begrippen" van Organisatie › Skills: de
// org-brede definities uit `org_skills` die in élk antwoord meegaan.
//
// v1.156 (04 PR-B): letterlijk uit SkillsPage.jsx gelicht toen daar een tweede
// tabblad (Werkwijzen, app_skills) bij kwam. Geen functie gewijzigd — alleen de
// import-paden zijn één map dieper en de header is nu de paneel-header in
// plaats van de pagina-header.

const EMPTY = { title: '', slug: '', category: 'pijplijn', body: '', tool_binding: '', active: true, sort_order: 100 }

export default function OrgSkillsPanel() {
  const { skills, loading, error, save, toggleActive, remove, stats } = useOrgSkills()
  const [draft, setDraft] = useState(null)
  const [confirmDelete, setConfirmDelete] = useState(null)
  const [busy, setBusy] = useState(false)

  async function onSave() {
    if (!draft.title.trim() || !draft.body.trim()) {
      showToast({ kind: 'error', message: 'Titel en kennis zijn verplicht' })
      return
    }
    setBusy(true)
    const res = await save({ ...draft, slug: draft.slug || slugify(draft.title) })
    setBusy(false)
    if (!res.ok) { showToast({ kind: 'error', message: res.error }); return }
    showToast({ kind: 'success', message: draft.id ? 'Skill bijgewerkt' : 'Skill toegevoegd' })
    setDraft(null)
  }

  async function onToggle(skill) {
    const res = await toggleActive(skill)
    if (!res.ok) showToast({ kind: 'error', message: res.error })
  }

  async function onDelete() {
    setBusy(true)
    const res = await remove(confirmDelete.id)
    setBusy(false)
    if (!res.ok) { showToast({ kind: 'error', message: res.error }); return }
    showToast({ kind: 'success', message: 'Skill verwijderd' })
    setConfirmDelete(null)
  }

  return (
    <>
      <div className="admin-skills__panelhead">
        <p className="admin-page-head__meta">
          {loading ? 'laden…' : `${stats.active} van ${stats.total} actief`}
          {stats.bound > 0 && <> · {stats.bound} aan een tool gebonden</>}
        </p>
        <button type="button" className="admin-btn admin-btn--primary" onClick={() => setDraft({ ...EMPTY })}>
          Begrip toevoegen
        </button>
      </div>

      {error && <div className="admin-banner admin-banner--err">Kon Skills niet laden: {error}</div>}

      {!loading && skills.length === 0 && !error && (
        <div className="admin-empty">
          <div className="admin-empty__title">Nog geen begrippen</div>
          <div className="admin-empty__hint">
            Leg vast wat de vragenbak over jullie pijplijn moet weten — bijvoorbeeld wat een fase betekent of
            wanneer iets een lead is. Bind een regel aan een tool en het model leest hem precies wanneer het
            die tool overweegt.
          </div>
        </div>
      )}

      {skills.length > 0 && (
        <div className="admin-table-wrap">
          <table className="admin-table admin-skills__table">
            <thead>
              <tr>
                <th>Skill</th>
                <th>Categorie</th>
                <th>Tool</th>
                <th>Status</th>
                <th aria-label="Acties" />
              </tr>
            </thead>
            <tbody>
              {skills.map(s => (
                <tr key={s.id} className={s.active ? '' : 'admin-skills__row--off'}>
                  <td>
                    <div className="admin-skills__title">{s.title}</div>
                    <div className="admin-skills__body">{s.body}</div>
                  </td>
                  <td><span className="admin-chip">{categoryLabel(s.category)}</span></td>
                  <td>
                    {s.tool_binding
                      ? <span className="admin-table__mono admin-skills__tool">{s.tool_binding}</span>
                      : <span className="admin-skills__tool--none">algemeen</span>}
                  </td>
                  <td>
                    <span className={`admin-pill ${s.active ? 'admin-pill--ok' : ''}`}>
                      <span className="admin-pill__dot" />{s.active ? 'actief' : 'uit'}
                    </span>
                  </td>
                  {/* Geen .admin-table__actions hier: die zet display:flex op de
                      <td> zelf, waardoor de cel uit de tabel-layout valt en de
                      knoppen buiten de kaart lopen. Flex op een binnen-div. */}
                  <td className="admin-skills__actions">
                    <div className="admin-skills__actions-row">
                      <button type="button" className="admin-btn admin-btn--sm" onClick={() => onToggle(s)}>
                        {s.active ? 'Uitzetten' : 'Aanzetten'}
                      </button>
                      <button type="button" className="admin-btn admin-btn--sm" onClick={() => setDraft({ ...s, tool_binding: s.tool_binding || '' })}>
                        Bewerken
                      </button>
                      <button type="button" className="admin-btn admin-btn--sm admin-btn--danger" onClick={() => setConfirmDelete(s)}>
                        Verwijderen
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <p className="admin-footnote">
        Actieve regels gaan mee in de system-prompt van de vragenbak — op élke route, ook die mét een tool-binding —
        tot {SKILL_BODY_INJECTION_CAP} tekens per regel en {SKILL_SET_INJECTION_CAP} tekens voor de hele lijst samen;
        wat daarbuiten valt wordt bewaard maar niet meegestuurd. Een tool-binding bepaalt waar de nadruk komt: die
        regel wordt bij de cijfers van precies die tool nog een keer herhaald.
      </p>

      {/* Modals renderen via een portal buiten .admin-main, dus dragen ze zelf
          .theme-maestro voor de tokens (zie index.css § token-scope) en de
          globale .btn-classes i.p.v. de .admin-main-scoped .admin-btn. */}
      <Modal
        open={!!draft}
        onClose={() => setDraft(null)}
        title={draft?.id ? 'Begrip bewerken' : 'Begrip toevoegen'}
        size="lg"
        className="theme-maestro"
      >
        {draft && (
          <SkillEditor
            draft={draft}
            onChange={setDraft}
            categories={SKILL_CATEGORIES}
            bindings={TOOL_BINDINGS}
          />
        )}
        <Modal.Footer>
          <button type="button" className="btn" onClick={() => setDraft(null)}>Annuleer</button>
          <button type="button" className="btn btn--accent" onClick={onSave} disabled={busy}>
            {busy ? 'Bezig…' : 'Opslaan'}
          </button>
        </Modal.Footer>
      </Modal>

      <Modal
        open={!!confirmDelete}
        onClose={() => setConfirmDelete(null)}
        title="Begrip verwijderen"
        size="sm"
        className="theme-maestro"
      >
        <p className="skill-confirm">
          “{confirmDelete?.title}” wordt verwijderd en verdwijnt uit de system-prompt van de vragenbak.
          Wil je hem alleen tijdelijk uitschakelen, gebruik dan <strong>Uitzetten</strong>.
        </p>
        <Modal.Footer>
          <button type="button" className="btn" onClick={() => setConfirmDelete(null)}>Annuleer</button>
          <button type="button" className="btn btn--danger" onClick={onDelete} disabled={busy}>
            {busy ? 'Bezig…' : 'Verwijderen'}
          </button>
        </Modal.Footer>
      </Modal>
    </>
  )
}
