import React from 'react'
import { createRoot } from 'react-dom/client'
import { act } from 'react-dom/test-utils'
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { Modal, ConfirmDialog } from '@care-ecosystem/design-system/components/ui'

describe('design-system Modal', () => {
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

  it('renders a centred dialog with a labelled close button and injected keyframes', async () => {
    await act(async () => { root.render(<Modal show title="Edit stock" onClose={() => {}}>Body</Modal>) })
    const dialog = host.querySelector('[role="dialog"]')
    expect(dialog.getAttribute('aria-modal')).toBe('true')
    expect(dialog.getAttribute('aria-labelledby')).toBe('ds-modal-title')
    expect(dialog.textContent).toContain('Edit stock')
    expect(dialog.textContent).toContain('Body')
    expect(dialog.querySelector('button[aria-label="Close"]')).toBeDefined()
    const tags = Array.from(document.querySelectorAll('style#ds-modal-keyframes'))
    expect(tags.length).toBe(1)
    expect(tags[0].textContent).toContain('@keyframes ds-drawer-enter')
  })

  it('closes on backdrop click or Escape, but not on a click inside the card', async () => {
    let closed = 0
    await act(async () => { root.render(<Modal show title="T" onClose={() => closed++}>Body</Modal>) })
    const dialog = host.querySelector('[role="dialog"]')
    const card = dialog.firstChild
    await act(async () => { card.dispatchEvent(new MouseEvent('click', { bubbles: true })) })
    expect(closed).toBe(0)
    await act(async () => { dialog.dispatchEvent(new MouseEvent('click', { bubbles: true })) })
    expect(closed).toBe(1)
    await act(async () => { document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' })) })
    expect(closed).toBe(2)
  })

  it('renders as a bottom sheet when passed the legacy sheet boolean or variant="sheet"', async () => {
    await act(async () => { root.render(<Modal show sheet title="S" onClose={() => {}}>Body</Modal>) })
    const sheet = host.querySelector('[role="dialog"]')
    expect(sheet.style.alignItems).toBe('flex-end')
    const card = sheet.firstChild
    expect(card.style.borderRadius).toContain('20px 20px 0 0')
    expect(card.style.animation).toContain('ds-sheet-enter')

    await act(async () => { root.render(<Modal show variant="sheet" title="S2" onClose={() => {}}>Body</Modal>) })
    expect(host.querySelector('[role="dialog"]').style.alignItems).toBe('flex-end')
  })

  it('renders as a right-hand drawer with variant="drawer"', async () => {
    await act(async () => { root.render(<Modal show variant="drawer" title="D" onClose={() => {}}>Body</Modal>) })
    const dialog = host.querySelector('[role="dialog"]')
    expect(dialog.style.justifyContent).toBe('flex-end')
    const card = dialog.firstChild
    expect(card.style.height).toBe('100%')
    expect(card.style.animation).toContain('ds-drawer-enter')
  })

  it('honours wide/size for the dialog width', async () => {
    await act(async () => { root.render(<Modal show wide title="W" onClose={() => {}}>Body</Modal>) })
    expect(host.querySelector('[role="dialog"]').firstChild.style.maxWidth).toBe('700px')
    await act(async () => { root.render(<Modal show size="sm" title="S" onClose={() => {}}>Body</Modal>) })
    expect(host.querySelector('[role="dialog"]').firstChild.style.maxWidth).toBe('420px')
  })

  it('blocks backdrop and Escape closing for irreversible content', async () => {
    let closed = 0
    await act(async () => {
      root.render(<Modal show preventBackdropClose title="T" onClose={() => closed++}>Body</Modal>)
    })
    const dialog = host.querySelector('[role="dialog"]')
    await act(async () => { dialog.dispatchEvent(new MouseEvent('click', { bubbles: true })) })
    await act(async () => { document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' })) })
    expect(closed).toBe(0)
  })

  it('ConfirmDialog shows consequence, keeps Cancel default-focused and never auto-focuses the destructive action', async () => {
    await act(async () => {
      root.render(<ConfirmDialog show onClose={() => {}} onConfirm={() => {}} title="Delete?" consequence="This permanently deletes the record." />)
    })
    expect(host.textContent).toContain('This permanently deletes the record.')
    const cancel = [...host.querySelectorAll('button')].find((b) => b.textContent === 'Cancel')
    const confirm = [...host.querySelectorAll('button')].find((b) => b.textContent === 'Delete')
    expect(document.activeElement).toBe(cancel)
    expect(document.activeElement).not.toBe(confirm)
  })
})