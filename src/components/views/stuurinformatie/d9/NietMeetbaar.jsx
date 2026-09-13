/**
 * NietMeetbaar — de inhoud van het detailpaneel als je de rode ⛔-regel kiest.
 *
 * Deze checks staan op het bord maar tellen in geen enkel getal mee. Ze horen
 * hier omdat een lege plek het argument is om de bron te ontsluiten: zolang
 * "verlies aan een concurrent" nergens wordt vastgelegd, is dat geen ticket
 * maar een zichtbare regel op een bord dat Jelle wekelijks opent
 * (skill `dashboarding`, bouwproces.md §Rolverdeling).
 *
 * Twee groepen, want de oplossing verschilt:
 *  • het veld bestaat niet in HubSpot → een besluit van Jelle en Jay;
 *  • de bron is niet gekoppeld (Genie, AFAS) → een koppeling, geen veld.
 *
 * Ingeklapt op één regel in de vaste strook, uitgeklapt hier. Zo staat de
 * telling altijd in beeld zonder dat zes rijen de lijst met werk verdringen.
 */
function Groep({ titel, items }) {
  if (items.length === 0) return null
  return (
    <div className="d9-nm__groep">
      <div className="d9-nm__kop">{titel}</div>
      <ul className="d9-nm__lijst">
        {items.map(c => (
          <li key={c.check_id}>
            <span className="d9-nm__id">{c.check_id}</span>
            <span>
              <span className="d9-nm__titel">{c.titel}</span>
              <span className="d9-nm__reden">
                {c.reden}
                {c.noemer !== null && c.noemer !== undefined && ` Het raakt ${c.noemer} ${c.noemer_label}.`}
              </span>
            </span>
          </li>
        ))}
      </ul>
    </div>
  )
}

export default function NietMeetbaar({ checks }) {
  const geenVeld = checks.filter(c => c.status === 'niet_meetbaar')
  const geenBron = checks.filter(c => c.status === 'niet_gekoppeld')

  return (
    <div className="d9-nm">
      <Groep titel="Het veld bestaat niet in HubSpot" items={geenVeld} />
      <Groep titel="De bron is niet gekoppeld" items={geenBron} />
    </div>
  )
}
