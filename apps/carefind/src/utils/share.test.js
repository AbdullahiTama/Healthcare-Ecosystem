import { describe, it, expect, vi, beforeEach } from 'vitest'
import { toShareText } from './formatShare.js'
import { shareOrCopy, postShareUrl, newsShareUrl } from './share.js'

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

  it('never hands a media file to the share sheet, even if a caller passes one (CODE_AUDIT A51)', async () => {
    const share = vi.fn().mockResolvedValue()
    const canShare = vi.fn(() => true)
    const file = new File(['x'], 'clip.mp4', { type: 'video/mp4' })
    Object.assign(global.navigator, { share, canShare, clipboard: { writeText: vi.fn() } })
    expect(await shareOrCopy({ title: 't', text: 'hi', url: 'http://x.test/post/abc', files: [file], mediaUrl: 'http://x.test/clip.mp4' })).toBe('shared')
    expect(share).toHaveBeenCalledWith({ title: 't', text: 'hi', url: 'http://x.test/post/abc' })
    expect(canShare).not.toHaveBeenCalled()
  })

  it('does not append the media URL to clipboard text (OG tags carry the image) — URL first', async () => {
    const clipboard = vi.fn().mockResolvedValue()
    Object.assign(global.navigator, { share: undefined, clipboard: { writeText: clipboard } })
    await shareOrCopy({ text: 'hi', url: 'http://x.test', mediaUrl: 'http://x.test/pic.jpg' })
    expect(clipboard).toHaveBeenCalledWith('http://x.test\n\nhi')
    expect(clipboard.mock.calls[0][0]).not.toContain('pic.jpg')
  })
})

describe('share links', () => {
  const ID = '0b1c2d3e-4f50-4a61-8b72-9c83d4e5f607'

  it('a post\'s link is its readable canonical URL on the public site', () => {
    expect(postShareUrl({ id: ID, content: 'Malaria: signs to watch for this rainy season' }))
      .toBe('https://carefind.app/post/malaria-signs-to-watch-for-this-rainy-season-' + ID)
  })

  it('a video or image post with no words still gets a working link', () => {
    expect(postShareUrl({ id: ID, content: '' })).toBe('https://carefind.app/post/article-on-carefind-' + ID)
  })

  it('a news article\'s link carries its headline', () => {
    expect(newsShareUrl({ id: ID, headline: 'New clinic opens in Yaba' })).toBe('https://carefind.app/news/new-clinic-opens-in-yaba-' + ID)
  })
})
