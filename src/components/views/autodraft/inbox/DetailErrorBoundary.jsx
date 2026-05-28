import { Component } from 'react'
import styles from '../autodraft.module.css'

// Mini-ErrorBoundary alleen rondom MailDetail — een crash in één mail mag de
// rest van de inbox niet slopen. Bewust geen globale boundary omdat we de mail
// die het probleem veroorzaakt willen kunnen overslaan met j/k.
export default class DetailErrorBoundary extends Component {
  constructor(props) { super(props); this.state = { error: null } }
  static getDerivedStateFromError(error) { return { error } }
  componentDidCatch(error, info) {
    console.error('[autodraft detail crash]', error, info)
    this.setState({ info })
  }
  render() {
    if (!this.state.error) return this.props.children
    return (
      <div className={styles.detailErrorWrap}>
        <strong className={styles.detailErrorTitle}>⚠ MailDetail crashed:</strong>
        <pre className={styles.detailErrorPre}>
          {String(this.state.error?.stack || this.state.error?.message || this.state.error)}
          {this.state.info?.componentStack && '\n\n' + this.state.info.componentStack}
        </pre>
        <button type="button" className={styles.detailErrorBtn}
          onClick={() => this.setState({ error: null, info: null })}>
          Probeer opnieuw
        </button>
      </div>
    )
  }
}
