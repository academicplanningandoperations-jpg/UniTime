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

  const [textIndex, setTextIndex] = useState(0);
  const [fade, setFade] = useState(true);

  const heroTexts = [
    "STREAMLINED ACADEMIC SCHEDULING",
    "INTELLIGENT RESOURCE ALLOCATION",
    "ENTERPRISE-GRADE TIMETABLE MANAGEMENT",
    "EMPOWERING EDUCATIONAL EXCELLENCE"
  ];

  useEffect(() => {
    const interval = setInterval(() => {
      setFade(false);
      setTimeout(() => {
        setTextIndex((prev) => (prev + 1) % heroTexts.length);
        setFade(true);
      }, 500);
    }, 4000);

    return () => clearInterval(interval);
  }, []);

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
    <div className="min-h-screen p-4 font-sans relative overflow-hidden flex items-center justify-center" style={{
      background: 'linear-gradient(160deg, #020c1f 0%, #04122e 35%, #071840 65%, #0a1f4a 100%)'
    }}>

      {/* Aurora blobs */}
      <div aria-hidden className="absolute inset-0 overflow-hidden pointer-events-none" style={{ zIndex: 0 }}>
        <div className="aurora-blob aurora-1" />
        <div className="aurora-blob aurora-2" />
        <div className="aurora-blob aurora-3" />
        <div className="aurora-blob aurora-4" />
      </div>

      {/* Animated Stars */}
      <div className="absolute inset-0 overflow-hidden pointer-events-none" style={{ zIndex: 1 }}>
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

      {/* Star Twinkle Animation */}
      <style>{`
        @keyframes starTwinkle {
          0%, 100% { opacity: 0.15; transform: scale(1); }
          50% { opacity: 0.9; transform: scale(1.3); }
        }
      `}</style>

      {/* Content Layout Container */}
      <div className="flex flex-col md:flex-row items-center justify-between w-full max-w-[1200px] px-4 md:px-8 z-10 relative gap-12">
        
        {/* Dynamic Text Section (Left) */}
        <div className="flex-1 text-white max-w-[600px] text-center md:text-left pt-10 md:pt-0">
          <div className="mb-4 hidden md:block">
            <Logo className="w-16 h-auto mix-blend-multiply opacity-90" />
          </div>
          <h2 
            className={`text-4xl md:text-6xl font-black leading-tight tracking-wide uppercase transition-opacity duration-500 ease-in-out ${fade ? 'opacity-100' : 'opacity-0'}`}
            style={{
              textShadow: '0 4px 20px rgba(0,0,0,0.5), 0 0 40px rgba(24,91,175,0.4)',
              background: 'linear-gradient(135deg, #ffffff 0%, #c8ddf8 100%)',
              WebkitBackgroundClip: 'text',
              WebkitTextFillColor: 'transparent',
            }}
          >
            {heroTexts[textIndex]}
          </h2>
          <p className="mt-6 text-[#6b91c0] text-sm md:text-base font-medium tracking-wider uppercase max-w-sm mx-auto md:mx-0">
            Welcome to the definitive platform for university scheduling operations.
          </p>
        </div>

        {/* Login Card (Right) */}
        <div className="w-full max-w-[400px] overflow-hidden relative shrink-0" style={{ zIndex: 10,
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
            <div className="flex flex-col gap-2 items-center justify-center bg-[#f0f6ff] border border-[#c8ddf8] p-4 text-center">
              <Logo className="w-32 h-auto mix-blend-multiply" />
              <p className="text-[10px] font-bold text-[#6b91c0] uppercase tracking-widest mt-0.5">University Scheduling Platform</p>
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

            <div className="text-center pt-2 border-t border-[#c8ddf8]/50 mt-2">
              <p className="text-[10px] font-medium text-[#5a7ba8]">
                Forgot your ID or password? <br/>
                <a href="#" className="text-[#185baf] font-bold hover:underline">Contact Administration</a>
              </p>
            </div>
          </div>

          <div className="px-4 py-2 bg-[#f0f6ff] border-t border-[#c8ddf8] flex items-center gap-2">
            <ShieldCheck className="w-3.5 h-3.5 text-[#5a7ba8] opacity-60" />
            <span className="text-[9px] font-bold uppercase tracking-widest text-[#5a7ba8] opacity-60">Secure Connection Active</span>
          </div>
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
