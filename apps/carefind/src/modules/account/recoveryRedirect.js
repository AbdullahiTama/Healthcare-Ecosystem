// Must be imported BEFORE the supabase client (see main.jsx).
//
// An emailed recovery link can land on ANY path (usually '/') carrying
// #access_token=...&type=recovery. supabase-js consumes and clears the hash
// during createClient() at app boot, so unless we bounce to /reset-password
// first, the recovery session is established on whatever page the user
// happened to land on, PASSWORD_RECOVERY fires with no listener attached,
// and the user never sees the "set new password" form.
try {
  if (typeof window !== 'undefined') {
    const hash = window.location.hash || ''
    const isRecovery = /[#&]type=recovery(&|$)/.test(hash)
    if (isRecovery && window.location.pathname !== '/reset-password') {
      window.location.replace('/reset-password' + window.location.search + hash)
    }
  }
} catch (err) {
  console.warn('[recoveryRedirect] failed:', err)
}
