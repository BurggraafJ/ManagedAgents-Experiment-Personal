/**
 * NietMeetbaar — de rode sectie onderaan D9.
 *
 * Deze checks staan op het bord maar tellen niet mee in de tellers. Ze horen
 * hier omdat een lege plek het argument is om de bron te ontsluiten: zolang
 * "verlies aan een concurrent" nergens wordt vastgelegd, is dat geen ticket
 * maar een zichtbare regel op een bord dat Jelle wekelijks opent
 * (skill `dashboarding`, bouwproces.md §Rolverdeling).
 *
 * Twee groepen, want de oplossing verschilt:
 *  • veld bestaat niet in HubSpot → een besluit van Jelle en Jay;
 *  • bron niet gekoppeld (Genie, AFAS) → een koppeling, geen veld.
 */
function Groep({ titel, uitleg, items }) {
  if (items.length === 0) return null
  return (
    <div className="d9-nm__groep">
      <div className="d9-nm__kop">{titel}</div>
      <p className="d9-nm__uitleg">{uitleg}</p>
      <ul className="d9-nm__lijst">
        {items.map(c => (
          <li key={c.check_id}>
            <span className="d9-nm__id">{c.check_id}</span>
            <span className="d9-nm__titel">{c.titel}</span>
            <span className="d9-nm__reden">{c.reden}</span>
            {c.noemer !== null && c.noemer !== undefined && (
              <span className="d9-nm__noemer">
                het raakt {c.noemer} {c.noemer_label}
              </span>
            )}
          </li>
        ))}
      </ul>
    </div>
  )
}

export default function NietMeetbaar({ checks }) {
  const geenVeld = checks.filter(c => c.status === 'niet_meetbaar')
  const geenBron = checks.filter(c => c.status === 'niet_gekoppeld')
  if (geenVeld.length === 0 && geenBron.length === 0) return null

  return (
    <section className="d9-nm">
      <h3 className="d9-nm__titelrij">
        Niet meetbaar
        <span className="d9-nm__telling">
          {geenVeld.length + geenBron.length} van de {checks.length} checks — tellen niet mee in de tellers
        </span>
      </h3>

      <Groep
        titel="Het veld bestaat niet in HubSpot"
        uitleg="Hier valt niets op te ruimen: er is geen plek om het antwoord te bewaren. Een veld aanmaken is een besluit van Jelle en Jay, geen bouwkeuze."
        items={geenVeld}
      />
      <Groep
        titel="De bron is niet gekoppeld"
        uitleg="Het antwoord bestaat wel, maar buiten dit platform. Deze regels verdwijnen vanzelf zodra de koppeling er is."
        items={geenBron}
      />
    </section>
  )
}
