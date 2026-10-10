// Framework-free state machines behind the payout UI. Each app renders them
// with its own components (CareFind and CareHub have different design systems)
// and subscribes with React's useSyncExternalStore — no React import here, so
// the package never ships a second copy of React.
import { isValidAccountNumber } from './banks.js'
import * as api from './client.js'
import { resolveAccountName, sendPinOtp, setWithdrawalPin } from './client.js'

function createStore(initial) {
  let state = initial
  const listeners = new Set()
  return {
    getState: () => state,
    set(patch) {
      state = { ...state, ...patch }
      listeners.forEach((l) => l())
    },
    subscribe(listener) {
      listeners.add(listener)
      return () => listeners.delete(listener)
    },
  }
}

// Bank + account number -> bank-reported account name. The name is read-only
// output; the user never types it. A stale response (user kept typing) is
// discarded by comparing request ids.
export function createAccountResolver({ getToken, basePath = '/api' }) {
  const store = createStore({
    bankCode: '', bankName: '', accountNumber: '',
    status: 'idle', // idle | loading | ok | unsupported (bank cannot be looked up) | error
    accountName: '', error: '',
  })
  let requestId = 0

  async function maybeResolve() {
    const { bankCode, accountNumber } = store.getState()
    const id = ++requestId
    if (!bankCode || !isValidAccountNumber(accountNumber)) {
      store.set({ status: 'idle', accountName: '', bankName: '', error: '' })
      return
    }
    store.set({ status: 'loading', accountName: '', error: '' })
    try {
      const token = await getToken()
      const r = await resolveAccountName({ basePath, token, bankCode, accountNumber })
      if (id !== requestId) return
      if (r.ok) store.set({ status: 'ok', accountName: r.data.accountName, bankName: '', error: '' })
      else if (r.data.unsupportedBank) store.set({ status: 'unsupported', accountName: '', error: r.data.error || 'This bank does not support automatic verification.' })
      else store.set({ status: 'error', accountName: '', error: r.data.error || 'Could not verify this account.' })
    } catch {
      if (id !== requestId) return
      store.set({ status: 'error', accountName: '', error: 'Network error. Check your connection and try again.' })
    }
  }

  return {
    getState: store.getState,
    subscribe: store.subscribe,
    setBank(bankCode) { store.set({ bankCode: bankCode || '' }); return maybeResolve() },
    setAccountNumber(value) {
      store.set({ accountNumber: String(value || '').replace(/\D/g, '').slice(0, 10) })
      return maybeResolve()
    },
    retry: maybeResolve,
    reset() {
      requestId++
      store.set({ bankCode: '', bankName: '', accountNumber: '', status: 'idle', accountName: '', error: '' })
    },
  }
}

// Set / change / reset the withdrawal PIN: request an emailed code, then submit
// PIN + code (+ current PIN unless forgot). Surfaces server messages verbatim.
export function createPinSetup({ getToken, basePath = '/api' }) {
  const store = createStore({ sending: false, codeSent: false, sentTo: '', submitting: false, error: '', done: false })

  return {
    getState: store.getState,
    subscribe: store.subscribe,
    async sendCode() {
      store.set({ sending: true, error: '' })
      try {
        const r = await sendPinOtp({ basePath, token: await getToken() })
        if (r.ok) store.set({ sending: false, codeSent: true, sentTo: r.data.sentTo || '' })
        else store.set({ sending: false, error: r.data.error || 'Could not send the code.' })
        return r.ok
      } catch {
        store.set({ sending: false, error: 'Network error. Check your connection and try again.' })
        return false
      }
    },
    async submit({ pin, confirmPin, otp, currentPin, forgot }) {
      if (!/^\d{4,6}$/.test(pin || '')) { store.set({ error: 'PIN must be 4-6 digits.' }); return false }
      if (pin !== confirmPin) { store.set({ error: 'PINs do not match.' }); return false }
      if (!/^\d{6}$/.test(otp || '')) { store.set({ error: 'Enter the 6-digit code from your email.' }); return false }
      store.set({ submitting: true, error: '' })
      try {
        const r = await setWithdrawalPin({ basePath, token: await getToken(), pin, otp, currentPin, forgot })
        if (r.ok) store.set({ submitting: false, done: true })
        else store.set({ submitting: false, error: r.data.error || 'Could not set your withdrawal PIN.' })
        return r.ok
      } catch {
        store.set({ submitting: false, error: 'Network error. Check your connection and try again.' })
        return false
      }
    },
    reset() { store.set({ sending: false, codeSent: false, sentTo: '', submitting: false, error: '', done: false }) },
  }
}

