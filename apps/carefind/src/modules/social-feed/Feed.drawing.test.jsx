import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'

// --- Supabase mock with insert tracking ---
const { supabaseMock, insertCalls, resetInsertCalls } = vi.hoisted(() => {
  const insertCalls = []
  let lastInsertData = null

  function makeBuilder(table) {
    const builder = {
      select: vi.fn(() => builder),
      order: vi.fn(() => builder),
      limit: vi.fn(() => builder),
      not: vi.fn(() => builder),
      or: vi.fn(() => builder),
      textSearch: vi.fn(() => builder),
      ilike: vi.fn(() => builder),
      eq: vi.fn(() => builder),
      in: vi.fn(() => builder),
      gt: vi.fn(() => builder),
      maybeSingle: vi.fn(() => {
        if (table === 'profiles') {
          return Promise.resolve({ data: { id: 'user-1', full_name: 'Test User', display_name: 'testuser', phone: '1234567890', is_verified: true, verification_label: null, avatar_url: null, location: 'Lagos', country: 'Nigeria' }, error: null })
        }
        return Promise.resolve({ data: null, error: null })
      }),
      single: vi.fn(() => {
        if (lastInsertData) {
          const data = { id: 'new-post-' + Date.now() + Math.random().toString(16).slice(2), ...lastInsertData, created_at: new Date().toISOString() }
          lastInsertData = null
          return Promise.resolve({ data, error: null })
        }
        return Promise.resolve({ data: null, error: null })
      }),
      insert: vi.fn((data) => {
        if (table === 'posts') {
          // data may be object or array
          const payload = Array.isArray(data) ? data[0] : data
          lastInsertData = payload
          insertCalls.push(payload)
        }
        return builder
      }),
      upsert: vi.fn(() => Promise.resolve({ data: null, error: null })),
      delete: vi.fn(() => builder),
      update: vi.fn(() => builder),
      // thenable for await supabase.from(...).select(...).order(...).limit(...)
      then: (resolve) => Promise.resolve({ data: [], error: null }).then(resolve),
    }
    return builder
  }

  const supabaseMock = {
    from: vi.fn((table) => makeBuilder(table)),
    rpc: vi.fn(() => Promise.resolve({ data: null, error: null })),
    channel: vi.fn(() => {
      const ch = { on: vi.fn(() => ch), subscribe: vi.fn(() => ch) }
      return ch
    }),
    removeChannel: vi.fn(() => {}),
    storage: {
      from: vi.fn(() => ({
        upload: vi.fn(() => Promise.resolve({ error: null })),
        getPublicUrl: vi.fn(() => ({ data: { publicUrl: 'https://example.com/drawing.jpg' } })),
      })),
    },
  }

  function resetInsertCalls() {
    insertCalls.length = 0
    lastInsertData = null
  }

  return { supabaseMock, insertCalls, resetInsertCalls }
})

vi.mock('../../config/supabaseClient', () => ({ supabase: supabaseMock }))

const mockUseAuth = vi.fn(() => ({ user: { id: 'user-1', email: 'test@test.com' } }))
vi.mock('../../providers/AuthContext', () => ({ useAuth: () => mockUseAuth() }))

vi.mock('../../utils/VisualCard.jsx', () => ({ default: () => <div data-testid="visual-card" /> }))
vi.mock('../news-publishing/ArticleEditor.jsx', () => ({ default: () => <div /> }))
vi.mock('./PostMenu.jsx', () => ({ default: () => null }))
vi.mock('./components/CommentThread.jsx', () => ({ CommentThread: () => null }))
vi.mock('./Stories.jsx', () => ({ default: () => null }))
vi.mock('./Logo.jsx', () => ({ default: () => null }))
vi.mock('./GoLive.jsx', () => ({ default: () => null }))
vi.mock('./UserGoLive.jsx', () => ({ default: () => null }))
vi.mock('../../components/VoiceRecorder.jsx', () => ({ default: () => null }))
vi.mock('../../components/SupportPrompt.jsx', () => ({ default: () => null }))
vi.mock('../../components/BottomNav.jsx', () => ({ default: () => null }))
vi.mock('../../components/layout/AppShell.jsx', () => ({ default: ({ children }) => <div>{children}</div> }))
vi.mock('../../components/layout/RightSidebar.jsx', () => ({ default: () => null }))
vi.mock('../subscriptions-monetization/GiftPanel.jsx', () => ({ default: () => null }))
vi.mock('../../services/notify.js', () => ({ notify: vi.fn() }))
vi.mock('../../services/ensureProfile.js', () => ({ ensureProfile: vi.fn(() => Promise.resolve(true)) }))
vi.mock('../../lib/activeIdentity', () => ({ getActiveIdentity: vi.fn(() => null) }))
vi.mock('../../utils/share.js', () => ({ shareOrCopy: vi.fn().mockResolvedValue('copied'), mediaToFile: vi.fn().mockResolvedValue(null) }))
vi.mock('../../utils/voiceCard.js', () => ({ canExportVideo: () => false, exportImage: vi.fn().mockResolvedValue({}), exportVideo: vi.fn().mockRejectedValue(new Error('no-video')), shareOrDownload: vi.fn() }))
vi.mock('../../utils/imageResize.js', () => ({ resizeImage: vi.fn((file) => Promise.resolve(file)) }))

