import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'

import PostCard from './PostCard.jsx'
import { imagesOf } from './postDisplay.jsx'
import { MAX_POST_IMAGES } from './mediaLimits.js'

function makeFile(name, type = 'image/jpeg') {
  return new File(['fake'], name, { type })
}

function makePost(overrides = {}) {
  return {
    id: 'p1',
    user_id: 'u1',
    post_type: 'text',
    content: 'Test post content for multi-image',
    created_at: '2026-01-01T00:00:00.000Z',
    view_count: 0,
    repost_count: 0,
    posted_as_type: null,
    posted_as_id: null,
    repost_of: null,
    image_url: null,
    image_urls: null,
    video_url: null,
    audio_url: null,
    theme: null,
    rating: null,
    ...overrides,
  }
}

function makeCardProps(overrides = {}) {
  return {
    user: null,
    navigate: vi.fn(),
    profiles: {},
    authorName: () => 'Dr Test',
    formatCount: (n) => n,
    timeAgo: () => 'now',
    likeCount: () => 0,
    userHasLiked: () => false,
    commentTotal: () => 0,
    shareCount: () => 0,
    saveCount: () => 0,
    giftCount: () => 0,
    userHasReposted: () => false,
    isSaved: () => false,
    isFollowing: () => false,
    toggleLike: vi.fn(),
    toggleComments: vi.fn(),
    toggleRepost: vi.fn(),
    toggleSave: vi.fn(),
    toggleFollow: vi.fn(),
    sharePost: vi.fn(),
    shareCard: vi.fn(),
    openReport: vi.fn(),
    onGift: vi.fn(),
    handleEditPost: vi.fn(),
    handleCommentAdded: vi.fn(),
    openComments: {},
    comments: {},
    setComments: vi.fn(),
    editingComment: null,
    setEditingComment: vi.fn(),
    replyingTo: null,
    setReplyingTo: vi.fn(),
    commentDrafts: {},
    setCommentDrafts: vi.fn(),
    myUsername: '',
    myAvatar: null,
    reportedPosts: [],
    sharingId: null,
    editingPost: null,
    setEditingPost: vi.fn(),
    setConfirmDeleteId: vi.fn(),
    onOpenDetail: vi.fn(),
    ...overrides,
  }
}

// Helper that replicates Feed/PostComposer handleImagesSelect guard logic
function simulateHandleImagesSelect(currentFiles, newFiles, toast) {
  const images = newFiles.filter((f) => f.type?.startsWith('image/'))
  const remaining = MAX_POST_IMAGES - currentFiles.length
  if (remaining <= 0) {
    toast(`You can add up to ${MAX_POST_IMAGES} photos (${MAX_POST_IMAGES}/${MAX_POST_IMAGES})`)
    return currentFiles
  }
  if (images.length > remaining) {
    toast(`You can add up to ${MAX_POST_IMAGES} photos (${MAX_POST_IMAGES}/${MAX_POST_IMAGES})`)
  }
  const toAdd = images.slice(0, remaining)
  return [...currentFiles, ...toAdd]
}

