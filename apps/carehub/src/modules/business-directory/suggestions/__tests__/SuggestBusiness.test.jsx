import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { createRoot } from 'react-dom/client'
import { act } from 'react'
import SuggestBusiness from '../SuggestBusiness.jsx'

// A rep tells the CareHub team about a business the directory does not know. The suggestion is separate from the
// visit report and changes nothing about it.

globalThis.IS_REACT_ACT_ENVIRONMENT = true

let root, host, repo
const flush = () => act(async () => { await new Promise((r) => setTimeout(r, 0)) })
const button = (text) => [...host.querySelectorAll('button')].find((b) => b.textContent.trim() === text)
const field = (label) => host.querySelector(`[aria-label="${label}"]`)
const setValue = async (el, value) => {
  const proto = el.tagName === 'SELECT' ? HTMLSelectElement.prototype : el.tagName === 'TEXTAREA' ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype
  await act(async () => { Object.getOwnPropertyDescriptor(proto, 'value').set.call(el, value); el.dispatchEvent(new Event(el.tagName === 'SELECT' ? 'change' : 'input', { bubbles: true })) })
}
const GPS = { lat: 6.6, lng: 3.35, accuracy: 12 }
async function show(props = {}) {
  const onClose = vi.fn(); const onSent = vi.fn()
  await act(async () => { root.render(<SuggestBusiness businessId='biz-1' gps={GPS} areaLabel='Allen Avenue, Ikeja' onClose={onClose} onSent={onSent} repo={repo} {...props} />) })
  return { onClose, onSent }
}
async function fillAndSend() {
  await setValue(field('Business name'), 'Kemi Stores')
  await setValue(field('Type'), 'retail')
  await act(async () => { button('Send suggestion').click() })
  await flush()
}

beforeEach(() => {
  repo = { create: vi.fn(async () => ({ id: 's1', status: 'pending' })) }
  Object.defineProperty(globalThis.navigator, 'onLine', { configurable: true, get: () => true })
  host = document.createElement('div')
  document.body.appendChild(host)
  root = createRoot(host)
})
afterEach(() => { act(() => root.unmount()); host.remove() })

describe('SuggestBusiness', () => {
  it('pre-fills the address with the area caption and sends the suggestion with the current position', async () => {
    const { onSent } = await show()
    expect(field('Address').value).toBe('Allen Avenue, Ikeja')
    await setValue(field('Note'), 'by the junction')
    await fillAndSend()
    expect(repo.create).toHaveBeenCalledWith('biz-1', { name: 'Kemi Stores', business_type: 'retail', address: 'Allen Avenue, Ikeja', latitude: 6.6, longitude: 3.35, note: 'by the junction' })
    expect(host.textContent).toContain('Thanks. The CareHub team will review it.')
    expect(onSent).toHaveBeenCalled()
  })

  it('needs a name of at least 2 letters and a type before it sends', async () => {
    await show()
    await setValue(field('Business name'), 'K')
    await act(async () => { button('Send suggestion').click() })
    expect(repo.create).not.toHaveBeenCalled()
    expect(host.textContent).toContain('Enter the business name.')
    await setValue(field('Business name'), 'Kemi')
    await act(async () => { button('Send suggestion').click() })
    expect(repo.create).not.toHaveBeenCalled()
    expect(host.textContent).toContain('Choose what kind of business it is.')
  })

  it('without a position it says one is needed and offers no send', async () => {
    await show({ gps: null })
    expect(host.textContent).toContain('Your position is needed to suggest a business.')
    expect(button('Send suggestion')).toBeUndefined()
  })

  it('the daily cap is explained in plain words, and the form is kept', async () => {
    repo.create.mockRejectedValue(Object.assign(new Error('Too many suggestions today'), { code: 'TOO_MANY' }))
    await show()
    await fillAndSend()
    expect(host.textContent).toContain('You have sent many suggestions today. Try again tomorrow.')
    expect(field('Business name').value).toBe('Kemi Stores')
  })

  it('another failure shows its message and keeps the form', async () => {
    repo.create.mockRejectedValue(new Error('timeout'))
    await show()
    await fillAndSend()
    expect(host.textContent).toContain('The suggestion was not sent: timeout')
    expect(field('Business name').value).toBe('Kemi Stores')
  })

  it('offline it says a connection is needed and sends nothing', async () => {
    Object.defineProperty(globalThis.navigator, 'onLine', { configurable: true, get: () => false })
    await show()
    await fillAndSend()
    expect(repo.create).not.toHaveBeenCalled()
    expect(host.textContent).toContain('Suggesting a business needs a connection.')
  })

  it('Cancel closes it', async () => {
    const { onClose } = await show()
    await act(async () => { button('Cancel').click() })
    expect(onClose).toHaveBeenCalled()
  })
})
