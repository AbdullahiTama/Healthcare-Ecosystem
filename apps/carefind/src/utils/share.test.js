import { describe, it, expect, vi, beforeEach } from 'vitest'
import { toShareText } from './formatShare.js'
import { shareOrCopy, mediaToFile } from './share.js'

describe('toShareText', () => {
  it('returns empty string for null/undefined', () => {
    expect(toShareText(null)).toBe('')
    expect(toShareText(undefined)).toBe('')
  })

  it('returns plain text as-is (trimmed)', () => {
    expect(toShareText('  Hello world  ')).toBe('Hello world')
  })

  it('unwraps a visual-card JSON object into its text field', () => {
    const card = JSON.stringify({ theme: 'teal', text: 'Stay hydrated today' })
    expect(toShareText(card)).toBe('Stay hydrated today')
  })

  it('strips markdown emphasis and heading markers', () => {
    expect(toShareText('**bold** and *italic*')).toBe('bold and italic')
    expect(toShareText('# A heading\nBody')).toBe('A heading\nBody')
    expect(toShareText('[see here](https://x.com)')).toBe('see here')
  })

  it('unwraps an article JSON block array into readable text', () => {
    const blocks = JSON.stringify([
      { type: 'text', content: 'First paragraph' },
      { type: 'heading', content: 'Second heading' },
      { type: 'quote', content: 'Third quote' },
      { type: 'drawing', content: '{}' },
    ])
    expect(toShareText(blocks)).toBe('First paragraph Second heading Third quote ✏️ drawing')
  })

  it('does not leak raw JSON for block arrays', () => {
    const blocks = JSON.stringify([{ type: 'text', content: 'Clean text' }])
    expect(toShareText(blocks)).not.toContain('{')
    expect(toShareText(blocks)).not.toContain('type')
  })

  it('accepts an already-parsed array of blocks', () => {
    const arr = [{ type: 'text', content: 'from array' }, { type: 'voice', content: '' }]
    expect(toShareText(arr)).toBe('from array 🎙 voice note')
  })

  it('strips article highlight markers (==hex|text== and ==text==)', () => {
    expect(toShareText('==#ffcc00|highlighted== word')).toBe('highlighted word')
    expect(toShareText('==plain highlight==')).toBe('plain highlight')
  })

  it('truncates long text with an ellipsis without cutting a word', () => {
    const long = 'one two three four five six seven eight nine ten'
    expect(toShareText(long, { maxLen: 10 })).toBe('one two…')
  })

  it('falls back to raw string when JSON parsing fails', () => {
    expect(toShareText('{not valid json}')).toBe('{not valid json}')
  })
})

