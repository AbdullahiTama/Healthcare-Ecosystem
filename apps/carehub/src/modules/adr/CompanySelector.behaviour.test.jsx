// The facility ADR form's company picker: facilities reported they could not select the manufacturer / importer.
// The list stayed empty until a name was typed and Search pressed. It now lists the registered companies at once,
// starting from the manufacturer typed on the product, and follows what is typed.
import { describe, it, expect, vi, afterEach } from 'vitest'
import { createRoot } from 'react-dom/client'
import { act } from 'react'

globalThis.IS_REACT_ACT_ENVIRONMENT = true

vi.mock('../../components/ui', () => ({
  Button: ({ children, variant: _v, size: _s, ...props }) => <button type="button" {...props}>{children}</button>,
  Input: ({ label, value, onChange, ...props }) => (
    <label>{label}<input value={value || ''} onChange={(e) => onChange && onChange(e.target.value)} {...props} /></label>
  ),
}))

import CompanySelector, { SEARCH_DEBOUNCE_MS } from './CompanySelector.jsx'

const COMPANIES = [
  { business_id: 'b1', business_name: 'Beecham Nigeria', city: 'Lagos', state: 'Lagos' },
  { business_id: 'b2', business_name: 'Fidson Healthcare', city: 'Ota', state: 'Ogun' },
]
const base = { kind: 'unknown', businessId: '', businessName: '', candidateName: '' }

let root, host
afterEach(async () => { if (root) await act(async () => root.unmount()); host?.remove(); vi.useRealTimers() })

async function mount(props) {
  host = document.createElement('div')
  document.body.appendChild(host)
  root = createRoot(host)
  await act(async () => { root.render(<CompanySelector onChange={() => {}} {...props} />) })
}
async function rerender(props) { await act(async () => { root.render(<CompanySelector onChange={() => {}} {...props} />) }) }
const wait = () => act(async () => { vi.advanceTimersByTime(SEARCH_DEBOUNCE_MS + 10); await Promise.resolve() })
const options = () => [...host.querySelectorAll('ul[aria-label="Matching companies"] button')].map((b) => b.textContent)
const searchBox = () => host.querySelector('input[aria-label="Search registered companies"]')
function type(value) {
  const el = searchBox()
  Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(el, value)
  el.dispatchEvent(new Event('input', { bubbles: true }))
}

describe('CompanySelector lists registered companies straight away', () => {
  it('shows every registered company as soon as "Select the company" is chosen', async () => {
    vi.useFakeTimers()
    const search = vi.fn(async () => COMPANIES)
    await mount({ value: { ...base, kind: 'verified' }, searchCompanies: search })
    await wait()
    expect(search).toHaveBeenCalledWith('', 20)
    expect(options()).toEqual(['Beecham NigeriaLagos, Lagos', 'Fidson HealthcareOta, Ogun'])
  })

  it('starts from the manufacturer typed on the product', async () => {
    vi.useFakeTimers()
    const search = vi.fn(async (q) => COMPANIES.filter((c) => c.business_name.toLowerCase().includes(q.toLowerCase())))
    await mount({ value: { ...base, kind: 'verified' }, searchCompanies: search, suggestedQuery: ' Fidson ' })
    await wait()
    expect(searchBox().value).toBe('Fidson')
    expect(search).toHaveBeenLastCalledWith('Fidson', 20)
    expect(options()).toEqual(['Fidson HealthcareOta, Ogun'])
  })

  it('filters as you type (one search per pause), and Enter searches at once without submitting anything', async () => {
    vi.useFakeTimers()
    const search = vi.fn(async (q) => COMPANIES.filter((c) => c.business_name.toLowerCase().includes(q.toLowerCase())))
    await mount({ value: { ...base, kind: 'verified' }, searchCompanies: search })
    await wait()
    search.mockClear()
    await act(async () => { type('B'); type('Be'); type('Bee') })
    await wait()
    expect(search).toHaveBeenCalledTimes(1)
    expect(search).toHaveBeenCalledWith('Bee', 20)
    expect(options()).toEqual(['Beecham NigeriaLagos, Lagos'])

    const e = new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true })
    await act(async () => { searchBox().dispatchEvent(e); await Promise.resolve() })
    expect(e.defaultPrevented).toBe(true)
    expect(search).toHaveBeenLastCalledWith('Bee', 20)
  })

  it('picking a company reports its id and name', async () => {
    vi.useFakeTimers()
    const onChange = vi.fn()
    await mount({ value: { ...base, kind: 'verified' }, searchCompanies: vi.fn(async () => COMPANIES), onChange })
    await wait()
    await act(async () => { host.querySelectorAll('ul[aria-label="Matching companies"] button')[1].click() })
    expect(onChange).toHaveBeenCalledWith({ kind: 'verified', businessId: 'b2', businessName: 'Fidson Healthcare', candidateName: '' })
  })

  it('a slow earlier reply never replaces a newer list', async () => {
    vi.useFakeTimers()
    let releaseFirst
    const search = vi.fn((q) => q === '' ? new Promise((r) => { releaseFirst = () => r(COMPANIES) }) : Promise.resolve([COMPANIES[1]]))
    await mount({ value: { ...base, kind: 'verified' }, searchCompanies: search })
    await wait()
    await act(async () => { type('Fid') })
    await wait()
    await act(async () => { releaseFirst(); await Promise.resolve() })
    expect(options()).toEqual(['Fidson HealthcareOta, Ogun'])
  })

  it('says when nothing matches, and when no company is registered', async () => {
    vi.useFakeTimers()
    await mount({ value: { ...base, kind: 'verified' }, searchCompanies: vi.fn(async () => []) })
    await wait()
    expect(host.textContent).toContain('No manufacturer or importer is registered yet')
    await act(async () => { type('zzz') })
    await wait()
    expect(host.textContent).toContain('No registered company matches')
  })

  it('a failed search says so and offers the typed-name option', async () => {
    vi.useFakeTimers()
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    await mount({ value: { ...base, kind: 'verified' }, searchCompanies: vi.fn(async () => { throw new Error('offline') }) })
    await wait()
    expect(host.querySelector('[role="alert"]').textContent).toContain('Company search is unavailable')
    warn.mockRestore()
  })

  it('does not search while "I don\'t know" is chosen or the report is locked', async () => {
    vi.useFakeTimers()
    const search = vi.fn(async () => COMPANIES)
    await mount({ value: base, searchCompanies: search })
    await wait()
    await rerender({ value: { ...base, kind: 'verified' }, searchCompanies: search, disabled: true })
    await wait()
    expect(search).not.toHaveBeenCalled()
  })

  it('explains where the report goes, and the group is labelled for screen readers', async () => {
    await mount({ value: base, searchCompanies: vi.fn(async () => []) })
    const group = host.querySelector('[role="group"]')
    expect(document.getElementById(group.getAttribute('aria-labelledby')).textContent).toContain('Company responsible')
    expect(document.getElementById(group.getAttribute('aria-describedby')).textContent)
      .toContain('When you submit, the report is sent to the registered manufacturer or importer you select here')
  })
})
