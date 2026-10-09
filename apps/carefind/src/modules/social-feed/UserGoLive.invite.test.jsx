import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'

// An invitation to co-host must name who sent it. It used to carry no actor, so the notification read "Someone invited
// you...", and the notifications INSERT policy (supabase/migrations/carefind_20261026_notifications_insert_policy.sql)
// only accepts a row whose actor_id is the signed-in user - without it, "Go Live Now" with a guest would create the show and
// then fail on the invitation. This pins the actor so the client can ship before the policy does.
const h = vi.hoisted(() => ({
  createLiveShow: vi.fn(),
  addLiveParticipant: vi.fn(),
  insertNotification: vi.fn(),
  navigate: vi.fn(),
}))

vi.mock('../../config/supabaseClient', () => ({
  supabase: {
    from: () => {
      const q = {}
      q.select = () => q
      q.or = () => q
      q.limit = () => Promise.resolve({ data: [{ id: 'guest-1', full_name: 'Ada Obi', display_name: 'ada', is_verified: false }], error: null })
      return q
    },
  },
}))
vi.mock('./repositories', () => ({
  postRepository: { createLiveShow: h.createLiveShow, addLiveParticipant: h.addLiveParticipant, insertNotification: h.insertNotification },
}))
vi.mock('../../providers/AuthContext', () => {
  const value = { user: { id: 'host-1' } }
  return { useAuth: () => value }
})
vi.mock('react-router-dom', async () => {
  const actual = await vi.importActual('react-router-dom')
  return { ...actual, useNavigate: () => h.navigate }
})

import UserGoLive from './UserGoLive.jsx'

beforeEach(() => {
  vi.clearAllMocks()
  h.createLiveShow.mockResolvedValue({ id: 'show-1', title: 'Skin Q&A' })
  h.addLiveParticipant.mockResolvedValue(undefined)
  h.insertNotification.mockResolvedValue(undefined)
})

async function goLiveWithGuest() {
  render(<MemoryRouter><UserGoLive onClose={vi.fn()} /></MemoryRouter>)
  fireEvent.change(screen.getByPlaceholderText(/e\.g\. managing diabetes/i), { target: { value: 'Skin Q&A' } })
  fireEvent.change(screen.getByPlaceholderText(/search people by name/i), { target: { value: 'Ad' } })
  fireEvent.click(await screen.findByRole('button', { name: /ada obi/i }))
  // The mode toggle and the action button share this label; the action button is the one lower in the sheet.
  fireEvent.click(screen.getAllByText('🔴 Go Live Now').at(-1))
}

describe('UserGoLive co-host invitations', () => {
  it('names the host as the actor of every invitation', async () => {
    await goLiveWithGuest()
    await waitFor(() => expect(h.insertNotification).toHaveBeenCalledTimes(1))
    expect(h.insertNotification).toHaveBeenCalledWith({
      recipient_id: 'guest-1',
      actor_id: 'host-1',
      type: 'live_invite',
      message: 'invited you to co-host a live: "Skin Q&A"',
      link: '/live-dashboard/show-1',
    })
    await waitFor(() => expect(h.navigate).toHaveBeenCalledWith('/live-dashboard/show-1'))
  })

  it('also adds the guest as a participant', async () => {
    await goLiveWithGuest()
    await waitFor(() => expect(h.addLiveParticipant).toHaveBeenCalledWith({ show_id: 'show-1', user_id: 'guest-1', role: 'guest' }))
  })
})
