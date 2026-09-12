import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import path from 'node:path'

// Preview-build voor docs/previews/member-ui-a-rust-*.png (scripts/preview-users).
// Dezelfde componenten en dezelfde CSS als de app; alleen de data-hooks en de
// supabase-client zijn gestubt, zodat er geen sessie of netwerk nodig is.
// Los van vite.config.js gehouden: de PWA-plugin en de app-entry horen niet in
// een screenshot-build.
export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: [
      { find: /(^|\/)lib\/supabase$/, replacement: path.resolve('./scripts/preview-users/mock-supabase.js') },
      { find: /^\.\/supabase$/, replacement: path.resolve('./scripts/preview-users/mock-supabase.js') },
      { find: /(^|\/)hooks\/useUsers$/, replacement: path.resolve('./scripts/preview-users/mock-hooks.js') },
      { find: /(^|\/)hooks\/useHubspotOwnerMap$/, replacement: path.resolve('./scripts/preview-users/mock-hooks.js') },
    ],
  },
  optimizeDeps: { entries: ['scripts/preview-users/index.html'] },
  build: {
    outDir: '/tmp/preview-users-dist',
    emptyOutDir: true,
    rollupOptions: { input: path.resolve('./scripts/preview-users/index.html') },
  },
})
