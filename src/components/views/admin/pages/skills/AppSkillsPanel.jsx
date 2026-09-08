import { useState } from 'react'
import Modal from '../../../../ui/Modal'
import { showToast } from '../../../../Toast'
import { TOOL_BINDINGS } from '../../../../../hooks/useOrgSkills'
import {
  useAppSkills, scopeLabel, slugifySkill, parseTriggers, triggersToText,
  APP_SKILL_SET_CAP,
} from '../../../../../hooks/useAppSkills'
import AppSkillEditor from './AppSkillEditor'

// AppSkillsPanel — het tabblad "Werkwijzen" van Organisatie › Skills.
//
// `app_skills` in drie trappen: de titel gaat bij élke vraag mee, de
// "wanneer-openen"-regel alleen op de onderzoeks-route, en de werkwijze zelf
// pas als het model er expliciet om vraagt (skill_open). Daarom noemt de tabel
// per rij welke trappen gevuld zijn — een werkwijze zonder beschrijving wordt
// nooit geopend, en dat is precies het soort stille fout dat je wil zien.
//
// v1.156 (04 PR-B): nieuw.

const EMPTY = {
  title: '', slug: '', description: '', body: '', triggers: '',
  scope: 'org', scope_user_id: null, scope_role: null,
  tool_binding: '', active: true, sort_order: 100,
}

