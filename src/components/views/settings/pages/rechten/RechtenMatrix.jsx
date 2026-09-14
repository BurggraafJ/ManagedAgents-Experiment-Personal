import { Fragment } from 'react'
import { cellFor } from '../../../../../lib/capabilities'

// De matrix zelf (Design B) — rechten × personen, vinkjes in de kruispunten.
//
// Oriëntatie: rechten als rijen, personen als kolommen. Dat is de vorm uit
// design/optie-b-matrix.png, en het is de enige die past: na het bundelen van
// Organisatie zijn er 29 rijen en 8 personen. Personen als kolommen geeft
// 10 kolommen (label + standaard + 8); rechten als kolommen zou er 31 geven en
// dus altijd horizontaal schuiven. De kop van de pagina heeft een knop die de
// assen omdraait voor wie liever per persoon leest.
//
// De eerste kolom ná het label is de grijze ijk-kolom **Standaard · member**:
// de rol-preset, niet bewerkbaar. Zonder die kolom kun je een oranje vinkje
// niet plaatsen — je ziet wel dát er is afgeweken, niet waarvan.
//
// v1.192 — groepen klappen in. Vier van de vijf staan dicht bij het openen; de
// groep waaraan gebouwd wordt staat open (lib/capabilities.js → GROEP_META).
// De kop van een dichte groep draagt alles wat je nodig hebt om te besluiten of
// je hem openmaakt: hoeveel rechten erin zitten, hoeveel er vandaag nog niets
// leveren, en hoeveel mensen er handmatig afwijken. Een inklapping die dat
// verstopt is een inklapping die je twee keer laat klikken.

const Check = (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d="M20 6 9 17l-5-5" />
  </svg>
)

const LockIcon = (
  <svg viewBox="0 0 24 24" width="11" height="11" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <rect x="4" y="10" width="16" height="11" rx="2" /><path d="M8 10V7a4 4 0 0 1 8 0v3" />
  </svg>
)

// De vier klassen die één vakje zijn uiterlijk geven. Eén plek, zodat de
// legenda onderaan de pagina gegarandeerd hetzelfde tekent als de matrix zelf
// — een legenda die afwijkt van wat hij uitlegt is erger dan geen legenda.
function boxClass({ on, mixed, manual, locked, saving }) {
  return [
    'rch-cellbtn',
    on ? 'is-on' : 'is-off',
    mixed ? 'is-mixed' : '',
    manual ? 'is-manual' : '',
    locked ? 'is-locked' : '',
    saving ? 'is-saving' : '',
  ].filter(Boolean).join(' ')
}

// Alleen-lezen vakje, voor de legenda.
export function StateBox(props) {
  return (
    <span className={boxClass(props)} aria-hidden="true">
      <span className="rch-box">{Check}</span>
    </span>
  )
}

function Cell({ state, disabled, saving, onToggle, title }) {
  return (
    <button
      type="button"
      className={boxClass({ ...state, saving })}
      disabled={disabled || saving}
      onClick={onToggle}
      title={title}
      aria-pressed={state.on}
      aria-label={title}
    >
      <span className="rch-box">{Check}</span>
    </button>
  )
}

const Chevron = (
  <svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d="m9 18 6-6-6-6" />
  </svg>
)

