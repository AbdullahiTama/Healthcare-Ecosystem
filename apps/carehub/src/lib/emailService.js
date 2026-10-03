import { createClient } from '@supabase/supabase-js'
import { EmailService, getEmailService, TEMPLATE_REGISTRY } from '@care-ecosystem/shared-email'

export { EmailService, getEmailService, TEMPLATE_REGISTRY }

let _impl = null
function impl() {
  // Inject the service-role client rather than letting the package build one.
  // shared-email resolves '@supabase/supabase-js' by walking up from
  // packages/shared-email/, which finds nothing on Vercel because the
  // workspace package ships without its own node_modules. This specifier
  // resolves normally, and it is still lazy, so an unset env var surfaces on
  // first use instead of at import.
  if (!_impl) {
    _impl = getEmailService({
      supabase: createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY),
    })
  }
  return _impl
}

// Lazy proxy — defers EmailService construction until first method call,
// preventing module-load crashes when SUPABASE_URL / SERVICE_ROLE_KEY are missing.
export const emailService = new Proxy({ enqueue: (...a) => impl().enqueue(...a), processBatch: (...a) => impl().processBatch(...a) }, {
  get(_, prop) { return Reflect.get(impl(), prop) }
})

export default EmailService
