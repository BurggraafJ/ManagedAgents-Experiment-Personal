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
      },
    }),
  ],
  build: { outDir: 'dist' },
})
