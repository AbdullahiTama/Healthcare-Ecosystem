import { describe, it, expect } from 'vitest'
import { voicePathFromUrl, voiceUploadInfo, VOICE_BUCKET } from './voiceUrl'

const BASE = 'https://proj.supabase.co/storage/v1/object'

describe('voicePathFromUrl: the file path inside the bucket, from whatever URL was stored', () => {
  it('reads the public form that every existing voice note was saved with', () => {
    expect(voicePathFromUrl(BASE + '/public/activity-voice/voice-1782-123.webm')).toBe('voice-1782-123.webm')
  })
  it('reads the folder form used by new uploads', () => {
    expect(voicePathFromUrl(BASE + '/public/activity-voice/biz-1/act-9-x1.mp4')).toBe('biz-1/act-9-x1.mp4')
  })
  it('reads an already signed or authenticated URL, dropping the token', () => {
    expect(voicePathFromUrl(BASE + '/sign/activity-voice/biz-1/a.webm?token=abc')).toBe('biz-1/a.webm')
    expect(voicePathFromUrl(BASE + '/authenticated/activity-voice/a.webm')).toBe('a.webm')
  })
  it('decodes escaped characters', () => {
    expect(voicePathFromUrl(BASE + '/public/activity-voice/a%20b.webm')).toBe('a b.webm')
  })
  it('is null for anything that is not a voice-note URL, rather than guessing', () => {
    expect(voicePathFromUrl(null)).toBeNull()
    expect(voicePathFromUrl('')).toBeNull()
    expect(voicePathFromUrl('https://example.com/song.mp3')).toBeNull()
    expect(voicePathFromUrl(BASE + '/public/post-images/pic.png')).toBeNull()
    expect(voicePathFromUrl(BASE + '/public/activity-voice/')).toBeNull()
  })
})

describe('voiceUploadInfo: where a recording goes and what it is called', () => {
  const blob = (type) => ({ type })
  it('goes into the company folder, named after the report, with a unique suffix so a retry never collides', () => {
    const a = voiceUploadInfo(blob('audio/webm'), 'biz-1', 'act-9', 'k1')
    const b = voiceUploadInfo(blob('audio/webm'), 'biz-1', 'act-9', 'k2')
    expect(a.path).toBe('biz-1/act-9-k1.webm')
    expect(b.path).not.toBe(a.path)
  })
  it('sends the type without parameters, because the bucket allow-list matches the bare type', () => {
    expect(voiceUploadInfo(blob('audio/webm;codecs=opus'), 'b', 'a', 'k').contentType).toBe('audio/webm')
    expect(voiceUploadInfo(blob('audio/webm; codecs=opus'), 'b', 'a', 'k').contentType).toBe('audio/webm')
  })
  it('picks the extension from the type', () => {
    expect(voiceUploadInfo(blob('audio/mp4'), 'b', 'a', 'k').path.endsWith('.mp4')).toBe(true)
    expect(voiceUploadInfo(blob('audio/ogg;codecs=opus'), 'b', 'a', 'k').path.endsWith('.ogg')).toBe(true)
    expect(voiceUploadInfo(blob('audio/aac'), 'b', 'a', 'k').path.endsWith('.aac')).toBe(true)
    expect(voiceUploadInfo(blob('audio/mpeg'), 'b', 'a', 'k').path.endsWith('.mp3')).toBe(true)
  })
  it('a recording with no type is treated as mp4 audio, as before', () => {
    const i = voiceUploadInfo(blob(''), 'b', 'a', 'k')
    expect(i.contentType).toBe('audio/mp4')
    expect(i.path.endsWith('.mp4')).toBe(true)
  })
  it('refuses to build a path without a company and a report, so a file can never land at the bucket root', () => {
    expect(() => voiceUploadInfo(blob('audio/webm'), '', 'a', 'k')).toThrow()
    expect(() => voiceUploadInfo(blob('audio/webm'), 'b', '', 'k')).toThrow()
  })
  it('the bucket name is one constant', () => {
    expect(VOICE_BUCKET).toBe('activity-voice')
  })
})