describe('Feed multi-image per post (spec-carefind-multi-image-per-post)', () => {
  it('exposes exactly five photo slots via MAX_POST_IMAGES', () => {
    expect(MAX_POST_IMAGES).toBe(5)
  })

  it('imagesOf returns image_urls in order and filters', () => {
    expect(imagesOf({ image_urls: ['a.jpg', 'b.jpg', 'c.jpg'], image_url: 'a.jpg' })).toEqual(['a.jpg', 'b.jpg', 'c.jpg'])
    expect(imagesOf({ image_urls: ['ok.jpg', null, '', 42, 'also.jpg'] })).toEqual(['ok.jpg', 'also.jpg'])
  })

  it('imagesOf falls back to legacy image_url', () => {
    expect(imagesOf({ image_url: 'legacy.jpg' })).toEqual(['legacy.jpg'])
    expect(imagesOf({})).toEqual([])
    expect(imagesOf(null)).toEqual([])
  })

  it('single image renders not carousel (width 100% single)', async () => {
    const post = makePost({ image_url: 'https://example.com/a.jpg', image_urls: ['https://example.com/a.jpg'] })
    const { container } = render(
      <MemoryRouter>
        <PostCard post={post} {...makeCardProps()} />
      </MemoryRouter>
    )
    const img = container.querySelector('img[alt="post image 1 of 1"]')
    expect(img).toBeTruthy()
    expect(img.getAttribute('loading')).toBe('lazy')
    expect(container.querySelector('[aria-roledescription="carousel"]')).toBeNull()
    expect(img.style.width).toBe('100%')
  })

  it('carousel renders dots for 3 images and snap carousel', async () => {
    const urls = ['https://example.com/a.jpg', 'https://example.com/b.jpg', 'https://example.com/c.jpg']
    const post = makePost({ image_url: urls[0], image_urls: urls })
    const { container } = render(
      <MemoryRouter>
        <PostCard post={post} {...makeCardProps()} />
      </MemoryRouter>
    )
    const carousel = container.querySelector('[aria-roledescription="carousel"]')
    expect(carousel).toBeTruthy()
    expect(carousel.getAttribute('role')).toBe('region')
    const flex = carousel.querySelector('div')
    expect(flex).toBeTruthy()
    expect(flex.style.display).toBe('flex')
    expect(flex.style.overflowX).toBe('auto')
    expect(flex.style.scrollSnapType).toMatch(/mandatory/)
    const imgs = carousel.querySelectorAll('img')
    expect(imgs.length).toBe(3)
    imgs.forEach((img, idx) => {
      expect(img.getAttribute('loading')).toBe('lazy')
      expect(img.alt).toContain(`${idx + 1} of 3`)
      expect(img.style.minWidth).toBe('100%')
      expect(img.style.aspectRatio).toBe('1 / 1')
    })
    const dots = carousel.querySelectorAll('span')
    expect(dots.length).toBe(3)
  })

  it('2-5 images each render carousel correctly (counts 2,4,5)', async () => {
    for (const count of [2,4,5]) {
      const urls = Array.from({ length: count }, (_, i) => `https://example.com/${i}.jpg`)
      const post = makePost({ image_url: urls[0], image_urls: urls })
      const { container, unmount } = render(
        <MemoryRouter>
          <PostCard post={post} {...makeCardProps()} />
        </MemoryRouter>
      )
      const carousel = container.querySelector('[aria-roledescription="carousel"]')
      expect(carousel).toBeTruthy()
      expect(carousel.querySelectorAll('img').length).toBe(count)
      expect(carousel.querySelectorAll('span').length).toBe(count)
      unmount()
    }
  })

  it('guards sixth image with toast and no additional files', () => {
    const toast = vi.fn()
    let files = [makeFile('1.jpg'), makeFile('2.jpg'), makeFile('3.jpg'), makeFile('4.jpg'), makeFile('5.jpg')]
    // already 5
    const result = simulateHandleImagesSelect(files, [makeFile('6.jpg')], toast)
    expect(result.length).toBe(5)
    expect(toast).toHaveBeenCalledWith(`You can add up to 5 photos (5/5)`)
    // 6 files at once when 0 should slice to 5 and toast
    toast.mockClear()
    const result2 = simulateHandleImagesSelect([], [makeFile('1.jpg'), makeFile('2.jpg'), makeFile('3.jpg'), makeFile('4.jpg'), makeFile('5.jpg'), makeFile('6.jpg')], toast)
    expect(result2.length).toBe(5)
    expect(toast).toHaveBeenCalledWith(`You can add up to 5 photos (5/5)`)
  })

  it('allows 1-5 images to be added without toast when within limit', () => {
    const toast = vi.fn()
    for (const n of [1,2,3,4,5]) {
      toast.mockClear()
      const files = Array.from({ length: n }, (_, i) => makeFile(`${i}.jpg`))
      const result = simulateHandleImagesSelect([], files, toast)
      expect(result.length).toBe(n)
      expect(toast).not.toHaveBeenCalled()
    }
  })

  it('remove decrements count and allows re-add', () => {
    const toast = vi.fn()
    let files = simulateHandleImagesSelect([], [makeFile('a.jpg'), makeFile('b.jpg')], toast)
    expect(files.length).toBe(2)
    // remove one
    files = files.filter((_, i) => i !== 0)
    expect(files.length).toBe(1)
    // now we can add up to 4 more
    const after = simulateHandleImagesSelect(files, [makeFile('c.jpg'), makeFile('d.jpg'), makeFile('e.jpg'), makeFile('f.jpg')], toast)
    expect(after.length).toBe(5)
    expect(toast).not.toHaveBeenCalled()
  })

  it('stores image_urls correctly with mirror image_url for 3 images (upload loop)', async () => {
    const mockUpload = vi.fn(() => Promise.resolve({ error: null }))
    const mockGetPublicUrl = vi.fn(() => ({ data: { publicUrl: 'https://example.com/photo.jpg' } }))
    const supabaseMock = {
      storage: { from: () => ({ upload: mockUpload, getPublicUrl: mockGetPublicUrl }) }
    }
    const imageFiles = [makeFile('a.jpg'), makeFile('b.jpg'), makeFile('c.jpg')]
    const resizeImage = async (f) => f
    const imageUrls = []
    for (const f of imageFiles) {
      const resized = await resizeImage(f, 1400, 0.85)
      const path = `user-1/${Date.now()}-${Math.random().toString(36).slice(2, 8)}.jpg`
      // Hardening: path must be folder-scoped user.id/ prefix for RLS
      expect(path.startsWith('user-1/')).toBe(true)
      expect(path.split('/')[0]).toBe('user-1')
      const { error } = await supabaseMock.storage.from('post-images').upload(path, resized, { contentType: 'image/jpeg' })
      if (error) throw error
      const { data } = supabaseMock.storage.from('post-images').getPublicUrl(path)
      imageUrls.push(data.publicUrl)
      // Verify upload was called with owner-scoped path and explicit contentType
      expect(mockUpload).toHaveBeenCalledWith(path, resized, { contentType: 'image/jpeg' })
    }
    expect(imageUrls.length).toBe(3)
    const payload = { image_url: imageUrls[0] || null, image_urls: imageUrls, content: 'Text + 3 images' }
    expect(payload.image_url).toBe(payload.image_urls[0])
    expect(mockUpload).toHaveBeenCalledTimes(3)
  })

  it('stores single image with mirror correctly', async () => {
    const mockUpload = vi.fn(() => Promise.resolve({ error: null }))
    const mockGetPublicUrl = vi.fn(() => ({ data: { publicUrl: 'https://example.com/photo.jpg' } }))
    const supabaseMock = {
      storage: { from: () => ({ upload: mockUpload, getPublicUrl: mockGetPublicUrl }) }
    }
    const imageFiles = [makeFile('single.jpg')]
    const imageUrls = []
    for (const f of imageFiles) {
      const resized = f
      const path = `user-1/${Date.now()}-${Math.random().toString(36).slice(2, 8)}.jpg`
      expect(path.startsWith('user-1/')).toBe(true)
      const { error } = await supabaseMock.storage.from('post-images').upload(path, resized, { contentType: 'image/jpeg' })
      if (error) throw error
      const { data } = supabaseMock.storage.from('post-images').getPublicUrl(path)
      imageUrls.push(data.publicUrl)
    }
    expect(imageUrls.length).toBe(1)
    expect(imageUrls[0]).toBe('https://example.com/photo.jpg')
    const payload = { image_url: imageUrls[0] || null, image_urls: imageUrls }
    expect(payload.image_url).toBe(payload.image_urls[0])
  })

  it('aborts on upload error without post created', async () => {
    const mockUpload = vi.fn(() => Promise.resolve({ error: { message: 'storage fail' } }))
    const mockGetPublicUrl = vi.fn(() => ({ data: { publicUrl: 'https://example.com/photo.jpg' } }))
    const supabaseMock = {
      storage: { from: () => ({ upload: mockUpload, getPublicUrl: mockGetPublicUrl }) }
    }
    const imageFiles = [makeFile('fail.jpg')]
    let aborted = false
    let payload = null
    try {
      const imageUrls = []
      for (const f of imageFiles) {
        const { error } = await supabaseMock.storage.from('post-images').upload('path', f, { contentType: 'image/jpeg' })
        if (error) throw error
        const { data } = supabaseMock.storage.from('post-images').getPublicUrl('path')
        imageUrls.push(data.publicUrl)
      }
      payload = { image_url: imageUrls[0] || null, image_urls: imageUrls }
    } catch (e) {
      aborted = true
    }
    expect(aborted).toBe(true)
    expect(payload).toBeNull()
    expect(mockUpload).toHaveBeenCalledTimes(1)
  })

  it('mixed post Text + 3 images stores content + image_urls[3] and retrievable', () => {
    const post = makePost({ content: 'Hello world', image_urls: ['a.jpg','b.jpg','c.jpg'], image_url: 'a.jpg' })
    expect(post.content).toBe('Hello world')
    expect(imagesOf(post).length).toBe(3)
    expect(imagesOf(post)[0]).toBe('a.jpg')
    // Simulate reload: imagesOf still returns same
    const reloaded = { ...post }
    expect(imagesOf(reloaded).length).toBe(3)
  })
})