export default function RechtenMatrix({
  rows, groups, people, presetRole, presetKeys, overrideByUser,
  savingKey, onToggle, transposed, openGroepen, onToggleGroep,
}) {
  const isOpen = (groep) => openGroepen.has(groep)

  // Hoeveel mensen wijken binnen deze groep handmatig af? Staat op de kop van
  // een dichte groep, want dat is de reden om hem open te maken.
  const afwijkendIn = (group) => {
    let n = 0
    for (const p of people) {
      const ov = overrideByUser.get(p.user_id) || new Map()
      const raak = group.rows.some(row => row.caps.some(cap => {
        const o = ov.get(cap.key)
        return o && cap.grantable && (o.effect === 'grant') !== p.presetKeys.has(cap.key)
      }))
      if (raak) n++
    }
    return n
  }

  // Eén cel uitrekenen. `person === null` = de grijze standaard-kolom.
  const stateFor = (row, person) => {
    if (!person) {
      return cellFor(row, presetRole, new Map(), presetKeys)
    }
    return cellFor(row, person.app_role, overrideByUser.get(person.user_id) || new Map(), person.presetKeys)
  }

  const titleFor = (row, person) => {
    if (!person) return `${row.label} — standaard voor ${presetRole}`
    if (!row.grantable) return `${row.label} — vast owner-recht, niet uit te delen`
    if (person.app_role === 'owner') return `${row.label} — de owner heeft altijd alles`
    const st = stateFor(row, person)
    const wat = st.on ? 'aan' : 'uit'
    const hoe = st.manual ? 'handmatig gezet' : 'volgt de rol-standaard'
    return `${row.label} — ${person.name}: ${wat} (${hoe}). Klik om te wisselen.`
  }

  const disabledFor = (row, person) =>
    !person || !row.grantable || person.app_role === 'owner'

  // ── Assen omgedraaid: personen als rijen, rechten als kolommen ───────────
  // Inklappen werkt hier op KOLOMMEN. Dezelfde groepen, dezelfde stand: wissel
  // je van as, dan staat hetzelfde open. De kolomkoppen van de groepen die
  // dichtstaan zitten in de strook boven de tabel, zodat je ze daar openzet.
  if (transposed) {
    const zichtbaar = rows.filter(row => isOpen(row.groep))
    return (
      <div className="rch-matrix-wrap">
        <div className="rch-groepstrook">
          {groups.map(g => (
            <button
              key={g.groep}
              type="button"
              className={`rch-groepknop ${isOpen(g.groep) ? 'is-open' : ''}`}
              onClick={() => onToggleGroep(g.groep)}
              aria-pressed={isOpen(g.groep)}
              title={g.reden || g.label}
            >
              {Chevron} {g.label} <span className="n">{g.rows.length}</span>
            </button>
          ))}
        </div>
        <table className="rch-matrix">
          <thead>
            <tr>
              <th className="rch-matrix__cap">Persoon</th>
              {zichtbaar.map(row => (
                <th key={row.id} className="rch-matrix__who" title={row.omschrijving || row.label}>
                  <span className="n">{row.label}</span>
                  <span className="r">{row.groep}</span>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            <tr>
              <td className="rch-matrix__cap is-preset">Standaard · {presetRole}</td>
              {zichtbaar.map(row => (
                <td key={row.id} className="rch-cell is-preset">
                  <Cell state={stateFor(row, null)} disabled title={titleFor(row, null)} />
                </td>
              ))}
            </tr>
            {people.map(p => (
              <tr key={p.user_id}>
                <td className="rch-matrix__cap">
                  {p.name}
                  <span className="rch-capsub">{p.app_role}</span>
                </td>
                {zichtbaar.map(row => (
                  <td key={row.id} className="rch-cell">
                    <Cell
                      state={stateFor(row, p)}
                      disabled={disabledFor(row, p)}
                      saving={savingKey === `${p.user_id}:${row.id}`}
                      onToggle={() => onToggle(row, p)}
                      title={titleFor(row, p)}
                    />
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    )
  }

  // ── De vorm uit het artboord: rechten als rijen ──────────────────────────
  return (
    <div className="rch-matrix-wrap">
      <table className="rch-matrix">
        <thead>
          <tr>
            <th className="rch-matrix__cap">Recht</th>
            <th className="rch-matrix__who is-preset">
              <span className="n">Standaard</span>
              <span className="r">{presetRole}</span>
            </th>
            {people.map(p => (
              <th key={p.user_id} className="rch-matrix__who" title={`${p.name} · ${p.email}`}>
                <span className="n">{p.kort}</span>
                <span className="r">{p.app_role}</span>
                {p.mailbox && (
                  <span className={`rch-mail ${p.mailbox.cls}`} title={p.mailbox.title}>
                    {p.mailbox.label}
                  </span>
                )}
                {p.afwijkend > 0 && (
                  <span className="rch-diff" title={`${p.afwijkend} recht(en) handmatig afgeweken van de ${p.app_role}-standaard`}>
                    {p.afwijkend} afw.
                  </span>
                )}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {groups.map(group => (
            <Fragment key={group.groep}>
              <tr className={`rch-matrix__grp ${isOpen(group.groep) ? 'is-open' : 'is-dicht'}`}>
                <td colSpan={people.length + 2}>
                  <button
                    type="button"
                    className="rch-grp-toggle"
                    onClick={() => onToggleGroep(group.groep)}
                    aria-expanded={isOpen(group.groep)}
                    title={isOpen(group.groep) ? 'Inklappen' : `Uitklappen — ${group.reden || group.label}`}
                  >
                    {Chevron}
                    <span className="rch-grp-naam">{group.label}</span>
                    <span className="rch-grp-n">{group.rows.length}</span>
                  </button>
                  {/* Hele groep levert vandaag niets: één regel hier in plaats
                      van dezelfde badge op elke rij eronder. */}
                  {group.alleLeeg && (
                    <span className="rch-grp-note">levert vandaag nog niets — de RLS eronder geeft een member hier geen rijen</span>
                  )}
                  {/* Dicht? Dan draagt de kop wat je nodig hebt om te besluiten
                      hem open te maken. Inklappen mag niets verstoppen. */}
                  {!isOpen(group.groep) && (
                    <span className="rch-grp-samen">
                      {group.reden && <span className="rch-grp-reden">{group.reden}</span>}
                      {!group.alleLeeg && group.levertNiets > 0 && (
                        <span className="rch-grp-tel is-warn">{group.levertNiets} levert nog niets</span>
                      )}
                      {afwijkendIn(group) > 0 && (
                        <span className="rch-grp-tel is-manual">{afwijkendIn(group)} × handmatig afgeweken</span>
                      )}
                    </span>
                  )}
                </td>
              </tr>
              {isOpen(group.groep) && group.rows.map(row => (
                <tr key={row.id}>
                  <td className="rch-matrix__cap">
                    <span className="rch-capname">
                      {row.label}
                      {!row.grantable && (
                        <span className="rch-tag rch-tag--vast">{LockIcon} vast</span>
                      )}
                      {row.grantable && !row.levert_vandaag && !group.alleLeeg && (
                        <span className="rch-tag rch-tag--blocked" title={row.toelichting || ''}>
                          levert nog niets
                        </span>
                      )}
                    </span>
                    {row.omschrijving && <span className="rch-capsub">{row.omschrijving}</span>}
                  </td>
                  <td className="rch-cell is-preset">
                    <Cell state={stateFor(row, null)} disabled title={titleFor(row, null)} />
                  </td>
                  {people.map(p => (
                    <td key={p.user_id} className="rch-cell">
                      <Cell
                        state={stateFor(row, p)}
                        disabled={disabledFor(row, p)}
                        saving={savingKey === `${p.user_id}:${row.id}`}
                        onToggle={() => onToggle(row, p)}
                        title={titleFor(row, p)}
                      />
                    </td>
                  ))}
                </tr>
              ))}
            </Fragment>
          ))}
        </tbody>
      </table>
    </div>
  )
}
