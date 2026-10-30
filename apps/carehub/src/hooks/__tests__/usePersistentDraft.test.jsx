import React from 'react'
import { createRoot } from 'react-dom/client'
import { act } from 'react-dom/test-utils'
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { usePersistentDraft, DRAFT_TTL_MS } from '../usePersistentDraft'

// Drives the hook through a tiny component and exposes its API on `api`.
let api
function Harness({ storageKey }) {
  const [value, setValue, meta] = usePersistentDraft(storageKey, () => ({ text: '' }), { isEmpty: v => !v.text })
  api = { value, setValue, ...meta }
  return <div data-testid='v'>{value.text}</div>
}

let host
let root
const render = (key) => act(async () => { root.render(<Harness storageKey={key} />) })
const remount = async (key) => {
  await act(async () => { root.unmount() })
  root = createRoot(host)
  await render(key)
}

beforeEach(() => {
  localStorage.clear()
  global.IS_REACT_ACT_ENVIRONMENT = true
  host = document.createElement('div')
  document.body.appendChild(host)
  root = createRoot(host)
})
afterEach(async () => {
  await act(async () => { root.unmount() })
  host.remove()
})

describe('usePersistentDraft', () => {
  it('restores the value after a remount, as after a page reload', async () => {
    await render('a')
    await act(async () => { api.setValue({ text: 'Amoxicillin x 20' }) })
    await remount('a')
    expect(api.value.text).toBe('Amoxicillin x 20')
    expect(typeof api.restoredAt).toBe('number')
  })

  it('removes an empty draft instead of storing it', async () => {
    await render('a')
    await act(async () => { api.setValue({ text: 'x' }) })
    expect(localStorage.getItem('carehub_draft_a')).not.toBeNull()
    await act(async () => { api.setValue({ text: '' }) })
    expect(localStorage.getItem('carehub_draft_a')).toBeNull()
  })

  it('clear() resets to the initial value and forgets the draft', async () => {
    await render('a')
    await act(async () => { api.setValue({ text: 'x' }) })
    await act(async () => { api.clear() })
    expect(api.value.text).toBe('')
    expect(localStorage.getItem('carehub_draft_a')).toBeNull()
    await remount('a')
    expect(api.value.text).toBe('')
    expect(api.restoredAt).toBeNull()
  })

  it('keeps drafts isolated per key and never carries one across a key change', async () => {
    await render('biz1')
    await act(async () => { api.setValue({ text: 'business one' }) })
    await render('biz2')
    expect(api.value.text).toBe('')
    await act(async () => { api.setValue({ text: 'business two' }) })
    await render('biz1')
    expect(api.value.text).toBe('business one')
    expect(JSON.parse(localStorage.getItem('carehub_draft_biz2')).value.text).toBe('business two')
  })

  it('ignores corrupt or foreign-version stored data', async () => {
    localStorage.setItem('carehub_draft_a', '{not json')
    await render('a')
    expect(api.value.text).toBe('')
    localStorage.setItem('carehub_draft_b', JSON.stringify({ version: 999, value: { text: 'old shape' } }))
    await render('b')
    expect(api.value.text).toBe('')
  })

  it('drops and removes a draft older than the expiry', async () => {
    localStorage.setItem('carehub_draft_a', JSON.stringify({ version: 1, savedAt: Date.now() - DRAFT_TTL_MS - 1000, value: { text: 'last month' } }))
    await render('a')
    expect(api.value.text).toBe('')
    expect(localStorage.getItem('carehub_draft_a')).toBeNull()
  })

  it('keeps working in memory when storage throws', async () => {
    const proto = Object.getPrototypeOf(localStorage)
    const orig = { get: proto.getItem, set: proto.setItem }
    proto.getItem = () => { throw new Error('blocked') }
    proto.setItem = () => { throw new Error('quota') }
    try {
      await render('a')
      await act(async () => { api.setValue({ text: 'still typing' }) })
      expect(host.querySelector('[data-testid="v"]').textContent).toBe('still typing')
    } finally {
      proto.getItem = orig.get
      proto.setItem = orig.set
    }
  })
})
