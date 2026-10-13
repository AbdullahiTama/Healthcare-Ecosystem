import { describe, it, expect, vi, beforeEach } from 'vitest'
import { renderHook, act } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'

const callAdminAuth = vi.hoisted(() => vi.fn())
const uploadToBucket = vi.hoisted(() => vi.fn())
const admin = vi.hoisted(() => ({ showToast: vi.fn(), invalidateAdmin: vi.fn() }))
vi.mock('../adminApi', () => ({ callAdminAuth }))
vi.mock('../lib/uploadMedia', () => ({ uploadToBucket }))
vi.mock('../provider/AdminProvider.jsx', () => ({ useAdmin: () => admin }))

import { useLiveActions, slideContent } from './useLiveActions'

const run = async (fn) => { let out; await act(async () => { out = await fn() }); return out }
const client = new QueryClient()
const setup = () => renderHook(() => useLiveActions(), { wrapper: ({ children }) => <QueryClientProvider client={client}>{children}</QueryClientProvider> })
const controlKey = (id) => ({ queryKey: ['admin', 'live', 'control', id] })
const trailer = { name: 't.mp4', type: 'video/webm' }
const image = { name: 'p.png' }

beforeEach(() => {
  vi.spyOn(client, 'invalidateQueries').mockReset().mockResolvedValue(undefined)
  callAdminAuth.mockReset().mockResolvedValue({})
  uploadToBucket.mockReset().mockResolvedValue({ ok: true, url: 'https://cdn/x' })
  Object.values(admin).forEach(f => { f.mockReset() })
})

describe('slideContent', () => {
  it('joins url, number and total with |||', () => {
    expect(slideContent('u', 2, 5)).toBe('u|||2|||5')
  })
})

describe('startShow', () => {
  it('sends the trimmed title and guestIds, refreshes once and toasts', async () => {
    const { result } = setup()
    expect(await run(() => result.current.startShow({ title: '  Hi  ', guestIds: ['a'] }))).toEqual({ ok: true })
    expect(callAdminAuth.mock.calls).toEqual([['start_live_show', { title: 'Hi', guestIds: ['a'] }]])
    expect(admin.invalidateAdmin).toHaveBeenCalledTimes(1)
    expect(admin.showToast).toHaveBeenCalledWith('Live show started. Its control room is under Currently live.', { type: 'success' })
  })
  it('blank title makes no call', async () => {
    const { result } = setup()
    expect(await run(() => result.current.startShow({ title: '  ', guestIds: [] }))).toEqual({ ok: false, error: 'Add a show title' })
    expect(callAdminAuth).not.toHaveBeenCalled()
  })
  it('server error returns it with no toast and no refresh', async () => {
    callAdminAuth.mockRejectedValueOnce(new Error('nope'))
    const { result } = setup()
    expect(await run(() => result.current.startShow({ title: 'x', guestIds: [] }))).toEqual({ ok: false, error: 'nope' })
    expect(admin.showToast).not.toHaveBeenCalled()
    expect(admin.invalidateAdmin).not.toHaveBeenCalled()
  })
})

