import React from 'react'
import { createRoot } from 'react-dom/client'
import { act } from 'react-dom/test-utils'
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import {
  Card, Pill, Badge, StatusBadge, Avatar, Loading, Skeleton, CardSkeleton, Empty, ErrorState,
} from '@care-ecosystem/design-system/components/ui'
import { theme } from '@care-ecosystem/design-system'

// jsdom serializes hex colors to rgb() — compare against that form.
const rgb = (hex) => {
  const n = parseInt(hex.slice(1), 16)
  return `rgb(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255})`
}

describe('design-system Card', () => {
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

  it('renders children with the card border and elevation', async () => {
    await act(async () => { root.render(<Card>Hello</Card>) })
    const card = host.firstChild
    expect(card.textContent).toBe('Hello')
    expect(card.style.border).toContain(rgb(theme.gray200))
    expect(card.style.boxShadow).toBe(theme.elevation[1])
  })

  it('is a keyboard-accessible button when onClick is provided', async () => {
    let clicks = 0
    await act(async () => { root.render(<Card onClick={() => clicks++}>Press</Card>) })
    const card = host.firstChild
    expect(card.getAttribute('role')).toBe('button')
    expect(card.tabIndex).toBe(0)
    await act(async () => { card.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true })) })
    expect(clicks).toBe(1)
  })

  it('does not intercept a Space keydown that originates inside a child input', async () => {
    let clicks = 0
    await act(async () => {
      root.render(<Card onClick={() => clicks++}><input aria-label="search" /></Card>)
    })
    const input = host.querySelector('input')
    await act(async () => { input.dispatchEvent(new KeyboardEvent('keydown', { key: ' ', bubbles: true })) })
    expect(clicks).toBe(0)
    expect(input.value).toBe('')
  })
})

describe('design-system Pill / StatusBadge', () => {
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

  it('Pill renders the mapped tint for the given type', async () => {
    await act(async () => { root.render(<Pill label="Live" type="teal" />) })
    const pill = host.firstChild
    expect(pill.textContent).toBe('Live')
    expect(pill.style.background).toBe(rgb(theme.tealMist))
    expect(pill.style.color).toBe(rgb(theme.tealDeep))
  })

  it('Pill falls back to gray for an unknown type', async () => {
    await act(async () => { root.render(<Pill label="Unknown" type="nope" />) })
    expect(host.firstChild.style.background).toBe(rgb(theme.gray100))
  })

  it('Badge is an alias of Pill', () => {
    expect(Badge).toBe(Pill)
  })

  it('StatusBadge maps known statuses to their label and tint', async () => {
    await act(async () => { root.render(<StatusBadge status="at_triage" />) })
    const pill = host.firstChild
    expect(pill.textContent).toBe('At Triage')
    expect(pill.style.background).toBe(rgb(theme.warningBg))
  })

  it('StatusBadge falls back to the raw status text', async () => {
    await act(async () => { root.render(<StatusBadge status="off_shift" />) })
    expect(host.firstChild.textContent).toBe('off_shift')
  })
})

describe('design-system Avatar', () => {
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

  it('shows the first initial on a teal background when no photo exists', async () => {
    await act(async () => { root.render(<Avatar name="Zuri Nadeau" />) })
    const av = host.firstChild
    expect(av.textContent).toBe('Z')
    expect(av.style.background).toBe(rgb(theme.tealDeep))
  })

  it('uses the photo src when provided and is labelled', async () => {
    await act(async () => { root.render(<Avatar name="Ava" src="/photos/ava.jpg" />) })
    const av = host.firstChild
    expect(av.getAttribute('aria-label')).toBe('Ava')
    expect(av.style.backgroundImage).toContain('/photos/ava.jpg')
  })
})

describe('design-system state components', () => {
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

  it('injects the shared keyframes once into <head>', () => {
    const tags = Array.from(document.querySelectorAll('style#ds-ui-keyframes'))
    expect(tags.length).toBe(1)
    expect(tags[0].textContent).toContain('@keyframes ds-spin')
    expect(tags[0].textContent).toContain('@keyframes ds-pulse')
  })

  it('Loading announces its status and text', async () => {
    await act(async () => { root.render(<Loading text="Fetching visits..." />) })
    const el = host.firstChild
    expect(el.getAttribute('role')).toBe('status')
    expect(el.textContent).toContain('Fetching visits...')
  })

  it('Skeleton pulses and CardSkeleton composes skeleton rows in a Card', async () => {
    await act(async () => { root.render(<CardSkeleton />) })
    expect(host.querySelectorAll('div[style*="ds-pulse"]').length).toBe(3)
    expect(host.firstChild.style.border).toContain(rgb(theme.gray200))
  })

  it('Empty renders the message and a primary action button', async () => {
    let clicked = 0
    await act(async () => { root.render(<Empty message="No orders yet" action="Create order" onAction={() => clicked++} />) })
    expect(host.textContent).toContain('No orders yet')
    const btn = host.querySelector('button')
    expect(btn.textContent).toContain('Create order')
    expect(btn.style.background).toBe(rgb(theme.tealDeep))
    await act(async () => { btn.dispatchEvent(new MouseEvent('click', { bubbles: true })) })
    expect(clicked).toBe(1)
  })

  it('Empty uses the ghost action for filtered causes and renders a legacy emoji icon', async () => {
    await act(async () => { root.render(<Empty icon="📭" message="Nothing matches" action="Clear filters" cause="filtered" />) })
    const btn = host.querySelector('button')
    expect(btn.style.background).toBe('white')
    expect(host.textContent).toContain('📭')
  })

  it('ErrorState app variant gives a human failure message with retry', async () => {
    let retried = 0
    await act(async () => { root.render(<ErrorState onRetry={() => retried++} />) })
    expect(host.textContent).toContain('Something went wrong')
    const btn = host.querySelector('button')
    expect(btn.textContent).toContain('Retry')
    await act(async () => { btn.dispatchEvent(new MouseEvent('click', { bubbles: true })) })
    expect(retried).toBe(1)
  })

  it('ErrorState network variant reassures with offline framing', async () => {
    await act(async () => { root.render(<ErrorState variant="network" />) })
    expect(host.textContent).toContain("You're offline")
  })
})