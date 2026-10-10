import { describe, it, expect } from 'vitest'

// The barrel used to `export { default as X } from './X'` and then build its default export from X. A re-export
// creates no local binding, so importing the module threw "BusinessDiscoveryPage is not defined" (found by ESLint
// no-undef). Nothing imports the barrel today, so only a test notices.
describe('business-discovery barrel', () => {
  it('imports without throwing and exposes the five components by name and in its default export', async () => {
    const mod = await import('./index.js')
    const names = ['BusinessDiscoveryPage', 'SearchBar', 'SearchFilters', 'ResultsList', 'ResultsMap']
    for (const name of names) {
      expect(mod[name], name).toBeTruthy()
      expect(mod.default[name], `default.${name}`).toBe(mod[name])
    }
    expect(Object.keys(mod.default).sort()).toEqual([...names].sort())
  })
})
