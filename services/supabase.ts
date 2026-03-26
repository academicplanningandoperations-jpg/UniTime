import { createClient } from '@supabase/supabase-js';

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL || localStorage.getItem('VITE_SUPABASE_URL');
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY || localStorage.getItem('VITE_SUPABASE_ANON_KEY');

if (!supabaseUrl || !supabaseAnonKey) {
  console.warn('Supabase credentials missing. App is in SANDBOX / LOCAL mode.');
}

export const supabase = (supabaseUrl && supabaseAnonKey && !supabaseUrl.includes('xyz.supabase.co')) 
  ? createClient(supabaseUrl, supabaseAnonKey) 
  : null;
