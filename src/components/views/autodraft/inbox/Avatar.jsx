import { colorForEmail, initialsFor } from '../../../../lib/avatar'
import styles from '../autodraft.module.css'

// Avatar — circle met initialen + deterministische background-color. Klein
// (28px default), grotere variant via prop `size="md"` (32px).
export default function Avatar({ name, email, size = 'sm', className = '' }) {
  const bg = colorForEmail(email)
  const initials = initialsFor(name, email)
  const sizeCls = size === 'md' ? styles.avatarMd : styles.avatarSm
  return (
    <span
      className={`${styles.avatar} ${sizeCls} ${className}`}
      style={{ background: bg }}
      aria-hidden="true"
      title={name || email || ''}
    >
      {initials}
    </span>
  )
}
