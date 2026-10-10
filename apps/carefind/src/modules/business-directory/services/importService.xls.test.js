import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

// Excel files are parsed on the server by a reader that only understands .xlsx. A legacy .xls must be refused up front, with a
// message that tells the user what to do, instead of being sent to the server to fail.
vi.mock('../../../config/supabaseClient.js', () => ({
  supabase: { auth: { getSession: async () => ({ data: { session: { access_token: 'tok' } } }) } },
}))

import { parseFile, LEGACY_XLS_MESSAGE } from './importService'

describe('parseFile and legacy .xls', () => {
  beforeEach(() => { vi.stubGlobal('fetch', vi.fn()) })
  afterEach(() => vi.unstubAllGlobals())

  it('refuses a .xls (any letter case) before making any request, and says how to fix it', async () => {
    for (const name of ['list.xls', 'LIST.XLS']) {
      await expect(parseFile({ name })).rejects.toThrow(LEGACY_XLS_MESSAGE)
    }
    expect(fetch).not.toHaveBeenCalled()
    expect(LEGACY_XLS_MESSAGE).toMatch(/\.xlsx/)
    expect(LEGACY_XLS_MESSAGE).toMatch(/Save As/)
  })

  it('sends a .xlsx to the server parser as an authenticated multipart upload and returns its rows', async () => {
    fetch.mockResolvedValue({ ok: true, json: async () => ({ headers: ['name'], records: [{ name: 'Ada' }], totalRows: 1 }) })
    const file = new File(['PK'], 'list.xlsx')
    await expect(parseFile(file)).resolves.toEqual({ headers: ['name'], records: [{ name: 'Ada' }], totalRows: 1 })

    const [url, init] = fetch.mock.calls[0]
    expect(url).toBe('/api/excel-import')
    expect(init.headers.Authorization).toBe('Bearer tok')
    expect(init.body).toBeInstanceOf(FormData)
    expect(init.body.get('file')).toBe(file)
  })

  it("shows the server's reason when it cannot read the workbook", async () => {
    fetch.mockResolvedValue({ ok: false, json: async () => ({ error: "Failed to parse Excel file: Doesn't look like an `.xlsx` file" }) })
    await expect(parseFile(new File(['x'], 'bad.xlsx'))).rejects.toThrow(/Doesn't look like an `.xlsx` file/)
  })
})
