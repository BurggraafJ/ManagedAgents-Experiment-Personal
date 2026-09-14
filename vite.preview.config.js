import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import path from 'node:path'

// Preview-build voor docs/previews/*.png (scripts/preview-*).
// Dezelfde componenten en dezelfde CSS als de app; alleen de data-hooks en de
// supabase-client zijn gestubt, zodat er geen sessie of netwerk nodig is.
// Los van vite.config.js gehouden: de PWA-plugin en de app-entry horen niet in
// een screenshot-build.
//
// v1.173: dezelfde config bedient nu meerdere harnassen. PREVIEW_ENTRY kiest de
// html, PREVIEW_SUPABASE_MOCK de stub voor lib/supabase en PREVIEW_OUT de
// build-map. Zonder die variabelen is het gedrag ongewijzigd (gebruikerspagina).
const ENTRY = process.env.PREVIEW_ENTRY || './scripts/preview-users/index.html'
const SUPA  = process.env.PREVIEW_SUPABASE_MOCK || './scripts/preview-users/mock-supabase.js'
const OUT   = process.env.PREVIEW_OUT || '/tmp/preview-users-dist'
// v1.183: extra hook-stubs per harnas, zonder deze config per harnas te
// forken. PREVIEW_HOOK_MOCKS="useAgenda=./scripts/x/mock.js,useAutoDraft=…" —
// elke naam wordt als `hooks/<naam>` gealiast naar het opgegeven bestand.
const HOOK_MOCKS = (process.env.PREVIEW_HOOK_MOCKS || '')
  .split(',').map(s => s.trim()).filter(Boolean)
  .map(pair => {
    const [name, file] = pair.split('=')
    // Hele specifier matchen (zie de opmerking bij lib/supabase hierboven).
    return { find: new RegExp(`^.*/hooks/${name}$`), replacement: path.resolve(file) }
  })

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: [
      // Anker op het héle specifier: een regex-alias vervangt alleen het
      // gematchte stuk, dus `/lib\/supabase$/` liet bij `../lib/supabase` de
      // `..` staan en zocht het bestand een map te hoog.
      { find: /^.*\/lib\/supabase$/, replacement: path.resolve(SUPA) },
      { find: /^\.\/supabase$/, replacement: path.resolve(SUPA) },
      { find: /^.*\/hooks\/useUsers$/, replacement: path.resolve('./scripts/preview-users/mock-hooks.js') },
      { find: /^.*\/hooks\/useHubspotOwnerMap$/, replacement: path.resolve('./scripts/preview-users/mock-hooks.js') },
      ...HOOK_MOCKS,
    ],
  },
  optimizeDeps: { entries: [ENTRY] },
  build: {
    outDir: OUT,
    emptyOutDir: true,
    rollupOptions: { input: path.resolve(ENTRY) },
  },
})
