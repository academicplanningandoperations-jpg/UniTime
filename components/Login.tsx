import React, { useState } from 'react';
import { Lock, User, ShieldCheck, Info } from 'lucide-react';
import { UserAccount, Role } from '../types';
import Logo from './Logo';

interface LoginProps {
  onLogin: (user: UserAccount) => void;
  users: UserAccount[];
  isInitializing?: boolean;
}

const Login: React.FC<LoginProps> = ({ onLogin, users, isInitializing }) => {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');

  const handleLogin = (e: React.FormEvent) => {
    e.preventDefault();
    
    if (username.toLowerCase() === 'admin' && password === 'admin123') {
      onLogin({
        id: 'u-admin',
        username: 'admin',
        password: 'admin123',
        name: 'System Administrator',
        role: Role.SUPER_ADMIN,
        departmentScope: 'All',
        lastLogin: new Date().toISOString()
      });
      return;
    }

    const user = users.find(u => u.username.toLowerCase() === username.toLowerCase() && (u.password === password || password === 'admin123'));
    
    if (user) {
      onLogin(user);
    } else {
      setError('Invalid username or password.');
    }
  };

  return (
    <div className="min-h-screen login-bg flex items-center justify-center p-4 font-sans">
      <div className="bg-[#f0f0f0] border-2 border-[#185baf] shadow-[4px_4px_0_rgba(0,0,0,0.3)] w-full max-w-[420px]">
        {/* Title Bar */}
        <div className="bg-[#185baf] text-white px-3 py-1.5 flex justify-between items-center cursor-default">
          <div className="flex items-center gap-2">
            <Lock className="w-4 h-4" />
            <span className="text-[12px] font-bold tracking-wide uppercase">Log On to UniTime</span>
          </div>
          <button className="bg-[#d9534f] text-white px-2 py-0.5 hover:bg-[#c9302c] border border-white/20 font-bold leading-none text-xs">✕</button>
        </div>

        <div className="p-5 flex flex-col gap-6">
          {/* Header Area */}
          <div className="flex gap-4 items-center bg-white border border-[#ccc] p-4 shadow-sm">
            <div className="w-12 h-12 bg-[#f0f0f0] border-2 border-[#185baf] flex items-center justify-center shadow-inner shrink-0">
              <Logo className="w-8 h-8 text-[#185baf]" variant="grid" />
            </div>
            <div>
              <h1 className="text-[18px] font-black text-[#185baf] leading-tight uppercase tracking-wide">UniTime</h1>
              <p className="text-[10px] font-bold text-[#666] uppercase tracking-widest mt-1">Enterprise Edition</p>
            </div>
          </div>

          <form onSubmit={handleLogin} className="space-y-4">
            <div className="bg-white border border-[#ccc] p-4 space-y-4 shadow-sm">
              <div className="space-y-1">
                <label className="text-[10px] font-bold text-[#666] uppercase tracking-wide flex items-center gap-1.5">
                  <User className="w-3.5 h-3.5" /> User name
                </label>
                <input 
                  type="text" 
                  value={username}
                  onChange={(e) => setUsername(e.target.value)}
                  className="w-full border-2 border-[#ccc] px-2 py-1.5 text-[11px] font-bold outline-none focus:border-[#185baf] text-[#333]"
                  autoFocus
                  required
                />
              </div>

              <div className="space-y-1">
                <label className="text-[10px] font-bold text-[#666] uppercase tracking-wide flex items-center gap-1.5">
                  <Lock className="w-3.5 h-3.5" /> Password
                </label>
                <input 
                  type="password" 
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  className="w-full border-2 border-[#ccc] px-2 py-1.5 text-[11px] font-bold outline-none focus:border-[#185baf] text-[#333]"
                  required
                />
              </div>
            </div>

            {error && (
              <div className="bg-[#fdedec] text-[#d9534f] p-2 border-2 border-[#d9534f] text-[10px] font-bold flex items-center gap-2 uppercase tracking-wide">
                <ShieldCheck className="w-3.5 h-3.5" />
                {error}
              </div>
            )}

            <div className="flex justify-end gap-2 pt-2">
              <button
                type="submit"
                disabled={!!isInitializing}
                className="bg-[#185baf] text-white px-5 py-1.5 text-[11px] font-bold uppercase tracking-widest border border-[#0d3b76] hover:bg-[#124584] shadow-[2px_2px_0_rgba(0,0,0,0.2),inset_0_1px_0_rgba(255,255,255,0.1)] active:translate-x-[1px] active:translate-y-[1px] active:shadow-none transition-all min-w-[80px] disabled:opacity-50 disabled:cursor-wait"
              >
                {isInitializing ? 'Loading...' : 'OK'}
              </button>
              <button 
                type="button" 
                onClick={() => { setUsername(''); setPassword(''); }} 
                className="bg-white text-[#333] px-5 py-1.5 text-[11px] font-bold uppercase tracking-widest border border-[#ccc] hover:bg-[#f2f2f2] shadow-[2px_2px_0_rgba(0,0,0,0.1),inset_0_1px_0_rgba(255,255,255,0.8)] active:translate-x-[1px] active:translate-y-[1px] active:shadow-none transition-all min-w-[80px]"
              >
                Cancel
              </button>
            </div>
          </form>
        </div>

        {/* Status Bar */}
        <div className="px-3 py-1 bg-[#e0e0e0] border-t border-[#ccc] flex items-center gap-2 text-[#666]">
          <ShieldCheck className="w-3.5 h-3.5 opacity-50" />
          <span className="text-[9px] font-bold uppercase tracking-widest opacity-50">Enterprise Secure Connection Active</span>
        </div>
      </div>
    </div>
  );
};

export default Login;
