// Lucide-stijl stroke-iconen voor de mobiele Maestro-shell.
// Geport uit de Claude Design-bundle (app/mobile-shared.jsx → Icon).
// Default kleur = currentColor zodat CSS de kleur stuurt (CLAUDE.md: geen
// inline styles); `color`/`stroke` props alleen voor data-/state-driven cases.
const PATHS = {
  dashboard: <><rect x="3" y="3" width="7" height="9" rx="1.5" /><rect x="14" y="3" width="7" height="5" rx="1.5" /><rect x="14" y="12" width="7" height="9" rx="1.5" /><rect x="3" y="16" width="7" height="5" rx="1.5" /></>,
  inbox:     <><path d="M22 13V6a2 2 0 0 0-2-2H4a2 2 0 0 0-2 2v12c0 1.1.9 2 2 2h9" /><path d="m22 7-8.97 5.7a1.94 1.94 0 0 1-2.06 0L2 7" /></>,
  task:      <><rect x="4" y="4" width="16" height="18" rx="2" /><path d="M9 2h6v4H9z" /><path d="m9 14 2 2 4-4" /></>,
  admin:     <><path d="M3 21h18" /><path d="M5 21V7l7-4 7 4v14" /><rect x="9" y="11" width="6" height="10" /></>,
  more:      <><circle cx="5" cy="12" r="1.5" /><circle cx="12" cy="12" r="1.5" /><circle cx="19" cy="12" r="1.5" /></>,
  cal:       <><rect x="3" y="4" width="18" height="18" rx="2" /><path d="M3 10h18M8 2v4M16 2v4" /></>,
  search:    <><circle cx="11" cy="11" r="7" /><path d="m21 21-4.3-4.3" /></>,
  bell:      <><path d="M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9" /><path d="M10.3 21a1.94 1.94 0 0 0 3.4 0" /></>,
  plus:      <><path d="M12 5v14M5 12h14" /></>,
  chevron:   <><path d="m9 18 6-6-6-6" /></>,
  check:     <><path d="m5 12 5 5L20 7" /></>,
  close:     <><path d="M18 6 6 18M6 6l12 12" /></>,
  filter:    <><path d="M3 6h18M7 12h10M11 18h2" /></>,
  refresh:   <><path d="M3 12a9 9 0 0 1 9-9 9.75 9.75 0 0 1 6.74 2.74L21 8" /><path d="M21 3v5h-5" /></>,
  clock:     <><circle cx="12" cy="12" r="9" /><path d="M12 7v5l3 2" /></>,
  plug:      <><path d="M12 22v-5" /><path d="M9 8V2M15 8V2" /><path d="M6 8h12v4a6 6 0 0 1-12 0Z" /></>,
  mail:      <><path d="M3 7h18v12H3z" /><path d="M3 7l9 7 9-7" /></>,
  user:      <><circle cx="12" cy="8" r="4" /><path d="M4 22c0-4.4 3.6-8 8-8s8 3.6 8 8" /></>,
  spark:     <><circle cx="12" cy="12" r="2.4" /><path d="M12 2v3M12 19v3M22 12h-3M5 12H2" /></>,
  pin:       <><path d="M21 10c0 6-9 13-9 13S3 16 3 10a9 9 0 0 1 18 0z" /><circle cx="12" cy="10" r="3" /></>,
  link:      <><rect x="2" y="2" width="20" height="20" rx="3" /><path d="M8 11v5M8 8v.01M12 16v-3a2 2 0 0 1 4 0v3" /></>,
  video:     <><path d="m22 8-6 4 6 4V8z" /><rect x="2" y="6" width="14" height="12" rx="2" /></>,
  car:       <><path d="M5 17H3a1 1 0 0 1-1-1v-3l2-7h16l2 7v3a1 1 0 0 1-1 1h-2" /><circle cx="7" cy="17" r="2" /><circle cx="17" cy="17" r="2" /></>,
  contacts:  <><path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2" /><circle cx="9" cy="7" r="4" /></>,
  mind:      <><circle cx="12" cy="12" r="9" /><path d="M9 9h6M9 13h6M9 17h3" /></>,
  scale:     <><path d="M9 18h6M10 22h4M12 2a7 7 0 0 0-4 12.74V18h8v-3.26A7 7 0 0 0 12 2z" /></>,
  settings:  <><circle cx="12" cy="12" r="3" /><path d="M19.4 15a1.7 1.7 0 0 0 .33 1.82 2 2 0 1 1-2.83 2.83 1.7 1.7 0 0 0-1.82-.33 1.7 1.7 0 0 0-1 1.51 2 2 0 0 1-4 0 1.7 1.7 0 0 0-1-1.51 1.7 1.7 0 0 0-1.82.33 2 2 0 1 1-2.83-2.83 1.7 1.7 0 0 0 .33-1.82 1.7 1.7 0 0 0-1.51-1 2 2 0 0 1 0-4 1.7 1.7 0 0 0 1.51-1 1.7 1.7 0 0 0-.33-1.82 2 2 0 1 1 2.83-2.83 1.7 1.7 0 0 0 1.82.33 1.7 1.7 0 0 0 1-1.51 2 2 0 0 1 4 0 1.7 1.7 0 0 0 1 1.51 1.7 1.7 0 0 0 1.82-.33 2 2 0 1 1 2.83 2.83 1.7 1.7 0 0 0-.33 1.82 1.7 1.7 0 0 0 1.51 1 2 2 0 0 1 0 4 1.7 1.7 0 0 0-1.51 1z" /></>,
  sun:       <><circle cx="12" cy="12" r="4" /><path d="M12 2v2M12 20v2M4.93 4.93l1.41 1.41M17.66 17.66l1.41 1.41M2 12h2M20 12h2M4.93 19.07l1.41-1.41M17.66 6.34l1.41-1.41" /></>,
  moon:      <><path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z" /></>,
  logout:    <><path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4M16 17l5-5-5-5M21 12H9" /></>,
  // Instellingen (v1.126): hub-iconen + desktop-voetnoot
  chat:      <><path d="M7.9 20A9 9 0 1 0 4 16.1L2 22Z" /></>,
  textA:     <><path d="m6 17 6-12 6 12" /><path d="M8.5 12h7" /></>,
  pen:       <><path d="M12 20h9" /><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4Z" /></>,
  laptop:    <><rect x="3" y="5" width="18" height="12" rx="2" /><path d="M2 19h20" /></>,
  people:    <><path d="M3 21v-2a4 4 0 0 1 4-4h4" /><circle cx="9" cy="7" r="4" /><path d="M16 11h6M16 15h6M16 19h6" /></>,
}

export default function MIcon({ name, size = 22, color = 'currentColor', stroke = 1.7 }) {
  return (
    <svg viewBox="0 0 24 24" width={size} height={size} fill="none"
      stroke={color} strokeWidth={stroke} strokeLinecap="round" strokeLinejoin="round"
      aria-hidden="true">
      {PATHS[name] || null}
    </svg>
  )
}
