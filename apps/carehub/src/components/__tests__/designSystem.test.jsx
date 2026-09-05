import React from 'react'
import { createRoot } from 'react-dom/client'
import { act } from 'react-dom/test-utils'
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { Button } from '@care-ecosystem/design-system/components/ui/Button'
import { PageHeader } from '@care-ecosystem/design-system/components/layout/PageHeader'
import { theme } from '@care-ecosystem/design-system'

// jsdom serializes hex colors to rgb() — compare against that form.
const rgb = (hex) => {
  const n = parseInt(hex.slice(1), 16)
  return `rgb(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255})`
}

describe('design-system Button', () => {
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

  it('renders a primary button with the brand background and label', async () => {
    await act(async () => { root.render(<Button>Save</Button>) })
    const btn = host.querySelector('button')
    expect(btn.textContent).toContain('Save')
    expect(btn.style.background).toBe(rgb(theme.tealDeep))
    expect(btn.style.minHeight).toBe('44px')
  })

  it('applies ghost variant chrome', async () => {
    await act(async () => { root.render(<Button variant='ghost'>Cancel</Button>) })
    const btn = host.querySelector('button')
    expect(btn.style.background).toBe('white')
    expect(btn.style.border).toContain(rgb(theme.gray200))
  })

  it('is disabled and non-interactive when disabled', async () => {
    let clicks = 0
    await act(async () => { root.render(<Button disabled onClick={() => clicks++}>Go</Button>) })
    const btn = host.querySelector('button')
    expect(btn.disabled).toBe(true)
    await act(async () => { btn.dispatchEvent(new MouseEvent('click', { bubbles: true })) })
    expect(clicks).toBe(0)
  })

  it('fires onClick', async () => {
    let clicks = 0
    await act(async () => { root.render(<Button onClick={() => clicks++}>Go</Button>) })
    const btn = host.querySelector('button')
    await act(async () => { btn.dispatchEvent(new MouseEvent('click', { bubbles: true })) })
    expect(clicks).toBe(1)
  })
})

describe('design-system PageHeader', () => {
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

  it('compact mode renders the title and right slot in an app-bar', async () => {
    await act(async () => { root.render(<PageHeader compact title='Inventory' rightSlot={<button>Sync</button>} />) })
    expect(host.querySelector('h1').textContent).toBe('Inventory')
    expect(host.querySelector('button').textContent).toBe('Sync')
    expect(host.querySelector('header')).toBeDefined()
  })

  it('full mode renders title, description and breadcrumb', async () => {
    await act(async () => {
      root.render(<PageHeader title='Reports' description='Business performance' breadcrumb={[{ label: 'Home', href: '/' }, { label: 'Reports' }]} />)
    })
    expect(host.querySelector('h1').textContent).toBe('Reports')
    expect(host.textContent).toContain('Business performance')
    expect(host.textContent).toContain('Home')
    expect(host.textContent).toContain('Reports')
  })

  it('full mode renders the primary action via the shared Button', async () => {
    await act(async () => {
      root.render(<PageHeader title='POS' primaryAction={{ label: 'New Sale' }} />)
    })
    const btn = host.querySelector('button')
    expect(btn.textContent).toContain('New Sale')
    expect(btn.style.background).toBe(rgb(theme.tealDeep))
  })
})