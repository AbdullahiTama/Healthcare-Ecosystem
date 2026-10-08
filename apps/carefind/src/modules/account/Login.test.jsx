import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'

const { signIn, signUp, rpc, navigate, breakpoint } = vi.hoisted(() => ({
  signIn: vi.fn(),
  signUp: vi.fn(),
  rpc: vi.fn(),
  navigate: vi.fn(),
  breakpoint: { isMobileOrTablet: false },
}))

vi.mock('../../providers/AuthContext', () => ({ useAuth: () => ({ signIn, signUp }) }))
vi.mock('../../config/supabaseClient', () => ({ supabase: { rpc } }))
vi.mock('../../hooks/useBreakpoint', () => ({ useBreakpoint: () => breakpoint }))
vi.mock('react-router-dom', async () => {
  const actual = await vi.importActual('react-router-dom')
  return { ...actual, useNavigate: () => navigate }
})

import Login from './Login'

function renderLogin() {
  return render(
    <MemoryRouter>
      <Login />
    </MemoryRouter>,
  )
}

function fillAndSubmit(email = 'a@b.co', password = 'secret1') {
  fireEvent.change(screen.getByLabelText(/email address/i), { target: { value: email } })
  fireEvent.change(screen.getByLabelText(/^password/i), { target: { value: password } })
  fireEvent.submit(screen.getByLabelText(/email address/i).closest('form'))
}

describe('Login', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    localStorage.clear()
    breakpoint.isMobileOrTablet = false
    signIn.mockResolvedValue({ error: null })
    signUp.mockResolvedValue({ data: { session: { access_token: 't' } }, error: null })
    rpc.mockResolvedValue({ data: null })
  })

  describe.each([
    ['desktop', false],
    ['mobile/tablet', true],
  ])('%s layout', (_name, isMobileOrTablet) => {
    beforeEach(() => { breakpoint.isMobileOrTablet = isMobileOrTablet })

    it('shows one page heading, the portrait with alt text and the form', () => {
      renderLogin()
      expect(screen.getAllByRole('heading', { level: 1 })).toHaveLength(1)
      expect(screen.getByRole('img', { name: /pharmacist/i })).toBeInTheDocument()
      expect(screen.getByLabelText(/email address/i)).toBeInTheDocument()
      expect(screen.getByRole('link', { name: /forgot password/i })).toBeInTheDocument()
    })

    it('logs a regular user in and sends them to the feed', async () => {
      renderLogin()
      fillAndSubmit()
      await waitFor(() => expect(navigate).toHaveBeenCalledWith('/feed'))
      expect(signIn).toHaveBeenCalledWith('a@b.co', 'secret1')
    })
  })

  it('lists the trust points on desktop', () => {
    renderLogin()
    expect(screen.getByText('Verified sellers')).toBeInTheDocument()
    expect(screen.getByText('Fast & reliable')).toBeInTheDocument()
    expect(screen.getByText('Compare prices')).toBeInTheDocument()
  })

  it('shows the auth error in an alert and re-enables the form', async () => {
    signIn.mockResolvedValue({ error: { message: 'Invalid login credentials' } })
    renderLogin()
    fillAndSubmit()
    expect(await screen.findByRole('alert')).toHaveTextContent('Invalid login credentials')
    expect(navigate).not.toHaveBeenCalled()
    expect(screen.getByRole('button', { name: 'Log In' })).toBeEnabled()
  })

  it('switches to sign-up, asks for a location and signs up into onboarding', async () => {
    renderLogin()
    fireEvent.click(screen.getByRole('button', { name: 'Sign Up' }))
    expect(screen.getByRole('heading', { name: 'Create your account' })).toBeInTheDocument()
    fireEvent.change(screen.getByLabelText(/your location/i), { target: { value: ' Lagos ' } })
    fillAndSubmit()
    await waitFor(() => expect(navigate).toHaveBeenCalledWith('/onboarding'))
    expect(signUp).toHaveBeenCalledWith('a@b.co', 'secret1', { location: 'Lagos' })
  })

  it('asks the user to confirm their email when sign-up returns no session', async () => {
    signUp.mockResolvedValue({ data: { session: null }, error: null })
    renderLogin()
    fireEvent.click(screen.getByRole('button', { name: 'Sign Up' }))
    fillAndSubmit()
    expect(await screen.findByText('Confirm your email')).toBeInTheDocument()
    expect(navigate).not.toHaveBeenCalled()
    fireEvent.click(screen.getByRole('button', { name: 'Back to log in' }))
    expect(screen.getByRole('heading', { name: 'Welcome back' })).toBeInTheDocument()
  })

  it('routes an admin to the admin panel', async () => {
    rpc.mockResolvedValue({ data: { id: 'a1', role: 'moderator' } })
    renderLogin()
    fillAndSubmit()
    await waitFor(() => expect(navigate).toHaveBeenCalledWith('/admin-panel'))
  })

  it('says phone login is coming soon and exposes the switch state to assistive tech', () => {
    renderLogin()
    const group = screen.getByRole('group', { name: /sign-in method/i })
    expect(within(group).getByRole('button', { name: 'Email' })).toHaveAttribute('aria-pressed', 'true')
    fireEvent.click(within(group).getByRole('button', { name: 'Phone' }))
    expect(within(group).getByRole('button', { name: 'Phone' })).toHaveAttribute('aria-pressed', 'true')
    expect(screen.getByText(/phone login is coming soon/i)).toBeInTheDocument()
  })
})
