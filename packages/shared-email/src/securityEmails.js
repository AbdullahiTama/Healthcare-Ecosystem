// Security emails: one-time codes and "something changed" alerts for money-moving settings. Built on the shared
// layout so they match every other transactional email. These are sent DIRECTLY (sendEmail), not through the outbox:
// a code is useless a minute later, and the outbox stores rendered payloads, which must never contain a live code.
import { sendEmail } from './sendEmail.js'
import { layout, paragraph, smallPrint, notice, html, brandFor } from './templates/layout.js'

const CODE_STYLE = 'margin:4px 0 20px;font-size:34px;line-height:1.2;font-weight:800;letter-spacing:10px;color:#0f172a;font-family:SFMono-Regular,Menlo,Consolas,monospace'

// What each OTP purpose is for, in the words the reader will recognise.
const PURPOSES = {
  pin_set: 'set or change your withdrawal PIN',
  payout_account: 'add a payout bank account',
}

export const senderFor = (app) => {
  const brand = brandFor(app)
  return `${brand.name} <${brand.support}>`
}

/** -> { subject, html, from } */
export function renderOtpEmail({ app = 'carefind', code, minutes = 5, purpose = 'pin_set' }) {
  const brand = brandFor(app)
  const what = PURPOSES[purpose] || 'confirm a sensitive change'
  return {
    subject: `Your ${brand.name} verification code`,
    from: senderFor(app),
    html: layout({
      app,
      title: 'Your verification code',
      preheader: `Use this code to ${what}. It expires in ${minutes} minutes.`,
      body: [
        paragraph(`Use this code to ${what}. It expires in ${minutes} minutes and works once.`),
        html`<p class="em-strong" style="${CODE_STYLE}">${String(code)}</p>`,
        notice('warn', `Never share this code. ${brand.name} staff will never ask you for it.`),
        smallPrint('If you did not ask for this code, you can ignore this email, but consider changing your password.'),
      ],
      reason: `You received this because a verification code was requested on your ${brand.name} account.`,
    }),
  }
}

/** Sent after the withdrawal PIN is set or changed, so a takeover is noticed. */
export function renderPinChangedEmail({ app = 'carefind', changedAt = new Date() }) {
  const brand = brandFor(app)
  return {
    subject: `Your ${brand.name} withdrawal PIN was changed`,
    from: senderFor(app),
    html: layout({
      app,
      title: 'Withdrawal PIN changed',
      preheader: 'The PIN that protects your withdrawals was just changed.',
      body: [
        paragraph('The PIN that protects withdrawals from your wallet was just set or changed.'),
        smallPrint(`Time: ${new Date(changedAt).toUTCString()}`),
        notice('danger', `If this was not you, change your password now and contact ${brand.support}.`),
      ],
      reason: `You received this security alert because it concerns your ${brand.name} account.`,
    }),
  }
}

/** Sent when a payout bank account is saved or removed. */
export function renderPayoutAccountEmail({ app = 'carefind', event = 'added', bankName, accountLast4 }) {
  const brand = brandFor(app)
  const verb = event === 'removed' ? 'removed' : 'added'
  return {
    subject: `A payout account was ${verb} on your ${brand.name} account`,
    from: senderFor(app),
    html: layout({
      app,
      title: `Payout account ${verb}`,
      preheader: `${bankName || 'A bank'} account ending ${accountLast4 || ''} was ${verb}.`,
      body: [
        paragraph(`${bankName || 'A bank account'} ending in ${accountLast4 || '----'} was ${verb} as a payout account.`),
        notice('danger', `If this was not you, change your password now and contact ${brand.support}.`),
      ],
      reason: `You received this security alert because it concerns your ${brand.name} account.`,
    }),
  }
}

/**
 * The three security mails behind one object, bound to an app, so a handler needs a single import:
 *   const mailer = createSecurityMailer({ app: 'carefind' })
 *   await mailer.sendOtp({ to, code, minutes, purpose })       -> { ok, error? }
 * `send` is injectable for tests. Failures are returned, never thrown, and never include the recipient or the code.
 */
export function createSecurityMailer({ app = 'carefind', send = sendEmail } = {}) {
  const deliver = async (to, message) => {
    const r = await send({ to, subject: message.subject, html: message.html, from: message.from })
    return r?.success ? { ok: true } : { ok: false, error: r?.error || 'send_failed' }
  }
  return {
    sendOtp: ({ to, code, minutes, purpose }) => deliver(to, renderOtpEmail({ app, code, minutes, purpose })),
    sendPinChanged: ({ to }) => deliver(to, renderPinChangedEmail({ app })),
    sendPayoutAccount: ({ to, event, bankName, accountLast4 }) => deliver(to, renderPayoutAccountEmail({ app, event, bankName, accountLast4 })),
  }
}
