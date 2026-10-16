// admin-users — the only place team-member accounts are created, changed or
// deleted. Runs on Supabase with the service key (never sent to browsers) and
// only obeys a caller who is signed in as a SUPER_ADMIN.
//
// Actions (POST JSON):
//   { action: 'upsert', user: {id?, username, name, role, departmentScope}, password? }
//   { action: 'delete', id }
//   { action: 'migrate' }   one-time move of existing users into Supabase Auth;
//                           needs header x-bootstrap-secret = a code stored in
//                           the locked admin_bootstrap table (used up on use)
import { createClient } from 'npm:@supabase/supabase-js@2.45.4';

const USER_EMAIL_DOMAIN = 'users.unitime.app'; // must match services/authService.ts
const ROLES = ['SUPER_ADMIN', 'ADMIN', 'SCHEDULER', 'VIEWER'];

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-bootstrap-secret',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...cors, 'Content-Type': 'application/json' } });

const admin = createClient(
  Deno.env.get('SUPABASE_URL')!,
  Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
  { auth: { autoRefreshToken: false, persistSession: false } },
);

const emailFor = (username: string) => `${username.trim().toLowerCase()}@${USER_EMAIL_DOMAIN}`;

async function findAuthUser(email: string) {
  for (let page = 1; page < 50; page++) {
    const { data, error } = await admin.auth.admin.listUsers({ page, perPage: 200 });
    if (error) throw error;
    const hit = data.users.find(u => u.email?.toLowerCase() === email.toLowerCase());
    if (hit) return hit;
    if (data.users.length < 200) return null;
  }
  return null;
}

// Create or update the Supabase Auth login for one team member.
async function syncAuthUser(opts: { oldUsername?: string; username: string; userId: string; role: string; password?: string }) {
  const email = emailFor(opts.username);
  const existing = (opts.oldUsername && await findAuthUser(emailFor(opts.oldUsername))) || await findAuthUser(email);
  const app_metadata = { role: opts.role, user_id: opts.userId };
  if (existing) {
    const { error } = await admin.auth.admin.updateUserById(existing.id, {
      email, email_confirm: true, app_metadata, ...(opts.password ? { password: opts.password } : {}),
    });
    if (error) throw error;
  } else {
    if (!opts.password) throw new Error('A password is required for a new user.');
    const { error } = await admin.auth.admin.createUser({ email, password: opts.password, email_confirm: true, app_metadata });
    if (error) throw error;
  }
}

async function savePassword(userId: string, password: string) {
  const { error } = await admin.from('user_passwords')
    .upsert({ user_id: userId, password, updated_at: new Date().toISOString() });
  if (error) throw error;
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });
  try {
    const body = await req.json().catch(() => ({}));

    // ── One-time migration (bootstrap secret, not a user session) ────────────
    if (body.action === 'migrate') {
      // One-time code kept in a locked table (no browser can read it). It is
      // deleted as soon as it is used, so the migration can't be run again.
      const code = req.headers.get('x-bootstrap-secret') || '';
      if (!code) return json({ error: 'Forbidden' }, 403);
      const { data: hit } = await admin.from('admin_bootstrap').delete().eq('token', code).select('token');
      if (!hit || hit.length === 0) return json({ error: 'Forbidden' }, 403);
      const { data: users, error } = await admin.from('users').select('*');
      if (error) throw error;
      const done: string[] = [];
      const skipped: string[] = [];
      for (const u of users ?? []) {
        const pw = (u.password && String(u.password)) || null;
        // No password on record (e.g. a new profile) → a Super Admin sets one
        // later from the Admin panel, which creates the login then.
        if (!pw) { skipped.push(u.username); continue; }
        await syncAuthUser({ username: u.username, userId: u.id, role: u.role, password: pw });
        await savePassword(u.id, pw);
        done.push(u.username);
      }
      return json({ ok: true, migrated: done, skipped });
    }

    // ── Everything else: caller must be a signed-in SUPER_ADMIN ──────────────
    const token = (req.headers.get('Authorization') || '').replace(/^Bearer\s+/i, '');
    const { data: caller } = await admin.auth.getUser(token);
    if (caller?.user?.app_metadata?.role !== 'SUPER_ADMIN') {
      return json({ error: 'Only a Super Admin can manage users.' }, 403);
    }
    const callerUserId = caller.user.app_metadata?.user_id;

    if (body.action === 'upsert') {
      const u = body.user ?? {};
      const username = String(u.username ?? '').trim();
      const name = String(u.name ?? '').trim();
      const role = ROLES.includes(u.role) ? u.role : 'SCHEDULER';
      if (!username || !name) return json({ error: 'Username and name are required.' }, 400);
      if (!/^[A-Za-z0-9._-]+$/.test(username)) return json({ error: 'Username may only use letters, numbers, dot, dash and underscore.' }, 400);

      // Username must stay unique (ignoring case).
      const { data: clash } = await admin.from('users').select('id').ilike('username', username);
      if ((clash ?? []).some(c => c.id !== u.id)) return json({ error: `Username "${username}" is already taken.` }, 400);

      let oldUsername: string | undefined;
      const id = u.id || `u-${Date.now()}`;
      if (u.id) {
        const { data: prev } = await admin.from('users').select('username, role').eq('id', u.id).maybeSingle();
        oldUsername = prev?.username;
        if (u.id === callerUserId && role !== 'SUPER_ADMIN') return json({ error: 'You cannot remove your own Super Admin role.' }, 400);
      }
      const password = body.password ? String(body.password) : undefined;
      if (password && password.length < 6) return json({ error: 'Password must be at least 6 characters.' }, 400);

      const { error: upErr } = await admin.from('users').upsert({
        id, username, name, role, departmentScope: String(u.departmentScope ?? 'All') || 'All', password: null,
      });
      if (upErr) throw upErr;
      await syncAuthUser({ oldUsername, username, userId: id, role, password });
      if (password) await savePassword(id, password);
      return json({ ok: true, id });
    }

    if (body.action === 'delete') {
      const id = String(body.id ?? '');
      if (!id) return json({ error: 'Missing user id.' }, 400);
      if (id === callerUserId) return json({ error: 'You cannot delete your own account.' }, 400);
      const { data: prev } = await admin.from('users').select('username').eq('id', id).maybeSingle();
      if (prev?.username) {
        const authUser = await findAuthUser(emailFor(prev.username));
        if (authUser) await admin.auth.admin.deleteUser(authUser.id);
      }
      const { error } = await admin.from('users').delete().eq('id', id); // user_passwords cascades
      if (error) throw error;
      return json({ ok: true });
    }

    return json({ error: 'Unknown action.' }, 400);
  } catch (err) {
    return json({ error: (err as Error)?.message ?? String(err) }, 500);
  }
});
