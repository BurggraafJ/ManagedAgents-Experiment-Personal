import { useKbAudience } from '../../../hooks/useKbAudience'

/**
 * KbAudienceSwitch — rechtsboven op elk kennisbank-scherm. Twee kennisbanken:
 * Intern en Klant (alles niet-intern valt onder Klant). Default Klant.
 */
export default function KbAudienceSwitch() {
  const [aud, setAud] = useKbAudience()
  return (
    <div className="knb-audsw" role="tablist" aria-label="Kennisbank: intern of klant">
      <button type="button" role="tab" aria-selected={aud === 'intern'}
        className={aud === 'intern' ? 'is-active' : ''} onClick={() => setAud('intern')}>
        <span className="dot" style={{ background: '#4a5147' }} />Intern
      </button>
      <button type="button" role="tab" aria-selected={aud === 'klant'}
        className={aud === 'klant' ? 'is-active' : ''} onClick={() => setAud('klant')}>
        <span className="dot" style={{ background: 'var(--knb-blue)' }} />Klant
      </button>
    </div>
  )
}
