import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import SafetyReportPage from './SafetyReportPage.jsx'
import ReviewStep from './steps/ReviewStep.jsx'
import CompanyPicker from './CompanyPicker.jsx'
import { WELCOME_HEADING, STEPS } from './constants.js'

const { mockRepo } = vi.hoisted(() => ({
  mockRepo: {
    getMyProfile: vi.fn(),
    getMyDrafts: vi.fn(),
    createDraft: vi.fn(),
    getDraftWithDetails: vi.fn(),
    updateDraft: vi.fn(),
    saveProduct: vi.fn(),
    saveReaction: vi.fn(),
    saveMed: vi.fn(),
    deleteProduct: vi.fn(),
    deleteReaction: vi.fn(),
    deleteMed: vi.fn(),
    createRoute: vi.fn(),
    submit: vi.fn(),
    uploadAttachment: vi.fn(),
    removeAttachment: vi.fn(),
    signedAttachmentUrl: vi.fn(),
    searchCompanies: vi.fn(),
  },
}))

vi.mock('./repository', () => ({ safetyReportRepository: mockRepo }))
vi.mock('../../providers/AuthContext', () => ({
  useAuth: () => ({ user: { id: 'user-1', email: 'a@example.com' } }),
}))

function renderPage() {
  return render(
    <MemoryRouter>
      <SafetyReportPage />
    </MemoryRouter>
  )
}

const validDraft = {
  reporter: { name: 'Ada', qualification: 'consumer', phone: '0801', email: '', consentFollowup: true, anonymousConfirmed: false, facilityName: '' },
  patient: { identifier: 'AB', gender: 'female', age: '34', dob: '', ageGroup: '' },
  products: [{ brandName: 'Ampiclox', company: { kind: 'unknown', businessId: '', businessName: '', candidateName: '' } }],
  reactions: [{
    description: 'Rash', severity: 'moderate', outcome: 'recovering',
    seriousness: { death: 'no', life_threatening: 'no', hospitalization: 'no', disability: 'no', congenital_anomaly: 'no', other_medically_important: 'no' },
  }],
  meds: [],
  extra: { conditions: '', notes: '' },
  attachments: [],
}

beforeEach(() => {
  vi.clearAllMocks()
  mockRepo.getMyProfile.mockResolvedValue({ display_name: 'Ada' })
  mockRepo.getMyDrafts.mockResolvedValue([])
  mockRepo.createDraft.mockResolvedValue({ report_id: 'r1', report_number: 'ADR-2026-000001' })
  mockRepo.updateDraft.mockResolvedValue({ report_number: 'ADR-2026-000001' })
})

describe('SafetyReportPage welcome', () => {
  it('shows the approved heading, safety explanation and emergency note', async () => {
    renderPage()
    expect(await screen.findByText(WELCOME_HEADING)).toBeTruthy()
    expect(screen.getByText(/helps monitor medicine safety/i)).toBeTruthy()
    expect(screen.getByText(/does not prove/i)).toBeTruthy()
    expect(screen.getByText(/not.*an emergency service/i)).toBeTruthy()
    expect(screen.getByRole('button', { name: /start report/i })).toBeTruthy()
  })

  it('offers Continue draft when a draft exists', async () => {
    mockRepo.getMyDrafts.mockResolvedValue([{ report_id: 'd9', created_at: new Date().toISOString() }])
    renderPage()
    expect(await screen.findByRole('button', { name: /continue draft/i })).toBeTruthy()
  })

  it('starts a new draft and opens the reporter step', async () => {
    renderPage()
    fireEvent.click(await screen.findByRole('button', { name: /start report/i }))
    expect(await screen.findByText('About you (the reporter)')).toBeTruthy()
    expect(mockRepo.createDraft).toHaveBeenCalledTimes(1)
    const payload = mockRepo.createDraft.mock.calls[0][0]
    expect(payload.reporter.email).toBe('a@example.com')
  })

  it('blocks continue until the reporter step is complete', async () => {
    renderPage()
    fireEvent.click(await screen.findByRole('button', { name: /start report/i }))
    await screen.findByText('About you (the reporter)')
    fireEvent.click(screen.getByRole('button', { name: /save & continue/i }))
    expect(await screen.findByText(/please complete/i)).toBeTruthy()
    expect(screen.queryByText(/person affected/i)).toBeNull()
    expect(mockRepo.updateDraft).not.toHaveBeenCalled()
  })
})

describe('ReviewStep', () => {
  it('enables submit for a complete draft and forwards submit', () => {
    const onSubmit = vi.fn()
    const onEdit = vi.fn()
    render(<ReviewStep draft={validDraft} missing={[]} onEdit={onEdit} onSubmit={onSubmit} submitting={false} submitError={null} />)
    const btn = screen.getByRole('button', { name: /submit safety report/i })
    expect(btn.disabled).toBe(false)
    fireEvent.click(btn)
    expect(onSubmit).toHaveBeenCalledTimes(1)
    expect(screen.getByText('Ampiclox')).toBeTruthy()
  })

  it('disables submit and links each missing item to its step', () => {
    const onEdit = vi.fn()
    const missing = [{ step: STEPS.PRODUCTS, label: 'Product brand name' }]
    render(<ReviewStep draft={{ ...validDraft, products: [] }} missing={missing} onEdit={onEdit} onSubmit={() => {}} submitting={false} submitError={null} />)
    expect(screen.getByRole('button', { name: /submit safety report/i }).disabled).toBe(true)
    fireEvent.click(screen.getByRole('button', { name: /edit Medicine or product/i }))
    expect(onEdit).toHaveBeenCalledWith(STEPS.PRODUCTS)
  })
})

describe('CompanyPicker', () => {
  const base = { kind: 'unknown', businessId: '', businessName: '', candidateName: '' }

  it('stores manual text as an unverified candidate', () => {
    const onChange = vi.fn()
    render(<CompanyPicker value={base} onChange={onChange} searchCompanies={mockRepo.searchCompanies} />)
    fireEvent.click(screen.getByText('I can’t find the company'))
    fireEvent.change(screen.getByPlaceholderText(/exactly as printed/i), { target: { value: 'Acme Labs' } })
    expect(onChange).toHaveBeenCalledWith(expect.objectContaining({ kind: 'unverified_candidate', candidateName: 'Acme Labs' }))
  })

  it('searches registered companies and selects one verified pick', async () => {
    mockRepo.searchCompanies.mockResolvedValue([{ business_id: 'b1', business_name: 'Fidson', business_type: 'manufacturer_importer', city: 'Lagos', state: 'Lagos', matched_alias: null }])
    const onChange = vi.fn()
    let value = { ...base, kind: 'verified' }
    const { rerender } = render(<CompanyPicker value={value} onChange={(v) => { value = v; onChange(v) }} searchCompanies={mockRepo.searchCompanies} />)
    fireEvent.change(screen.getByLabelText(/search registered companies/i), { target: { value: 'Fidson' } })
    await waitFor(() => expect(mockRepo.searchCompanies).toHaveBeenCalledWith('Fidson', 10))
    rerender(<CompanyPicker value={value} onChange={onChange} searchCompanies={mockRepo.searchCompanies} />)
    fireEvent.click(await screen.findByRole('option', { name: /fidson/i }))
    expect(onChange).toHaveBeenCalledWith(expect.objectContaining({ kind: 'verified', businessId: 'b1', businessName: 'Fidson' }))
  })
})
