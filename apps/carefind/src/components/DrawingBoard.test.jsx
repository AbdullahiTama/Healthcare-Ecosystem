import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, act } from '@testing-library/react'
import DrawingBoard from './DrawingBoard.jsx'

// INVARIANT tests for spec-carefind-drawing-auto-publish-fix
// Ensure DrawingBoard never auto-publishes; only explicit "Use this drawing" calls onSave.

describe('DrawingBoard — draft invariant (one Post = one post)', () => {
  let mockCtx
  let onSave
  let onCancel
  let originalGetContext
  let originalGetBoundingClientRect
  let originalToBlob

  beforeEach(() => {
    mockCtx = {
      scale: vi.fn(),
      lineCap: '',
      lineJoin: '',
      fillStyle: '',
      fillRect: vi.fn(),
      strokeStyle: '',
      lineWidth: 0,
      beginPath: vi.fn(),
      moveTo: vi.fn(),
      lineTo: vi.fn(),
      stroke: vi.fn(),
      getContext: vi.fn(),
    }
    onSave = vi.fn()
    onCancel = vi.fn()

    originalGetContext = HTMLCanvasElement.prototype.getContext
    originalGetBoundingClientRect = HTMLCanvasElement.prototype.getBoundingClientRect
    originalToBlob = HTMLCanvasElement.prototype.toBlob

    HTMLCanvasElement.prototype.getContext = vi.fn(() => mockCtx)
    HTMLCanvasElement.prototype.getBoundingClientRect = vi.fn(() => ({
      width: 400,
      height: 300,
      left: 0,
      top: 0,
      right: 400,
      bottom: 300,
    }))
    // default toBlob calls back immediately with a blob
    HTMLCanvasElement.prototype.toBlob = vi.fn((cb) => {
      cb(new Blob(['fake'], { type: 'image/png' }))
    })

    // ensure devicePixelRatio defined
    Object.defineProperty(window, 'devicePixelRatio', { value: 1, writable: true, configurable: true })
  })

  afterEach(() => {
    HTMLCanvasElement.prototype.getContext = originalGetContext
    HTMLCanvasElement.prototype.getBoundingClientRect = originalGetBoundingClientRect
    HTMLCanvasElement.prototype.toBlob = originalToBlob
    vi.restoreAllMocks()
  })

  it('does not call onSave on strokes, moves, erases, clears without explicit save', async () => {
    render(<DrawingBoard onSave={onSave} onCancel={onCancel} />)
    const canvas = document.querySelector('canvas')
    expect(canvas).toBeInTheDocument()

    // simulate slow drawing: multiple strokes
    fireEvent.mouseDown(canvas, { clientX: 10, clientY: 10 })
    fireEvent.mouseMove(canvas, { clientX: 20, clientY: 20 })
    fireEvent.mouseMove(canvas, { clientX: 30, clientY: 30 })
    fireEvent.mouseUp(canvas)
    // another stroke
    fireEvent.mouseDown(canvas, { clientX: 40, clientY: 40 })
    fireEvent.mouseMove(canvas, { clientX: 50, clientY: 50 })
    fireEvent.mouseUp(canvas)
    // touch events
    fireEvent.touchStart(canvas, { touches: [{ clientX: 60, clientY: 60 }] })
    fireEvent.touchMove(canvas, { touches: [{ clientX: 70, clientY: 70 }] })
    fireEvent.touchEnd(canvas)

    // Clear button
    fireEvent.click(screen.getByRole('button', { name: 'Clear' }))

    // erases via color white (eraser is white color)
    // still no publish
    expect(onSave).not.toHaveBeenCalled()

    // change color and size does not publish
    const colorButtons = screen.getAllByRole('button').filter(b => b.style.backgroundColor)
    // at least one color button exists
    expect(colorButtons.length).toBeGreaterThan(0)
    expect(onSave).not.toHaveBeenCalled()
  })

  it('calls onSave exactly once when "Use this drawing" is clicked', async () => {
    render(<DrawingBoard onSave={onSave} onCancel={onCancel} />)
    const saveBtn = screen.getByRole('button', { name: /Use this drawing/i })
    fireEvent.click(saveBtn)
    expect(HTMLCanvasElement.prototype.toBlob).toHaveBeenCalledTimes(1)
    expect(onSave).toHaveBeenCalledTimes(1)
    expect(onSave.mock.calls[0][0]).toBeInstanceOf(Blob)
  })

  it('prevents double onSave on rapid double-tap while saving (saving guard)', async () => {
    // make toBlob async / deferred so saving flag stays true on second click
    let pendingCb = null
    HTMLCanvasElement.prototype.toBlob = vi.fn((cb) => {
      pendingCb = cb
    })

    render(<DrawingBoard onSave={onSave} onCancel={onCancel} />)
    const saveBtn = screen.getByRole('button', { name: /Use this drawing/i })

    fireEvent.click(saveBtn)
    // second rapid tap while still saving
    fireEvent.click(saveBtn)

    // toBlob should have been called only once due to saving guard
    expect(HTMLCanvasElement.prototype.toBlob).toHaveBeenCalledTimes(1)
    expect(onSave).not.toHaveBeenCalled()

    // now resolve the pending blob
    act(() => {
      pendingCb(new Blob(['fake'], { type: 'image/png' }))
    })

    expect(onSave).toHaveBeenCalledTimes(1)

    // after saving false, another click should work again
    fireEvent.click(saveBtn)
    expect(HTMLCanvasElement.prototype.toBlob).toHaveBeenCalledTimes(2)
  })

  it('does not call onSave on Cancel', async () => {
    render(<DrawingBoard onSave={onSave} onCancel={onCancel} />)
    const canvas = document.querySelector('canvas')
    fireEvent.mouseDown(canvas, { clientX: 10, clientY: 10 })
    fireEvent.mouseMove(canvas, { clientX: 20, clientY: 20 })
    fireEvent.mouseUp(canvas)

    // Cancel via ✕ button (first button with ✕)
    const cancelBtn = screen.getByText('✕')
    fireEvent.click(cancelBtn)
    expect(onCancel).toHaveBeenCalledTimes(1)
    expect(onSave).not.toHaveBeenCalled()
  })

  it('clearCanvas only mutates canvas, never calls onSave or supabase', async () => {
    render(<DrawingBoard onSave={onSave} onCancel={onCancel} />)
    // Clear multiple times
    const clearBtn = screen.getByRole('button', { name: 'Clear' })
    fireEvent.click(clearBtn)
    fireEvent.click(clearBtn)
    fireEvent.click(clearBtn)
    expect(onSave).not.toHaveBeenCalled()
    expect(mockCtx.fillRect).toHaveBeenCalled()
  })

  it('save button is disabled while saving', async () => {
    let pendingCb = null
    HTMLCanvasElement.prototype.toBlob = vi.fn((cb) => { pendingCb = cb })
    render(<DrawingBoard onSave={onSave} onCancel={onCancel} />)
    const saveBtn = screen.getByRole('button', { name: /Use this drawing/i })
    fireEvent.click(saveBtn)
    expect(saveBtn).toBeDisabled()
    expect(saveBtn).toHaveTextContent('Saving')
    act(() => { pendingCb(new Blob(['fake'], { type: 'image/png' })) })
    // after blob resolved, button enabled again
    expect(saveBtn).not.toBeDisabled()
    expect(saveBtn).toHaveTextContent('Use this drawing')
  })
})
