import { EmailService, getEmailService, TEMPLATE_REGISTRY } from '@care-ecosystem/shared-email'

export { EmailService, getEmailService, TEMPLATE_REGISTRY }

let _impl = null
function impl() {
  if (!_impl) _impl = getEmailService()
  return _impl
}

// Lazy proxy — defers EmailService construction until first method call,
// preventing module-load crashes when SUPABASE_URL / SERVICE_ROLE_KEY are missing.
export const emailService = new Proxy({ enqueue: (...a) => impl().enqueue(...a), processBatch: (...a) => impl().processBatch(...a) }, {
  get(_, prop) { return Reflect.get(impl(), prop) }
})

export default EmailService
