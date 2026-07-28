import { describe, it, expect } from 'vitest'

// Replicate the server-side topup packages for testing
const TOPUP_PACKAGES = {
  1: { coins: 1, naira: 200 },
  5: { coins: 5, naira: 950 },
  15: { coins: 15, naira: 2700 },
  50: { coins: 50, naira: 8500 },
}

describe('topupPackages', () => {
  it('defines all expected packages', () => {
    expect(Object.keys(TOPUP_PACKAGES)).toEqual(['1', '5', '15', '50'])
  })

  it('each package has valid coins and naira', () => {
    for (const [id, pkg] of Object.entries(TOPUP_PACKAGES)) {
      expect(pkg.coins).toBeGreaterThan(0)
      expect(pkg.naira).toBeGreaterThan(0)
      expect(String(pkg.coins)).toBe(id)
    }
  })

  it('price per coin decreases with larger packages', () => {
    for (let i = 1; i < Object.keys(TOPUP_PACKAGES).length; i++) {
      const prev = Object.values(TOPUP_PACKAGES)[i - 1]
      const curr = Object.values(TOPUP_PACKAGES)[i]
      expect(curr.naira / curr.coins).toBeLessThan(prev.naira / prev.coins)
    }
  })

  it('5-coin package saves 50 naira vs 5 singles', () => {
    const pkg5 = TOPUP_PACKAGES[5]
    const single = TOPUP_PACKAGES[1]
    expect(single.naira * 5 - pkg5.naira).toBe(50)
  })

  it('rejects undefined package id', () => {
    expect(TOPUP_PACKAGES[99]).toBeUndefined()
    expect(TOPUP_PACKAGES['invalid']).toBeUndefined()
  })
})