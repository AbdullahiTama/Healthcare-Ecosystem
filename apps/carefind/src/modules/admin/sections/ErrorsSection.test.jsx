import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import * as adminApi from '../adminApi'
import ErrorsSection from './ErrorsSection.jsx'

afterEach(() => { vi.restoreAllMocks() })

describe('ErrorsSection', () => {
  it('says the error inbox is not connected, and why', () => {
    render(<ErrorsSection />)
    expect(screen.getByRole('heading', { level: 1, name: 'Error Inbox' })).toBeInTheDocument()
    expect(screen.getByText("The error inbox isn't connected yet")).toBeInTheDocument()
    expect(screen.getByText('The server has no actions to list or resolve errors, so there is nothing to show here.')).toBeInTheDocument()
  })

  it('makes no request of any kind', () => {
    const callAdminAuth = vi.spyOn(adminApi, 'callAdminAuth')
    const getHeader = vi.spyOn(adminApi, 'getAdminAuthorizationHeader')
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response('{}'))
    render(<ErrorsSection />)
    expect(callAdminAuth).not.toHaveBeenCalled()
    expect(getHeader).not.toHaveBeenCalled()
    expect(fetchSpy).not.toHaveBeenCalled()
  })
})
