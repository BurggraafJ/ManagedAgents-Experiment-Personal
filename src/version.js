// Eén bron van waarheid voor het app-versienummer.
//
// Formaat: MAJOR.MINOR met 2-cijferige minor → "1.01", "1.02" … "1.10" …
// Bump-regel:
//   • elke gewone deploy met zichtbare wijziging → minor +1 (1.01 → 1.02 → …)
//   • een MAJOR bump (2.0, 3.0) = een GROTE release en gebeurt ALLEEN op
//     expliciet aangeven van Jelle. Niet zelf doen.
//
// Deze constante voedt: de versie-badge in de sidebar + login, en (via
// vite.config) het version.json dat de ReloadPrompt-popup ophaalt.
// Zie CLAUDE.md → "Versiebeheer".
// Na 1.99 loopt de minor door met 3 cijfers (1.100, 1.101, …); 2.0 is een
// MAJOR en die gebeurt alleen op expliciet aangeven van Jelle (zie CLAUDE.md).
export const APP_VERSION = '1.122'
