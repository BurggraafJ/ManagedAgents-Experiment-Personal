import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { VitePWA } from 'vite-plugin-pwa'

export default defineConfig({
  plugins: [
    react(),
    VitePWA({
      registerType: 'autoUpdate',
      injectRegister: 'auto',
      includeAssets: ['favicon.svg', 'pwa-icon.svg', 'pwa-icon-maskable.svg'],
      manifest: {
        name: 'Maestro',
        short_name: 'Maestro',
        description: 'Maestro — Legal Mind Agent Command Center. Autonome agents voor inbox, agenda en administratie.',
        lang: 'nl',
        theme_color: '#E86832',
        background_color: '#1a1a1a',
        display: 'standalone',
        orientation: 'any',
        start_url: '/',
        scope: '/',
        icons: [
          { src: '/pwa-icon.svg', sizes: '192x192', type: 'image/svg+xml', purpose: 'any' },
          { src: '/pwa-icon.svg', sizes: '512x512', type: 'image/svg+xml', purpose: 'any' },
          { src: '/pwa-icon-maskable.svg', sizes: '512x512', type: 'image/svg+xml', purpose: 'maskable' },
        ],
      },
      workbox: {
        cleanupOutdatedCaches: true,
        clientsClaim: true,
        skipWaiting: true,
        navigateFallbackDenylist: [/^\/api\//, /^\/auth\//],
        globPatterns: ['**/*.{js,css,html,svg,ico,woff2}'],
        // V9.7 (2026-05-18): main bundle is ~2.2MB door SenderTimeline +
        // ContactTimelineView + alle V9.x features. Verhoog precache-limiet
        // van 2MB → 4MB zodat het hoofd-bundel meegenomen wordt. Toekomstige
        // refactor: code-splitsen via manualChunks (zoeken-view + autodraft-
        // modals lazy-loaden). Voor nu: limiet ophogen, deploy door.
        maximumFileSizeToCacheInBytes: 4 * 1024 * 1024,
      },
    }),
  ],
  build: {
    outDir: 'dist',
    // V9.9 (2026-05-18): manualChunks voor kleinere main-bundle + betere
    // browser-cache (vendor-libs veranderen zelden, app-code wel).
    rollupOptions: {
      output: {
        manualChunks: {
          'vendor-react':     ['react', 'react-dom', 'react-router-dom'],
          'vendor-supabase':  ['@supabase/supabase-js'],
          'vendor-dompurify': ['dompurify'],
        },
      },
    },
  },
})
