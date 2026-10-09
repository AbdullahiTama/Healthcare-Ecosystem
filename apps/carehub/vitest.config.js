import react from '@vitejs/plugin-react'
import { defineConfig } from 'vitest/config'

export default defineConfig({
  plugins: [react()],
  test: {
    environment: 'jsdom',
    include: ['src/**/*.test.{js,jsx}', 'api/**/*.test.js'],
    globals: true,
    // lib/authClient.js refuses to load without Supabase credentials. Tests
    // never reach the network (every request seam is mocked), so placeholder
    // values let CI run without a .env — real credentials still win when set.
    env: {
      VITE_SUPABASE_URL: process.env.VITE_SUPABASE_URL || 'https://test-project.supabase.co',
      VITE_SUPABASE_ANON_KEY: process.env.VITE_SUPABASE_ANON_KEY || 'test-anon-key',
    },
  },
})
