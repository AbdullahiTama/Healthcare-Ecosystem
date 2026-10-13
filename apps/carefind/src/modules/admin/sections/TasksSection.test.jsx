import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, within, act } from '@testing-library/react'

const state = vi.hoisted(() => ({ query: null, actions: null, toast: null }))

vi.mock('../hooks/useTasksData', () => ({
  useTasksData: () => state.query,
  useTaskActions: () => state.actions,
}))
vi.mock('../provider/AdminProvider.jsx', () => ({ useAdmin: () => ({ showToast: state.toast }) }))

import TasksSection from './TasksSection.jsx'

const DAY = 86400000
const task = (over = {}) => ({
  id: 't1', title: 'Review guide', description: 'Read it', compensation: 1500, specialty: 'Pharmacist',
  created_at: new Date(Date.now() - 3 * DAY).toISOString(), ...over,
})
const queryOf = (over = {}) => ({ data: [], isLoading: false, isError: false, refetch: vi.fn(), ...over })
const type = (el, value) => fireEvent.change(el, { target: { value } })
const title = () => screen.getByLabelText(/Task title/)
const pay = () => screen.getByLabelText(/Compensation/)
const spec = () => screen.getByLabelText(/Target specialty/)
const desc = () => screen.getByLabelText(/Description/)
const submit = () => screen.getByRole('button', { name: /^(create task|creating…)$/i })
const fill = (o = {}) => {
  type(title(), o.title ?? '  Review guide ')
  type(pay(), o.pay ?? ' 500 ')
  type(spec(), o.spec ?? '')
  type(desc(), o.desc ?? ' Read the guide ')
}
const deferred = () => { let resolve; const p = new Promise(r => { resolve = r }); return { p, resolve } }

beforeEach(() => {
  state.query = queryOf()
  state.toast = vi.fn()
  state.actions = { busy: false, createTask: vi.fn().mockResolvedValue({ ok: true }) }
})
afterEach(() => { vi.useRealTimers() })

describe('TasksSection page', () => {
  it('has one h1 with the subtitle', () => {
    render(<TasksSection />)
    expect(screen.getAllByRole('heading', { level: 1 })).toHaveLength(1)
    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('Sponsored Tasks')
    expect(screen.getByText('Create and manage tasks for healthcare professionals')).toBeInTheDocument()
  })

  it('marks the required fields natively and explains the compensation and specialty', () => {
    render(<TasksSection />)
    expect(title()).toBeRequired()
    expect(pay()).toBeRequired()
    expect(desc()).toBeRequired()
    expect(spec()).not.toBeRequired()
    expect(pay()).toHaveAttribute('type', 'text')
    expect(pay()).toHaveAttribute('inputmode', 'numeric')
    expect(screen.getByText('Whole naira, e.g. 500')).toBeInTheDocument()
    expect(screen.getByText('Leave empty for all specialties')).toBeInTheDocument()
  })
})

describe('TasksSection list states', () => {
  it('shows loading', () => {
    state.query = queryOf({ data: undefined, isLoading: true })
    render(<TasksSection />)
    expect(screen.getByRole('status')).toHaveTextContent('Loading tasks…')
  })

  it('shows a failure with Retry and never the empty text', () => {
    const refetch = vi.fn()
    state.query = queryOf({ data: undefined, isError: true, refetch })
    render(<TasksSection />)
    expect(screen.getByRole('alert')).toHaveTextContent("Couldn't load tasks")
    expect(screen.queryByText('No tasks yet')).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: 'Retry loading tasks' }))
    expect(refetch).toHaveBeenCalledTimes(1)
  })

  it('says "No tasks yet" only after a successful empty read', () => {
    render(<TasksSection />)
    expect(screen.getByText('No tasks yet')).toBeInTheDocument()
  })

  it('keeps the list and notes a failed refresh with Retry', () => {
    const refetch = vi.fn()
    state.query = queryOf({ data: [task()], isError: true, refetch })
    render(<TasksSection />)
    expect(screen.getByText('Review guide')).toBeInTheDocument()
    expect(screen.getByRole('alert')).toHaveTextContent("Couldn't refresh tasks")
    fireEvent.click(screen.getByRole('button', { name: 'Retry refreshing tasks' }))
    expect(refetch).toHaveBeenCalledTimes(1)
  })

  it('renders title, specialty, naira amount and age', () => {
    state.query = queryOf({ data: [task(), task({ id: 't2', title: 'Second', specialty: null, compensation: '25000', created_at: 'nonsense' })] })
    render(<TasksSection />)
    const first = screen.getByText('Review guide').closest('li')
    expect(within(first).getByText('Pharmacist')).toBeInTheDocument()
    expect(within(first).getByText(`₦${Number(1500).toLocaleString()}`)).toBeInTheDocument()
    expect(within(first).getByText('3d ago')).toBeInTheDocument()
    const second = screen.getByText('Second').closest('li')
    expect(within(second).getByText('All specialties')).toBeInTheDocument()
    expect(within(second).getByText(`₦${Number(25000).toLocaleString()}`)).toBeInTheDocument()
    expect(within(second).getByText('—')).toBeInTheDocument()
  })

  it('renders task text as inert text, never markup', () => {
    state.query = queryOf({ data: [task({ title: '<img src=x onerror=alert(1)>', specialty: '<b>bold</b>', description: '<script>x</script>' })] })
    const { container } = render(<TasksSection />)
    expect(screen.getByText('<img src=x onerror=alert(1)>')).toBeInTheDocument()
    expect(screen.getByText('<b>bold</b>')).toBeInTheDocument()
    expect(container.querySelector('img, b, script')).toBeNull()
  })

  it('is honest that submissions cannot be reviewed yet', () => {
    render(<TasksSection />)
    expect(screen.getByText("Task submissions can't be reviewed from the console yet.")).toBeInTheDocument()
  })
})

