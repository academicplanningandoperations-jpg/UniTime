import { createClient } from '@supabase/supabase-js';

// ✅ NEW PROJECT: qwbqergazgfzjlrreouz
const NEW_URL = 'https://qwbqergazgfzjlrreouz.supabase.co';
const NEW_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InF3YnFlcmdhemdmempscnJlb3V6Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzQ0NTUwODEsImV4cCI6MjA5MDAzMTA4MX0.OZFOhxCRe6PkBH-tDa9WfPucb9361PZiqntfl7I3cQw';

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL || localStorage.getItem('VITE_SUPABASE_URL') || NEW_URL;
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY || localStorage.getItem('VITE_SUPABASE_ANON_KEY') || NEW_KEY;

if (!supabaseUrl || !supabaseAnonKey) {
  console.warn('Supabase credentials missing. App is in SANDBOX / LOCAL mode.');
}

export const supabase = (supabaseUrl && supabaseAnonKey && !supabaseUrl.includes('xyz.supabase.co')) 
  ? createClient(supabaseUrl, supabaseAnonKey) 
  : null;
