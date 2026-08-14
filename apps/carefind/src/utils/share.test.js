import { describe, it, expect } from 'vitest'
import { toShareText } from './formatShare.js'
import { shareOrCopy } from './share.js'

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
  it('returns failed when neither navigator.share nor clipboard exists', async () => {
    expect(await shareOrCopy({ text: 'hi', url: 'http://x.test' })).toBe('failed')
  })

  it('falls back to clipboard when navigator.share is missing', async () => {
    const clipboard = vi.fn().mockResolvedValue()
    Object.assign(global.navigator, { share: undefined, clipboard: { writeText: clipboard } })
    const result = await shareOrCopy({ text: 'hi', url: 'http://x.test' })
    expect(result).toBe('copied')
    expect(clipboard).toHaveBeenCalledWith('hi\n\nhttp://x.test')
  })

  it('reports shared when navigator.share succeeds', async () => {
    const share = vi.fn().mockResolvedValue()
    Object.assign(global.navigator, { share, clipboard: { writeText: vi.fn() } })
    expect(await shareOrCopy({ title: 't', text: 'hi', url: 'http://x.test' })).toBe('shared')
  })

  it('reports dismissed when the user aborts the share sheet', async () => {
    const share = vi.fn().mockRejectedValue({ name: 'AbortError' })
    Object.assign(global.navigator, { share, clipboard: { writeText: vi.fn() } })
    expect(await shareOrCopy({ title: 't', text: 'hi', url: 'http://x.test' })).toBe('dismissed')
  })
})