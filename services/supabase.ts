import { createClient } from '@supabase/supabase-js';
import { meteredFetch } from './usageMeter';

// Credentials come from VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY env vars.
// These must be set in Vercel → Project Settings → Environment Variables BEFORE
// the build runs — Vite embeds them at compile time, not at runtime.
// The hardcoded fallback below is for the "academic planning" Supabase project only.
// If you are running a DIFFERENT deployment (e.g. vikhyat kashyap), set the env
// vars in Vercel and redeploy with "Use existing Build Cache" unchecked.
const SUPABASE_URL      = import.meta.env.VITE_SUPABASE_URL      || 'https://qwbqergazgfzjlrreouz.supabase.co';
const SUPABASE_ANON_KEY = import.meta.env.VITE_SUPABASE_ANON_KEY || 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InF3YnFlcmdhemdmempscnJlb3V6Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzQ0NTUwODEsImV4cCI6MjA5MDAzMTA4MX0.OZFOhxCRe6PkBH-tDa9WfPucb9361PZiqntfl7I3cQw';

// Warn when the fallback fires — this means env vars were NOT set at build time
// and the app will connect to the academic-planning Supabase, not yours.
if (!import.meta.env.VITE_SUPABASE_URL) {
  console.warn(
    '⚠️  VITE_SUPABASE_URL is not set — using hardcoded fallback (academic-planning project).\n' +
    '   If this is a separate deployment, set VITE_SUPABASE_URL + VITE_SUPABASE_ANON_KEY\n' +
    '   in Vercel → Settings → Environment Variables and redeploy (clear build cache).'
  );
}

// Clear any stale credentials from localStorage that could override the above
try {
  localStorage.removeItem('VITE_SUPABASE_URL');
  localStorage.removeItem('VITE_SUPABASE_ANON_KEY');
} catch {}

// meteredFetch counts the data Supabase sends us (for the admin usage panel).
export const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, { global: { fetch: meteredFetch } });

// Connection test — logs to console on startup so you can verify immediately
supabase.from('terms').select('id').limit(1).then(({ error }) => {
  if (error) {
    console.error('❌ Supabase connection FAILED:', error.message);
  } else {
    console.log('✅ Supabase connected successfully to', SUPABASE_URL);
  }
});