export default function AppSkillsPanel() {
  const { skills, users, loading, error, save, toggleActive, remove, stats } = useAppSkills()
  const [draft, setDraft] = useState(null)
  const [confirmDelete, setConfirmDelete] = useState(null)
  const [busy, setBusy] = useState(false)

  async function onSave() {
    if (!draft.title.trim()) {
      showToast({ kind: 'error', message: 'Een titel is verplicht — dat is wat de vragenbak altijd ziet' })
      return
    }
    if (draft.scope === 'user' && !draft.scope_user_id) {
      showToast({ kind: 'error', message: 'Kies een gebruiker, anders ziet niemand deze werkwijze' })
      return
    }
    setBusy(true)
    const res = await save({
      ...draft,
      slug: draft.slug || slugifySkill(draft.title),
      triggers: parseTriggers(typeof draft.triggers === 'string' ? draft.triggers : triggersToText(draft.triggers)),
    })
    setBusy(false)
    if (!res.ok) { showToast({ kind: 'error', message: res.error }); return }
    showToast({ kind: 'success', message: draft.id ? 'Werkwijze bijgewerkt' : 'Werkwijze toegevoegd' })
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
    showToast({ kind: 'success', message: 'Werkwijze verwijderd' })
    setConfirmDelete(null)
  }

  return (
    <>
      <div className="admin-skills__panelhead">
        <p className="admin-page-head__meta">
          {loading ? 'laden…' : `${stats.active} van ${stats.total} actief`}
          {stats.persoonlijk > 0 && <> · {stats.persoonlijk} persoonlijk of per rol</>}
          {stats.titelTekens > 0 && <> · ±{stats.titelTekens} tekens titellijst per vraag</>}
        </p>
        <button type="button" className="admin-btn admin-btn--primary" onClick={() => setDraft({ ...EMPTY })}>
          Werkwijze toevoegen
        </button>
      </div>

      {error && <div className="admin-banner admin-banner--err">Kon werkwijzen niet laden: {error}</div>}

      {stats.overSetCap > 0 && (
        <div className="admin-banner admin-banner--warn">
          {stats.active} actieve werkwijzen — de vragenbak neemt de eerste {APP_SKILL_SET_CAP} titels mee.
          De laatste {stats.overSetCap} vallen weg (op skill-grens, geteld in de run-diagnostiek).
          Zet er een paar uit of verhoog de sortering van wat er zeker bij moet.
        </div>
      )}

      {!loading && skills.length === 0 && !error && (
        <div className="admin-empty">
          <div className="admin-empty__title">Nog geen werkwijzen</div>
          <div className="admin-empty__hint">
            Een werkwijze is een procedure die je vaker uitlegt dan je zou willen: een overdracht, een
            QBR-checklist, de stappen bij een verlenging. De vragenbak ziet altijd de titel, en haalt de
            volledige tekst pas op als een vraag erover gaat — dus lengte kost hier niets bij elke andere vraag.
          </div>
        </div>
      )}

      {skills.length > 0 && (
        <div className="admin-table-wrap">
          <table className="admin-table admin-skills__table">
            <thead>
              <tr>
                <th>Werkwijze</th>
                <th>Voor wie</th>
                <th>Trappen</th>
                <th>Status</th>
                <th aria-label="Acties" />
              </tr>
            </thead>
            <tbody>
              {skills.map(s => (
                <tr key={s.id} className={s.active ? '' : 'admin-skills__row--off'}>
                  <td>
                    <div className="admin-skills__title">{s.title}</div>
                    <div className="admin-skills__body">{s.description || <em>geen wanneer-openen-regel — het model zal hem nooit opvragen</em>}</div>
                  </td>
                  <td><span className="admin-chip">{scopeLabel(s)}</span></td>
                  <td>
                    <span className="admin-skills__steps">
                      <span className="admin-skills__step admin-skills__step--on" title="Titel — gaat bij elke vraag mee">1</span>
                      <span className={`admin-skills__step${s.description ? ' admin-skills__step--on' : ''}`} title="Wanneer-openen — alleen op de onderzoeks-route">2</span>
                      <span className={`admin-skills__step${s.body ? ' admin-skills__step--on' : ''}`} title="De werkwijze zelf — alleen na skill_open">3</span>
                    </span>
                    <span className="admin-skills__tool--none">v{s.version} · {(s.body || '').length} tekens</span>
                  </td>
                  <td>
                    <span className={`admin-pill ${s.active ? 'admin-pill--ok' : ''}`}>
                      <span className="admin-pill__dot" />{s.active ? 'actief' : 'uit'}
                    </span>
                  </td>
                  <td className="admin-skills__actions">
                    <div className="admin-skills__actions-row">
                      <button type="button" className="admin-btn admin-btn--sm" onClick={() => onToggle(s)}>
                        {s.active ? 'Uitzetten' : 'Aanzetten'}
                      </button>
                      <button type="button" className="admin-btn admin-btn--sm" onClick={() => setDraft({ ...s, tool_binding: s.tool_binding || '', triggers: triggersToText(s.triggers) })}>
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

      {/* Eén <span> als enig kind: .admin-footnote is display:flex (voor een
          icoon + tekst), dus een losse <strong> zou een eigen flex-item worden
          en de zin in kolommen breken. */}
      <p className="admin-footnote">
        <span>
          Van elke actieve werkwijze ziet de vragenbak <strong>altijd de titel</strong>. De wanneer-openen-regel gaat
          alleen mee op de onderzoeks-route — de enige route waar het model een werkwijze kán opvragen — en de tekst
          zelf pas ná zo'n verzoek, maximaal twee per vraag. Een werkwijze “Voor wie: iedereen” staat in het gedeelde
          deel van de prompt; een persoonlijke of rol-werkwijze staat in het deel dat bij die ene vrager hoort en komt
          bij niemand anders terecht.
        </span>
      </p>

      <Modal
        open={!!draft}
        onClose={() => setDraft(null)}
        title={draft?.id ? 'Werkwijze bewerken' : 'Werkwijze toevoegen'}
        size="lg"
        className="theme-maestro"
      >
        {draft && (
          <AppSkillEditor
            draft={draft}
            onChange={setDraft}
            bindings={TOOL_BINDINGS}
            users={users}
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
        title="Werkwijze verwijderen"
        size="sm"
        className="theme-maestro"
      >
        <p className="skill-confirm">
          “{confirmDelete?.title}” wordt verwijderd, inclusief de volledige tekst. De vragenbak kan hem daarna
          niet meer opvragen. Wil je hem alleen tijdelijk uit de lijst halen, gebruik dan <strong>Uitzetten</strong>.
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
