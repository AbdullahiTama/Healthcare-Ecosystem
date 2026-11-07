// The sign-up form for a pharmaceutical importer / manufacturer: the type is offered, the operating model must be chosen,
// and the choice is sent with the registration (docs/architecture/Importer-Operating-Models.md).
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { createRoot } from 'react-dom/client'
import { act } from 'react'
import { MemoryRouter } from 'react-router-dom'

globalThis.IS_REACT_ACT_ENVIRONMENT = true

const h = vi.hoisted(() => ({ registerBusiness: vi.fn() }))
vi.mock('../../../services/supabase', () => ({ registerBusiness: (...a) => h.registerBusiness(...a) }))

import Register from '../Register.jsx'

let host, root
const flush = () => act(async () => { await new Promise((r) => setTimeout(r, 0)) })
const text = () => document.body.textContent
const btn = (re) => [...document.body.querySelectorAll('button')].find((b) => re.test(b.textContent.trim()))
const click = async (el) => { await act(async () => { el.click() }); await flush() }
const fill = async (label, v) => {
  const el = [...document.body.querySelectorAll('input, select')].find((i) => i.id && document.querySelector(`label[for="${i.id}"]`)?.textContent.replace('*', '').trim() === label)
  if (!el) throw new Error('no field ' + label)
  const proto = el.tagName === 'SELECT' ? HTMLSelectElement.prototype : HTMLInputElement.prototype
  await act(async () => { Object.getOwnPropertyDescriptor(proto, 'value').set.call(el, v); el.dispatchEvent(new Event(el.tagName === 'SELECT' ? 'change' : 'input', { bubbles: true })) })
}

beforeEach(() => {
  vi.clearAllMocks()
  h.registerBusiness.mockResolvedValue({ ok: true })
  vi.spyOn(globalThis, 'fetch').mockResolvedValue({ ok: true, json: async () => ({}) })
  host = document.createElement('div'); document.body.appendChild(host); root = createRoot(host)
})
afterEach(async () => { await act(async () => root.unmount()); host.remove(); vi.restoreAllMocks() })

describe('Register: Manufacturer / Importer', () => {
  it('offers the type, requires an operating model, and sends the choice', async () => {
    await act(async () => { root.render(<MemoryRouter><Register /></MemoryRouter>) })
    await click(btn(/^Manufacturer \/ Importer$/))

    await fill('Business Name', 'Zenith Pharma Ltd')
    await fill('State', 'Lagos')
    await fill('Full Business Address', '1 Allen Avenue')
    await fill('Business Phone', '08000000000')
    await fill('Business Email', 'info@zenith.test')
    expect(text()).toContain('How do your representatives work?')
    expect(btn(/^Continue/).disabled).toBe(true) // no model chosen yet

    await act(async () => { document.querySelector('input[name="operating-model"][value="decentralised"]').click() })
    expect(btn(/^Continue/).disabled).toBe(false)
    await click(btn(/^Continue/))

    await fill('WhatsApp Number', '08000000000')
    await fill('Business Hours', 'Mon-Fri 8am-6pm')
    await click(btn(/^Continue/))
    await fill('First Name', 'Ada')
    await fill('Last Name', 'Obi')
    await fill('Your Email (used to log in)', 'Ada@Zenith.test')
    await fill('Your Phone', '08000000001')
    await click(btn(/^Continue/))
    await act(async () => { [...document.querySelectorAll('input[type=checkbox]')].forEach((c) => c.click()) }) // no referrer + terms
    await click(btn(/^Continue/))

    expect(text()).toMatch(/Operating model\s*Decentralised/)
    await click(btn(/Submit registration/))
    expect(h.registerBusiness).toHaveBeenCalledWith(expect.objectContaining({
      business_type: 'manufacturer_importer', operating_model: 'decentralised', email: 'ada@zenith.test',
    }))
  })

  it('does not ask other business types about representatives, Wholesale / Distributor included', async () => {
    await act(async () => { root.render(<MemoryRouter><Register /></MemoryRouter>) })
    await click(btn(/^Pharmacies$/))
    expect(text()).not.toContain('How do your representatives work?')
    await act(async () => root.unmount())
    root = createRoot(host)
    await act(async () => { root.render(<MemoryRouter><Register /></MemoryRouter>) })
    await click(btn(/^Wholesale \/ Distributor$/))
    expect(text()).toContain('Business Information')
    expect(text()).not.toContain('How do your representatives work?')
  })
})
