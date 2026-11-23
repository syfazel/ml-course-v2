// کلاینت Supabase برای سایت یادگیری ماشین (نسخه دوم — فاز ۱)
// کلید فقط از متغیر بیلد Vite خوانده می‌شود؛ هیچ کلید یا رمزی در کد نیست.
// در بیلد محلی بدون env (قانون dist بدون کلید)، sb برابر null می‌ماند.

import { createClient } from '@supabase/supabase-js'

const supabaseUrl = (import.meta.env.VITE_SUPABASE_URL || '').trim()
const supabasePublishableKey = (
  import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY || ''
).trim()

export const isSupabaseConfigured = Boolean(
  supabaseUrl && supabasePublishableKey
)

export const sb = isSupabaseConfigured
  ? createClient(supabaseUrl, supabasePublishableKey, {
      auth: {
        persistSession: true,
        autoRefreshToken: true,
        detectSessionInUrl: true,
        flowType: 'pkce',
        storageKey: 'ml-course-v2-auth'
      }
    })
  : null