describe('scheduleShow', () => {
  const args = { title: ' Show ', scheduledAt: '2026-11-01T10:00', trailerFile: null, guestIds: ['g'] }
  it('without a trailer sends trailerUrl null', async () => {
    const { result } = setup()
    expect(await run(() => result.current.scheduleShow(args))).toEqual({ ok: true })
    expect(callAdminAuth.mock.calls).toEqual([['schedule_show', { title: 'Show', scheduledAt: '2026-11-01T10:00', trailerUrl: null, guestIds: ['g'] }]])
    expect(admin.invalidateAdmin).toHaveBeenCalledTimes(1)
    expect(admin.showToast).toHaveBeenCalledWith('Show scheduled! It will show a countdown to your audience. Tap "Start Now" when you\'re ready to go live.', { type: 'success' })
  })
  it('makes no upload call at all when there is no file', async () => {
    const { result } = setup()
    await run(() => result.current.scheduleShow(args))
    expect(uploadToBucket).not.toHaveBeenCalled()
  })
  it('uploads the trailer with its own type and sends its url', async () => {
    const { result } = setup()
    await run(() => result.current.scheduleShow({ ...args, trailerFile: trailer }))
    expect(uploadToBucket).toHaveBeenCalledWith('live-media', trailer, 'trailer', { contentType: 'video/webm' })
    expect(callAdminAuth).toHaveBeenCalledWith('schedule_show', expect.objectContaining({ trailerUrl: 'https://cdn/x' }))
  })
  it('defaults the trailer content type to video/mp4', async () => {
    const { result } = setup()
    const file = { name: 't.mp4' }
    await run(() => result.current.scheduleShow({ ...args, trailerFile: file }))
    expect(uploadToBucket).toHaveBeenCalledWith('live-media', file, 'trailer', { contentType: 'video/mp4' })
  })
  it('a failed trailer upload makes no server call and does not toast', async () => {
    uploadToBucket.mockResolvedValue({ ok: false, error: 'too big' })
    const { result } = setup()
    expect(await run(() => result.current.scheduleShow({ ...args, trailerFile: trailer }))).toEqual({ ok: false, error: "Couldn't upload the trailer: too big" })
    expect(callAdminAuth.mock.calls).toEqual([])
    expect(admin.showToast).not.toHaveBeenCalled()
    expect(admin.invalidateAdmin).not.toHaveBeenCalled()
  })
  it('guards make no calls', async () => {
    const { result } = setup()
    expect(await run(() => result.current.scheduleShow({ ...args, title: ' ' }))).toEqual({ ok: false, error: 'Add a show title' })
    expect(await run(() => result.current.scheduleShow({ ...args, scheduledAt: '' }))).toEqual({ ok: false, error: 'Pick a date & time for the show' })
    expect(callAdminAuth).not.toHaveBeenCalled()
    expect(uploadToBucket).not.toHaveBeenCalled()
  })
})

describe('start / cancel / end', () => {
  it.each([
    ['startScheduled', 'start_scheduled_show', 'You are now LIVE!'],
    ['cancelScheduled', 'cancel_scheduled_show', 'Scheduled show cancelled'],
    ['endShow', 'end_live_show', 'Live show ended'],
  ])('%s calls %s with { showId } and toasts', async (method, action, toast) => {
    const { result } = setup()
    expect(await run(() => result.current[method]('s1'))).toEqual({ ok: true })
    expect(callAdminAuth.mock.calls).toEqual([[action, { showId: 's1' }]])
    expect(admin.invalidateAdmin).toHaveBeenCalledTimes(1)
    expect(client.invalidateQueries).not.toHaveBeenCalled()
    expect(admin.showToast).toHaveBeenCalledWith(toast, { type: 'success' })
  })
  it('a failure returns the error without toasting', async () => {
    callAdminAuth.mockRejectedValueOnce(new Error('boom'))
    const { result } = setup()
    expect(await run(() => result.current.endShow('s1'))).toEqual({ ok: false, error: 'boom' })
    expect(admin.showToast).not.toHaveBeenCalled()
  })
})

