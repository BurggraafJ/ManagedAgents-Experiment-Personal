import { useState } from 'react'
import MIcon from '../MIcon'
import { MSetHead, MSetGroup } from './MobileSettingsBits'
import { useAppSkills, scopeLabel } from '../../hooks/useAppSkills'
import { useOrgSkills, categoryLabel } from '../../hooks/useOrgSkills'

/**
 * MobileSettingsSkills (v1.225) — Instellingen › Skills op de telefoon.
 *
 * De desktop-tegenhanger is SkillsSettingsPage.jsx: dezelfde twee bronnen,
 * dezelfde hooks, dezelfde leesregel (RLS bepaalt wat je krijgt). Alleen de
 * vorm verschilt — een tabel met vijf kolommen past niet op een telefoon, dus
 * hier twee lijsten met uitklapbare rijen, het patroon van MobileAdminSecurity.
 *
 * Bewust géén tabbladen zoals desktop: twee groepen onder elkaar is wat de rest
 * van de mobiele Instellingen doet, en scheelt een schakelaar die je op een
 * telefoon toch met je duim moet zoeken.
 *
 * Lezen mag iedereen met `instellingen.eigen` (het recht dat de hele
 * Instellingen-view al opent — zie viewRegistry.js). Bewerken staat hier niet:
 * dat blijft Organisatie › Skills op desktop, achter `organisatie.skills` en
 * de `*_admin_write`-policies. MobileAdminHub houdt Skills daarom in zijn
 * "alleen op desktop"-blok — dat gaat over de editor, dit over de leeskant.
 */
export default function MobileSettingsSkills({ onBack }) {
  const app = useAppSkills({ withUsers: false })
  const org = useOrgSkills()
  const [open, setOpen] = useState(null)   // `${bron}:${id}`

  const bezig = app.loading || org.loading
  const fout = app.error || org.error
  const toggle = (key) => setOpen(o => (o === key ? null : key))

  return (
    <div className="m-dash m-set m-ap">
      <MSetHead
        back={onBack} backLabel="Instellingen" title="Skills"
        sub="Wat de vragenbak over Legal Mind weet zonder het te hoeven zoeken — en dus wat er in jouw antwoorden kan meekomen."
      />
      <div className="m-set__body">
        {fout && <div className="m-set__errline">⚠ {fout}</div>}

        <MSetGroup label={`Werkwijzen${app.skills.length ? ` · ${app.skills.length}` : ''}`}>
          {bezig && app.skills.length === 0 && <div className="m-set__empty">laden…</div>}
          {!bezig && app.skills.length === 0 && (
            <div className="m-set__empty">Nog geen werkwijzen die bij jouw vragen meekomen.</div>
          )}
          {app.skills.map(s => (
            <SkillRij
              key={s.id}
              open={open === `app:${s.id}`}
              onToggle={() => toggle(`app:${s.id}`)}
              titel={s.title}
              sub={s.description || 'geen wanneer-openen-regel — het model vraagt hem nooit op'}
              tag={scopeLabel(s)}
              uit={!s.active}
              tekst={s.body}
              leeg="Nog geen tekst vastgelegd — er valt voor het model niets te openen."
            />
          ))}
        </MSetGroup>
        <p className="m-set__note">
          <MIcon name="book" size={18} />
          <span>
            Van elke werkwijze ziet de vragenbak altijd de titel. De wanneer-openen-regel komt alleen mee op de
            onderzoeks-route, en de tekst zelf pas als het model er expliciet om vraagt.
          </span>
        </p>

        <MSetGroup label={`Begrippen${org.skills.length ? ` · ${org.skills.length}` : ''}`}>
          {bezig && org.skills.length === 0 && <div className="m-set__empty">laden…</div>}
          {!bezig && org.skills.length === 0 && (
            <div className="m-set__empty">Nog geen begrippen vastgelegd.</div>
          )}
          {org.skills.map(s => (
            <SkillRij
              key={s.id}
              open={open === `org:${s.id}`}
              onToggle={() => toggle(`org:${s.id}`)}
              titel={s.title}
              // De definitie zelf is de subregel, niet de categorie: bij een
              // begrip "Lead" in categorie "Lead" zou die regel niets zeggen.
              sub={s.body}
              tag={categoryLabel(s.category)}
              uit={!s.active}
              tekst={s.body}
              leeg="Geen tekst."
              voet={s.tool_binding
                ? `Gebonden aan ${s.tool_binding} — bij de cijfers van precies die tool komt deze regel nog een keer mee.`
                : null}
            />
          ))}
        </MSetGroup>
        <p className="m-set__note">
          <MIcon name="spark" size={18} />
          <span>Actieve begrippen gaan bij élke vraag mee in de prompt — een werkwijze pas als de vraag erover gaat.</span>
        </p>

        <p className="m-set__note">
          <MIcon name="laptop" size={18} />
          <span>Vastleggen en wijzigen doet een beheerder op desktop, onder Organisatie › Skills.</span>
        </p>
      </div>
    </div>
  )
}

/**
 * Eén uitklapbare rij; dicht toont hij twee regels, open de volledige tekst.
 *
 * Bij een werkwijze is de subregel de wanneer-openen-regel en `tekst` de
 * werkwijze zelf — twee verschillende dingen, dus allebei tonen. Bij een begrip
 * ís de subregel de definitie; die twee keer onder elkaar zetten leest als een
 * fout. Daarom bepaalt de rij zelf of er nog iets ónder de subregel hoort.
 */
function SkillRij({ open, onToggle, titel, sub, tag, uit, tekst, leeg, voet }) {
  const eigenTekst = !!tekst && tekst !== sub
  const toonBlok = open && (eigenTekst || voet || !tekst)
  return (
    <div className={`m-inset__static m-skl ${open ? 'is-open' : ''}`}>
      <button type="button" className="m-inset__row m-skl__row" onClick={onToggle} aria-expanded={open}>
        <span className="m-inset__txt">
          <span className="m-inset__lbl">
            {titel}
            {uit && <span className="m-skl__off">uit</span>}
          </span>
          <span className="m-inset__sub m-skl__sub">{sub}</span>
        </span>
        {tag && <span className="m-set__count m-skl__tag">{tag}</span>}
        <span className={`m-inset__chev m-skl__chev ${open ? 'is-open' : ''}`}><MIcon name="chevron" size={16} /></span>
      </button>
      {toonBlok && (
        <div className="m-skl__txt">
          {eigenTekst ? tekst : (!tekst ? leeg : null)}
          {voet && <span className="m-skl__voet">{voet}</span>}
        </div>
      )}
    </div>
  )
}
