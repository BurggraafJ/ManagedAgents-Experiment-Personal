import styles from '../autodraft.module.css'

// Generic empty-state hero — gebruikt in MailingSettings (geen openstaande
// voorstellen) en in InboxPanel-varianten waar geen mails zijn.
export default function EmptyHero({ icon, title, hint }) {
  return (
    <div className={`ad-empty ${styles.emptyHeroMin}`}>
      <div className="ad-empty__icon">{icon}</div>
      <div className="ad-empty__title">{title}</div>
      <div className="ad-empty__hint">{hint}</div>
    </div>
  )
}
