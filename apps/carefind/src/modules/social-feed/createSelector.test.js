import { describe, it, expect, vi } from 'vitest'
import {
  CREATE_PARAM, CREATE_PATH, shouldOpenCreateSelector, withoutCreateParam, logCreateTap,
} from './createSelector.js'

describe('createSelector signal', () => {
  it('navigates to the feed with the create flag set', () => {
    expect(CREATE_PATH).toBe(`/feed?${CREATE_PARAM}=1`)
  })

  it('recognises the flag from a query string, with or without the leading ?', () => {
    expect(shouldOpenCreateSelector('?create=1')).toBe(true)
    expect(shouldOpenCreateSelector('create=1')).toBe(true)
    expect(shouldOpenCreateSelector('?post=abc&create=1')).toBe(true)
  })

  it('recognises the flag from a react-router location object', () => {
    expect(shouldOpenCreateSelector({ search: '?create=1' })).toBe(true)
    expect(shouldOpenCreateSelector({ search: '?post=abc' })).toBe(false)
  })

  it('recognises the flag from URLSearchParams', () => {
    expect(shouldOpenCreateSelector(new URLSearchParams('create=1'))).toBe(true)
    expect(shouldOpenCreateSelector(new URLSearchParams('create=0'))).toBe(false)
  })

  it('is false for an absent, empty or non-1 flag', () => {
    expect(shouldOpenCreateSelector('')).toBe(false)
    expect(shouldOpenCreateSelector(undefined)).toBe(false)
    expect(shouldOpenCreateSelector('?create=')).toBe(false)
    expect(shouldOpenCreateSelector('?create=yes')).toBe(false)
  })

  it('strips only the create flag, preserving every other parameter', () => {
    expect(withoutCreateParam('?create=1')).toBe('')
    expect(withoutCreateParam('?post=abc&create=1')).toBe('?post=abc')
    expect(withoutCreateParam({ search: '?create=1&tab=video' })).toBe('?tab=video')
    expect(withoutCreateParam('?post=abc')).toBe('?post=abc')
  })
})

describe('logCreateTap', () => {
  it('reports a successful open at info level', () => {
    const sink = { info: vi.fn(), warn: vi.fn() }
    logCreateTap({ source: 'bottom-nav', opened: true, path: '/feed' }, sink)
    expect(sink.info).toHaveBeenCalledTimes(1)
    expect(sink.warn).not.toHaveBeenCalled()
  })

  it('warns — never stays silent — when the selector did not open', () => {
    const sink = { info: vi.fn(), warn: vi.fn() }
    const detail = logCreateTap({ source: 'bottom-nav', opened: false, path: '/profile' }, sink)
    expect(sink.warn).toHaveBeenCalledTimes(1)
    expect(sink.info).not.toHaveBeenCalled()
    expect(detail).toEqual({ source: 'bottom-nav', opened: false, path: '/profile' })
  })
})
