import {
  slugifySkill, triggersToText,
  SKILL_SCOPES, SKILL_ROLES,
  APP_SKILL_TITLE_CAP, APP_SKILL_DESCRIPTION_CAP,
  APP_SKILL_BODY_STORE_CAP, APP_SKILL_BODY_INJECTION_CAP,
} from '../../../../../hooks/useAppSkills'

// AppSkillEditor — formulier-body binnen de Werkwijze-modal. Los bestand zodat
// AppSkillsPanel onder de LOC-cap blijft (CLAUDE.md: < 400 per file).
//
// De drie velden zijn de drie trappen, en het formulier zegt dat ook: titel
// (altijd mee), wanneer-openen (alleen op de onderzoeks-route) en de werkwijze
// zelf (alleen ná skill_open). Zonder die uitleg is het niet te zien waarom een
// beschrijving van 500 tekens en een body van 6.000 verschillende dingen zijn.

export default function AppSkillEditor({ draft, onChange, bindings, users }) {
  const set = (patch) => onChange({ ...draft, ...patch })
  const isNew = !draft.id
  const bodyLen = (draft.body || '').length
  const overCap = Math.max(0, bodyLen - APP_SKILL_BODY_INJECTION_CAP)
  const descLen = (draft.description || '').length

  return (
    <div className="skill-form">
      <label className="skill-form__field">
        <span className="skill-form__label">Titel — trap 1, gaat bij elke vraag mee</span>
        <input
          className="skill-form__input"
          type="text"
          value={draft.title}
          maxLength={APP_SKILL_TITLE_CAP}
          placeholder="Bijv. Overdracht van Closed Won naar Customer Base"
          onChange={e => set(isNew ? { title: e.target.value, slug: slugifySkill(e.target.value) } : { title: e.target.value })}
        />
        <span className="skill-form__hint">
          Dit is het enige dat de vragenbak op élke route ziet. Schrijf hem als het onderwerp
          waar iemand naar zou vragen, niet als een bestandsnaam.
        </span>
      </label>

      <div className="skill-form__row">
        <label className="skill-form__field">
          <span className="skill-form__label">Voor wie</span>
          <select className="skill-form__input" value={draft.scope} onChange={e => set({ scope: e.target.value })}>
            {SKILL_SCOPES.map(s => <option key={s.key} value={s.key}>{s.label}</option>)}
          </select>
          <span className="skill-form__hint">
            {SKILL_SCOPES.find(s => s.key === draft.scope)?.hint}
          </span>
        </label>

        {draft.scope === 'user' && (
          <label className="skill-form__field">
            <span className="skill-form__label">Welke gebruiker</span>
            <select className="skill-form__input" value={draft.scope_user_id || ''} onChange={e => set({ scope_user_id: e.target.value })}>
              <option value="">— kies —</option>
              {users.map(u => (
                <option key={u.user_id} value={u.user_id}>
                  {u.display_name || u.user_id.slice(0, 8)} ({u.app_role})
                </option>
              ))}
            </select>
            <span className="skill-form__hint">Alleen deze gebruiker ziet de titel, en alleen in zijn eigen gesprekken.</span>
          </label>
        )}

        {draft.scope === 'role' && (
          <label className="skill-form__field">
            <span className="skill-form__label">Welke rol</span>
            <select className="skill-form__input" value={draft.scope_role || 'member'} onChange={e => set({ scope_role: e.target.value })}>
              {SKILL_ROLES.map(r => <option key={r.key} value={r.key}>{r.label}</option>)}
            </select>
            <span className="skill-form__hint">Wie deze rol heeft ziet hem; wie hem niet heeft, ziet hem niet.</span>
          </label>
        )}

        {draft.scope === 'org' && (
          <label className="skill-form__field">
            <span className="skill-form__label">Hang aan een tool (optioneel)</span>
            <select className="skill-form__input" value={draft.tool_binding} onChange={e => set({ tool_binding: e.target.value })}>
              {bindings.map(b => <option key={b.key || 'none'} value={b.key}>{b.label}</option>)}
            </select>
            <span className="skill-form__hint">
              Vandaag alleen een label: de werkwijzen-laag hangt aan de titel en niet aan een tool.
              Het veld bestaat zodat een latere versie er wél iets mee kan doen.
            </span>
          </label>
        )}
      </div>

      <label className="skill-form__field">
        <span className="skill-form__label">Wanneer moet het model deze werkwijze openen — trap 2</span>
        <textarea
          className="skill-form__input"
          rows={3}
          maxLength={APP_SKILL_DESCRIPTION_CAP}
          value={draft.description}
          placeholder="Bijv. Open dit bij vragen over een pilot die afloopt, een overdracht naar Customer Base of het opstellen van een nieuwe licentie."
          onChange={e => set({ description: e.target.value })}
        />
        <span className="skill-form__hint">
          {descLen} / {APP_SKILL_DESCRIPTION_CAP} tekens. Deze regel gaat alléén mee op de onderzoeks-route
          (de enige route waar het model een werkwijze kán opvragen). Schrijf hem dus als een
          herkenningsregel — “open dit bij …” — en niet als een samenvatting.
        </span>
      </label>

      <label className="skill-form__field">
        <span className="skill-form__label">De werkwijze zelf — trap 3, alleen op verzoek</span>
        <textarea
          className="skill-form__input skill-form__textarea"
          rows={10}
          maxLength={APP_SKILL_BODY_STORE_CAP}
          value={draft.body}
          placeholder={'De stappen, in de tweede persoon en zonder omhaal. Bijvoorbeeld:\n\n1. Controleer of de licentieovereenkomst is ondertekend.\n2. Vul de 19 facturatievelden uit de overeenkomst.\n3. Zet de deal in Customer Base en sluit de oude.'}
          onChange={e => set({ body: e.target.value })}
        />
        <span className={`skill-form__hint${overCap ? ' skill-form__hint--warn' : ''}`}>
          {overCap
            ? `${bodyLen} tekens — de vragenbak stuurt de eerste ${APP_SKILL_BODY_INJECTION_CAP} mee (afgekapt op regelgrens) en meldt in het antwoord dat hij niet alles heeft. Kort in of splits op in twee werkwijzen.`
            : `${bodyLen} / ${APP_SKILL_BODY_INJECTION_CAP} tekens die het model leest zodra het de werkwijze opvraagt. Opslaan mag tot ${APP_SKILL_BODY_STORE_CAP}.`}
        </span>
      </label>

      <label className="skill-form__field">
        <span className="skill-form__label">Trefwoorden (optioneel)</span>
        <input
          className="skill-form__input"
          type="text"
          value={typeof draft.triggers === 'string' ? draft.triggers : triggersToText(draft.triggers)}
          placeholder="overdracht, customer base, licentie verlengen"
          onChange={e => set({ triggers: e.target.value })}
        />
        <span className="skill-form__hint">
          Komma-lijst, maximaal 12. Bedoeld om een vraag met een van deze woorden naar de
          onderzoeks-route te sturen, zodat de werkwijze bereikbaar is. Die schakelaar staat
          nu <strong>uit</strong>; tot hij aangaat verandert een trefwoord niets.
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
          <span className="skill-form__hint">Lager staat eerder in de lijst.</span>
        </label>

        <label className="skill-form__field skill-form__check">
          <input type="checkbox" checked={draft.active !== false} onChange={e => set({ active: e.target.checked })} />
          <span>
            <span className="skill-form__label">Actief</span>
            <span className="skill-form__hint">Uit = bewaard, maar de vragenbak ziet hem niet.</span>
          </span>
        </label>
      </div>

      {draft.slug && (
        <p className="skill-form__slug">
          Referentie: <code>{draft.slug}</code>
          {!isNew && <> · versie <code>{draft.version}</code></>}
          {!isNew && <span className="skill-form__hint"> — de slug blijft vast; de versie loopt op zodra je de beschrijving of de werkwijze wijzigt.</span>}
        </p>
      )}
    </div>
  )
}
