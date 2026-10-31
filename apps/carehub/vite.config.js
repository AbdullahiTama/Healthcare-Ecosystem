import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import path from 'path'

// One id per production build, baked into the bundle and published at
// /version.json so an open tab can tell it is out of date
// (src/lib/buildVersion.js). Vercel's commit sha when present, else the time.
const BUILD_ID = process.env.VERCEL_GIT_COMMIT_SHA || String(Date.now())

function buildVersionFile() {
  return {
    name: 'carehub-build-version',
    apply: 'build',
    generateBundle() {
      this.emitFile({ type: 'asset', fileName: 'version.json', source: JSON.stringify({ buildId: BUILD_ID }) })
    },
  }
}

export default defineConfig(({ command }) => ({
  plugins: [
    react(),
    buildVersionFile(),
  ],
  define: command === 'build' ? { __BUILD_ID__: JSON.stringify(BUILD_ID) } : {},
  resolve: {
    alias: {
      'lucide-react': path.resolve(__dirname, 'node_modules/lucide-react/dist/cjs/lucide-react.js'),
      '@supabase/supabase-js': path.resolve(__dirname, 'node_modules/@supabase/supabase-js'),
      'resend': path.resolve(__dirname, 'node_modules/resend'),
      '@care-ecosystem/design-system/components': path.resolve(__dirname, '../../packages/design-system/src/components'),
      '@care-ecosystem/design-system': path.resolve(__dirname, '../../packages/design-system/src/theme.js'),
    },
  },
  build: {
    sourcemap: false,
    target: 'es2015',
  },
}))
