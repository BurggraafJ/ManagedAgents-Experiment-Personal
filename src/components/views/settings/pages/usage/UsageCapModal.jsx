import { useState } from 'react'
import Modal from '../../../../ui/Modal'
import { eur, STANDAARD_PLAFOND_EUR } from '../../../../../hooks/useModelUsage'

// Het maandplafond van één regel zetten (Jelle, 2026-09-14: "plafond €50
// standaard, instelbaar per gebruiker — incl. Maestro").
//
// Twee bestemmingen achter één formulier:
//   een mens  → user_model_budget (rij weg = terug naar €50)
//   Maestro   → dash_parameters.model_budget_maestro_eur
// Welke van de twee het is weet de aanroeper; deze modal kent alleen een naam,
// een huidig bedrag en een opslaan-functie.
//
// Waarom een modal en geen invulveld in de cel: de kolom moet blijven zeggen
// wát het plafond is, en in de rij eronder past de zin niet die er hoort te
// staan — dat dit getal vandaag nog niets tegenhoudt. Een invulveld dat die zin
// niet draagt, nodigt uit tot het geloof dat je iets afgrendelt.
//
// ⚠ Een Modal rendert via een portal op document.body en staat dus BUITEN
// .theme-maestro. De tokens (--ink, --paper, --border, --neutral-*) leven daar,
// niet op :root, en één lege var() sloopt de hele declaratie — een
// .admin-btn--primary wordt dan een onzichtbare knop. Vandaar `theme-maestro`
// op de dialoog zelf plus de globale .btn-classes, precies zoals
// OrgSkillsPanel het doet.

export default function UsageCapModal({ regel, onClose, onSave }) {
  const [waarde, setWaarde] = useState(
    regel.cap === null || regel.cap === undefined ? '' : String(regel.cap),
  )
  const [bezig, setBezig] = useState(false)
  const [fout, setFout] = useState(null)

  const getal = waarde.trim() === '' ? null : Number(waarde.replace(',', '.'))
  const ongeldig = getal !== null && (!Number.isFinite(getal) || getal < 0)

  async function bewaar(nieuw) {
    setBezig(true)
    setFout(null)
    try {
      await onSave(nieuw)
      onClose()
    } catch (e) {
      setFout(e.message || String(e))
      setBezig(false)
    }
  }

  return (
    <Modal open onClose={onClose} size="sm" title={`Maandplafond · ${regel.name}`} className="theme-maestro">
      <div className="usg-cap">
        <label className="usg-cap__label" htmlFor="usg-cap-input">
          Plafond per maand
        </label>
        <div className="usg-cap__veld">
          <span className="usg-cap__munt">€</span>
          <input
            id="usg-cap-input"
            className="usg-cap__input"
            type="number"
            min="0"
            step="5"
            inputMode="decimal"
            value={waarde}
            disabled={bezig}
            onChange={e => setWaarde(e.target.value)}
            onKeyDown={e => { if (e.key === 'Enter' && !ongeldig) bewaar(getal) }}
          />
          <span className="usg-cap__per">per maand</span>
        </div>

        {ongeldig && (
          <p className="usg-cap__fout">Vul een bedrag van 0 of hoger in.</p>
        )}

        <p className="usg-cap__uit">
          De standaard is {eur(STANDAARD_PLAFOND_EUR)}. Zet je precies dat bedrag
          {regel.systeem ? '' : ' (of maak je het veld leeg)'}, dan volgt deze regel
          gewoon weer de standaard en staat er geen eigen instelling meer.
        </p>

        {/* De zin die de hele reden is dat dit een modal is en geen veldje. */}
        <p className="usg-cap__waarsch">
          <b>Dit plafond houdt vandaag niets tegen.</b> Geen enkele Edge Function leest
          het (GAP-3): de zes die betaalde model-calls doen hebben geen rolcheck en geen
          budgetcheck. Je legt hier een afspraak vast, geen rem.
        </p>

        {fout && (
          <div className="users-form__notice users-form__notice--error">
            <strong>Niet opgeslagen:</strong> {fout}
          </div>
        )}
      </div>

      <Modal.Footer>
        {regel.capExpliciet && (
          <button
            type="button"
            className="btn usg-cap__reset"
            disabled={bezig}
            onClick={() => bewaar(null)}
            title={`Eigen instelling weghalen; ${regel.name} valt terug op ${eur(STANDAARD_PLAFOND_EUR)}.`}
          >
            Terug naar de standaard
          </button>
        )}
        <button type="button" className="btn" disabled={bezig} onClick={onClose}>
          Annuleren
        </button>
        <button
          type="button"
          className="btn btn--accent"
          disabled={bezig || ongeldig}
          onClick={() => bewaar(getal)}
        >
          {bezig ? 'Opslaan…' : 'Opslaan'}
        </button>
      </Modal.Footer>
    </Modal>
  )
}
