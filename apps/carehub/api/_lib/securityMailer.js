// Security mails (one-time codes, "your PIN changed" alerts) for carehub. shared-email is imported lazily for the same
// reason emailService.js does: the workspace package must resolve at call time on Vercel, and a failure here must
// not take down every route that merely imports this file.
export async function getSecurityMailer() {
  const { createSecurityMailer } = await import('@care-ecosystem/shared-email')
  return createSecurityMailer({ app: 'carehub' })
}
