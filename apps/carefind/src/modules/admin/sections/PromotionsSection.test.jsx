import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor, act } from '@testing-library/react'

const lists = vi.hoisted(() => ({ result: null }))
const actions = vi.hoisted(() => ({ busy: false, createPromotion: vi.fn(), deletePromotion: vi.fn() }))
const admin = vi.hoisted(() => ({ askConfirm: vi.fn(), showToast: vi.fn() }))

vi.mock('../hooks/useContentLists', () => ({ usePromotionsList: () => lists.result }))
vi.mock('../hooks/useContentActions', () => ({
  useContentActions: () => ({ busy: actions.busy, createPromotion: actions.createPromotion, deletePromotion: actions.deletePromotion }),
}))
vi.mock('../provider/AdminProvider.jsx', () => ({
  useAdmin: () => ({ askConfirm: admin.askConfirm, showToast: admin.showToast }),
}))

import PromotionsSection from './PromotionsSection.jsx'

const day = 86400000
const promos = [
  { id: 'p1', title: '50% off Vitamin C', link_url: 'https://shop.example/vit-c', image_url: 'https://cdn.example/p1.jpg', created_at: new Date(Date.now() - 2 * day).toISOString(), expires_at: new Date(Date.now() + 5 * day).toISOString() },
  { id: 'p2', title: 'Sneaky', link_url: 'javascript:alert(1)', image_url: 'javascript:alert(2)', created_at: new Date(Date.now() - 9 * day).toISOString(), expires_at: new Date(Date.now() - 2 * day).toISOString() },
  { id: 'p3', title: 'Internal', link_url: '/business/xyz', image_url: null, created_at: new Date(Date.now() - 1 * day).toISOString(), expires_at: null },
]
const loaded = (over = {}) => ({ data: promos, isLoading: false, isError: false, refetch: vi.fn(), ...over })
const CONSEQUENCE = 'This permanently removes the promotion from the app. This cannot be undone.'

const titleBox = () => screen.getByLabelText(/^Promotion Title/)
const linkBox = () => screen.getByLabelText('Link URL')
const durationBox = () => screen.getByLabelText('Duration')
const fileBox = () => screen.getByLabelText('Image (optional)')
const add = () => screen.getByRole('button', { name: /^(add promotion|adding)/i })
const png = () => new File(['x'], 'promo.png', { type: 'image/png' })
const chooseFile = async (file) => {
  fireEvent.change(fileBox(), { target: { files: [file] } })
  await screen.findByAltText('Selected image preview')
}
const submit = async () => { await act(async () => { fireEvent.click(add()) }) }

beforeEach(() => {
  lists.result = loaded()
  actions.busy = false
  actions.createPromotion.mockReset()
  actions.createPromotion.mockResolvedValue({ ok: true })
  actions.deletePromotion.mockReset()
  actions.deletePromotion.mockResolvedValue({ ok: true })
  admin.askConfirm.mockReset()
  admin.showToast.mockReset()
})

