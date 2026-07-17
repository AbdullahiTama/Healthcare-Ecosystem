import { createClient } from '@supabase/supabase-js'

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
)

async function hashPassword(password) {
  const salt = process.env.ADMIN_SECRET_SALT || 'carefind_admin_2024_secure'
  const encoder = new TextEncoder()
  const data = encoder.encode(password + salt)
  const hashBuffer = await crypto.subtle.digest('SHA-256', data)
  const hashArray = Array.from(new Uint8Array(hashBuffer))
  return hashArray.map(b => b.toString(16).padStart(2, '0')).join('')
}

export default async function handler(req, res) {
  const setupKey = req.query.key
  const expectedKey = process.env.ADMIN_SECRET_SALT || 'carefind_admin_2024_secure'

  if (setupKey !== expectedKey) {
    return res.status(403).json({ error: 'Invalid setup key' })
  }

  const email = 'admin@carefind.ng'
  const password = 'CareFind@Admin2024!'

  const { data: existing } = await supabase
    .from('admin_users')
    .select('id')
    .eq('email', email)
    .maybeSingle()

  const hash = await hashPassword(password)

  if (existing) {
    await supabase.from('admin_users').update({ password_hash: hash, role: 'super_admin', is_active: true }).eq('email', email)
    return res.status(200).json({ message: 'Super admin updated', email, password })
  }

  const { error } = await supabase.from('admin_users').insert({
    email,
    password_hash: hash,
    full_name: 'Abdullahi Tama',
    role: 'super_admin',
    is_active: true,
  })

  if (error) return res.status(500).json({ error: error.message })

  return res.status(200).json({
    success: true,
    message: 'Super admin created!',
    email,
    password,
    login_url: 'https://carefind-nine.vercel.app/admin-login'
  })
}
