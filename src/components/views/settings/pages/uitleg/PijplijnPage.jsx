import { SettingsPage } from '../../SettingsLayout'
import { usePijplijn } from '../../../../../hooks/usePijplijn'
import { STAGES, stageCounts } from '../../../../../lib/pijplijn'
import './pijplijn.css'

/**
 * PijplijnPage — Instellingen › Uitleg › Pijplijn (v1.195, P9).
 *
 * De zeven stappen tussen een binnenkomende mail en een antwoord dat klopt:
 *   Sync → Chunk → Embed → Index → Retrieve → Consume → Quality
 *
 * Vervangt de gelijknamige pagina onder Organisatie › Leren (v1.183–v1.194),
 * die zelf al de Intelligence-hub verving. Wat verdween is het bewakingsdeel —
 * klikbare stappen, recente runs, het bundel-auditspoor. Wat bleef is de
 * uitleg, en die hoort bij de andere uitleg (Mail-verrijking, AutoDraft) in
 * plaats van in het owner-portaal.
 *
 * Eén verticale keten in plaats van zeven kaarten naast elkaar: de volgorde is
 * de boodschap, en zeven kolommen op 1440px lieten van de omschrijving drie
 * afgekapte regels over. Verticaal leest hij op een telefoon hetzelfde.
 *
 * De stand per stap komt live uit v_intelligence_hub_summary, sync_health_all()
 * en context_bundles (usePijplijn) — alleen voor de owner, zie de hook. Wat
 * niet gemeten wordt krijgt geen chip; de peildatum staat onder de keten.
 */
export default function PijplijnPage({ isOwner = false }) {
  const { data, error, loading, refresh } = usePijplijn({ enabled: isOwner })
  const counts = stageCounts(data)

  return (
    <SettingsPage
      title="Pijplijn"
      intro="Hoe een mail, deal of meeting doorzoekbare context wordt — en hoe de keten zichzelf meet."
      right={isOwner && (
        <button type="button" className="set-btn set-btn--ghost set-btn--sm" onClick={refresh} disabled={loading}>
          {loading ? 'Laden…' : 'Vernieuwen'}
        </button>
      )}
    >
      <div className="set-ex">

        <section className="set-ex-hero">
          <div className="set-ex-hero__tag">de keten</div>
          <h3 className="set-ex-hero__title">
            Zeven stappen tussen een binnenkomende mail en een antwoord dat klopt.
          </h3>
          <p className="set-ex-hero__lede">
            Maestro zoekt niet in Outlook of HubSpot. Alles wat binnenkomt wordt
            eerst gespiegeld, in stukken geknipt, omgezet naar betekenis en
            geïndexeerd — pas daarna is het vindbaar. Elke stap hieronder is een
            schakel: valt er één stil, dan wordt het antwoord stil-en-onvolledig
            in plaats van fout. Vandaar dat elke stap zijn eigen cijfer heeft.
          </p>
        </section>

        {error && <div className="pl-err">⚠ Stand niet geladen: {error}</div>}

        <ol className="pl-chain" aria-label="De pijplijn in zeven stappen">
          {STAGES.map(stage => {
            const count = counts[stage.id]
            return (
              <li key={stage.id} className="pl-step">
                <span className="pl-step__nr" aria-hidden>{stage.nr}</span>
                <div className="pl-step__body">
                  <div className="pl-step__head">
                    <h4 className="pl-step__label">{stage.label}</h4>
                    {isOwner && (count || loading) && (
                      <span className={`pl-step__count ${count ? '' : 'is-empty'}`}>
                        {count || '…'}
                      </span>
                    )}
                  </div>
                  <p className="pl-step__text">{stage.explainer}</p>
                  <div className="pl-step__detail">{stage.detail}</div>
                </div>
              </li>
            )
          })}
        </ol>

        <p className="pl-meta">
          {isOwner
            ? data
              ? <>Stand van {data.checkedAt.toLocaleString('nl-NL', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' })}
                  {data.healthError && <> · versheid per bron niet geladen ({data.healthError})</>}
                  {' · Consume heeft geen cijfer: hoeveel skills context ophalen is productkennis, geen meting.'}
                </>
              : loading ? 'Stand laden…' : 'Geen stand beschikbaar — de uitleg hierboven staat los van de cijfers.'
            : 'De stand per stap (chunks, edges, bundels) is org-breed en staat bij de beheerder.'}
        </p>

        <section className="set-ex-card set-ex-card--soft">
          <h4 className="set-ex-card__title">Waar je dit merkt</h4>
          <p>
            Een vraag in de vragenbak, een AutoDraft-concept, de voorbereiding
            bij een agenda-afspraak: alle drie lopen ze over dezelfde zeven
            stappen. Krijg je een antwoord dat iets mist, dan is de vraag bijna
            altijd <em>welke schakel het niet meenam</em> — niet of het model
            het wist. Een bron die niet gesynct is, bestaat voor Maestro niet.
          </p>
        </section>

      </div>
    </SettingsPage>
  )
}
