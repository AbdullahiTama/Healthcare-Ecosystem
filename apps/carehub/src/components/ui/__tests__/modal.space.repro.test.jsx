import React, { useState } from 'react'
import { createRoot } from 'react-dom/client'
import { act } from 'react-dom/test-utils'
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { Modal, Card, Inp, GhostBtn, TealBtn } from '../index'

// Regression: the Modal's content sits inside a clickable Card (onClick ->
// role="button" + a keydown handler that preventDefaults Enter/Space). A keydown
// handler on a parent fires for events bubbling from child inputs, so that
// preventDefault was swallowing the spacebar inside every modal input. Space
// must type; only the card ITSELF being focused should act like a button.
function ModalWithInput() {
  const [open, setOpen] = useState(false)
  const [name, setName] = useState('')
  return (
    <div>
      <button data-testid='open' onClick={() => setOpen(true)}>Open</button>
      <Modal show={open} onClose={() => setOpen(false)} title='Add record'
        footer={<><GhostBtn onClick={() => setOpen(false)}>Cancel</GhostBtn><TealBtn>Save</TealBtn></>}>
        <Inp label='Name' value={name} onChange={v => setName(v)} placeholder='e.g. Ada' />
      </Modal>
    </div>
  )
}

// A clickable Card must still activate on Space/Enter when IT is focused
// (keyboard accessibility), we only stopped the handler from firing on events
// that bubble up from child controls.
function ClickableCard() {
  const [clicked, setClicked] = useState(false)
  return (
    <Card onClick={() => setClicked(true)} style={{ padding: 12 }}>
      <div data-testid='card-label'>{clicked ? 'clicked' : 'click me'}</div>
    </Card>
  )
}

describe('Modal inputs accept the spacebar', () => {
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

  it('focuses the first input when the modal opens via a button click', async () => {
    await act(async () => { root.render(<ModalWithInput />) })
    const openBtn = host.querySelector('[data-testid="open"]')
    await act(async () => { openBtn.dispatchEvent(new MouseEvent('click', { bubbles: true })) })
    const input = host.querySelector('input')
    expect(input).not.toBeNull()
    expect(document.activeElement).toBe(input)
  })

  it('does NOT preventDefault a space keydown that bubbles from a child input', async () => {
    await act(async () => { root.render(<ModalWithInput />) })
    const openBtn = host.querySelector('[data-testid="open"]')
    await act(async () => { openBtn.dispatchEvent(new MouseEvent('click', { bubbles: true })) })
    const input = host.querySelector('input')
    expect(document.activeElement).toBe(input)

    // A real space keydown bubbling out of the input must not be prevented,
    // otherwise the space character can never be typed.
    await act(async () => {
      input.focus()
      const ev = new KeyboardEvent('keydown', { key: ' ', bubbles: true, cancelable: true })
      input.dispatchEvent(ev)
      expect(ev.defaultPrevented).toBe(false)
    })
  })

  it('still activates a clickable Card on Space when the Card itself is focused', async () => {
    await act(async () => { root.render(<ClickableCard />) })
    const card = host.querySelector('[data-testid="card-label"]').parentElement
    expect(card.getAttribute('role')).toBe('button')

    await act(async () => {
      card.focus()
      expect(document.activeElement).toBe(card)
      const ev = new KeyboardEvent('keydown', { key: ' ', bubbles: true, cancelable: true })
      card.dispatchEvent(ev)
    })

    expect(host.querySelector('[data-testid="card-label"]').textContent).toBe('clicked')
  })
})
