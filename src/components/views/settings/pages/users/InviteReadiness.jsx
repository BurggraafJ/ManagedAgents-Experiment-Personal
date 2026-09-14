// Multi-user M2 — het poortenpaneel boven de Uitnodigen-knop.
//
// Eén blok, vier regels, en een kop die zegt wat de uitkomst betekent. Geen
// accordeon en geen "details"-link: dit is precies het moment waarop iemand
// niet doorklikt, en een poort die je moet openvouwen bewaakt niets.
//
// Groen toont alleen de kopregel. Rood toont per poort het gemeten getal, de
// norm en waarom die poort er is — want een rode poort is zeldzaam en dan wil
// je niet eerst een document zoeken.
export default function InviteReadiness({ readiness, compact = false }) {
  const { loading, error, poorten, rood, magUitnodigen } = readiness

  if (loading) {
    return (
      <div className="users-form__notice">
        <strong>Poorten controleren…</strong> De uitnodiging staat vast tot deze meting rond is.
      </div>
    )
  }

  if (error) {
    return (
      <div className="users-form__notice users-form__notice--error">
        <strong>De poortcontrole kon niet draaien.</strong> Uitnodigen staat daarom dicht.
        <div className="users-form__hint">{error}</div>
      </div>
    )
  }

  if (magUitnodigen) {
    return (
      <div className="users-form__notice users-form__notice--success">
        <strong>Vier poorten dicht.</strong> Geen view die de RLS overslaat, geen
        ongeguarde RPC, geen EXECUTE voor iedereen, geen open bucket. Deze
        persoon ziet straks alleen wat zijn rechten toelaten.
        {!compact && (
          <div className="users-form__hint">
            Dezelfde vier metingen als M1/M2/M2b/M8 in de pre-flight, uit dezelfde
            configuratie — één lijst, twee lezers.
          </div>
        )}
      </div>
    )
  }

  return (
    <div className="users-form__notice users-form__notice--error">
      <strong>
        {rood.length} van {poorten.length} poorten staat open. Uitnodigen is geblokkeerd.
      </strong>
      <ul className="users-poorten">
        {rood.map(p => (
          <li key={p.sleutel} className="users-poorten__rij">
            <code className="users-poorten__sleutel">{p.sleutel}</code>
            <span className="users-poorten__getal">
              gemeten <b>{p.gemeten}</b> · norm {p.norm}
            </span>
            <span className="users-poorten__uitleg">{p.uitleg}</span>
          </li>
        ))}
      </ul>
      <div className="users-form__hint">
        Draai <code>node scripts/multi_user_acl_eval.cjs</code> voor de volledige
        uitslag; die leest dezelfde lijst.
      </div>
    </div>
  )
}
