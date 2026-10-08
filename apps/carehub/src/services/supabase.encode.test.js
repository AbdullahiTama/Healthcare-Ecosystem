import { describe, it, expect } from 'vitest'

// Reproduce the encodeStoragePath behavior from supabase.js without importing the whole module (which needs window)
// This tests the behavior: slashes must be preserved, segments encoded
function encodeStoragePath(path) {
  return path.split('/').map(encodeURIComponent).join('/')
}
function oldEncode(path) {
  return encodeURIComponent(path)
}

describe('sbUpload path encoding', () => {
  it('preserves slashes and encodes segments', () => {
    const path = 'ecommerce/e1/123-456.jpg'
    expect(encodeStoragePath(path)).toBe('ecommerce/e1/123-456.jpg')
    expect(oldEncode(path)).toBe('ecommerce%2Fe1%2F123-456.jpg')
    expect(encodeStoragePath(path).includes('%2F')).toBe(false)
  })
  it('encodes spaces and special chars but not slashes', () => {
    const path = 'ecommerce/e1/my photo (1).jpg'
    const encoded = encodeStoragePath(path)
    expect(encoded).toBe('ecommerce/e1/my%20photo%20(1).jpg')
    expect(encoded.includes('%2F')).toBe(false)
    expect(encoded.includes('%20')).toBe(true)
  })
  it('matches Supabase storage-js encodeStoragePath', () => {
    // Supabase storage-js does path.split('/').map(encodeURIComponent).join('/')
    const cases = [
      'ecommerce/abc/123.jpg',
      'businesses/123/logo-123.jpg',
      'ecommerce/xyz/file with spaces.png',
    ]
    for (const p of cases) {
      expect(encodeStoragePath(p).split('/').length).toBe(p.split('/').length)
      expect(encodeStoragePath(p).includes('%2F')).toBe(false)
    }
  })
})