// Mock DrawingBoard with controllable stroke/clear/save/cancel but no auto-publish
vi.mock('../../components/DrawingBoard.jsx', () => ({
  default: ({ onSave, onCancel }) => (
    <div data-testid="drawing-board">
      <button onClick={() => { /* stroke simulation - no publish */ }} >stroke</button>
      <button onClick={() => { /* erase simulation */ }} >erase</button>
      <button onClick={() => { /* clear simulation */ }} >Clear</button>
      <button onClick={() => {
        const blob = new Blob(['fake-drawing'], { type: 'image/png' })
        onSave(blob)
      }}>Use this drawing</button>
      <button onClick={onCancel}>Cancel draw</button>
      <button onClick={onCancel}>✕</button>
    </div>
  ),
}))

import Feed from './Feed.jsx'

function renderFeed() {
  return render(
    <MemoryRouter initialEntries={['/feed']}>
      <Feed />
    </MemoryRouter>
  )
}

describe('Feed drawing auto-publish fix — one Post = one post', () => {
  beforeEach(() => {
    resetInsertCalls()
    supabaseMock.from.mockClear()
    supabaseMock.rpc.mockClear()
    mockUseAuth.mockReturnValue({ user: { id: 'user-1', email: 'test@test.com' } })
    // ensure window scrolling helpers not to throw
    Object.defineProperty(window, 'scrollY', { value: 0, writable: true, configurable: true })
  })

  it('slow drawing: strokes, erases, redraws without Post creates 0 posts', async () => {
    renderFeed()
    // wait for feed to load
    await waitFor(() => expect(supabaseMock.from).toHaveBeenCalled())

    // switch to visual postType so Draw button appears
    const voiceTab = await screen.findByRole('button', { name: 'Voice card' })
    fireEvent.click(voiceTab)

    const drawBtn = await screen.findByRole('button', { name: /Draw/i })
    fireEvent.click(drawBtn)

    expect(screen.getByTestId('drawing-board')).toBeInTheDocument()

    // simulate 3 minutes of strokes/erases/redraws via mock board's stroke/erase/clear
    const strokeBtn = screen.getByRole('button', { name: 'stroke' })
    const eraseBtn = screen.getByRole('button', { name: 'erase' })
    const clearBtn = screen.getByRole('button', { name: 'Clear' })
    for (let i = 0; i < 50; i++) {
      fireEvent.click(strokeBtn)
      if (i % 10 === 0) fireEvent.click(eraseBtn)
      if (i % 20 === 0) fireEvent.click(clearBtn)
    }

    // still 0 posts inserted - drawing stays draft
    expect(insertCalls.length).toBe(0)

    // Use this drawing - still draft, no insert yet (preview only)
    const useBtn = screen.getByRole('button', { name: 'Use this drawing' })
    fireEvent.click(useBtn)

    // board closes, preview set but still no post
    await waitFor(() => expect(screen.queryByTestId('drawing-board')).not.toBeInTheDocument())
    expect(insertCalls.length).toBe(0)

    // no Post pressed - still 0
    await new Promise(r => setTimeout(r, 50))
    expect(insertCalls.length).toBe(0)
  })

  it('imageFile set via drawing does not auto-insert until explicit Post', async () => {
    renderFeed()
    await waitFor(() => expect(supabaseMock.from).toHaveBeenCalled())
    fireEvent.click(await screen.findByRole('button', { name: 'Voice card' }))
    fireEvent.click(await screen.findByRole('button', { name: /Draw/i }))
    fireEvent.click(screen.getByRole('button', { name: 'Use this drawing' }))
    await waitFor(() => expect(screen.queryByTestId('drawing-board')).not.toBeInTheDocument())
    // draft set, but no insert
    expect(insertCalls.length).toBe(0)

    // caption required for Feed handlePost
    const textbox = screen.getByPlaceholderText('Type your message here...')
    fireEvent.change(textbox, { target: { value: 'My drawing caption' } })

    // Post button should be enabled now
    const postBtn = screen.getByRole('button', { name: /^Post$/ })
    expect(postBtn).not.toBeDisabled()
    // still no insert until click
    expect(insertCalls.length).toBe(0)
  })

  it('single Post with drawing creates exactly 1 post', async () => {
    renderFeed()
    await waitFor(() => expect(supabaseMock.from).toHaveBeenCalled())
    fireEvent.click(await screen.findByRole('button', { name: 'Voice card' }))
    fireEvent.click(await screen.findByRole('button', { name: /Draw/i }))
    fireEvent.click(screen.getByRole('button', { name: 'Use this drawing' }))
    await waitFor(() => expect(screen.queryByTestId('drawing-board')).not.toBeInTheDocument())

    const textbox = screen.getByPlaceholderText('Type your message here...')
    fireEvent.change(textbox, { target: { value: 'My drawing caption' } })

    const postBtn = screen.getByRole('button', { name: /^Post$/ })
    fireEvent.click(postBtn)

    await waitFor(() => expect(insertCalls.length).toBe(1))
    expect(insertCalls[0].image_url).toBeDefined()
    expect(insertCalls[0].content).toBe('My drawing caption')
  })

  it('drawing + caption posts with content + image', async () => {
    renderFeed()
    await waitFor(() => expect(supabaseMock.from).toHaveBeenCalled())
    fireEvent.click(await screen.findByRole('button', { name: 'Voice card' }))
    fireEvent.click(await screen.findByRole('button', { name: /Draw/i }))
    fireEvent.click(screen.getByRole('button', { name: 'Use this drawing' }))
    await waitFor(() => expect(screen.queryByTestId('drawing-board')).not.toBeInTheDocument())

    fireEvent.change(screen.getByPlaceholderText('Type your message here...'), { target: { value: 'Caption with drawing' } })
    fireEvent.click(screen.getByRole('button', { name: /^Post$/ }))
    await waitFor(() => expect(insertCalls.length).toBe(1))
    expect(insertCalls[0].content).toBe('Caption with drawing')
    expect(insertCalls[0].image_url).toBe('https://example.com/drawing.jpg')
  })

  it('rapid double Post still creates only 1 post (posting guard)', async () => {
    renderFeed()
    await waitFor(() => expect(supabaseMock.from).toHaveBeenCalled())
    fireEvent.click(await screen.findByRole('button', { name: 'Voice card' }))
    fireEvent.click(await screen.findByRole('button', { name: /Draw/i }))
    fireEvent.click(screen.getByRole('button', { name: 'Use this drawing' }))
    await waitFor(() => expect(screen.queryByTestId('drawing-board')).not.toBeInTheDocument())

    fireEvent.change(screen.getByPlaceholderText('Type your message here...'), { target: { value: 'Double tap test' } })
    const postBtn = screen.getByRole('button', { name: /^Post$/ })
    // rapid double click
    fireEvent.click(postBtn)
    fireEvent.click(postBtn)
    fireEvent.click(postBtn)

    await waitFor(() => expect(insertCalls.length).toBe(1))
    // wait a bit more to ensure no second insert
    await new Promise(r => setTimeout(r, 100))
    expect(insertCalls.length).toBe(1)
  })

  it('Cancel drawing creates 0 posts and clears draft', async () => {
    renderFeed()
    await waitFor(() => expect(supabaseMock.from).toHaveBeenCalled())
    fireEvent.click(await screen.findByRole('button', { name: 'Voice card' }))
    fireEvent.click(await screen.findByRole('button', { name: /Draw/i }))
    expect(screen.getByTestId('drawing-board')).toBeInTheDocument()

    // Cancel via ✕ or Cancel draw
    fireEvent.click(screen.getByRole('button', { name: 'Cancel draw' }))
    await waitFor(() => expect(screen.queryByTestId('drawing-board')).not.toBeInTheDocument())

    // still no post
    expect(insertCalls.length).toBe(0)

    // even if user fills caption and posts, it will be a text post without image, but still should only post on explicit Post
    // ensure no auto post after cancel
    await new Promise(r => setTimeout(r, 50))
    expect(insertCalls.length).toBe(0)

    // now fill caption and post - should be 1 text post without image (since draft cleared)
    fireEvent.change(screen.getByPlaceholderText('Type your message here...'), { target: { value: 'After cancel' } })
    fireEvent.click(screen.getByRole('button', { name: /^Post$/ }))
    await waitFor(() => expect(insertCalls.length).toBe(1))
    // after cancel, image_url should be null/undefined
    expect(insertCalls[0].image_url).toBeNull()
  })
})
