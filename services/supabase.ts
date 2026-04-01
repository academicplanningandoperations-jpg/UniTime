import { createClient } from '@supabase/supabase-js';

// ✅ Active project: qwbqergazgfzjlrreouz
// These are the ONLY credentials used. localStorage overrides are intentionally
// removed — they caused the app to silently connect to old/wrong Supabase projects.
const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL || 'https://qwbqergazgfzjlrreouz.supabase.co';
const SUPABASE_ANON_KEY = import.meta.env.VITE_SUPABASE_ANON_KEY || 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InF3YnFlcmdhemdmempscnJlb3V6Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzQ0NTUwODEsImV4cCI6MjA5MDAzMTA4MX0.OZFOhxCRe6PkBH-tDa9WfPucb9361PZiqntfl7I3cQw';

// Clear any stale credentials from localStorage that could override the above
try {
  localStorage.removeItem('VITE_SUPABASE_URL');
  localStorage.removeItem('VITE_SUPABASE_ANON_KEY');
} catch {}

export const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

// Connection test — logs to console on startup so you can verify immediately
supabase.from('terms').select('id').limit(1).then(({ error }) => {
  if (error) {
    console.error('❌ Supabase connection FAILED:', error.message);
  } else {
    console.log('✅ Supabase connected successfully to', SUPABASE_URL);
  }
});
