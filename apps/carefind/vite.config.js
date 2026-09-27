import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import path from 'path'

const hasSentry = !!process.env.SENTRY_AUTH_TOKEN

export default defineConfig({
  plugins: [
    react(),
  ],
  resolve: {
    alias: {
      'lucide-react': path.resolve(__dirname, 'node_modules/lucide-react'),
      '@supabase/supabase-js': path.resolve(__dirname, 'node_modules/@supabase/supabase-js'),
      'resend': path.resolve(__dirname, 'node_modules/resend'),
      '@care-ecosystem/design-system/components': path.resolve(__dirname, '../../packages/design-system/src/components'),
      '@care-ecosystem/design-system': path.resolve(__dirname, '../../packages/design-system/src/theme.js'),
    },
  },
  build: {
    sourcemap: false,
    chunkSizeWarningLimit: 600,
    target: 'es2015',
  },
})
