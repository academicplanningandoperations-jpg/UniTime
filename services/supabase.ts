import { createClient } from '@supabase/supabase-js';

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL || localStorage.getItem('VITE_SUPABASE_URL') || 'https://oyktffogtqxvhnflfnse.supabase.co';
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY || localStorage.getItem('VITE_SUPABASE_ANON_KEY') || 'sb_publishable_TlA1Rgl1Vk2YNpRRbjJoGA_I26Hjqpd';

if (!supabaseUrl || !supabaseAnonKey) {
  console.warn('Supabase credentials missing. Falling back to local storage.');
}

export const supabase = (supabaseUrl && supabaseAnonKey) 
  ? createClient(supabaseUrl, supabaseAnonKey) 
  : null;
