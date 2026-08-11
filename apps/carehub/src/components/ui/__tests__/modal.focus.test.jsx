import React, { useState } from 'react'
import { createRoot } from 'react-dom/client'
import { act } from 'react-dom/test-utils'
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { Modal, ConfirmDialog, GhostBtn, TealBtn } from '../index'

// Regression: on open the modal used to focus its first *focusable*, which is
// the header's close (cancel) button — so a form modal opened with the focus
// ring on Cancel and typing did nothing until the user clicked back into a
// field. Focus must land on the first editable field instead.
function FormHarness() {
  const [open, setOpen] = useState(true)
  const [name, setName] = useState('')
  return (
    <Modal show={open} onClose={() => setOpen(false)} title='New record'
      footer={<><GhostBtn onClick={() => setOpen(false)}>Cancel</GhostBtn><TealBtn>Save</TealBtn></>}>
      <label htmlFor='a'>Name</label>
      <input id='a' data-testid='name' value={name} onChange={e => setName(e.target.value)} />
    </Modal>
  )
}

describe('Modal focus behavior', () => {
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

  it('focuses the first editable field on open, not the close/cancel button', async () => {
    await act(async () => { root.render(<FormHarness />) })
    const input = host.querySelector('[data-testid="name"]')
    const close = host.querySelector('[aria-label="Close"]')
    expect(document.activeElement).toBe(input)
    expect(close).toBeDefined()
  })

  it('keeps focus in the input across parent re-renders (each keystroke)', async () => {
    await act(async () => { root.render(<FormHarness />) })
    const input = host.querySelector('[data-testid="name"]')
    expect(document.activeElement).toBe(input)

    for (const ch of ['a', 'b', 'c', 'd']) {
      await act(async () => {
        input.value += ch
        input.dispatchEvent(new Event('input', { bubbles: true }))
      })
      expect(document.activeElement, `focus was stolen while typing "${ch}"`).toBe(input)
    }
    expect(input.value).toBe('a b c d'.replace(/ /g, ''))
  })

  it('falls back to the Cancel button when the modal has no fields (ConfirmDialog)', async () => {
    await act(async () => {
      root.render(
        <ConfirmDialog show onClose={() => {}} onConfirm={() => {}}
          title='Delete?' consequence='This permanently deletes the record.' />
      )
    })
    const cancel = [...host.querySelectorAll('button')].find(b => b.textContent === 'Cancel')
    const confirm = [...host.querySelectorAll('button')].find(b => b.textContent === 'Delete')
    // Pattern 29: Cancel is the default focus; the destructive button never is.
    expect(document.activeElement).toBe(cancel)
    expect(document.activeElement).not.toBe(confirm)
  })
})