// Identity + saved payout accounts for one signed-in owner. One store so the screen is a simple render of its state:
//   loading | loadError | kyc ({ verified, legalName, bvnLast4, ninLast4, tier } | null) | accounts [] | required
//   busy ('' | 'verify' | 'otp' | 'add' | 'default' | 'remove') | error | code (server error code) | codeSent / sentTo
export function createPayoutManager({ getToken, basePath = '/api' }) {
  const store = createStore({
    loading: true, loadError: '', kyc: null, accounts: [], required: false, limits: null,
    busy: '', error: '', code: '', codeSent: false, sentTo: '',
  })

  async function authed(fn, args = {}) {
    return fn({ basePath, token: await getToken(), ...args })
  }
  const fail = (r, fallback) => store.set({ busy: '', error: r.data?.error || fallback, code: r.data?.code || '' })
  const network = () => store.set({ busy: '', error: 'Network error. Check your connection and try again.', code: 'network' })

  async function load() {
    store.set({ loading: true, loadError: '' })
    try {
      const [k, a] = await Promise.all([authed(api.kycStatus), authed(api.listPayoutAccounts)])
      if (!k.ok || !a.ok) throw new Error('load')
      store.set({ loading: false, kyc: k.data, accounts: a.data.accounts || [], required: Boolean(a.data.required), limits: a.data.limits || null })
    } catch {
      store.set({ loading: false, loadError: 'Could not load your payout details. Try again.' })
    }
  }

  async function run(busy, fn, onOk, fallback) {
    store.set({ busy, error: '', code: '' })
    try {
      const r = await fn()
      if (r.ok) { await onOk(r); return true }
      fail(r, fallback)
      return false
    } catch {
      network()
      return false
    }
  }

  return {
    getState: store.getState,
    subscribe: store.subscribe,
    load,
    clearError: () => store.set({ error: '', code: '' }),

    verifyIdentity: ({ bvn, nin }) => {
      if (!/^\d{11}$/.test(bvn || '') || !/^\d{11}$/.test(nin || '')) {
        store.set({ error: 'Enter your 11-digit BVN and your 11-digit NIN.', code: 'invalid_id' })
        return Promise.resolve(false)
      }
      return run('verify', () => authed(api.kycVerify, { bvn, nin }), (r) => store.set({ busy: '', kyc: r.data }), 'Could not verify your identity.')
    },

    /** Selfie match against the verified BVN (tier 2 = higher daily limit). The BVN is re-entered: we never keep it. */
    verifySelfie: ({ bvn, selfieImage }) => {
      if (!/^\d{11}$/.test(bvn || '')) { store.set({ error: 'Enter your 11-digit BVN.', code: 'invalid_id' }); return Promise.resolve(false) }
      if (!selfieImage) { store.set({ error: 'Take or choose a photo of your face.', code: 'no_photo' }); return Promise.resolve(false) }
      return run('selfie', () => authed(api.kycSelfie, { bvn, selfieImage }), async () => { await load(); store.set({ busy: '' }) }, 'Could not verify your selfie.')
    },

    sendCode: () => run('otp', () => authed(api.sendPayoutAccountOtp), (r) => store.set({ busy: '', codeSent: true, sentTo: r.data.sentTo || '' }), 'Could not send the code.'),

    addAccount: ({ bankCode, accountNumber, otp }) => {
      if (!/^\d{6}$/.test(otp || '')) { store.set({ error: 'Enter the 6-digit code from your email.', code: 'otp_invalid' }); return Promise.resolve(false) }
      return run('add', () => authed(api.addPayoutAccount, { bankCode, accountNumber, otp }),
        async () => { store.set({ codeSent: false, sentTo: '' }); await load(); store.set({ busy: '' }) }, 'Could not save the account.')
    },

    setDefault: (id) => run('default', () => authed(api.setDefaultPayoutAccount, { id }), async () => { await load(); store.set({ busy: '' }) }, 'Could not change the default account.'),

    remove: ({ id, pin }) => {
      if (!/^\d{4,6}$/.test(pin || '')) { store.set({ error: 'Enter your withdrawal PIN to remove an account.', code: 'invalid_pin' }); return Promise.resolve(false) }
      return run('remove', () => authed(api.removePayoutAccount, { id, pin }), async () => { await load(); store.set({ busy: '' }) }, 'Could not remove the account.')
    },
  }
}