describe('postItem', () => {
  it('empty text and no image makes no call', async () => {
    const { result } = setup()
    expect(await run(() => result.current.postItem({ showId: 's', text: '  ', imageFile: null }))).toEqual({ ok: false, error: 'Write something or add an image' })
    expect(callAdminAuth).not.toHaveBeenCalled()
    expect(uploadToBucket).not.toHaveBeenCalled()
  })
  it('text only posts the trimmed text, no upload, one refresh, no toast', async () => {
    const { result } = setup()
    expect(await run(() => result.current.postItem({ showId: 's', text: ' hi ', imageFile: null }))).toEqual({ ok: true })
    expect(uploadToBucket).not.toHaveBeenCalled()
    expect(callAdminAuth.mock.calls).toEqual([['post_live_item', { showId: 's', kind: 'text', content: 'hi' }]])
    expect(client.invalidateQueries.mock.calls).toEqual([[controlKey('s')]])
    expect(admin.invalidateAdmin).not.toHaveBeenCalled()
    expect(admin.showToast).not.toHaveBeenCalled()
  })
  it('image then text, in that order, with no token', async () => {
    const { result } = setup()
    expect(await run(() => result.current.postItem({ showId: 's', text: 'cap', imageFile: image }))).toEqual({ ok: true })
    expect(uploadToBucket).toHaveBeenCalledWith('live-media', image, 'live-s')
    expect(callAdminAuth.mock.calls).toEqual([
      ['post_live_item', { showId: 's', kind: 'image', content: 'https://cdn/x' }],
      ['post_live_item', { showId: 's', kind: 'text', content: 'cap' }],
    ])
    expect(client.invalidateQueries.mock.calls).toEqual([[controlKey('s')]])
    expect(admin.invalidateAdmin).not.toHaveBeenCalled()
  })
  it('image only posts just the image', async () => {
    const { result } = setup()
    await run(() => result.current.postItem({ showId: 's', text: '', imageFile: image }))
    expect(callAdminAuth.mock.calls).toEqual([['post_live_item', { showId: 's', kind: 'image', content: 'https://cdn/x' }]])
  })
  it('a failed image upload posts nothing, not even the text', async () => {
    uploadToBucket.mockResolvedValue({ ok: false, error: 'bad' })
    const { result } = setup()
    expect(await run(() => result.current.postItem({ showId: 's', text: 'cap', imageFile: image }))).toEqual({ ok: false, error: "Couldn't upload the image: bad" })
    expect(callAdminAuth.mock.calls).toEqual([])
    expect(admin.showToast).not.toHaveBeenCalled()
    expect(admin.invalidateAdmin).not.toHaveBeenCalled()
  })
  it('a non-Error rejection still yields an error string', async () => {
    callAdminAuth.mockRejectedValueOnce('plain string')
    const { result } = setup()
    expect(await run(() => result.current.endShow('a'))).toEqual({ ok: false, error: 'plain string' })
  })
  it('a failed image post stops before the text and is not partial', async () => {
    callAdminAuth.mockRejectedValueOnce(new Error('img fail'))
    const { result } = setup()
    expect(await run(() => result.current.postItem({ showId: 's', text: 'cap', imageFile: image }))).toEqual({ ok: false, error: 'img fail' })
    expect(callAdminAuth).toHaveBeenCalledTimes(1)
    expect(admin.invalidateAdmin).not.toHaveBeenCalled()
  })
  it('image posted but text failed is partial, and the control room is refreshed', async () => {
    callAdminAuth.mockResolvedValueOnce({}).mockRejectedValueOnce(new Error('txt fail'))
    const { result } = setup()
    expect(await run(() => result.current.postItem({ showId: 's', text: 'cap', imageFile: image }))).toEqual({ ok: false, error: 'txt fail', partial: true })
    expect(client.invalidateQueries.mock.calls).toEqual([[controlKey('s')]])
    expect(admin.invalidateAdmin).not.toHaveBeenCalled()
    expect(admin.showToast).not.toHaveBeenCalled()
  })
  it('a text-only failure is not partial', async () => {
    callAdminAuth.mockRejectedValueOnce(new Error('txt fail'))
    const { result } = setup()
    expect(await run(() => result.current.postItem({ showId: 's', text: 'cap', imageFile: null }))).toEqual({ ok: false, error: 'txt fail' })
  })
})

describe('postMedia', () => {
  it.each(['voice', 'video', 'slide'])('posts %s with the content as given', async (kind) => {
    const { result } = setup()
    expect(await run(() => result.current.postMedia({ showId: 's', kind, content: 'c' }))).toEqual({ ok: true })
    expect(callAdminAuth.mock.calls).toEqual([['post_live_item', { showId: 's', kind, content: 'c' }]])
    expect(client.invalidateQueries.mock.calls).toEqual([[controlKey('s')]])
    expect(admin.invalidateAdmin).not.toHaveBeenCalled()
    expect(admin.showToast).not.toHaveBeenCalled()
  })
  it('a failure returns the error', async () => {
    callAdminAuth.mockRejectedValueOnce(new Error('x'))
    const { result } = setup()
    expect(await run(() => result.current.postMedia({ showId: 's', kind: 'voice', content: 'c' }))).toEqual({ ok: false, error: 'x' })
  })
})

