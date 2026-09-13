import './bord-shell.css'

/**
 * DetailPaneel — zone 4. De records achter de regel die links gekozen is.
 *
 * Drie regels zitten in de component:
 *
 *  1. **Het paneel duwt niets weg.** Het staat náást de master in een eigen
 *     gridkolom; klikken op een andere regel verandert alleen wat hierin
 *     staat, niet de breedte van de lijst en niet de scrollpositie.
 *  2. **Leeg is "kies een regel", geen leeg vlak** — en er wordt nooit
 *     automatisch een eerste regel gekozen. Wie binnenkomt moet aan het
 *     antwoord genoeg hebben; het detail is een vervolgvraag.
 *  3. **Nul lopende tekst.** De uitleg bij een kolom hoort in de tooltip van
 *     de kop, de definitie in de subregel hierboven (Research 2 §2.3).
 *
 * De route verandert niet bij het drillen — één vraag is één route. Alleen de
 * recordregel zelf verlaat de app (HubSpot, nieuw tabblad).
 */
export default function DetailPaneel({ titel, sub = null, leegTekst, children, voet = null }) {
  const leeg = !titel

  return (
    <section className="bs-paneel" data-zone="detail">
      {leeg ? (
        <div className="bs-detail__leeg">{leegTekst}</div>
      ) : (
        <>
          <div className="bs-detail__kop">
            <div className="bs-detail__titel">{titel}</div>
            {sub && <div className="bs-detail__sub">{sub}</div>}
          </div>
          <div className="bs-paneel__body">{children}</div>
          {voet && <div className="bs-paneel__voet">{voet}</div>}
        </>
      )}
    </section>
  )
}
