import { sendEmail } from './sendEmail.js'
export { sendEmail } from './sendEmail.js'
// getEmailService is part of the public surface: apps/carehub/src/lib/emailService.js
// imports it to build a lazy singleton. It was missing here, so that import
// threw "does not provide an export named 'getEmailService'" at module load.
// Because the CareHub router now imports handlers statically, a throw in any
// transitive import takes down every route, so a missing export here is a
// full-API outage rather than a local one.
export { EmailService, getEmailService } from './EmailService.js'
export { sendAuthEmail } from './authEmail.js'
export * from './templates/index.js'
export { renderEmailTemplate, generateSampleVariables } from './templates/Marketing/templateRenderer.js'
export { SAMPLES, TEMPLATE_META } from './templates/samples.js'
export { fmtNaira, fmtKobo, fmtDate, fmtPhone } from './utils/formatters.js'
export { escapeHtml } from './utils/escapeHtml.js'
export { createEmailProvider } from './provider.js'
export { validateMessage, validateFrom, validateRecipients, validateSubject, validateHtml, validateReplyTo, isValidEmail, isValidFrom } from './validation.js'
export { EMAIL_EVENTS, isKnownEvent } from './events.js'
export { verifySvixSignature, applyResendEvent } from './resendWebhook.js'
export { getTemplate as resolveTemplate } from './templates.js'
export { renderOtpEmail, renderPinChangedEmail, renderPinLockedEmail, renderPayoutAccountEmail, senderFor, createSecurityMailer } from './securityEmails.js'
