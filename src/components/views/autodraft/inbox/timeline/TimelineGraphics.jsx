import styles from '../SenderTimeline.module.css'

// State-graphics voor empty / loading / error in de tijdlijn-views.

export function EmptyGraphic() {
  return (
    <svg className={styles.graphic} width="140" height="140" viewBox="0 0 140 140" fill="none" aria-hidden="true">
      <defs>
        <linearGradient id="senderTimelineFadeOut" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%"  stopColor="currentColor" stopOpacity="0.7"/>
          <stop offset="100%" stopColor="currentColor" stopOpacity="0"/>
        </linearGradient>
      </defs>
      <line x1="70" y1="20" x2="70" y2="110" stroke="url(#senderTimelineFadeOut)" strokeWidth="2" strokeDasharray="3 4" strokeLinecap="round" />
      <circle cx="70" cy="35" r="9" fill="var(--surface-1, #fff)" stroke="currentColor" strokeWidth="1.8" opacity="0.7"/>
      <circle cx="70" cy="65" r="9" fill="var(--surface-1, #fff)" stroke="currentColor" strokeWidth="1.8" opacity="0.5"/>
      <circle cx="70" cy="95" r="9" fill="var(--surface-1, #fff)" stroke="currentColor" strokeWidth="1.8" opacity="0.3"/>
      <g transform="translate(92, 90)" opacity="0.7">
        <rect x="0" y="0" width="32" height="22" rx="2.5" fill="var(--surface-2, #f5f4f0)" stroke="var(--accent, #dc6f3f)" strokeWidth="1.5"/>
        <path d="M0 3 L16 14 L32 3" fill="none" stroke="var(--accent, #dc6f3f)" strokeWidth="1.5" strokeLinejoin="round"/>
      </g>
    </svg>
  )
}

export function LoadingGraphic() {
  return (
    <svg className={styles.graphic} width="140" height="80" viewBox="0 0 140 80" fill="none" aria-hidden="true">
      <line x1="20" y1="40" x2="120" y2="40" stroke="currentColor" strokeWidth="2" strokeDasharray="3 4" strokeLinecap="round" opacity="0.4"/>
      <circle cx="40" cy="40" r="8" fill="currentColor" opacity="0.3">
        <animate attributeName="opacity" values="0.3;0.9;0.3" dur="1.2s" repeatCount="indefinite"/>
      </circle>
      <circle cx="70" cy="40" r="8" fill="currentColor" opacity="0.3">
        <animate attributeName="opacity" values="0.3;0.9;0.3" dur="1.2s" begin="0.2s" repeatCount="indefinite"/>
      </circle>
      <circle cx="100" cy="40" r="8" fill="currentColor" opacity="0.3">
        <animate attributeName="opacity" values="0.3;0.9;0.3" dur="1.2s" begin="0.4s" repeatCount="indefinite"/>
      </circle>
    </svg>
  )
}

export function ErrorGraphic() {
  return (
    <svg className={styles.graphic} width="120" height="120" viewBox="0 0 120 120" fill="none" aria-hidden="true">
      <path d="M60 20 L105 95 L15 95 Z" fill="var(--surface-2, #f5f4f0)"
        stroke="var(--accent, #dc6f3f)" strokeWidth="2.5" strokeLinejoin="round"/>
      <line x1="60" y1="48" x2="60" y2="75" stroke="var(--accent, #dc6f3f)" strokeWidth="3" strokeLinecap="round"/>
      <circle cx="60" cy="85" r="2.5" fill="var(--accent, #dc6f3f)"/>
    </svg>
  )
}
