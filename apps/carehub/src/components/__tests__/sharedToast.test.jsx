import React from 'react'
import { createRoot } from 'react-dom/client'
import { act } from 'react-dom/test-utils'
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { Toast } from '@care-ecosystem/design-system/components/ui'

describe('design-system Toast', () => {
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

  it('renders nothing when there is no message', async () => {
    await act(async () => { root.render(<Toast msg="" />) })
    expect(host.querySelector('[role="status"]')).toBeNull()
  })

  it('renders the message with the announced-status a11y contract', async () => {
    await act(async () => { root.render(<Toast msg="Saved" />) })
    const toast = host.querySelector('[role="status"]')
    expect(toast.getAttribute('aria-live')).toBe('polite')
    expect(toast.textContent).toContain('Saved')
  })

  it('maps type to colour and icon (info has no icon)', async () => {
    await act(async () => { root.render(<Toast msg="done" type="success" />) })
    expect(host.textContent).toContain('done')
    await act(async () => { root.render(<Toast msg="note" type="info" />) })
    expect(host.querySelectorAll('[aria-hidden="true"]').length).toBe(0)
  })

  it('renders one inline action wired to onAction for the Undo pattern', async () => {
    const onAction = () => { actTriggered.push(1) }
    const actTriggered = []
    await act(async () => {
      root.render(<Toast msg="Deleted" actionLabel="Undo" onAction={onAction} />)
    })
    const undo = [...host.querySelectorAll('button')].find((b) => b.textContent === 'Undo')
    expect(undo).toBeDefined()
    await act(async () => { undo.dispatchEvent(new MouseEvent('click', { bubbles: true })) })
    expect(actTriggered.length).toBe(1)
  })

  it('is responsive by default: desktop top-right rule injected once', async () => {
    await act(async () => { root.render(<Toast msg="T" />) })
    const tags = Array.from(document.querySelectorAll('style#ds-toast-styles'))
    expect(tags.length).toBe(1)
    const css = tags[0].textContent
    expect(css).toContain('@keyframes ds-toast-in')
    expect(css).toContain('@media (min-width: 768px)')
    expect(css).toContain('top: 24px')
    expect(css).toContain('@media (prefers-reduced-motion: reduce)')
    expect(host.querySelector('[role="status"]').className).toBe('ds-toast')
  })

  it('pins an explicit position with inline styles that override the responsive rule', async () => {
    await act(async () => { root.render(<Toast msg="T" position="bottom-right" />) })
    const toast = host.querySelector('[role="status"]')
    expect(toast.style.bottom).toBe('24px')
    expect(toast.style.right).toBe('24px')
    expect(toast.style.transform).toBe('none')
    await act(async () => { root.render(<Toast msg="T" position="top-right" />) })
    expect(host.querySelector('[role="status"]').style.top).toBe('24px')
  })
})