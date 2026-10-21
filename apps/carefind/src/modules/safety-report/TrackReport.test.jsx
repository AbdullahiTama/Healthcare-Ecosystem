import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import TrackReportPage, { problemMessage, STAGE_TEXT } from './TrackReportPage.jsx'

const repo = { trackReport: vi.fn() }
const mount = () => render(<MemoryRouter><TrackReportPage repository={repo} /></MemoryRouter>)
const type = (label, value) => fireEvent.change(screen.getByLabelText(label), { target: { value } })

beforeEach(() => { vi.clearAllMocks(); window.history.replaceState({}, '', '/track-report') })

describe('TrackReportPage', () => {
  it('shows the stage of each product for a matching report, and nothing else', async () => {
    repo.trackReport.mockResolvedValue({ found: true, report_number: 'ADR-2026-000123', submitted_at: '2026-10-20T10:00:00Z',
      products: [{ product: 'Ampiclox', stage: 'sent_to_company' }] })
    mount()
    type(/ADR number/, ' adr-2026-000123 ')
    fireEvent.click(screen.getByRole('button', { name: 'Check report' }))
    await waitFor(() => expect(screen.getByText('Sent to the company')).toBeTruthy())
    expect(repo.trackReport).toHaveBeenCalledWith('ADR-2026-000123', '')
    expect(screen.getByText('Ampiclox')).toBeTruthy()
  })

  it('a number that does not match says so, without saying why', async () => {
    repo.trackReport.mockResolvedValue({ found: false })
    mount()
    type(/ADR number/, 'ADR-2026-000999')
    fireEvent.click(screen.getByRole('button', { name: 'Check report' }))
    await waitFor(() => expect(screen.getByText(/could not find a report that matches/i)).toBeTruthy())
  })

  it('a badly formed number is rejected before any request', async () => {
    mount()
    type(/ADR number/, 'hello')
    fireEvent.click(screen.getByRole('button', { name: 'Check report' }))
    await waitFor(() => expect(screen.getByText(/Check the number/)).toBeTruthy())
    expect(repo.trackReport).not.toHaveBeenCalled()
  })

  it('a failed lookup is an error, not "not found"', async () => {
    repo.trackReport.mockRejectedValue(new Error('Failed to fetch'))
    mount()
    type(/ADR number/, 'ADR-2026-000123')
    fireEvent.click(screen.getByRole('button', { name: 'Check report' }))
    await waitFor(() => expect(screen.getByRole('alert').textContent).toMatch(/Check your connection/))
    expect(screen.queryByText(/could not find a report/i)).toBeNull()
  })

  it('arriving from the receipt (?ref=) looks the report up straight away', async () => {
    window.history.replaceState({}, '', '/track-report?ref=ADR-2026-000123')
    repo.trackReport.mockResolvedValue({ found: true, report_number: 'ADR-2026-000123', products: [{ product: 'X', stage: 'received' }] })
    mount()
    await waitFor(() => expect(screen.getByText('Received')).toBeTruthy())
    expect(repo.trackReport).toHaveBeenCalledTimes(1)
  })

  it('every stage the server can return has plain-language text', () => {
    for (const k of ['received', 'in_review', 'sent_to_company', 'acknowledged_by_company', 'under_assessment', 'closed']) expect(STAGE_TEXT[k]).toHaveLength(2)
    expect(problemMessage(new Error('too_many_attempts'))).toMatch(/Too many attempts/)
    expect(problemMessage(new Error('sign_in_required'))).toMatch(/sign in/i)
  })
})
