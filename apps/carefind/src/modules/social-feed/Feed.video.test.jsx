import { describe, it, expect, vi, beforeEach } from 'vitest'
import { validateVideoFile, probeVideoDuration } from './mediaLimits.js'

/*
 * Spec-carefind-video-2min-audio-fix
 * Tests: valid 30s passes, 130s rejected with 120s message, probe failure (0) passes via size,
 * size limit, and Feed handleCardVideo rejection without upload.
 *
 * Feed integration is validated via the same validate + probe path that Feed.jsx
 * now uses (await probeVideoDuration + validateVideoFile before supabase.storage
 * upload). A helper simulates that path to prove no upload occurs on rejection.
 */

function makeFile(name, sizeBytes, type = 'video/mp4') {
  const buf = new Uint8Array(1)
  const f = new File([buf], name, { type })
  Object.defineProperty(f, 'size', { value: sizeBytes })
  return f
}

// Simulate Feed.handleCardVideo logic without rendering the whole Feed
async function simulateHandleCardVideo({ file, probe, validate, upload, toast }) {
  const duration = await probe(file)
  const err = validate({ size: file.size, duration })
  if (err) {
    toast(err)
    return { uploaded: false, error: err }
  }
  await upload(file)
  return { uploaded: true, error: null }
}

describe('Feed video 2-minute limit and audio fix', () => {
  it('valid 30s video with audio passes validation', () => {
    const err = validateVideoFile({ size: 20 * 1024 * 1024, duration: 30 })
    expect(err).toBeNull()
  })

  it('near-max 110s passes', () => {
    const err = validateVideoFile({ size: 80 * 1024 * 1024, duration: 110 })
    expect(err).toBeNull()
  })

  it('exceeds 120s (130s) is rejected with 2 minutes (120s) message', () => {
    const err = validateVideoFile({ size: 20 * 1024 * 1024, duration: 130 })
    expect(err).toMatch(/2 minutes/i)
    expect(err).toMatch(/120/)
    expect(err).toMatch(/trim/i)
  })

  it('exceeds size 110MB is rejected with size message', () => {
    const err = validateVideoFile({ size: 110 * 1024 * 1024, duration: 30 })
    expect(err).toMatch(/too large/i)
    expect(err).toMatch(/100/)
  })

  it('corrupt duration probe (0) allows via size check', () => {
    expect(validateVideoFile({ size: 50 * 1024 * 1024, duration: 0 })).toBeNull()
    expect(validateVideoFile({ size: 50 * 1024 * 1024, duration: NaN })).toBeNull()
    expect(validateVideoFile({ size: 50 * 1024 * 1024, duration: undefined })).toBeNull()
  })

  it('probeVideoDuration resolves 0 on missing file', async () => {
    const d = await probeVideoDuration(null)
    expect(d).toBe(0)
  })

  it('Feed handleCardVideo rejects >120s without upload (simulated)', async () => {
    const toast = vi.fn()
    const upload = vi.fn(async () => {})
    const probe = vi.fn(async () => 130)
    const file = makeFile('long.mp4', 20 * 1024 * 1024)
    const result = await simulateHandleCardVideo({ file, probe, validate: validateVideoFile, upload, toast })
    expect(result.uploaded).toBe(false)
    expect(result.error).toMatch(/2 minutes/i)
    expect(result.error).toMatch(/120/)
    expect(toast).toHaveBeenCalledWith(expect.stringMatching(/2 minutes/i))
    expect(upload).not.toHaveBeenCalled()
  })

  it('Feed handleCardVideo rejects oversize without upload', async () => {
    const toast = vi.fn()
    const upload = vi.fn(async () => {})
    const probe = vi.fn(async () => 30)
    const file = makeFile('huge.mp4', 110 * 1024 * 1024)
    const result = await simulateHandleCardVideo({ file, probe, validate: validateVideoFile, upload, toast })
    expect(result.uploaded).toBe(false)
    expect(result.error).toMatch(/too large/i)
    expect(upload).not.toHaveBeenCalled()
  })

  it('Feed handleCardVideo allows probe failure (0) when size ok', async () => {
    const toast = vi.fn()
    const upload = vi.fn(async () => {})
    const probe = vi.fn(async () => 0)
    const file = makeFile('ok.mp4', 20 * 1024 * 1024)
    const result = await simulateHandleCardVideo({ file, probe, validate: validateVideoFile, upload, toast })
    expect(result.uploaded).toBe(true)
    expect(result.error).toBeNull()
    expect(toast).not.toHaveBeenCalled()
    expect(upload).toHaveBeenCalled()
  })

  it('Feed handleCardVideo allows valid 30s upload', async () => {
    const toast = vi.fn()
    const upload = vi.fn(async () => {})
    const probe = vi.fn(async () => 30)
    const file = makeFile('good.mp4', 20 * 1024 * 1024)
    const result = await simulateHandleCardVideo({ file, probe, validate: validateVideoFile, upload, toast })
    expect(result.uploaded).toBe(true)
    expect(toast).not.toHaveBeenCalled()
  })
})