describe('shareOrCopy', () => {
  beforeEach(() => {
    Object.assign(global.navigator, { share: undefined, canShare: undefined, clipboard: undefined })
  })

  it('returns failed when neither navigator.share nor clipboard exists', async () => {
    expect(await shareOrCopy({ text: 'hi', url: 'http://x.test' })).toBe('failed')
  })

  it('falls back to clipboard when navigator.share is missing — URL first for preview without scroll', async () => {
    const clipboard = vi.fn().mockResolvedValue()
    Object.assign(global.navigator, { share: undefined, clipboard: { writeText: clipboard } })
    const result = await shareOrCopy({ text: 'hi', url: 'http://x.test' })
    expect(result).toBe('copied')
    expect(clipboard).toHaveBeenCalledWith('http://x.test\n\nhi')
  })

  it('clipboard fallback is URL alone when there is no text', async () => {
    const clipboard = vi.fn().mockResolvedValue()
    Object.assign(global.navigator, { share: undefined, clipboard: { writeText: clipboard } })
    await shareOrCopy({ text: '', url: 'http://x.test/post/123' })
    expect(clipboard).toHaveBeenCalledWith('http://x.test/post/123')
  })

  it('reports shared when navigator.share succeeds — url is separate field for deep-link preview', async () => {
    const share = vi.fn().mockResolvedValue()
    Object.assign(global.navigator, { share, clipboard: { writeText: vi.fn() } })
    expect(await shareOrCopy({ title: 't', text: 'hi', url: 'http://x.test/post/abc' })).toBe('shared')
    expect(share).toHaveBeenCalledWith(expect.objectContaining({ title: 't', text: 'hi', url: 'http://x.test/post/abc' }))
  })

  it('reports dismissed when the user aborts the share sheet', async () => {
    const share = vi.fn().mockRejectedValue({ name: 'AbortError' })
    Object.assign(global.navigator, { share, clipboard: { writeText: vi.fn() } })
    expect(await shareOrCopy({ title: 't', text: 'hi', url: 'http://x.test' })).toBe('dismissed')
  })

  it('passes files to navigator.share when canShare accepts them', async () => {
    const share = vi.fn().mockResolvedValue()
    const file = new File(['x'], 'pic.jpg', { type: 'image/jpeg' })
    Object.assign(global.navigator, {
      share,
      canShare: vi.fn(() => true),
      clipboard: { writeText: vi.fn() },
    })
    expect(await shareOrCopy({ text: 'hi', url: 'http://x.test', files: [file] })).toBe('shared')
    expect(share).toHaveBeenCalledWith(expect.objectContaining({ files: [file], url: 'http://x.test' }))
  })

  it('omits files when canShare rejects them but still shares url (deep-link preview)', async () => {
    const share = vi.fn().mockResolvedValue()
    const clipboard = vi.fn().mockResolvedValue()
    const file = new File(['x'], 'pic.jpg', { type: 'image/jpeg' })
    Object.assign(global.navigator, {
      share,
      canShare: vi.fn(() => false),
      clipboard: { writeText: clipboard },
    })
    expect(await shareOrCopy({ text: 'hi', url: 'http://x.test', files: [file] })).toBe('shared')
    expect(share).toHaveBeenCalledWith(expect.objectContaining({ url: 'http://x.test', text: 'hi' }))
    expect(share).not.toHaveBeenCalledWith(expect.objectContaining({ files: expect.anything() }))
    expect(clipboard).not.toHaveBeenCalled()
  })

  it('does not append the media URL to clipboard text (OG tags carry the image) — URL first', async () => {
    const clipboard = vi.fn().mockResolvedValue()
    Object.assign(global.navigator, { share: undefined, clipboard: { writeText: clipboard } })
    await shareOrCopy({ text: 'hi', url: 'http://x.test', mediaUrl: 'http://x.test/pic.jpg' })
    expect(clipboard).toHaveBeenCalledWith('http://x.test\n\nhi')
    expect(clipboard.mock.calls[0][0]).not.toContain('pic.jpg')
  })
})

describe('mediaToFile', () => {
  it('returns null for no URL or a failed fetch', async () => {
    expect(await mediaToFile(null)).toBeNull()
    expect(await mediaToFile('')).toBeNull()
  })

  it('returns null when the fetch response is not ok', async () => {
    global.fetch = vi.fn().mockResolvedValue({ ok: false })
    expect(await mediaToFile('http://x.test/pic.jpg')).toBeNull()
  })

  it('builds a File from a fetched blob, deriving the name from the URL', async () => {
    const blob = new Blob(['img'], { type: 'image/jpeg' })
    global.fetch = vi.fn().mockResolvedValue({ ok: true, blob: async () => blob })
    const file = await mediaToFile('http://x.test/uploads/pic.jpg?token=abc')
    expect(file).toBeInstanceOf(File)
    expect(file.name).toBe('pic.jpg')
    expect(file.type).toBe('image/jpeg')
  })

  it('returns null when fetch throws (CORS etc.)', async () => {
    global.fetch = vi.fn().mockRejectedValue(new TypeError('Failed to fetch'))
    expect(await mediaToFile('http://x.test/pic.jpg')).toBeNull()
  })
})