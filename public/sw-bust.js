// LEGACY — was tijdelijk om oude service workers te unregisteren.
// Sinds we vite-plugin-pwa gebruiken (registerType: 'autoUpdate') doet de
// PWA-SW dit zelf via workbox.cleanupOutdatedCaches + skipWaiting + clientsClaim.
// Dit script wordt niet meer geladen vanuit index.html — file blijft staan om
// een 404 te voorkomen als ergens een oude bookmark/preload hem nog raakt.
// Veilig om in een latere opruim-sessie volledig te verwijderen.
