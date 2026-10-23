import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { createRoot } from 'react-dom/client'
import { act, useState } from 'react'
import PhotoAttach from './PhotoAttach.jsx'

globalThis.IS_REACT_ACT_ENVIRONMENT = true

let root, host, prepare, changes
const flush = () => act(async () => { await new Promise((r) => setTimeout(r, 0)) })
const button = (text) => [...host.querySelectorAll('button')].find((b) => b.textContent.trim().includes(text))
const input = () => host.querySelector('input[type="file"]')

// A parent that owns the list, as the report form does.
function Harness({ initial = [], max }) {
  const [photos, setPhotos] = useState(initial)
  changes.push(photos)
  return <PhotoAttach photos={photos} onChange={setPhotos} prepare={prepare} max={max} />
}
const mount = async (props) => { await act(async () => { root.render(<Harness {...props} />) }); await flush() }
async function choose(...files) {
  Object.defineProperty(input(), 'files', { configurable: true, value: files })
  await act(async () => { input().dispatchEvent(new Event('change', { bubbles: true })) })
  await flush()
}
const jpeg = () => ({ ok: true, blob: new Blob(['x'], { type: 'image/jpeg' }) })

beforeEach(() => {
  changes = []
  prepare = vi.fn(async () => jpeg())
  URL.createObjectURL = vi.fn(() => 'blob:thumb')
  URL.revokeObjectURL = vi.fn()
  host = document.createElement('div')
  document.body.appendChild(host)
  root = createRoot(host)
})
afterEach(() => { act(() => root.unmount()); host.remove() })

describe('PhotoAttach', () => {
  it('starts with an Add photo button and no thumbnails', async () => {
    await mount()
    expect(button('Add photo')).toBeTruthy()
    expect(host.querySelectorAll('img')).toHaveLength(0)
  })

  it('the file field takes images only and is not shown (the button is the control)', async () => {
    await mount()
    expect(input().getAttribute('accept')).toBe('image/*')
    expect(input().hidden).toBe(true)
  })

  it('Add photo opens the file chooser from the keyboard-reachable button', async () => {
    await mount()
    const click = vi.spyOn(input(), 'click')
    await act(async () => { button('Add photo').click() })
    expect(click).toHaveBeenCalled()
    expect(button('Add photo').tagName).toBe('BUTTON')
  })

  it('a chosen photo is prepared, then shown with a Remove button that has an accessible name', async () => {
    await mount()
    await choose({ name: 'a.jpg' })
    expect(prepare).toHaveBeenCalledTimes(1)
    expect(host.querySelectorAll('img')).toHaveLength(1)
    expect(host.querySelector('img').getAttribute('alt')).toBe('Photo 1 of this report')
    expect(host.querySelector('button[aria-label="Remove photo 1"]')).toBeTruthy()
  })

  it('Remove takes the photo out and frees its preview', async () => {
    await mount()
    await choose({ name: 'a.jpg' })
    await act(async () => { host.querySelector('button[aria-label="Remove photo 1"]').click() })
    expect(host.querySelectorAll('img')).toHaveLength(0)
    expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:thumb')
  })

  it('up to three photos; then Add photo is disabled and says why', async () => {
    await mount()
    await choose({ name: '1' }, { name: '2' }, { name: '3' })
    expect(host.querySelectorAll('img')).toHaveLength(3)
    expect(button('Add photo').disabled).toBe(true)
    expect(host.textContent).toMatch(/up to 3 photos/i)
  })

  it('choosing more than fit keeps the first ones and says the rest were skipped', async () => {
    await mount({ initial: [{ key: 'k1', blob: new Blob(['x']) }, { key: 'k2', blob: new Blob(['x']) }] })
    await choose({ name: 'a' }, { name: 'b' })
    expect(host.querySelectorAll('img')).toHaveLength(3)
    expect(prepare).toHaveBeenCalledTimes(1)
    expect(host.querySelector('[role="alert"]').textContent).toMatch(/only 3 photos fit/i)
  })

  it.each([
    ['not_image', /not a photo/i],
    ['too_large', /too large/i],
    ['decode_failed', /could not prepare/i],
  ])('a photo refused as %s is explained in plain words in an alert, and nothing is added', async (reason, text) => {
    prepare.mockResolvedValue({ ok: false, reason })
    await mount()
    await choose({ name: 'bad' })
    expect(host.querySelector('[role="alert"]').textContent).toMatch(text)
    expect(host.querySelectorAll('img')).toHaveLength(0)
  })

  it('shows that it is working while a photo is being prepared', async () => {
    let release
    prepare.mockImplementation(() => new Promise((r) => { release = () => r(jpeg()) }))
    await mount()
    Object.defineProperty(input(), 'files', { configurable: true, value: [{ name: 'a' }] })
    await act(async () => { input().dispatchEvent(new Event('change', { bubbles: true })) })
    expect(host.textContent).toMatch(/preparing photo/i)
    expect(button('Preparing').disabled).toBe(true)
    await act(async () => { release() })
    await flush()
    expect(host.textContent).not.toMatch(/preparing photo/i)
  })

  it('the file field is cleared after each choice so the same photo can be picked again', async () => {
    await mount()
    await choose({ name: 'a' })
    expect(input().value).toBe('')
  })

  it('a prepare function that throws is reported, not crashed on', async () => {
    prepare.mockRejectedValue(new Error('boom'))
    await mount()
    await choose({ name: 'a' })
    expect(host.querySelector('[role="alert"]').textContent).toMatch(/could not prepare/i)
  })

  it('can be switched off while a report is being saved', async () => {
    await act(async () => { root.render(<PhotoAttach photos={[{ key: 'k', blob: new Blob(['x']) }]} onChange={() => {}} prepare={prepare} disabled />) })
    expect(button('Add photo').disabled).toBe(true)
    expect(host.querySelector('button[aria-label="Remove photo 1"]').disabled).toBe(true)
  })
})
