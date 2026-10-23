import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { createRoot } from 'react-dom/client'
import { act } from 'react'
import PhotoThumbs from './PhotoThumbs.jsx'

globalThis.IS_REACT_ACT_ENVIRONMENT = true

let root, host
const flush = () => act(async () => { await new Promise((r) => setTimeout(r, 0)) })
const button = (text) => [...host.querySelectorAll('button')].find((b) => b.textContent.trim().includes(text))
const deferred = () => { let resolve, reject; const promise = new Promise((a, b) => { resolve = a; reject = b }); return { promise, resolve, reject } }
async function show(props) {
  await act(async () => { root.render(<PhotoThumbs {...props} />) })
  await flush()
}

beforeEach(() => {
  host = document.createElement('div')
  document.body.appendChild(host)
  root = createRoot(host)
})
afterEach(() => { act(() => root.unmount()); host.remove() })

describe('PhotoThumbs', () => {
  it('shows nothing for a report with no photos', async () => {
    await show({ paths: [], resolve: vi.fn() })
    expect(host.innerHTML).toBe('')
    await show({ paths: undefined, resolve: vi.fn() })
    expect(host.innerHTML).toBe('')
  })

  it('shows a loading placeholder, then the photo from its signed link, with alt text naming the place', async () => {
    const d = deferred()
    const resolve = vi.fn(() => d.promise)
    await show({ paths: ['b/a-0.jpg'], resolve, label: 'Lagos General' })
    expect(resolve).toHaveBeenCalledWith('b/a-0.jpg')
    expect(host.querySelector('[aria-busy="true"]')).toBeTruthy()
    expect(host.querySelectorAll('img')).toHaveLength(0)
    await act(async () => { d.resolve('https://signed/a0') })
    await flush()
    const img = host.querySelector('img')
    expect(img.getAttribute('src')).toBe('https://signed/a0')
    expect(img.getAttribute('alt')).toBe('Photo 1 of Lagos General')
    expect(host.querySelector('[aria-busy="true"]')).toBeNull()
  })

  it('without a place name the alt text still says what the photo is', async () => {
    await show({ paths: ['p'], resolve: vi.fn(async () => 'https://signed') })
    expect(host.querySelector('img').getAttribute('alt')).toBe('Photo 1 of this report')
  })

  it('asks for each photo once, and only the photos that exist', async () => {
    const resolve = vi.fn(async (p) => 'https://signed/' + p)
    await show({ paths: ['a', 'b', 'c'], resolve })
    expect(resolve).toHaveBeenCalledTimes(3)
    expect(host.querySelectorAll('img')).toHaveLength(3)
  })

  it('a photo that cannot be opened says so, and Try again asks again', async () => {
    const resolve = vi.fn().mockResolvedValueOnce(null).mockResolvedValueOnce('https://signed/ok')
    await show({ paths: ['p'], resolve })
    expect(host.textContent).toMatch(/photo unavailable/i)
    expect(host.querySelectorAll('img')).toHaveLength(0)
    await act(async () => { button('Try again').click() })
    await flush()
    expect(resolve).toHaveBeenCalledTimes(2)
    expect(host.querySelector('img').getAttribute('src')).toBe('https://signed/ok')
  })

  it('a resolver that throws is the same as unavailable, not a crash', async () => {
    await show({ paths: ['p'], resolve: vi.fn(async () => { throw new Error('boom') }) })
    expect(host.textContent).toMatch(/photo unavailable/i)
  })

  it('a link that fails to load as an image becomes unavailable too', async () => {
    await show({ paths: ['p'], resolve: vi.fn(async () => 'https://signed/expired') })
    await act(async () => { host.querySelector('img').dispatchEvent(new Event('error')) })
    expect(host.textContent).toMatch(/photo unavailable/i)
  })

  it('a photo can be enlarged, with a named control, and closed again', async () => {
    await show({ paths: ['p'], resolve: vi.fn(async () => 'https://signed/big'), label: 'Lagos General' })
    const open = host.querySelector('button[aria-label="Enlarge photo 1 of Lagos General"]')
    expect(open).toBeTruthy()
    await act(async () => { open.click() })
    const dialog = document.querySelector('[role="dialog"]')
    expect(dialog).toBeTruthy()
    expect(dialog.querySelector('img').getAttribute('src')).toBe('https://signed/big')
    await act(async () => { [...dialog.querySelectorAll('button')].find((b) => /close/i.test(b.textContent + (b.getAttribute('aria-label') || ''))).click() })
    expect(document.querySelector('[role="dialog"]')).toBeNull()
  })
})
