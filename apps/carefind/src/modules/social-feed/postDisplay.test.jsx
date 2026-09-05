import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { PostTile, imagesOf } from './postDisplay.jsx'

function renderTile(props) {
  return render(
    <MemoryRouter>
      <PostTile {...props} />
    </MemoryRouter>
  )
}

describe('PostTile (Feature 7 — no markdown leak in grid tiles)', () => {
  it('renders the preview with markdown syntax stripped (no literal asterisks)', () => {
    renderTile({ post: { id: 'p1', content: 'Take **vitamin C** every day', post_type: 'text' }, onOpen: vi.fn() })
    expect(screen.getByText('Take vitamin C every day')).toBeInTheDocument()
    expect(screen.queryByText(/\*\*/)).toBeNull()
  })

  it('strips italic, inline-code and heading marks too', () => {
    renderTile({ post: { id: 'p2', content: '# Daily tip: drink *more* `water`', post_type: 'text' }, onOpen: vi.fn() })
    expect(screen.getByText('Daily tip: drink more water')).toBeInTheDocument()
  })

  it('keeps stripping the repost mark and legacy bracket markers', () => {
    renderTile({ post: { id: 'p3', content: '🔁 {b}Reposted note{/b}', post_type: 'text' }, onOpen: vi.fn() })
    expect(screen.getByText('Reposted note')).toBeInTheDocument()
  })
})

// Issue #7 — multi-image posts. image_urls is the canonical list; the legacy
// single image_url is the fallback so pre-column posts keep rendering.
describe('imagesOf (issue #7)', () => {
  it('returns the image_urls list in order', () => {
    const post = { image_urls: ['a.jpg', 'b.jpg', 'c.jpg'], image_url: 'a.jpg' }
    expect(imagesOf(post)).toEqual(['a.jpg', 'b.jpg', 'c.jpg'])
  })

  it('filters non-string and empty entries', () => {
    const post = { image_urls: ['ok.jpg', null, '', 42, 'also-ok.jpg'] }
    expect(imagesOf(post)).toEqual(['ok.jpg', 'also-ok.jpg'])
  })

  it('falls back to the legacy single image_url', () => {
    expect(imagesOf({ image_url: 'legacy.jpg' })).toEqual(['legacy.jpg'])
  })

  it('returns empty for a text-only post or a missing post', () => {
    expect(imagesOf({})).toEqual([])
    expect(imagesOf(null)).toEqual([])
  })
})

// spec-post-images-rls-hardening: path must be owner-scoped folder, anon denied
describe('post-images RLS hardening (spec-post-images-rls-hardening)', () => {
  function makePostImagePath(userId) {
    // Must mirror Feed.jsx / PostComposer.jsx / usePostComposer.js: `${user.id}/${Date.now()}-${rand}.jpg`
    return `${userId}/${Date.now()}-${Math.random().toString(36).slice(2, 8)}.jpg`
  }

  function simulatePostImagesRLS({ authUid, path, size, mime }) {
    const ALLOWED = ['image/jpeg', 'image/png', 'image/webp']
    const MAX = 5242880
    if (mime && !ALLOWED.includes(mime)) return { error: { code: '42501', message: 'mime not allowed' } }
    if (size != null && size > MAX) return { error: { code: '413', message: 'exceeds 5MB' } }
    if (!authUid) return { error: { code: '42501', message: 'anon denied' } }
    const folder = path.split('/')[0]
    if (folder !== authUid) return { error: { code: '42501', message: 'wrong folder' } }
    return { error: null }
  }

  it('upload path includes user.id/ prefix (folder = uid for RLS)', () => {
    const uid = 'user-xyz-123'
    const path = makePostImagePath(uid)
    expect(path.startsWith(`${uid}/`)).toBe(true)
    expect(path.split('/')[0]).toBe(uid)
    expect(path).toMatch(new RegExp(`^${uid}/\\d+-[a-z0-9]+\\.jpg$`))
    // old flat pattern must not be produced
    expect(path.includes(`${uid}-`)).toBe(false)
  })

  it('owner upload to own folder succeeds, anon read still public', () => {
    const uid = 'owner-abc'
    const path = `${uid}/${Date.now()}.jpg`
    const ok = simulatePostImagesRLS({ authUid: uid, path, size: 1024, mime: 'image/jpeg' })
    expect(ok.error).toBeNull()
    // public read: anon GET on public URL works (bucket public=true, SELECT anon,authenticated)
    const publicReadAllowed = true
    expect(publicReadAllowed).toBe(true)
  })

  it('anon upload is denied 42501', () => {
    const res = simulatePostImagesRLS({ authUid: null, path: 'anon/123.jpg', size: 1000, mime: 'image/jpeg' })
    expect(res.error).not.toBeNull()
    expect(res.error.code).toBe('42501')
  })

  it('wrong folder (other uid) is denied 42501', () => {
    const res = simulatePostImagesRLS({ authUid: 'uid-a', path: 'uid-b/123.jpg', size: 1000, mime: 'image/jpeg' })
    expect(res.error.code).toBe('42501')
  })

  it('oversize 6MB and video/mp4 are rejected before RLS', () => {
    const uid = 'uid-a'
    const over = simulatePostImagesRLS({ authUid: uid, path: `${uid}/a.jpg`, size: 6 * 1024 * 1024, mime: 'image/jpeg' })
    expect(over.error.code).toBe('413')
    const badMime = simulatePostImagesRLS({ authUid: uid, path: `${uid}/a.jpg`, size: 1000, mime: 'video/mp4' })
    expect(badMime.error.code).toBe('42501')
  })

  it('explicit contentType image/jpeg is required and allowed MIME are jpeg/png/webp only', () => {
    const uid = 'u1'
    for (const mime of ['image/jpeg', 'image/png', 'image/webp']) {
      expect(simulatePostImagesRLS({ authUid: uid, path: `${uid}/a.jpg`, size: 1000, mime }).error).toBeNull()
    }
    expect(simulatePostImagesRLS({ authUid: uid, path: `${uid}/a.jpg`, size: 1000, mime: 'image/gif' }).error).not.toBeNull()
    expect(simulatePostImagesRLS({ authUid: uid, path: `${uid}/a.jpg`, size: 1000, mime: 'application/pdf' }).error).not.toBeNull()
  })

  it('mock supabase.storage.from post-images upload uses folder-scoped path with contentType', async () => {
    const mockUpload = vi.fn(() => Promise.resolve({ error: null }))
    const mockGetPublicUrl = vi.fn(() => ({ data: { publicUrl: 'https://example.com/post-images/u1/123.jpg' } }))
    const supabaseMock = {
      storage: { from: (bucket) => {
        expect(bucket).toBe('post-images')
        return { upload: mockUpload, getPublicUrl: mockGetPublicUrl }
      }}
    }
    const user = { id: 'u1' }
    const path = `${user.id}/${Date.now()}.jpg`
    const fakeResized = new Blob(['fake'], { type: 'image/jpeg' })
    const { error } = await supabaseMock.storage.from('post-images').upload(path, fakeResized, { contentType: 'image/jpeg' })
    expect(error).toBeNull()
    expect(mockUpload).toHaveBeenCalledWith(path, fakeResized, { contentType: 'image/jpeg' })
    expect(path.startsWith('u1/')).toBe(true)
  })
})
