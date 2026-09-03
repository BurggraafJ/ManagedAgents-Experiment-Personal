import { slugify, SKILL_BODY_INJECTION_CAP } from '../../../../../hooks/useOrgSkills'

// SkillEditor — formulier-body binnen de Skill-modal. Los bestand zodat
// SkillsPage onder de LOC-cap blijft (CLAUDE.md: < 400 per file).
//
// De slug wordt uit de titel afgeleid zolang de gebruiker hem niet zelf heeft
// aangeraakt; bij bewerken van een bestaande skill blijft de slug staan (die
// is de stabiele referentie).
export default function SkillEditor({ draft, onChange, categories, bindings }) {
  const set = (patch) => onChange({ ...draft, ...patch })
  const isNew = !draft.id
  // De DB bewaart tot 8000 tekens, maar de vragenbak leest alleen de eerste
  // SKILL_BODY_INJECTION_CAP. Zonder deze teller zou een lange regel er in de
  // app opgeslagen uitzien terwijl de staart nooit bij het model aankomt.
  const overCap = Math.max(0, draft.body.length - SKILL_BODY_INJECTION_CAP)

  return (
    <div className="skill-form">
      <label className="skill-form__field">
        <span className="skill-form__label">Titel</span>
        <input
          className="skill-form__input"
          type="text"
          value={draft.title}
          maxLength={120}
          placeholder="Bijv. Wat 'Backburner na demo' betekent"
          onChange={e => set(isNew ? { title: e.target.value, slug: slugify(e.target.value) } : { title: e.target.value })}
        />
      </label>

      <div className="skill-form__row">
        <label className="skill-form__field">
          <span className="skill-form__label">Categorie</span>
          <select className="skill-form__input" value={draft.category} onChange={e => set({ category: e.target.value })}>
            {categories.map(c => <option key={c.key} value={c.key}>{c.label}</option>)}
          </select>
          <span className="skill-form__hint">
            {categories.find(c => c.key === draft.category)?.hint}
          </span>
        </label>

        <label className="skill-form__field">
          <span className="skill-form__label">Hang aan een tool</span>
          <select className="skill-form__input" value={draft.tool_binding} onChange={e => set({ tool_binding: e.target.value })}>
            {bindings.map(b => <option key={b.key || 'none'} value={b.key}>{b.label}</option>)}
          </select>
          <span className="skill-form__hint">
            {draft.tool_binding
              ? 'Het model leest deze regel wanneer het die tool overweegt — alleen op de onderzoeks-route, waar de vragenbak zelf tools kiest. Moet de regel bij élk antwoord gelden, laat de binding dan leeg.'
              : 'Zonder binding gaat de regel als algemene organisatie-kennis mee in elk antwoord.'}
          </span>
        </label>
      </div>

      <label className="skill-form__field">
        <span className="skill-form__label">De kennis zelf</span>
        <textarea
          className="skill-form__input skill-form__textarea"
          rows={7}
          maxLength={8000}
          value={draft.body}
          placeholder={'Schrijf het als een feit, niet als een opdracht. Bijvoorbeeld:\n\n“Backburner na demo betekent: wel interesse, geen budget dit jaar. Niet meerekenen in de actieve pijplijn, wel meenemen bij de vraag welke leads terug moeten komen.”'}
          onChange={e => set({ body: e.target.value })}
        />
        <span className={`skill-form__hint${overCap ? ' skill-form__hint--warn' : ''}`}>
          {overCap
            ? `${draft.body.length} tekens — de vragenbak leest alleen de eerste ${SKILL_BODY_INJECTION_CAP}; de laatste ${overCap} worden wel bewaard maar niet meegestuurd. Kort in of splits op in meerdere skills.`
            : `${draft.body.length} / ${SKILL_BODY_INJECTION_CAP} tekens die de vragenbak meeleest`}
        </span>
      </label>

      <div className="skill-form__row">
        <label className="skill-form__field skill-form__field--narrow">
          <span className="skill-form__label">Sortering</span>
          <input
            className="skill-form__input"
            type="number"
            min={0}
            max={9999}
            value={draft.sort_order}
            onChange={e => set({ sort_order: e.target.value })}
          />
          <span className="skill-form__hint">Lager staat eerder in de prompt.</span>
        </label>

        <label className="skill-form__field skill-form__check">
          <input type="checkbox" checked={draft.active !== false} onChange={e => set({ active: e.target.checked })} />
          <span>
            <span className="skill-form__label">Actief</span>
            <span className="skill-form__hint">Uit = bewaard, maar niet meegenomen in de chat.</span>
          </span>
        </label>
      </div>

      {draft.slug && (
        <p className="skill-form__slug">
          Referentie: <code>{draft.slug}</code>
          {!isNew && <span className="skill-form__hint"> — blijft vast zodat verwijzingen kloppen.</span>}
        </p>
      )}
    </div>
  )
}
