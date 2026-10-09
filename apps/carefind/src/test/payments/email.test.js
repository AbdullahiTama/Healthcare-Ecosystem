import { describe, it, expect, vi } from 'vitest'
import { sendEmail, renderEmail, escapeHtml, isValidEmail } from '../../../api/_lib/email.js'

const quietLogger = () => ({ warn: vi.fn(), error: vi.fn(), info: vi.fn() })
const okResponse = (body = { id: 'em_1' }) => ({ ok: true, status: 200, json: async () => body })

describe('sendEmail', () => {
  it('skips quietly when no API key is configured', async () => {
    const fetchImpl = vi.fn()
    const logger = quietLogger()
    const r = await sendEmail({ to: 'a@b.co', subject: 's', html: 'h' }, { env: {}, fetchImpl, logger })
    expect(r).toEqual({ sent: false, skipped: 'not_configured' })
    expect(fetchImpl).not.toHaveBeenCalled()
    expect(logger.warn).toHaveBeenCalled()
  })

  it('refuses an invalid recipient without calling the provider', async () => {
    const fetchImpl = vi.fn()
    for (const to of [undefined, '', 'not-an-email', 'a@b', 'a b@c.co', 'x@y.co,z@y.co']) {
      const r = await sendEmail({ to, subject: 's', html: 'h' }, { env: { RESEND_API_KEY: 'k' }, fetchImpl, logger: quietLogger() })
      expect(r, String(to)).toEqual({ sent: false, skipped: 'invalid_recipient' })
    }
    expect(fetchImpl).not.toHaveBeenCalled()
  })

  it('posts the message to Resend with the key, sender, html and text', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(okResponse())
    const r = await sendEmail(
      { to: ' ada@example.com ', subject: 'Receipt\r\nBcc: evil@x.co', html: '<p>hi</p>', text: 'hi' },
      { env: { RESEND_API_KEY: 're_key', EMAIL_FROM: 'CareFind <receipts@carefind.ng>' }, fetchImpl, logger: quietLogger() },
    )
    expect(r).toEqual({ sent: true, id: 'em_1' })
    const [url, init] = fetchImpl.mock.calls[0]
    expect(url).toBe('https://api.resend.com/emails')
    expect(init.headers.Authorization).toBe('Bearer re_key')
    const body = JSON.parse(init.body)
    expect(body).toMatchObject({ from: 'CareFind <receipts@carefind.ng>', to: ['ada@example.com'], html: '<p>hi</p>', text: 'hi' })
    // Header-injection attempt in the subject is flattened to one line.
    expect(body.subject).toBe('Receipt Bcc: evil@x.co')
  })

  it('falls back to the Resend test sender when EMAIL_FROM is unset', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(okResponse())
    await sendEmail({ to: 'a@b.co', subject: 's', html: 'h' }, { env: { RESEND_API_KEY: 'k' }, fetchImpl, logger: quietLogger() })
    expect(JSON.parse(fetchImpl.mock.calls[0][1].body).from).toBe('CareFind <onboarding@resend.dev>')
  })

  it('reports a provider rejection without throwing, and does not log the address', async () => {
    const logger = quietLogger()
    const fetchImpl = vi.fn().mockResolvedValue({ ok: false, status: 422, json: async () => ({ message: 'domain not verified' }) })
    const r = await sendEmail({ to: 'ada@example.com', subject: 's', html: 'h' }, { env: { RESEND_API_KEY: 'k' }, fetchImpl, logger })
    expect(r).toEqual({ sent: false, error: 'domain not verified' })
    expect(JSON.stringify(logger.error.mock.calls)).not.toContain('ada@example.com')
  })

  it('reports a network failure without throwing', async () => {
    const fetchImpl = vi.fn().mockRejectedValue(new Error('ECONNRESET'))
    const r = await sendEmail({ to: 'a@b.co', subject: 's', html: 'h' }, { env: { RESEND_API_KEY: 'k' }, fetchImpl, logger: quietLogger() })
    expect(r).toEqual({ sent: false, error: 'ECONNRESET' })
  })

  it('gives up on a hung provider instead of holding the payment response', async () => {
    const fetchImpl = vi.fn((url, { signal }) => new Promise((_, reject) => {
      signal.addEventListener('abort', () => reject(Object.assign(new Error('aborted'), { name: 'AbortError' })))
    }))
    const r = await sendEmail({ to: 'a@b.co', subject: 's', html: 'h' }, { env: { RESEND_API_KEY: 'k' }, fetchImpl, logger: quietLogger(), timeoutMs: 20 })
    expect(r).toEqual({ sent: false, error: 'timed out' })
  })
})

describe('isValidEmail', () => {
  it('accepts ordinary addresses and rejects obvious junk', () => {
    expect(isValidEmail('ada.obi+cf@example.com')).toBe(true)
    expect(isValidEmail('ada@example')).toBe(false)
    expect(isValidEmail('<script>@x.co')).toBe(false)
    expect(isValidEmail(null)).toBe(false)
    expect(isValidEmail(`${'a'.repeat(250)}@x.co`)).toBe(false)
  })
})

describe('renderEmail', () => {
  const content = {
    heading: 'Payment received',
    intro: 'Thank you, Ada.',
    rows: [['Amount paid', '₦5,000'], ['Reference', 'cf_u1_abc']],
    cta: { label: 'View your wallet', path: '/wallet' },
  }

  it('renders the facts, an absolute call-to-action link and a plain-text twin', () => {
    const { html, text } = renderEmail(content, { appUrl: 'https://carefind.example/', supportEmail: 'help@carefind.example' })
    expect(html).toContain('Payment received')
    expect(html).toContain('₦5,000')
    expect(html).toContain('href="https://carefind.example/wallet"')
    expect(html).toContain('help@carefind.example')
    expect(text).toContain('Amount paid: ₦5,000')
    expect(text).toContain('View your wallet: https://carefind.example/wallet')
    expect(text).toContain('Questions? Contact help@carefind.example.')
  })

  it('escapes every interpolated value so a typed name cannot inject markup', () => {
    const { html } = renderEmail({
      heading: '<img src=x onerror=alert(1)>',
      intro: 'Hi <b>Ada</b>',
      rows: [['Item', 'Consultation with <a href="https://evil.example">Dr X</a>']],
      cta: { label: '"><script>', path: '/u/1' },
    }, { appUrl: 'https://carefind.example' })
    expect(html).not.toContain('<img src=x')
    expect(html).not.toContain('<a href="https://evil.example">')
    expect(html).not.toContain('<script>')
    expect(html).toContain('Consultation with &lt;a href=&quot;https://evil.example&quot;&gt;Dr X&lt;/a&gt;')
  })

  it('omits the button when no base URL is configured (a relative link is useless in an email)', () => {
    const { html, text } = renderEmail(content, { appUrl: '' })
    expect(html).not.toMatch(/<a href/)
    expect(text).not.toContain('View your wallet')
    expect(html).toContain('₦5,000') // the receipt itself is intact
  })

  it('omits the button when there is no link and the table when there are no rows', () => {
    const { html, text } = renderEmail({ heading: 'H', intro: 'I' }, { appUrl: 'https://x.example' })
    expect(html).not.toContain('<table')
    expect(html).not.toMatch(/<a href/)
    expect(text).not.toContain('undefined')
  })

  it('escapeHtml leaves ordinary text alone', () => {
    expect(escapeHtml(null)).toBe('')
    expect(escapeHtml("Ada's & Co")).toBe('Ada&#39;s &amp; Co')
  })
})
