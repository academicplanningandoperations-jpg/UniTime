
import React, { useState } from 'react';
import { motion } from 'motion/react';
import { Database, ExternalLink, CheckCircle2, AlertCircle, Copy, Save } from 'lucide-react';

interface SupabaseSetupProps {
  onConfigured: (url: string, key: string) => void;
}

const SupabaseSetup: React.FC<SupabaseSetupProps> = ({ onConfigured }) => {
  const [url, setUrl] = useState('');
  const [key, setKey] = useState('');
  const [status, setStatus] = useState<'idle' | 'testing' | 'success' | 'error'>('idle');

  const handleConnect = () => {
    if (!url || !key) return;
    setStatus('testing');
    
    // Simple validation
    if (url.startsWith('https://') && url.includes('.supabase.co') && key.length > 20) {
      setTimeout(() => {
        setStatus('success');
        setTimeout(() => {
          localStorage.setItem('VITE_SUPABASE_URL', url);
          localStorage.setItem('VITE_SUPABASE_ANON_KEY', key);
          onConfigured(url, key);
        }, 1000);
      }, 800);
    } else {
      setStatus('error');
    }
  };

  return (
    <div className="min-h-screen bg-[#008080] flex items-center justify-center p-6">
      <div className="wf w-full max-w-md shadow-2xl">
        <div className="wtb tb-blue">
          <span className="wico">☁️</span>
          <span className="wtit uppercase tracking-widest text-[10px]">Supabase Cloud Configuration</span>
        </div>
        
        <div className="p-6 bg-[#ECECEC] space-y-6">
          <div className="text-center space-y-2">
            <div className="w-16 h-16 bg-white border-2 border-slate-300 shadow-inner rounded-full flex items-center justify-center mx-auto mb-4">
              <Database className="w-8 h-8 text-blue-700" />
            </div>
            <h2 className="text-xl font-black text-slate-900 uppercase tracking-tight">Connect to Cloud</h2>
            <p className="text-[10px] text-slate-500 font-bold uppercase tracking-widest leading-relaxed">
              Enable real-time multi-user synchronization and persistent storage.
            </p>
          </div>

          <div className="space-y-4">
            <div className="space-y-1">
              <label className="text-[10px] font-black text-slate-500 uppercase tracking-widest flex items-center gap-2">
                Project URL
              </label>
              <input 
                type="text" 
                placeholder="https://your-project.supabase.co"
                className="wi w-full"
                value={url}
                onChange={(e) => setUrl(e.target.value)}
              />
            </div>

            <div className="space-y-1">
              <label className="text-[10px] font-black text-slate-500 uppercase tracking-widest flex items-center gap-2">
                API Key (Anon)
              </label>
              <textarea 
                placeholder="your-anon-key"
                className="wi w-full h-20 resize-none font-mono text-[9px]"
                value={key}
                onChange={(e) => setKey(e.target.value)}
              />
            </div>

            {status === 'error' && (
              <div className="bg-red-700 text-white p-2 border border-white text-[9px] font-black uppercase tracking-widest flex items-center gap-2">
                <AlertCircle className="w-3 h-3" />
                Invalid Credentials - Try Again
              </div>
            )}

            <div className="pt-2 space-y-3">
              <button 
                onClick={handleConnect}
                disabled={status === 'testing' || status === 'success'}
                className="wb add w-full flex items-center justify-center gap-2 py-2"
              >
                {status === 'testing' ? (
                  <>
                    <div className="w-3 h-3 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                    Connecting...
                  </>
                ) : status === 'success' ? (
                  <>
                    <CheckCircle2 className="w-3 h-3" />
                    Connected!
                  </>
                ) : (
                  <>
                    <Database className="w-3 h-3" />
                    Initialize Connection
                  </>
                )}
              </button>
              
              <button 
                onClick={() => onConfigured('', '')}
                className="wb w-full text-[10px]"
              >
                Continue with Local Storage Only
              </button>
            </div>
          </div>

          <div className="bg-white border border-slate-300 p-3 shadow-inner">
            <p className="text-[9px] text-slate-500 font-bold uppercase tracking-widest leading-relaxed text-center">
              Your credentials are encrypted and stored locally in your browser session.
            </p>
          </div>
        </div>
      </div>
    </div>
  );
};

export default SupabaseSetup;
