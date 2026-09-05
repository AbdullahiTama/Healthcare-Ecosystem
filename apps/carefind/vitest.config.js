import { defineConfig } from 'vitest/config'
import react from '@vitejs/plugin-react'
import path from 'path'

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      'lucide-react': path.resolve(__dirname, 'node_modules/lucide-react'),
      '@care-ecosystem/design-system/components': path.resolve(__dirname, '../../packages/design-system/src/components'),
      '@care-ecosystem/design-system': path.resolve(__dirname, '../../packages/design-system/src/theme.js'),
    },
  },
  test: {
    environment: 'jsdom',
    setupFiles: ['./src/test/setup.js'],
    include: ['src/**/*.test.{js,jsx}'],
    globals: true,
    // Above the 5000ms `asyncUtilTimeout` configured in src/test/setup.js (see
    // the reasoning there): when a findBy* runs out of time it must fail with
    // RTL's own message, which names the element it could not find, rather
    // than vitest's generic "test timed out" — which only holds while the test
    // timeout stays clear of the async-util one. A hung test still fails in 15s.
    testTimeout: 15000,
  },
})