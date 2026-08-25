import react from '@vitejs/plugin-react'
import { defineConfig } from 'vitest/config'
import path from 'path'

export default defineConfig({
  plugins: [react()],
  test: {
    environment: 'jsdom',
    include: ['src/**/*.test.{js,jsx}'],
    globals: true,
    setupFiles: ['./src/test/setup.js'],
  },
  // Mirrors vite.config.js so tests resolve the shared design-system package
  // the same way the build does (Vitest does not read Vite's resolve.alias).
  // lucide-react is aliased to the package dir so the shared components (which
  // live outside apps/carehub and have no local node_modules) resolve it via
  // its ESM entry — the same entry existing tests already exercise.
  resolve: {
    alias: {
      'lucide-react': path.resolve(__dirname, 'node_modules/lucide-react'),
      '@care-ecosystem/design-system/components': path.resolve(__dirname, '../../packages/design-system/src/components'),
      '@care-ecosystem/design-system': path.resolve(__dirname, '../../packages/design-system/src/theme.js'),
    },
  },
})