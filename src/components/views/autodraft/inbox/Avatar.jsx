import { colorForEmail, initialsFor } from '../../../../lib/avatar'
import styles from '../autodraft.module.css'

// Avatar — circle met initialen + deterministische background-color.
// sizes: sm (36px), md (40px), lg (44px). Hash op email-domain garandeert
// dat dezelfde afzender altijd dezelfde kleur krijgt.
const SIZE_CLASS = { sm: 'avatarSm', md: 'avatarMd', lg: 'avatarLg' }

export default function Avatar({ name, email, size = 'sm', className = '' }) {
  const bg = colorForEmail(email)
  const initials = initialsFor(name, email)
  const sizeCls = styles[SIZE_CLASS[size] || 'avatarSm']
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
