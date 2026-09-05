import React from 'react'
import { createRoot } from 'react-dom/client'
import { act } from 'react-dom/test-utils'
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { StatCard } from '@care-ecosystem/design-system/components/ui'
import { CheckCircle } from 'lucide-react'

describe('design-system StatCard', () => {
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

  it('renders icon, label, value and sub', async () => {
    await act(async () => { root.render(<StatCard icon={<CheckCircle />} label="Today" value="12" sub="3 confirmed" />) })
    expect(host.textContent).toContain('Today')
    expect(host.textContent).toContain('12')
    expect(host.textContent).toContain('3 confirmed')
  })

  it('tints the value via tone or the legacy alert bool', async () => {
    await act(async () => { root.render(<StatCard icon={<CheckCircle />} label="A" value="5" tone="warning" />) })
    let valueEl = [...host.querySelectorAll('div')].find((d) => d.textContent === '5')
    expect(valueEl.style.color).toBe('rgb(217, 119, 6)')
    await act(async () => { root.render(<StatCard icon={<CheckCircle />} label="B" value="9" alert />) })
    valueEl = [...host.querySelectorAll('div')].find((d) => d.textContent === '9')
    expect(valueEl.style.color).toBe('rgb(217, 119, 6)')
  })

  it('is clickable via onClick', async () => {
    let clicks = 0
    await act(async () => { root.render(<StatCard icon={<CheckCircle />} label="C" value="1" onClick={() => clicks++} />) })
    await act(async () => { host.querySelector('[role="button"], div').dispatchEvent(new MouseEvent('click', { bubbles: true })) })
    expect(clicks).toBe(1)
  })
})