import { createClient } from '@supabase/supabase-js'

const supabase = createClient(
  'https://szdybxmgmhndoytqanfb.supabase.co',
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InN6ZHlieG1nbWhuZG95dHFhbmZiIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc4MjY0NjczMSwiZXhwIjoyMDk4MjIyNzMxfQ.WQMU9yVMN-Ey616bP-rLRbtCoMObmcO5yAdGYjtGiFc'
)

const TEMP_PASSWORD = 'Admin@CareFind2026!'

async function run() {
  console.log('=== Admin Auth Migration ===\n')

  // Step 1: Fix the conflicting profile (the CareHub test admin with display_name='admin')
  const { data: conflictProfile } = await supabase
    .from('profiles')
    .select('id, display_name')
    .ilike('display_name', 'admin')
    .single()

  if (conflictProfile) {
    console.log(`Fixing conflicting profile: ${conflictProfile.id} (display_name: "admin")`)
    const { error } = await supabase
      .from('profiles')
      .update({ display_name: 'CareHub Admin' })
      .eq('id', conflictProfile.id)
    if (error) console.error('  Failed:', error.message)
    else console.log('  -> Updated to "CareHub Admin"\n')
  }

  // Step 2: Get all active admins
  const { data: admins } = await supabase
    .from('admin_users')
    .select('id, email, full_name')
    .eq('is_active', true)

  console.log(`Found ${admins.length} active admin(s)\n`)

  // Step 3: Check existing auth users
  const { data: existingUsers } = await supabase.auth.admin.listUsers()
  const existingEmails = new Set(existingUsers.users.map(u => u.email?.toLowerCase()))

  let created = 0, skipped = 0, failed = 0

  for (const admin of admins) {
    const email = admin.email.toLowerCase()
    console.log(`${admin.email} (${admin.full_name})`)

    if (existingEmails.has(email)) {
      // Reset password for existing users
      const existing = existingUsers.users.find(u => u.email?.toLowerCase() === email)
      console.log(`  -> Auth account exists, resetting password...`)
      const { error } = await supabase.auth.admin.updateUserById(existing.id, {
        password: TEMP_PASSWORD,
        email_confirm: true,
      })
      if (error) console.error(`  Failed: ${error.message}`)
      else console.log(`  -> Password reset to ${TEMP_PASSWORD}\n`)
      skipped++
      continue
    }

    // Create auth user
    const { data, error } = await supabase.auth.admin.createUser({
      email,
      password: TEMP_PASSWORD,
      email_confirm: true,
      user_metadata: { full_name: admin.full_name || email.split('@')[0] },
    })

    if (error) {
      console.error(`  FAILED: ${error.message}\n`)
      failed++
    } else {
      console.log(`  -> Created (id: ${data.user.id})\n`)
      created++
    }
  }

  console.log('='.repeat(50))
  console.log(`Done! Created: ${created}, Skipped: ${skipped}, Failed: ${failed}`)
  console.log(`\nTemporary password: ${TEMP_PASSWORD}`)
  console.log('Admins should change their password after first login.\n')

  // Step 4: Verify
  const { data: finalUsers } = await supabase.auth.admin.listUsers()
  const { data: adminRows } = await supabase
    .from('admin_users')
    .select('email, full_name, role')
    .eq('is_active', true)

  console.log('Verification:')
  for (const a of adminRows) {
    const authUser = finalUsers.users.find(u => u.email?.toLowerCase() === a.email.toLowerCase())
    console.log(`  ${a.email}: auth=${authUser ? 'YES' : 'NO'}${authUser ? ` (id: ${authUser.id})` : ''}`)
  }
}

run().catch(err => {
  console.error('Migration failed:', err.message)
  process.exit(1)
})
