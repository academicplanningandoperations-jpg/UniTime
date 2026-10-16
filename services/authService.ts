import { supabase } from './supabase';
import { UserAccount } from '../types';

// Login goes through Supabase Auth, so the database itself checks the password
// and the browser gets a signed session. People still type their usual
// username — it is turned into an internal email address that is never shown
// and never receives mail. Must match USER_EMAIL_DOMAIN in the admin-users
// edge function.
const USER_EMAIL_DOMAIN = 'users.unitime.app';
export const usernameToEmail = (username: string) =>
  `${username.trim().toLowerCase()}@${USER_EMAIL_DOMAIN}`;

const USER_COLUMNS = 'id, username, name, role, departmentScope, lastLogin';

async function loadProfile(username: string): Promise<UserAccount | null> {
  if (!supabase) return null;
  const { data, error } = await supabase
    .from('users').select(USER_COLUMNS).ilike('username', username.trim()).limit(1).maybeSingle();
  if (error || !data) return null;
  return data as UserAccount;
}

export const AuthService = {
  // Returns the signed-in team member, or an error message.
  async signIn(username: string, password: string): Promise<{ user?: UserAccount; error?: string }> {
    if (!supabase) return { error: 'Database connection is not configured.' };
    const { error } = await supabase.auth.signInWithPassword({ email: usernameToEmail(username), password });
    if (error) return { error: 'Invalid username or password.' };
    const user = await loadProfile(username);
    if (!user) {
      await supabase.auth.signOut();
      return { error: 'This login has no team-member profile. Ask a Super Admin.' };
    }
    return { user };
  },

  // The signed-in team member from a saved session (page reload), if any.
  async restore(): Promise<UserAccount | null> {
    if (!supabase) return null;
    const { data } = await supabase.auth.getSession();
    const email = data.session?.user?.email;
    if (!email) return null;
    const user = await loadProfile(email.split('@')[0]);
    if (!user) await supabase.auth.signOut();
    return user;
  },

  async signOut(): Promise<void> {
    if (supabase) await supabase.auth.signOut();
  },

  // ── Super Admin user management (runs in the admin-users edge function,
  //    which checks that the caller really is a Super Admin) ────────────────
  async saveUser(user: Partial<UserAccount> & { username: string; name: string }, password?: string): Promise<void> {
    await callAdmin({ action: 'upsert', user, password: password || undefined });
  },

  async deleteUser(id: string): Promise<void> {
    await callAdmin({ action: 'delete', id });
  },

  // Readable by Super Admins only (enforced by the database, not the browser).
  async getPassword(userId: string): Promise<string | null> {
    if (!supabase) return null;
    const { data, error } = await supabase
      .from('user_passwords').select('password').eq('user_id', userId).maybeSingle();
    if (error) throw new Error(error.message);
    return data?.password ?? null;
  },
};

async function callAdmin(body: any): Promise<any> {
  if (!supabase) throw new Error('Database connection is not configured.');
  const { data, error } = await supabase.functions.invoke('admin-users', { body });
  if (error) {
    let msg = error.message;
    try { const ctx = await (error as any).context?.json?.(); if (ctx?.error) msg = ctx.error; } catch { /* keep generic */ }
    throw new Error(msg);
  }
  if (data?.error) throw new Error(data.error);
  return data;
}
