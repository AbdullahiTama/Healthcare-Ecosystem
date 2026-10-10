import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, fireEvent } from '@testing-library/react'

// The upload screen's file checks. Legacy .xls is refused by extension; the MIME type cannot decide, because Windows reports a
// plain .csv as application/vnd.ms-excel too.
const h = vi.hoisted(() => ({ uploadFile: vi.fn() }))
vi.mock('./hooks', () => ({
  useBusinessImport: () => ({
    step: 'upload', file: null, parsedData: null, validationResult: null, importResult: null, isLoading: false, error: null,
    uploadFile: h.uploadFile, parseFile: vi.fn(), validateRecords: vi.fn(), startImport: vi.fn(), reset: vi.fn(),
  }),
}))

import BusinessImportTab from './BusinessImportTab.jsx'
import { LEGACY_XLS_MESSAGE } from './services/importService'

const pick = (onError, file) => {
  const { container } = render(<BusinessImportTab onComplete={vi.fn()} onError={onError} />)
  const input = container.querySelector('input[type="file"]')
  fireEvent.change(input, { target: { files: [file] } })
  return input
}

describe('BusinessImportTab file checks', () => {
  beforeEach(() => h.uploadFile.mockClear())

  it('does not offer .xls in the file picker', () => {
    const { container } = render(<BusinessImportTab onComplete={vi.fn()} onError={vi.fn()} />)
    expect(container.querySelector('input[type="file"]').getAttribute('accept')).toBe('.csv,.xlsx')
  })

  it('refuses a .xls with the explanation, even though its MIME type looks acceptable', () => {
    const onError = vi.fn()
    pick(onError, new File(['x'], 'directory.xls', { type: 'application/vnd.ms-excel' }))
    expect(onError).toHaveBeenCalledWith(LEGACY_XLS_MESSAGE)
    expect(h.uploadFile).not.toHaveBeenCalled()
  })

  it('still accepts a .csv that Windows labels application/vnd.ms-excel', () => {
    const onError = vi.fn()
    pick(onError, new File(['name,state'], 'directory.csv', { type: 'application/vnd.ms-excel' }))
    expect(onError).not.toHaveBeenCalled()
    expect(h.uploadFile).toHaveBeenCalledTimes(1)
  })

  it('accepts a .xlsx, and refuses other types', () => {
    let onError = vi.fn()
    pick(onError, new File(['PK'], 'directory.xlsx', { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }))
    expect(h.uploadFile).toHaveBeenCalledTimes(1)

    onError = vi.fn()
    pick(onError, new File(['x'], 'notes.txt', { type: 'text/plain' }))
    expect(onError).toHaveBeenCalledWith('Please upload a CSV or Excel file')
    expect(h.uploadFile).toHaveBeenCalledTimes(1)
  })
})
