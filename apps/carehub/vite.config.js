import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import path from 'path'
import { sentryVitePlugin } from '@sentry/vite-plugin'

export default defineConfig({
  plugins: [
    react(),
    sentryVitePlugin({
      org: process.env.SENTRY_ORG,
      project: 'carehub',
      authToken: process.env.SENTRY_AUTH_TOKEN,
      release: { name: process.env.VERCEL_GIT_COMMIT_SHA || 'local' },
      sourcemaps: { assets: './dist/**' },
      disable: !process.env.SENTRY_AUTH_TOKEN,
    }),
  ],
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
    sourcemap: process.env.SENTRY_AUTH_TOKEN ? 'hidden' : false,
    rollupOptions: {
      output: {
        manualChunks: {
          'react-vendor': ['react', 'react-dom', 'react-router-dom'],
          'supabase': ['@supabase/supabase-js'],
        },
      },
    },
  },
})