describe('TasksSection create', () => {
  it('sends the exact payload with specialty null when blank, then clears every field', async () => {
    render(<TasksSection />)
    fill()
    await act(async () => { fireEvent.click(submit()) })
    expect(state.actions.createTask).toHaveBeenCalledTimes(1)
    expect(state.actions.createTask).toHaveBeenCalledWith({
      title: 'Review guide', description: 'Read the guide', compensation: '500', specialty: null,
    })
    expect(title()).toHaveValue('')
    expect(pay()).toHaveValue('')
    expect(spec()).toHaveValue('')
    expect(desc()).toHaveValue('')
    expect(screen.queryByRole('alert')).toBeNull()
  })

  it('sends a trimmed specialty when given', async () => {
    render(<TasksSection />)
    fill({ spec: '  Dentist ' })
    await act(async () => { fireEvent.click(submit()) })
    expect(state.actions.createTask.mock.calls[0][0].specialty).toBe('Dentist')
  })

  it.each(['abc', '12.5', '-3', '0', '1e3'])('refuses compensation %s with a message and no call', async (bad) => {
    render(<TasksSection />)
    fill({ pay: bad })
    await act(async () => { fireEvent.click(submit()) })
    expect(state.actions.createTask).not.toHaveBeenCalled()
    expect(screen.getByText('Enter a positive whole-number compensation')).toBeInTheDocument()
    expect(pay()).toHaveAttribute('aria-invalid', 'true')
    expect(title()).toHaveValue('  Review guide ')
  })

  it('clears the compensation message once the value is corrected', async () => {
    render(<TasksSection />)
    fill({ pay: 'abc' })
    await act(async () => { fireEvent.click(submit()) })
    type(pay(), '500')
    expect(screen.queryByText('Enter a positive whole-number compensation')).toBeNull()
  })

  it('keeps everything and shows the error in an alert when the create fails', async () => {
    state.actions.createTask.mockResolvedValue({ ok: false, error: 'server said no' })
    render(<TasksSection />)
    fill({ spec: 'Dentist' })
    await act(async () => { fireEvent.click(submit()) })
    expect(screen.getByRole('alert')).toHaveTextContent('server said no')
    expect(title()).toHaveValue('  Review guide ')
    expect(pay()).toHaveValue(' 500 ')
    expect(spec()).toHaveValue('Dentist')
    expect(desc()).toHaveValue(' Read the guide ')
  })

  it('shows a thrown error as a failure and keeps the form', async () => {
    state.actions.createTask.mockRejectedValue(new Error('network down'))
    render(<TasksSection />)
    fill()
    await act(async () => { fireEvent.click(submit()) })
    expect(screen.getByRole('alert')).toHaveTextContent('network down')
    expect(title()).toHaveValue('  Review guide ')
  })

  it('disables the button while busy', () => {
    state.actions = { busy: true, createTask: vi.fn() }
    render(<TasksSection />)
    expect(submit()).toBeDisabled()
  })

  it('makes one call for a double click', async () => {
    const d = deferred()
    state.actions.createTask.mockReturnValue(d.p)
    render(<TasksSection />)
    fill()
    fireEvent.click(submit())
    fireEvent.click(submit())
    expect(state.actions.createTask).toHaveBeenCalledTimes(1)
    await act(async () => { d.resolve({ ok: true }) })
  })

  it('toasts a failure that arrives after unmount', async () => {
    const d = deferred()
    state.actions.createTask.mockReturnValue(d.p)
    const { unmount } = render(<TasksSection />)
    fill()
    fireEvent.click(submit())
    unmount()
    await act(async () => { d.resolve({ ok: false, error: 'late failure' }) })
    expect(state.toast).toHaveBeenCalledTimes(1)
    expect(state.toast.mock.calls[0][0]).toContain('late failure')
    expect(state.toast.mock.calls[0][1]).toEqual({ type: 'error' })
  })

  it('does not toast a late success (the hook already did)', async () => {
    const d = deferred()
    state.actions.createTask.mockReturnValue(d.p)
    const { unmount } = render(<TasksSection />)
    fill()
    fireEvent.click(submit())
    unmount()
    await act(async () => { d.resolve({ ok: true }) })
    expect(state.toast).not.toHaveBeenCalled()
  })
})
