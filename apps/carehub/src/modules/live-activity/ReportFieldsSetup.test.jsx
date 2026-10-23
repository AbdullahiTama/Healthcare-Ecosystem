import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { createRoot } from 'react-dom/client'
import { act } from 'react'

// What a visit report asks for, decided by the owner. Standalone so it can be its own Field team page.

globalThis.IS_REACT_ACT_ENVIRONMENT = true

vi.mock('./repositories', () => ({
  liveActivityRepository: { getActivityFields: vi.fn(), addActivityField: vi.fn(), deleteActivityField: vi.fn() },
}))

import ReportFieldsSetup from './ReportFieldsSetup.jsx'
import { liveActivityRepository as repo } from './repositories'

let root, host
const flush = () => act(async () => { await new Promise((r) => setTimeout(r, 0)) })
const button = (text) => [...host.querySelectorAll('button')].find((b) => b.textContent.trim() === text)
const setValue = async (el, value) => {
  const proto = el.tagName === 'SELECT' ? HTMLSelectElement.prototype : HTMLInputElement.prototype
  const setter = Object.getOwnPropertyDescriptor(proto, 'value').set
  await act(async () => { setter.call(el, value); el.dispatchEvent(new Event(el.tagName === 'SELECT' ? 'change' : 'input', { bubbles: true })) })
}
const show = async (props = {}) => { await act(async () => { root.render(<ReportFieldsSetup businessId='biz-1' {...props} />) }); await flush() }

beforeEach(() => {
  vi.clearAllMocks()
  repo.getActivityFields.mockResolvedValue([{ id: 'f1', label: 'Customer', field_type: 'text', required: true, sort_order: 0 }])
  repo.addActivityField.mockResolvedValue([{ id: 'f2' }])
  repo.deleteActivityField.mockResolvedValue(null)
  host = document.createElement('div')
  document.body.appendChild(host)
  root = createRoot(host)
})
afterEach(() => { act(() => root.unmount()); host.remove() })

describe('ReportFieldsSetup', () => {
  it('shows a loading state, then the company\'s fields', async () => {
    let release
    repo.getActivityFields.mockImplementation(() => new Promise((r) => { release = () => r([{ id: 'f1', label: 'Customer', field_type: 'text', required: true }]) }))
    await act(async () => { root.render(<ReportFieldsSetup businessId='biz-1' />) })
    expect(host.textContent).toMatch(/loading/i)
    await act(async () => { release() })
    await flush()
    expect(host.textContent).toContain('Customer *')
    expect(repo.getActivityFields).toHaveBeenCalledWith('biz-1')
  })

  it('an empty list says reps get one simple note until fields are added', async () => {
    repo.getActivityFields.mockResolvedValue([])
    await show()
    expect(host.textContent).toMatch(/no fields yet/i)
  })

  it('a failed load shows the reason and Try again loads again', async () => {
    repo.getActivityFields.mockRejectedValueOnce(new Error('offline')).mockResolvedValueOnce([])
    await show()
    expect(host.querySelector('[role="alert"]').textContent).toContain('offline')
    await act(async () => { button('Try again').click() })
    await flush()
    expect(repo.getActivityFields).toHaveBeenCalledTimes(2)
  })

  it('adding a field sends the trimmed name, type, required flag and position, then reloads and tells the parent', async () => {
    const onChanged = vi.fn()
    await show({ onChanged })
    await setValue(host.querySelector('input[placeholder^="Field name"]'), '  Outcome  ')
    await setValue(host.querySelector('select'), 'choice')
    await setValue(host.querySelector('input[placeholder^="Options"]'), 'Sold, Follow-up')
    await act(async () => { host.querySelector('input[type="checkbox"]').click() })
    await act(async () => { button('Add Field').click() })
    await flush()
    expect(repo.addActivityField).toHaveBeenCalledWith({ business_id: 'biz-1', label: 'Outcome', field_type: 'choice', required: true, options: 'Sold, Follow-up', sort_order: 1 })
    expect(repo.getActivityFields).toHaveBeenCalledTimes(2)
    expect(onChanged).toHaveBeenCalled()
  })

  it('a field needs a name: nothing is sent and the person is told', async () => {
    await show()
    await act(async () => { button('Add Field').click() })
    await flush()
    expect(repo.addActivityField).not.toHaveBeenCalled()
    expect(host.textContent).toMatch(/give the field a name/i)
  })

  it('options are only sent for a choice field', async () => {
    await show()
    await setValue(host.querySelector('input[placeholder^="Field name"]'), 'Notes')
    await act(async () => { button('Add Field').click() })
    await flush()
    expect(repo.addActivityField.mock.calls[0][0].options).toBeNull()
  })

  it('removing asks first, then deletes and reloads', async () => {
    const onChanged = vi.fn()
    await show({ onChanged })
    await act(async () => { button('Remove').click() })
    expect(repo.deleteActivityField).not.toHaveBeenCalled()
    await act(async () => { button('Remove Field').click() })
    await flush()
    expect(repo.deleteActivityField).toHaveBeenCalledWith('f1')
    expect(onChanged).toHaveBeenCalled()
  })

  it('a failed add says why and keeps what was typed', async () => {
    repo.addActivityField.mockRejectedValue(new Error('permission denied'))
    await show()
    const name = host.querySelector('input[placeholder^="Field name"]')
    await setValue(name, 'Outcome')
    await act(async () => { button('Add Field').click() })
    await flush()
    expect(host.textContent).toContain('permission denied')
    expect(name.value).toBe('Outcome')
  })
})
