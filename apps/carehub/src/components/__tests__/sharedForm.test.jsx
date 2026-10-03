import React from 'react'
import { createRoot } from 'react-dom/client'
import { act } from 'react-dom/test-utils'
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { Input, Select, Textarea, Toggle, Label, HelperText, ErrorMessage } from '@care-ecosystem/design-system/components/ui'
import { theme } from '@care-ecosystem/design-system'

// jsdom serializes hex colors to rgb() — compare against that form.
const rgb = (hex) => {
  const n = parseInt(hex.slice(1), 16)
  return `rgb(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255})`
}

describe('design-system form primitives', () => {
  let host
  let root

  beforeEach(() => {
    host = document.createElement('div')
    document.body.appendChild(host)
    root = createRoot(host)
  })

  afterEach(async () => {
    await act(async () => { root.unmount() })
    host.remove()
  })

  it('Input links its label to the field and reports a string on change', async () => {
    let value = ''
    await act(async () => { root.render(<Input label="Patient name" value={value} onChange={(v) => { value = v }} />) })
    const input = host.querySelector('input')
    expect(host.querySelector('label').getAttribute('for')).toBe('patient-name')
    expect(input.id).toBe('patient-name')
    const inputSetter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set
    await act(async () => {
      inputSetter.call(input, 'Zuri')
      input.dispatchEvent(new Event('input', { bubbles: true }))
    })
    expect(value).toBe('Zuri')
  })

  it('Input shows the required marker and an accessible error message', async () => {
    await act(async () => { root.render(<Input label="Phone" required error="A phone number is required" />) })
    const input = host.querySelector('input')
    expect(input.getAttribute('aria-invalid')).toBe('true')
    expect(input.getAttribute('aria-describedby')).toBe('phone-error')
    expect(host.querySelector('#phone-error').textContent).toBe('A phone number is required')
    expect(input.style.border).toContain(rgb(theme.danger))
    expect(host.textContent).toContain('*')
  })

  it('Input renders helper text (not the error) and wires aria-describedby to it', async () => {
    await act(async () => { root.render(<Input label="Email" helperText="We never share this." />) })
    const input = host.querySelector('input')
    expect(input.getAttribute('aria-describedby')).toBe('email-help')
    expect(host.querySelector('#email-help').textContent).toBe('We never share this.')
  })

  it('Select renders a placeholder plus string and object options, reporting the chosen value', async () => {
    let value = ''
    await act(async () => {
      root.render(<Select label="Role" value={value} onChange={(v) => { value = v }} options={['Cashier', { value: 'ph', label: 'Pharmacist' }]} />)
    })
    const sel = host.querySelector('select')
    const options = [...sel.options].map((o) => o.textContent)
    expect(options).toEqual(['Select...', 'Cashier', 'Pharmacist'])
    await act(async () => {
      sel.value = 'ph'
      sel.dispatchEvent(new Event('change', { bubbles: true }))
    })
    expect(value).toBe('ph')
  })

  it('Textarea renders its label and reports content on change', async () => {
    let value = ''
    await act(async () => { root.render(<Textarea label="Notes" value={value} onChange={(v) => { value = v }} />) })
    const area = host.querySelector('textarea')
    expect(host.querySelector('label').getAttribute('for')).toBe('notes')
    const areaSetter = Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, 'value').set
    await act(async () => {
      areaSetter.call(area, 'bring two')
      area.dispatchEvent(new Event('input', { bubbles: true }))
    })
    expect(value).toBe('bring two')
  })

  it('Toggle is a switch that flips its checked state and its aria-checked', async () => {
    let on = false
    await act(async () => { root.render(<Toggle label="Notify me" desc="When a reply arrives" value={on} onChange={(v) => { on = v }} />) })
    const sw = host.querySelector('button[role="switch"]')
    expect(sw.getAttribute('aria-checked')).toBe('false')
    expect(sw.getAttribute('aria-label')).toBe('Notify me')
    await act(async () => { sw.dispatchEvent(new MouseEvent('click', { bubbles: true })) })
    expect(on).toBe(true)
  })

  it('Label, HelperText and ErrorMessage are directly usable for custom compositions', async () => {
    await act(async () => {
      root.render(<><Label htmlFor="x" required>Code</Label><HelperText>6 digits</HelperText><ErrorMessage>Wrong code</ErrorMessage></>)
    })
    expect(host.querySelector('label').textContent).toBe('Code *')
    expect(host.textContent).toContain('6 digits')
    expect(host.textContent).toContain('Wrong code')
  })
})