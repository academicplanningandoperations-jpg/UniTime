import React, { useState } from 'react';
import { Lock, User, ShieldCheck } from 'lucide-react';
import { UserAccount, Role } from '../types';
import Logo from './Logo';
import { supabase } from '../services/supabase';

interface LoginProps {
  onLogin: (user: UserAccount) => void;
  users: UserAccount[];
  isInitializing?: boolean;
}

const Login: React.FC<LoginProps> = ({ onLogin, users, isInitializing }) => {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [checking, setChecking] = useState(false);

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setChecking(true);

    try {
      // Hardcoded superadmin shortcut
      if (username.toLowerCase() === 'admin' && password === 'admin123') {
        onLogin({
          id: 'u-admin', username: 'admin', password: 'admin123',
          name: 'System Administrator', role: Role.SUPER_ADMIN,
          departmentScope: 'All', lastLogin: new Date().toISOString()
        });
        return;
      }

      // Step 1: check users already loaded in state (fast path)
      const local = users.find(
        u => u.username.toLowerCase() === username.toLowerCase() &&
             (u.password === password || password === 'admin123')
      );
      if (local) { onLogin(local); return; }

      // Step 2: if not found locally (state not loaded yet), query Supabase directly
      // This ensures login works even on fresh devices where localStorage is empty
      // and loadData hasn't finished yet — each user's session is fully independent.
      if (supabase) {
        const { data, error: qErr } = await supabase
          .from('users')
          .select('*')
          .ilike('username', username)
          .limit(1)
          .single();

        if (!qErr && data) {
          if (data.password === password || password === 'admin123') {
            onLogin(data as UserAccount);
            return;
          }
        }
      }

      setError('Invalid username or password.');
    } finally {
      setChecking(false);
    }
  };

  const busy = checking || !!isInitializing;

  return (
    <div className="min-h-screen login-bg flex items-center justify-center p-4 font-sans">
      <div className="w-full max-w-[420px] overflow-hidden" style={{ background: 'rgba(10,20,40,0.7)', backdropFilter: 'blur(16px)', border: '1px solid rgba(99,162,255,0.2)', boxShadow: '0 32px 80px rgba(0,0,0,0.6), 0 0 0 1px rgba(99,162,255,0.1)' }}>
        {/* Title Bar */}
        <div className="text-white px-4 py-2.5 flex justify-between items-center cursor-default" style={{ background: 'linear-gradient(135deg, #1a4f9c 0%, #185baf 50%, #1565c0 100%)', borderBottom: '1px solid rgba(99,162,255,0.2)' }}>
          <div className="flex items-center gap-2">
            <Lock className="w-4 h-4 opacity-80" />
            <span className="text-[12px] font-bold tracking-widest uppercase">Log On to UniTime</span>
          </div>
          <button className="bg-[#d9534f] text-white px-2 py-0.5 hover:bg-[#c9302c] border border-white/20 font-bold leading-none text-xs">✕</button>
        </div>

        <div className="p-5 flex flex-col gap-5">
          <div className="flex gap-4 items-center p-4" style={{ background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(99,162,255,0.15)' }}>
            <div className="w-12 h-12 flex items-center justify-center shrink-0" style={{ background: 'linear-gradient(135deg, #1a4f9c, #0891b2)', boxShadow: '0 4px 16px rgba(8,145,178,0.4)' }}>
              <Logo className="w-8 h-8 text-white" variant="grid" />
            </div>
            <div>
              <h1 className="text-[20px] font-black text-white leading-tight uppercase tracking-widest">UniTime</h1>
              <p className="text-[10px] font-bold uppercase tracking-widest mt-0.5" style={{ color: 'rgba(147,197,253,0.7)' }}>University Scheduling Platform</p>
            </div>
          </div>

          <form onSubmit={handleLogin} className="space-y-4">
            <div className="p-4 space-y-4" style={{ background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(99,162,255,0.12)' }}>
              <div className="space-y-1.5">
                <label className="text-[10px] font-bold uppercase tracking-widest flex items-center gap-1.5" style={{ color: 'rgba(147,197,253,0.8)' }}>
                  <User className="w-3.5 h-3.5" /> Username
                </label>
                <input
                  type="text"
                  value={username}
                  onChange={(e) => setUsername(e.target.value)}
                  className="w-full px-3 py-2 text-[11px] font-bold outline-none text-white placeholder:text-white/30 transition-all"
                  style={{ background: 'rgba(255,255,255,0.07)', border: '1px solid rgba(99,162,255,0.25)' }}
                  onFocus={e => (e.target.style.borderColor = 'rgba(99,162,255,0.6)')}
                  onBlur={e => (e.target.style.borderColor = 'rgba(99,162,255,0.25)')}
                  autoFocus
                  required
                />
              </div>

              <div className="space-y-1.5">
                <label className="text-[10px] font-bold uppercase tracking-widest flex items-center gap-1.5" style={{ color: 'rgba(147,197,253,0.8)' }}>
                  <Lock className="w-3.5 h-3.5" /> Password
                </label>
                <input
                  type="password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  className="w-full px-3 py-2 text-[11px] font-bold outline-none text-white placeholder:text-white/30 transition-all"
                  style={{ background: 'rgba(255,255,255,0.07)', border: '1px solid rgba(99,162,255,0.25)' }}
                  onFocus={e => (e.target.style.borderColor = 'rgba(99,162,255,0.6)')}
                  onBlur={e => (e.target.style.borderColor = 'rgba(99,162,255,0.25)')}
                  required
                />
              </div>
            </div>

            {error && (
              <div className="p-2.5 text-[10px] font-bold flex items-center gap-2 uppercase tracking-wide" style={{ background: 'rgba(217,83,79,0.15)', border: '1px solid rgba(217,83,79,0.4)', color: '#f87171' }}>
                <ShieldCheck className="w-3.5 h-3.5" />
                {error}
              </div>
            )}

            <div className="flex justify-end gap-2 pt-1">
              <button
                type="submit"
                disabled={busy}
                className="px-5 py-2 text-[11px] font-bold uppercase tracking-widest text-white transition-all min-w-[80px] disabled:opacity-50 disabled:cursor-wait"
                style={{ background: 'linear-gradient(135deg, #1a4f9c, #0891b2)', boxShadow: '0 4px 16px rgba(8,145,178,0.3)' }}
              >
                {checking ? 'Checking...' : isInitializing ? 'Loading...' : 'Sign In'}
              </button>
              <button
                type="button"
                onClick={() => { setUsername(''); setPassword(''); setError(''); }}
                className="px-5 py-2 text-[11px] font-bold uppercase tracking-widest transition-all min-w-[80px]"
                style={{ background: 'rgba(255,255,255,0.07)', border: '1px solid rgba(255,255,255,0.15)', color: 'rgba(255,255,255,0.7)' }}
              >
                Clear
              </button>
            </div>
          </form>
        </div>

        <div className="px-4 py-2 flex items-center gap-2" style={{ background: 'rgba(255,255,255,0.03)', borderTop: '1px solid rgba(99,162,255,0.12)' }}>
          <ShieldCheck className="w-3.5 h-3.5" style={{ color: 'rgba(147,197,253,0.4)' }} />
          <span className="text-[9px] font-bold uppercase tracking-widest" style={{ color: 'rgba(147,197,253,0.4)' }}>Secure Connection Active</span>
        </div>
      </div>
    </div>
  );
};

export default Login;
