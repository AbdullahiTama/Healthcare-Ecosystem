import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import path from 'path'
import { sentryVitePlugin } from '@sentry/vite-plugin'

const hasSentry = !!process.env.SENTRY_AUTH_TOKEN

export default defineConfig({
  plugins: [
    react(),
    sentryVitePlugin({
      org: process.env.SENTRY_ORG,
      project: 'carefind',
      authToken: process.env.SENTRY_AUTH_TOKEN,
      release: { name: process.env.VERCEL_GIT_COMMIT_SHA || 'local' },
      sourcemaps: { assets: './dist/**' },
      disable: !hasSentry,
    }),
  ],
  resolve: {
    alias: {
      'lucide-react': path.resolve(__dirname, 'node_modules/lucide-react'),
      '@care-ecosystem/design-system/components': path.resolve(__dirname, '../../packages/design-system/src/components'),
      '@care-ecosystem/design-system': path.resolve(__dirname, '../../packages/design-system/src/theme.js'),
    },
  },
  build: {
    // Hidden sourcemaps for Sentry when configured; no maps shipped to browsers otherwise
    sourcemap: hasSentry ? 'hidden' : false,
    chunkSizeWarningLimit: 600,
    rollupOptions: {
      output: {
        manualChunks: {
          'react-vendor': ['react', 'react-dom', 'react-router-dom'],
          'supabase': ['@supabase/supabase-js'],
          'map-vendor': ['leaflet', 'react-leaflet'],
          'motion': ['gsap'],
          'query': ['@tanstack/react-query'],
        },
      },
    },
  },
})