describe('PromotionsSection', () => {
  it('shows the heading, subtitle and the create panel', () => {
    render(<PromotionsSection />)
    expect(screen.getByRole('heading', { level: 1, name: 'Promotions' })).toBeInTheDocument()
    expect(screen.getByText('Manage featured promotions in the MedMarket strip')).toBeInTheDocument()
    expect(screen.getByText('Add a Promotion')).toBeInTheDocument()
    expect(screen.getByText('Promotions appear in the moving featured strip and auto-expire')).toBeInTheDocument()
    expect(screen.getByText('Where users go when they tap the promotion')).toBeInTheDocument()
    expect(titleBox()).toBeRequired()
    expect(linkBox()).toBeInTheDocument()
  })

  it('keeps Add promotion disabled until there is a trimmed title', () => {
    render(<PromotionsSection />)
    expect(add()).toBeDisabled()
    fireEvent.change(titleBox(), { target: { value: '   ' } })
    expect(add()).toBeDisabled()
    fireEvent.change(titleBox(), { target: { value: 'Sale' } })
    expect(add()).toBeEnabled()
  })

  it('offers the five durations with 7 days selected', () => {
    render(<PromotionsSection />)
    const options = [...durationBox().querySelectorAll('option')].filter(o => o.value !== '')
    expect(options.map(o => [o.value, o.textContent])).toEqual([
      ['3', '3 days'], ['7', '7 days'], ['14', '14 days'], ['30', '30 days'], ['90', '90 days'],
    ])
    expect(durationBox()).toHaveValue('7')
  })

  it('creates with trimmed title, the link as typed, days as a string, and clears the form', async () => {
    render(<PromotionsSection />)
    const file = png()
    fireEvent.change(titleBox(), { target: { value: '  Big sale  ' } })
    fireEvent.change(linkBox(), { target: { value: ' https://x.example/a ' } })
    fireEvent.change(durationBox(), { target: { value: '30' } })
    await chooseFile(file)
    await submit()
    expect(actions.createPromotion).toHaveBeenCalledTimes(1)
    expect(actions.createPromotion).toHaveBeenCalledWith({ title: 'Big sale', linkUrl: ' https://x.example/a ', days: '30', imageFile: file })
    await waitFor(() => expect(titleBox()).toHaveValue(''))
    expect(linkBox()).toHaveValue('')
    expect(durationBox()).toHaveValue('7')
    expect(fileBox().files).toHaveLength(0)
    expect(screen.queryByAltText('Selected image preview')).not.toBeInTheDocument()
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
  })

  it('sends a blank link through as given, with days defaulting to the string 7', async () => {
    render(<PromotionsSection />)
    fireEvent.change(titleBox(), { target: { value: 'Sale' } })
    await submit()
    expect(actions.createPromotion).toHaveBeenCalledWith({ title: 'Sale', linkUrl: '', days: '7', imageFile: null })
  })

  it('shows the error and keeps every field and the file when the create fails', async () => {
    actions.createPromotion.mockResolvedValue({ ok: false, error: "Couldn't upload the image: too large" })
    render(<PromotionsSection />)
    const file = png()
    fireEvent.change(titleBox(), { target: { value: 'Big sale' } })
    fireEvent.change(linkBox(), { target: { value: '/business/abc' } })
    fireEvent.change(durationBox(), { target: { value: '14' } })
    await chooseFile(file)
    await submit()
    const alert = await screen.findByRole('alert')
    expect(alert).toHaveTextContent("Couldn't upload the image: too large")
    expect(titleBox()).toHaveValue('Big sale')
    expect(linkBox()).toHaveValue('/business/abc')
    expect(durationBox()).toHaveValue('14')
    expect(fileBox().files[0]).toBe(file)
    expect(screen.getByAltText('Selected image preview')).toBeInTheDocument()
    expect(screen.getByText('promo.png')).toBeInTheDocument()
    // retry with the same file
    actions.createPromotion.mockResolvedValue({ ok: true })
    await submit()
    expect(actions.createPromotion).toHaveBeenLastCalledWith({ title: 'Big sale', linkUrl: '/business/abc', days: '14', imageFile: file })
    await waitFor(() => expect(titleBox()).toHaveValue(''))
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
  })

  it('removes the chosen image with Remove image', async () => {
    render(<PromotionsSection />)
    await chooseFile(png())
    fireEvent.click(screen.getByRole('button', { name: 'Remove image' }))
    expect(screen.queryByAltText('Selected image preview')).not.toBeInTheDocument()
    expect(fileBox().files).toHaveLength(0)
  })

  it('disables every control while busy', async () => {
    const view = render(<PromotionsSection />)
    await chooseFile(png())
    fireEvent.change(titleBox(), { target: { value: 'Sale' } })
    actions.busy = true
    view.rerender(<PromotionsSection />)
    expect(titleBox()).toBeDisabled()
    expect(linkBox()).toBeDisabled()
    expect(durationBox()).toBeDisabled()
    expect(fileBox()).toBeDisabled()
    expect(screen.getByRole('button', { name: 'Remove image' })).toBeDisabled()
    expect(add()).toBeDisabled()
    const deletes = screen.getAllByRole('button', { name: /^Delete promotion/ })
    expect(deletes).toHaveLength(3)
    for (const b of deletes) expect(b).toBeDisabled()
  })

  it('lists promotions with title, age, expiry and thumbnail', () => {
    render(<PromotionsSection />)
    expect(screen.getByText('50% off Vitamin C')).toBeInTheDocument()
    expect(screen.getByText(/2d ago/)).toBeInTheDocument()
    expect(screen.getByText(/^Expires /)).toBeInTheDocument()
    expect(screen.getByText(/Expired/)).toBeInTheDocument()
    expect(screen.getByText(/No expiry/)).toBeInTheDocument()
    const imgs = document.querySelectorAll('li img')
    expect(imgs).toHaveLength(1)
    expect(imgs[0]).toHaveAttribute('src', 'https://cdn.example/p1.jpg')
  })

  it('links only http(s) URLs; anything else, including javascript:, is plain text', () => {
    render(<PromotionsSection />)
    const link = screen.getByRole('link', { name: 'https://shop.example/vit-c' })
    expect(link).toHaveAttribute('href', 'https://shop.example/vit-c')
    expect(link).toHaveAttribute('rel', expect.stringContaining('noreferrer'))
    expect(link).toHaveAttribute('target', '_blank')
    expect(screen.getByText('javascript:alert(1)')).toBeInTheDocument()
    expect(screen.getByText('javascript:alert(1)').closest('a')).toBeNull()
    expect(screen.getByText('/business/xyz').closest('a')).toBeNull()
    expect(document.querySelectorAll('li a')).toHaveLength(1)
    expect(document.querySelector('[href^="javascript"]')).toBeNull()
  })

  it('asks for confirmation with the legacy text and deletes only after it is confirmed', async () => {
    render(<PromotionsSection />)
    fireEvent.click(screen.getByRole('button', { name: 'Delete promotion 50% off Vitamin C' }))
    expect(actions.deletePromotion).not.toHaveBeenCalled()
    expect(admin.askConfirm).toHaveBeenCalledTimes(1)
    const arg = admin.askConfirm.mock.calls[0][0]
    expect(arg).toMatchObject({ title: 'Delete this promotion?', consequence: CONSEQUENCE, confirmLabel: 'Delete' })
    await act(async () => { await arg.action() })
    expect(actions.deletePromotion).toHaveBeenCalledWith('p1')
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
  })

  it('shows a failed delete inline on that promotion only', async () => {
    actions.deletePromotion.mockResolvedValue({ ok: false, error: 'Forbidden' })
    render(<PromotionsSection />)
    fireEvent.click(screen.getByRole('button', { name: 'Delete promotion 50% off Vitamin C' }))
    await act(async () => { await admin.askConfirm.mock.calls[0][0].action() })
    const alert = screen.getByRole('alert')
    expect(alert).toHaveTextContent("Couldn't delete the promotion: Forbidden")
    expect(screen.getByText('50% off Vitamin C').closest('li')).toContainElement(alert)
    expect(admin.showToast).not.toHaveBeenCalled()
  })

  it('shows a loading status while the list loads', () => {
    lists.result = loaded({ data: undefined, isLoading: true })
    render(<PromotionsSection />)
    expect(screen.getByRole('status')).toHaveTextContent(/loading promotions/i)
    expect(screen.queryByText('No promotions yet')).not.toBeInTheDocument()
  })

  it('shows Retry, never the empty text, when the list failed', () => {
    const refetch = vi.fn()
    lists.result = loaded({ data: undefined, isError: true, refetch })
    render(<PromotionsSection />)
    expect(screen.getByText("Couldn't load promotions")).toBeInTheDocument()
    expect(screen.queryByText('No promotions yet')).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }))
    expect(refetch).toHaveBeenCalledTimes(1)
  })

  it('shows the empty text when there are no promotions', () => {
    lists.result = loaded({ data: [] })
    render(<PromotionsSection />)
    expect(screen.getByText('No promotions yet')).toBeInTheDocument()
  })

  it('renders promotion text as text, never as markup', () => {
    lists.result = loaded({ data: [{ id: 'x', title: '<b>bold</b>', link_url: null, created_at: new Date().toISOString() }] })
    render(<PromotionsSection />)
    expect(screen.getByText('<b>bold</b>')).toBeInTheDocument()
    expect(document.querySelector('li b')).toBeNull()
  })
})
