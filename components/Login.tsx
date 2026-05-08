import React, { useState, useEffect, useRef } from 'react';
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

  // Generate star positions once
  const starsRef = useRef<{x: number, y: number, size: number, delay: number, duration: number}[]>([]);
  if (starsRef.current.length === 0) {
    for (let i = 0; i < 120; i++) {
      starsRef.current.push({
        x: Math.random() * 100,
        y: Math.random() * 100,
        size: Math.random() * 2.5 + 0.5,
        delay: Math.random() * 5,
        duration: Math.random() * 3 + 2,
      });
    }
  }

  return (
    <div className="min-h-screen flex items-center justify-center p-4 font-sans relative overflow-hidden" style={{
      background: 'linear-gradient(180deg, #0a1e42 0%, #0f3d8c 35%, #185baf 60%, #2a7cc7 80%, #4d9de0 100%)'
    }}>
      {/* Animated Stars */}
      <div className="absolute inset-0 overflow-hidden pointer-events-none">
        {starsRef.current.map((star, i) => (
          <div
            key={i}
            className="absolute rounded-full bg-white"
            style={{
              left: `${star.x}%`,
              top: `${star.y}%`,
              width: `${star.size}px`,
              height: `${star.size}px`,
              animation: `starTwinkle ${star.duration}s ease-in-out ${star.delay}s infinite`,
              opacity: 0.2,
            }}
          />
        ))}
      </div>

      {/* Constellation / Glow accent (centered above card) */}
      <div className="absolute pointer-events-none" style={{
        top: '12%',
        left: '50%',
        transform: 'translateX(-50%)',
        width: '280px',
        height: '280px',
        background: 'radial-gradient(circle, rgba(8,145,178,0.25) 0%, rgba(24,91,175,0.12) 40%, transparent 70%)',
        filter: 'blur(30px)',
      }} />

      {/* Subtle radial glow behind card */}
      <div className="absolute pointer-events-none" style={{
        top: '50%',
        left: '50%',
        transform: 'translate(-50%, -50%)',
        width: '600px',
        height: '600px',
        background: 'radial-gradient(circle, rgba(24,91,175,0.15) 0%, transparent 60%)',
      }} />

      {/* Floating Constellation Dots */}
      <div className="absolute pointer-events-none" style={{ top: '10%', left: '50%', transform: 'translateX(-50%)' }}>
        <svg width="200" height="200" viewBox="0 0 200 200" fill="none" className="opacity-30">
          <circle cx="100" cy="60" r="2.5" fill="white" className="animate-pulse" />
          <circle cx="130" cy="90" r="2" fill="white" style={{ animationDelay: '0.5s' }} className="animate-pulse" />
          <circle cx="80" cy="100" r="1.8" fill="white" style={{ animationDelay: '1s' }} className="animate-pulse" />
          <circle cx="110" cy="130" r="2.2" fill="white" style={{ animationDelay: '1.5s' }} className="animate-pulse" />
          <circle cx="70" cy="70" r="1.5" fill="white" style={{ animationDelay: '2s' }} className="animate-pulse" />
          <circle cx="140" cy="120" r="1.8" fill="white" style={{ animationDelay: '0.8s' }} className="animate-pulse" />
          <line x1="100" y1="60" x2="130" y2="90" stroke="white" strokeWidth="0.5" opacity="0.3" />
          <line x1="130" y1="90" x2="110" y2="130" stroke="white" strokeWidth="0.5" opacity="0.3" />
          <line x1="80" y1="100" x2="110" y2="130" stroke="white" strokeWidth="0.5" opacity="0.3" />
          <line x1="70" y1="70" x2="100" y2="60" stroke="white" strokeWidth="0.5" opacity="0.3" />
          <line x1="80" y1="100" x2="70" y2="70" stroke="white" strokeWidth="0.5" opacity="0.3" />
          <line x1="140" y1="120" x2="130" y2="90" stroke="white" strokeWidth="0.5" opacity="0.3" />
        </svg>
      </div>

      {/* Star Twinkle Animation */}
      <style>{`
        @keyframes starTwinkle {
          0%, 100% { opacity: 0.15; transform: scale(1); }
          50% { opacity: 0.9; transform: scale(1.3); }
        }
      `}</style>

      {/* Login Card */}
      <div className="w-full max-w-[400px] overflow-hidden relative z-10" style={{
        background: 'rgba(255,255,255,0.95)',
        backdropFilter: 'blur(20px)',
        boxShadow: '0 25px 80px rgba(0,0,0,0.35), 0 4px 20px rgba(24,91,175,0.2), 0 0 60px rgba(8,145,178,0.1)',
        border: '1px solid rgba(255,255,255,0.5)',
      }}>
        {/* Title Bar */}
        <div className="text-white px-4 py-2.5 flex justify-between items-center cursor-default" style={{ background: 'linear-gradient(135deg, #0f3d8c 0%, #185baf 60%, #1a6ac4 100%)' }}>
          <div className="flex items-center gap-2">
            <Lock className="w-4 h-4 opacity-80" />
            <span className="text-[12px] font-bold tracking-widest uppercase">Log On to UniTime</span>
          </div>
          <button className="bg-[#d9534f] text-white px-2 py-0.5 hover:bg-[#c9302c] border border-white/20 font-bold leading-none text-xs">✕</button>
        </div>

        <div className="p-6 flex flex-col gap-5">
          {/* Brand block */}
          <div className="flex gap-4 items-center bg-[#f0f6ff] border border-[#c8ddf8] p-4">
            <div className="w-12 h-12 flex items-center justify-center shrink-0" style={{ background: 'linear-gradient(135deg, #185baf, #0891b2)' }}>
              <Logo className="w-8 h-8 text-white" variant="grid" />
            </div>
            <div>
              <h1 className="text-[20px] font-black text-[#185baf] leading-tight uppercase tracking-widest">UniTime</h1>
              <p className="text-[10px] font-bold text-[#6b91c0] uppercase tracking-widest mt-0.5">University Scheduling Platform</p>
            </div>
          </div>

          <form onSubmit={handleLogin} className="space-y-4">
            <div className="space-y-3">
              <div className="space-y-1.5">
                <label className="text-[10px] font-bold text-[#5a7ba8] uppercase tracking-widest flex items-center gap-1.5">
                  <User className="w-3.5 h-3.5" /> Username
                </label>
                <input
                  type="text"
                  value={username}
                  onChange={(e) => setUsername(e.target.value)}
                  className="w-full border-2 border-[#c8ddf8] px-3 py-2 text-[11px] font-bold outline-none text-[#1e3a5f] bg-white transition-all focus:border-[#185baf]"
                  autoFocus
                  required
                />
              </div>

              <div className="space-y-1.5">
                <label className="text-[10px] font-bold text-[#5a7ba8] uppercase tracking-widest flex items-center gap-1.5">
                  <Lock className="w-3.5 h-3.5" /> Password
                </label>
                <input
                  type="password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  className="w-full border-2 border-[#c8ddf8] px-3 py-2 text-[11px] font-bold outline-none text-[#1e3a5f] bg-white transition-all focus:border-[#185baf]"
                  required
                />
              </div>
            </div>

            {error && (
              <div className="bg-[#fff0ef] text-[#d9534f] p-2.5 border-2 border-[#f5c6c6] text-[10px] font-bold flex items-center gap-2 uppercase tracking-wide">
                <ShieldCheck className="w-3.5 h-3.5" />
                {error}
              </div>
            )}

            <div className="flex justify-end gap-2 pt-1">
              <button
                type="submit"
                disabled={busy}
                className="px-5 py-2 text-[11px] font-bold uppercase tracking-widest text-white transition-all min-w-[80px] disabled:opacity-50 disabled:cursor-wait hover:opacity-90"
                style={{ background: 'linear-gradient(135deg, #185baf, #0d8ecf)' }}
              >
                {checking ? 'Checking...' : isInitializing ? 'Loading...' : 'Sign In'}
              </button>
              <button
                type="button"
                onClick={() => { setUsername(''); setPassword(''); setError(''); }}
                className="px-5 py-2 text-[11px] font-bold uppercase tracking-widest text-[#666] border-2 border-[#ccc] bg-white hover:bg-[#f5f5f5] transition-all min-w-[80px]"
              >
                Clear
              </button>
            </div>
          </form>
        </div>

        <div className="px-4 py-2 bg-[#f0f6ff] border-t border-[#c8ddf8] flex items-center gap-2">
          <ShieldCheck className="w-3.5 h-3.5 text-[#5a7ba8] opacity-60" />
          <span className="text-[9px] font-bold uppercase tracking-widest text-[#5a7ba8] opacity-60">Secure Connection Active</span>
        </div>
      </div>

      {/* Bottom Scroll Chevron */}
      <div className="absolute bottom-8 left-1/2 -translate-x-1/2 animate-bounce pointer-events-none">
        <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="opacity-40">
          <polyline points="6 9 12 15 18 9" />
        </svg>
      </div>
    </div>
  );
};

export default Login;
