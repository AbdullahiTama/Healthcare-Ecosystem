// The sender identity of each app, in one place.
//
// Both apps share one outbox table and one catalog, and each row is sent from
// its app's own verified domain (the same addresses email_event_catalog.from_email
// holds). Auth emails always passed these explicitly; purchase confirmations did
// not, so they depended on an EMAIL_FROM environment variable that a deployment
// can silently lack. Keeping the addresses here lets every enqueue path fall
// back to the right one instead of failing.
export const APP_SENDERS = Object.freeze({
  carefind: 'CareFind <support@mail.carefind.app>',
  carehub: 'CareHub <support@mail.carefindhub.com>',
})

// '' for an app we do not know, so callers can `||` onto the next fallback.
export function senderFor(app) {
  return APP_SENDERS[app] || ''
}