describe('hideComment', () => {
  it('sends { id } and refreshes only the show control room when given { showId }', async () => {
    const { result } = setup()
    expect(await run(() => result.current.hideComment('c1', { showId: 's' }))).toEqual({ ok: true })
    expect(callAdminAuth.mock.calls).toEqual([['hide_live_comment', { id: 'c1' }]])
    expect(client.invalidateQueries.mock.calls).toEqual([[controlKey('s')]])
    expect(admin.invalidateAdmin).not.toHaveBeenCalled()
    expect(admin.showToast).not.toHaveBeenCalled()
  })
  it('falls back to refreshing all admin data without a show id', async () => {
    const { result } = setup()
    expect(await run(() => result.current.hideComment('c1'))).toEqual({ ok: true })
    expect(admin.invalidateAdmin).toHaveBeenCalledTimes(1)
    expect(client.invalidateQueries).not.toHaveBeenCalled()
  })
})

describe('after the server succeeded', () => {
  it('a throwing refresh still resolves { ok: true }', async () => {
    admin.invalidateAdmin.mockImplementation(() => { throw new Error('refresh broke') })
    client.invalidateQueries.mockImplementation(() => { throw new Error('refresh broke') })
    const logged = vi.spyOn(console, 'error').mockImplementation(() => {})
    const { result } = setup()
    expect(await run(() => result.current.postMedia({ showId: 's', kind: 'voice', content: 'c' }))).toEqual({ ok: true })
    expect(await run(() => result.current.endShow('s'))).toEqual({ ok: true })
    expect(result.current.busy).toBeNull()
    expect(logged).toHaveBeenCalled()
    logged.mockRestore()
  })
  it('a throwing toast still resolves { ok: true }', async () => {
    admin.showToast.mockImplementation(() => { throw new Error('toast broke') })
    const logged = vi.spyOn(console, 'error').mockImplementation(() => {})
    const { result } = setup()
    expect(await run(() => result.current.startShow({ title: 'x', guestIds: [] }))).toEqual({ ok: true })
    logged.mockRestore()
  })
})

describe('busy', () => {
  it('is the running action name and clears afterwards', async () => {
    let release
    callAdminAuth.mockImplementation(() => new Promise(r => { release = r }))
    const { result } = setup()
    expect(result.current.busy).toBeNull()
    let pending
    act(() => { pending = result.current.endShow('s') })
    expect(result.current.busy).toBe('endShow')
    await act(async () => { release({}); await pending })
    expect(result.current.busy).toBeNull()
  })
  it('covers the upload and clears after a failed one', async () => {
    let release
    uploadToBucket.mockImplementation(() => new Promise(r => { release = r }))
    const { result } = setup()
    let pending
    act(() => { pending = result.current.postItem({ showId: 's', text: '', imageFile: image }) })
    expect(result.current.busy).toBe('postItem')
    await act(async () => { release({ ok: false, error: 'e' }); await pending })
    expect(result.current.busy).toBeNull()
  })
  it('clears after a server failure', async () => {
    callAdminAuth.mockRejectedValueOnce(new Error('x'))
    const { result } = setup()
    await run(() => result.current.hideComment('c'))
    expect(result.current.busy).toBeNull()
  })
})

