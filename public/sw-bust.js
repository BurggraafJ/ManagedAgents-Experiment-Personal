// Bust eventuele oude service worker (voorkomt stale bundle issues).
// Vroeger inline in index.html, verplaatst naar externe file zodat
// CSP `script-src 'self'` (zonder 'unsafe-inline') gehandhaafd kan blijven.
if ('serviceWorker' in navigator) {
  navigator.serviceWorker.getRegistrations().then(rs => rs.forEach(r => r.unregister()))
}
