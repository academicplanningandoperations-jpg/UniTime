
import React, { Component } from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';

// Root Error Boundary for absolute crash protection
class ErrorBoundary extends Component<any, any> {
  state = { hasError: false };

  static getDerivedStateFromError() {
    return { hasError: true };
  }

  componentDidCatch(error: any, errorInfo: any) {
    console.error("CRITICAL ROOT ERROR:", error, errorInfo);
  }

  render() {
    if (this.state.hasError) {
      return (
        <div className="min-h-screen bg-[#0f172a] flex items-center justify-center p-6 text-white font-sans">
          <div className="max-w-md w-full bg-[#1e293b] border-2 border-[#3b82f6] p-8 shadow-2xl">
            <h1 className="text-2xl font-black uppercase tracking-tighter text-[#3b82f6] mb-4 text-center">System Cache Failure</h1>
            <p className="text-sm text-[#cbd5e1] mb-6 font-bold leading-relaxed uppercase tracking-wider text-center">
              The application is trapped in an old browser cache or has encountered a runtime error.
            </p>
            <div className="bg-black/50 p-4 font-mono text-[10px] text-[#93c5fd] mb-6 border border-[#1d4ed8]/50 overflow-x-auto">
              System ID: {window.location.hostname} • Version: UniTime-v4
            </div>
            <button 
              onClick={async () => {
                // ✅ Deep Clean: Clear SW, Caches, and LocalStorage
                if ('serviceWorker' in navigator) {
                  const regs = await navigator.serviceWorker.getRegistrations();
                  for(let r of regs) await r.unregister();
                }
                const keys = await caches.keys();
                for(let k of keys) await caches.delete(k);
                localStorage.clear();
                window.location.replace(window.location.origin + '?reset=' + Date.now());
              }}
              className="w-full bg-[#2563eb] hover:bg-[#1d4ed8] text-white font-black py-4 uppercase tracking-widest text-xs transition-all shadow-[4px_4px_0_rgba(0,0,0,0.3)] active:translate-x-[2px] active:translate-y-[2px] active:shadow-none"
            >
              Clear System Cache & Reset App
            </button>
          </div>
        </div>
      );
    }

    return (this as any).props.children;
  }
}

const rootElement = document.getElementById('root');
if (!rootElement) {
  throw new Error("Could not find root element to mount to");
}

const root = ReactDOM.createRoot(rootElement);
root.render(
  <React.StrictMode>
    <ErrorBoundary>
      <App />
    </ErrorBoundary>
  </React.StrictMode>
);
