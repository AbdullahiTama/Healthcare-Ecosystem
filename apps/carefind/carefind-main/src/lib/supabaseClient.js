import { createClient } from '@supabase/supabase-js'

const supabaseUrl = 'https://szdybxmgmhndoytqanfb.supabase.co'
const supabaseAnonKey = 'sb_publishable_xEs5f4L6qSxqXikPZM06SQ_TKy4UNFz'

export const supabase = createClient(supabaseUrl, supabaseAnonKey)