describe('in-flight guard', () => {
  const deferred = () => { let resolve, reject; const p = new Promise((res, rej) => { resolve = res; reject = rej }); return { p, resolve, reject } }

  it('a second endShow on the same show is refused without a server call', async () => {
    const d = deferred()
    callAdminAuth.mockImplementation(() => d.p)
    const { result } = setup()
    let first, second
    act(() => { first = result.current.endShow('a') })
    await act(async () => { second = await result.current.endShow('a') })
    expect(second).toEqual({ ok: false, error: 'Already running' })
    await act(async () => { d.resolve({}); await first })
    expect(callAdminAuth.mock.calls).toEqual([['end_live_show', { showId: 'a' }]])
  })
  it('endShow on different shows both run', async () => {
    const d = deferred()
    callAdminAuth.mockImplementation(() => d.p)
    const { result } = setup()
    let a, b
    act(() => { a = result.current.endShow('a'); b = result.current.endShow('b') })
    await act(async () => { d.resolve({}); await Promise.all([a, b]) })
    expect(callAdminAuth).toHaveBeenCalledTimes(2)
  })
  it('hideComment runs while a postItem is still in flight', async () => {
    let release
    uploadToBucket.mockImplementation(() => new Promise(r => { release = r }))
    const { result } = setup()
    let post, hide
    act(() => { post = result.current.postItem({ showId: 's', text: '', imageFile: image }) })
    await act(async () => { hide = await result.current.hideComment('c1') })
    expect(hide).toEqual({ ok: true })
    expect(callAdminAuth.mock.calls).toEqual([['hide_live_comment', { id: 'c1' }]])
    await act(async () => { release({ ok: true, url: 'u' }); await post })
  })
  it('isBusy is true while running and false after, including after a failure', async () => {
    let release
    callAdminAuth.mockImplementation(() => new Promise(r => { release = r }))
    const { result } = setup()
    let p
    act(() => { p = result.current.endShow('a') })
    expect(result.current.isBusy('endShow', 'a')).toBe(true)
    expect(result.current.isBusy('endShow', 'b')).toBe(false)
    expect(result.current.busyKeys).toEqual(['endShow:a'])
    await act(async () => { release({}); await p })
    expect(result.current.isBusy('endShow', 'a')).toBe(false)
    callAdminAuth.mockReset().mockRejectedValueOnce(new Error('x'))
    await run(() => result.current.endShow('a'))
    expect(result.current.isBusy('endShow', 'a')).toBe(false)
    expect(result.current.busyKeys).toEqual([])
  })
  it('the key is released after a failure so the action can run again', async () => {
    callAdminAuth.mockRejectedValueOnce(new Error('x'))
    const { result } = setup()
    await run(() => result.current.endShow('a'))
    expect(await run(() => result.current.endShow('a'))).toEqual({ ok: true })
  })

  it('two different media items on one show both post; only a true duplicate is refused', async () => {
    const d = deferred()
    callAdminAuth.mockImplementation(() => d.p)
    const { result } = setup()
    let a, b, dup
    act(() => {
      a = result.current.postMedia({ showId: 's', kind: 'voice', content: 'u1' })
      b = result.current.postMedia({ showId: 's', kind: 'voice', content: 'u2' })
    })
    await act(async () => { dup = await result.current.postMedia({ showId: 's', kind: 'voice', content: 'u1' }) })
    expect(dup).toEqual({ ok: false, error: 'Already running' })
    await act(async () => { d.resolve({}); await Promise.all([a, b]) })
    expect(callAdminAuth.mock.calls).toEqual([
      ['post_live_item', { showId: 's', kind: 'voice', content: 'u1' }],
      ['post_live_item', { showId: 's', kind: 'voice', content: 'u2' }],
    ])
  })
})

describe('the guard is held until the refresh has landed', () => {
  const deferred = () => { let resolve, reject; const p = new Promise((res, rej) => { resolve = res; reject = rej }); return { p, resolve, reject } }

  it('a second endShow during the refresh is refused, and the guard is released afterwards', async () => {
    const refresh = deferred()
    admin.invalidateAdmin.mockImplementation(() => refresh.p)
    const { result } = setup()
    let first, second
    act(() => { first = result.current.endShow('a') })
    await act(async () => { await Promise.resolve(); await Promise.resolve() })
    expect(admin.invalidateAdmin).toHaveBeenCalledTimes(1)
    expect(result.current.isBusy('endShow', 'a')).toBe(true)
    await act(async () => { second = await result.current.endShow('a') })
    expect(second).toEqual({ ok: false, error: 'Already running' })
    expect(callAdminAuth).toHaveBeenCalledTimes(1)
    await act(async () => { refresh.resolve(); await first })
    expect(result.current.isBusy('endShow', 'a')).toBe(false)
    expect(await run(() => result.current.endShow('a'))).toEqual({ ok: true })
  })
  it('a rejecting refresh still resolves { ok: true } and releases the guard', async () => {
    admin.invalidateAdmin.mockImplementation(() => Promise.reject(new Error('refresh broke')))
    const logged = vi.spyOn(console, 'error').mockImplementation(() => {})
    const { result } = setup()
    expect(await run(() => result.current.startScheduled('s'))).toEqual({ ok: true })
    expect(result.current.busyKeys).toEqual([])
    expect(logged).toHaveBeenCalled()
    logged.mockRestore()
  })
})
