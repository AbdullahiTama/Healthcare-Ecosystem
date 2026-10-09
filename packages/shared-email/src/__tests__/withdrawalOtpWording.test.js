// E: one OTP template serves both flows (arming the withdrawal PIN and confirming a withdrawal),
// so its copy must be action-neutral - it may never claim the code is "for your withdrawal PIN"
// when it was requested to confirm a withdrawal (and vice versa). The action itself travels in
// the outbox payload, not in the copy.
import { describe, it, expect } from 'vitest'
import { getTemplate } from '../templates/index.js'

const payload = { fullName: 'Ada Obi', code: '654321', minutes: 10, action: 'withdrawal' }

describe('withdrawal_pin_otp wording', () => {
  for (const app of ['carefind', 'carehub']) {
    it(`${app}: renders the code with action-neutral copy`, () => {
      const render = getTemplate('withdrawal_pin_otp', app)
      expect(render).toBeTypeOf('function')
      const out = JSON.stringify(render(payload))
      expect(out).toContain('654321')
      expect(out).not.toMatch(/withdrawal PIN|set or change/i)
      expect(out).toMatch(/one-time code/i)
    })

    it(`${app}: renders for either action without throwing`, () => {
      const render = getTemplate('withdrawal_pin_otp', app)
      for (const action of ['set_pin', 'withdrawal', undefined]) {
        expect(() => render({ ...payload, action })).not.toThrow()
      }
    })
  }
})
