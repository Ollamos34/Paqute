import { createClient } from '@supabase/supabase-js'

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL || 'https://kuowcswwuyxhcghyrqhz.supabase.co'
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY || 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Imt1b3djc3d3dWl4aGNnaHlycWh6Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3M0DY3NzEwNDg3ImV4cCI6MjEwMjA0OH0.tqmTR35_EX-b8Ayx8C8Q-AfMfa8nPkcjO5xiWReXK5o'

if (!supabaseUrl || !supabaseAnonKey) {
  console.error(
    '[supabase] Missing VITE_SUPABASE_URL or VITE_SUPABASE_ANON_KEY. ' +
    'Copy .env.example to .env.local and fill them in.'
  )
}

export const supabase = createClient(supabaseUrl || '', supabaseAnonKey || '', {
  auth: { persistSession: true, autoRefreshToken: true },
})