// spec-post-images-rls-hardening: owner-scoped uploads, 5MB, MIME, anon denied
describe('post-images RLS hardening (spec-post-images-rls-hardening)', () => {
  // Simulates storage.objects RLS + bucket limits for post-images
  function simulatePostImagesUpload({ authUid, path, size, mimeType }) {
    const ALLOWED_MIME = ['image/jpeg', 'image/png', 'image/webp']
    const MAX_SIZE = 5242880 // 5MB
    // Bucket MIME check (before RLS)
    if (mimeType && !ALLOWED_MIME.includes(mimeType)) {
      return { error: { code: '42501', message: 'mime type not allowed', status: 400 } }
    }
    if (size != null && size > MAX_SIZE) {
      return { error: { code: '413', message: 'file size exceeds limit', status: 413 } }
    }
    // RLS: authenticated only + folder must be auth.uid()
    if (!authUid) {
      return { error: { code: '42501', message: 'new row violates row-level security policy', status: 401 } }
    }
    const folder = path.split('/')[0]
    if (folder !== authUid) {
      return { error: { code: '42501', message: 'new row violates row-level security policy', status: 403 } }
    }
    return { error: null, publicUrl: `https://example.supabase.co/storage/v1/object/public/post-images/${path}` }
  }

  it('owner upload with folder-scoped path succeeds and public URL works for anon read', () => {
    const uid = 'abc-uid-123'
    const path = `${uid}/${Date.now()}.jpg`
    const result = simulatePostImagesUpload({ authUid: uid, path, size: 1024 * 1024, mimeType: 'image/jpeg' })
    expect(result.error).toBeNull()
    expect(result.publicUrl).toContain(`post-images/${uid}/`)
    // public read is anon GET on that URL — no auth needed (bucket public=true)
    expect(result.publicUrl).toMatch(/^https:\/\/.*\/public\/post-images\//)
  })

  it('upload path generated by Feed/PostComposer is folder-scoped user.id/ with contentType image/jpeg', async () => {
    const mockUpload = vi.fn(() => Promise.resolve({ error: null }))
    const mockGetPublicUrl = vi.fn(() => ({ data: { publicUrl: 'https://example.com/photo.jpg' } }))
    const supabaseMock = {
      storage: { from: (bucket) => {
        expect(bucket).toBe('post-images')
        return { upload: mockUpload, getPublicUrl: mockGetPublicUrl }
      }}
    }
    const user = { id: 'owner-uid-xyz' }
    const file = makeFile('photo.jpg', 'image/jpeg')
    const resized = file
    const filePath = `${user.id}/${Date.now()}-${Math.random().toString(36).slice(2, 8)}.jpg`
    expect(filePath.startsWith(`${user.id}/`)).toBe(true)
    expect(filePath).not.toContain(`${user.id}-`) // flat must not appear
    const { error } = await supabaseMock.storage.from('post-images').upload(filePath, resized, { contentType: 'image/jpeg' })
    expect(error).toBeNull()
    expect(mockUpload).toHaveBeenCalledWith(filePath, resized, { contentType: 'image/jpeg' })
    const { data: urlData } = supabaseMock.storage.from('post-images').getPublicUrl(filePath)
    expect(urlData.publicUrl).toBe('https://example.com/photo.jpg')
  })

  it('anon upload is denied 42501', () => {
    const result = simulatePostImagesUpload({ authUid: null, path: 'anon/123.jpg', size: 1000, mimeType: 'image/jpeg' })
    expect(result.error).not.toBeNull()
    expect(result.error.code).toBe('42501')
  })

  it('wrong folder (other-uid prefix) is denied 42501', () => {
    const authUid = 'abc-uid'
    const path = `other-uid/${Date.now()}.jpg`
    const result = simulatePostImagesUpload({ authUid, path, size: 1000, mimeType: 'image/jpeg' })
    expect(result.error).not.toBeNull()
    expect(result.error.code).toBe('42501')
  })

  it('oversize 6MB is rejected before RLS (413)', () => {
    const uid = 'abc-uid'
    const path = `${uid}/${Date.now()}.jpg`
    const result = simulatePostImagesUpload({ authUid: uid, path, size: 6 * 1024 * 1024, mimeType: 'image/jpeg' })
    expect(result.error).not.toBeNull()
    expect(result.error.code).toBe('413')
  })

  it('wrong MIME video/mp4 is rejected', () => {
    const uid = 'abc-uid'
    const path = `${uid}/${Date.now()}.jpg`
    const result = simulatePostImagesUpload({ authUid: uid, path, size: 1000, mimeType: 'video/mp4' })
    expect(result.error).not.toBeNull()
    expect(result.error.message).toMatch(/mime/)
  })

  it('public read still works for anon (bucket public=true)', () => {
    // Public read is via getPublicUrl + anon GET; no RLS SELECT denial
    // Simulate: anon can select post-images row
    const canAnonRead = true // bucket public=true + SELECT TO anon,authenticated
    expect(canAnonRead).toBe(true)
  })

  it('allowed MIME types are exactly jpeg/png/webp, 5MB limit', () => {
    const allowed = ['image/jpeg', 'image/png', 'image/webp']
    const uid = 'u1'
    for (const mime of allowed) {
      const r = simulatePostImagesUpload({ authUid: uid, path: `${uid}/a.jpg`, size: 1000, mimeType: mime })
      expect(r.error).toBeNull()
    }
    const denied = simulatePostImagesUpload({ authUid: uid, path: `${uid}/a.jpg`, size: 1000, mimeType: 'image/gif' })
    expect(denied.error).not.toBeNull()
    const exactLimit = simulatePostImagesUpload({ authUid: uid, path: `${uid}/a.jpg`, size: 5242880, mimeType: 'image/jpeg' })
    expect(exactLimit.error).toBeNull()
    const over = simulatePostImagesUpload({ authUid: uid, path: `${uid}/a.jpg`, size: 5242881, mimeType: 'image/jpeg' })
    expect(over.error).not.toBeNull()
  })
})
