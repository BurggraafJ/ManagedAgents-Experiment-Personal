// JelleMind-kop (desktop, admin-shell). v1.129 Chrome A: dit is nu de
// paginakop zelf (titel · één zin · metaregel · actie rechts) in de gedeelde
// .admin-page-head-classes i.p.v. een eigen paneel met inline-styling onder
// een tweede AdminSubHeader-kop. Inhoud en knop ongewijzigd: drie laden,
// aantal wachtende voorstellen, "Draai jellemind" + run-melding.
export default function Header({ running, onRun, runMessage, totalPending }) {
  return (
    <header className="admin-page-head">
      <div className="admin-page-head__main">
        <h1 className="admin-page-head__title">JelleMind</h1>
        <p className="admin-page-head__subtitle">
          Drie laden — Jelle (persoonlijk), Legal Mind (organisatie), Skills (procesinstructies).
        </p>
        <p className="admin-page-head__meta">
          {totalPending > 0
            ? <><b>{totalPending}</b> {totalPending === 1 ? 'voorstel wacht' : 'voorstellen wachten'} op review</>
            : 'Alles up-to-date'}
          {runMessage && <>{' · '}<span className="is-warn">{runMessage}</span></>}
        </p>
      </div>
      <div className="admin-page-head__actions">
        <button
          type="button"
          className="admin-btn admin-btn--primary"
          onClick={onRun}
          disabled={running}
          title="Vraag een handmatige JelleMind-run aan (orchestrator pakt 'm binnen 15 min op)"
        >
          {running ? 'Aanvragen…' : 'Draai jellemind'}
        </button>
      </div>
    </header>
  )
}
