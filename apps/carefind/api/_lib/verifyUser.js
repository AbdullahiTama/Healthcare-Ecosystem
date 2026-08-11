// Verifies the Supabase session token a client sent in its Authorization
// header and returns the real, server-confirmed user — used by any
// payment endpoint that needs to know who's actually asking, rather than
// trusting a user_id or email the client claims in the request body.
export async function verifyUser(supabase, req) {
  const authHeader = req.headers['authorization'] || ''
  const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : null
  if (!token) return null

  const { data, error } = await supabase.auth.getUser(token)
  if (error || !data?.user) return null
  return data.user
}
