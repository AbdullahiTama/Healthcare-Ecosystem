import { describe, it, expect } from 'vitest'
import { getTemplate } from '../templates/index.js'

// The finance_alert email goes to the platform administrators when a money check finds something critical. Its payload comes from
// our own database (finding details), but a detail can still contain text from a provider event, so it must be escaped.
describe('finance_alert template', () => {
  const render = (payload) => {
    const out = getTemplate('finance_alert', 'carefind')(payload)
    return typeof out === 'string' ? out : out.html || JSON.stringify(out)
  }

  it('resolves for CareFind only', () => {
    expect(typeof getTemplate('finance_alert', 'carefind')).toBe('function')
    expect(getTemplate('finance_alert', 'carehub')).toBeNull()
  })

  it('lists each finding, says how many more there are, and links to the admin panel', () => {
    const html = render({ critical_count: '14', lines: 'unmatched charge (ref_1): a charge of 2500.00 NGN\nevent failed (e2): database down', more_count: '2' })
    expect(html).toContain('14 critical finance findings need attention')
    expect(html).toContain('unmatched charge (ref_1)')
    expect(html).toContain('a charge of 2500.00 NGN')
    expect(html).toContain('and 2 more')
    expect(html).toContain('/admin-panel')
  })

  it('uses the singular for one finding and omits the "more" line when there are none', () => {
    const html = render({ critical_count: '1', lines: 'x (y): z', more_count: '0' })
    expect(html).toContain('1 critical finance finding need')
    expect(html).not.toMatch(/and \d+ more/)
  })

  it('escapes anything that came from outside', () => {
    const html = render({ critical_count: '1', lines: 'k (<script>alert(1)</script>): <img src=x onerror=alert(2)>', more_count: '0' })
    expect(html).not.toContain('<script>alert(1)</script>')
    expect(html).not.toContain('<img src=x')
  })

  it('does not throw on an empty payload', () => {
    expect(() => render({})).not.toThrow()
  })
})
