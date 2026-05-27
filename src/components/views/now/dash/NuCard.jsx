import Icon from '../Icon'

// NuCard — donkere "NU"-kaart met de eerstvolgende meeting. Bij een online
// meeting toont 'ie een echte Vergaderlink-knop (opent Teams/Meet). Primaire
// CTA gaat naar de agenda. Geen meeting meer vandaag → rustige lege staat.
export default function NuCard({ nu, goto }) {
  if (!nu) {
    return (
      <div className="nu">
        <div className="nu__icon">
          <Icon size={24}><circle cx="12" cy="12" r="9" /><path d="M12 7v5l3 2" /></Icon>
        </div>
        <div className="nu__body">
          <div className="nu__eyebrow">Agenda</div>
          <div className="nu__title">Geen meeting meer vandaag</div>
          <div className="nu__sub">Je middag is vrij — mooi moment om de wachtrijen leeg te maken.</div>
        </div>
        <div className="nu__actions">
          <a className="nu__cta" href="/agenda" onClick={(e) => { e.preventDefault(); goto('/agenda') }}>
            Open agenda
            <Icon size={14}><path d="m9 18 6-6-6-6" /></Icon>
          </a>
        </div>
      </div>
    )
  }

  return (
    <div className="nu">
      <div className="nu__icon">
        <Icon size={24}><circle cx="12" cy="12" r="9" /><path d="M12 7v5l3 2" /></Icon>
      </div>
      <div className="nu__body">
        <div className="nu__eyebrow">{nu.eyebrow}</div>
        <div className="nu__title">{nu.title}</div>
        {nu.sub && <div className="nu__sub">{nu.sub}</div>}
      </div>
      <div className="nu__actions">
        {nu.onlineUrl && (
          <a className="nu__alt" href={nu.onlineUrl} target="_blank" rel="noreferrer">
            <Icon size={14}><path d="m22 8-6 4 6 4V8z" /><rect x="2" y="6" width="14" height="12" rx="2" /></Icon>
            Vergaderlink
          </a>
        )}
        <a
          className="nu__cta"
          href={`/agenda/briefing/${nu.eventId}`}
          onClick={(e) => { e.preventDefault(); goto(`/agenda/briefing/${nu.eventId}`) }}
        >
          Bekijk briefing
          <Icon size={14}><path d="m9 18 6-6-6-6" /></Icon>
        </a>
      </div>
    </div>
  )
}
