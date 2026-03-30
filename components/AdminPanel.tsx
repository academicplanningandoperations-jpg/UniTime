
import React, { useState, useEffect } from 'react';
import { UserAccount, Role } from '../types';
import { 
  UserPlus, 
  Shield, 
  User, 
  Users,
  Trash2, 
  Edit2, 
  CheckCircle2, 
  Search, 
  X, 
  Lock, 
  Server, 
  Globe, 
  Database, 
  Save,
  ArrowRight,
  CloudLightning,
  CreditCard
} from 'lucide-react';

interface AdminPanelProps {
  users: UserAccount[];
  onUpdateUsers: (users: UserAccount[]) => void;
  currentUser: UserAccount;
  onFullSync: () => Promise<void>;
  onWipeAllData: () => Promise<void>;
}

const AdminPanel: React.FC<AdminPanelProps> = ({ users, onUpdateUsers, currentUser, onFullSync, onWipeAllData }) => {
  const [isAdding, setIsAdding] = useState(false);
  const [isEditing, setIsEditing] = useState(false);
  const [editingUserId, setEditingUserId] = useState<string | null>(null);
  const [searchTerm, setSearchTerm] = useState('');
  
  // Read credentials from localStorage first, then fall back to build-time env vars.
  // Env vars are baked into the Vercel bundle and work for all users automatically.
  const envUrl = (import.meta as any).env?.VITE_SUPABASE_URL || '';
  const envKey = (import.meta as any).env?.VITE_SUPABASE_ANON_KEY || '';
  const usingEnvVars = !!(envUrl && !envUrl.includes('xyz.supabase.co'));

  const [apiEndpoint, setApiEndpoint] = useState(localStorage.getItem('VITE_SUPABASE_URL') || envUrl);
  const [apiKey, setApiKey] = useState(localStorage.getItem('VITE_SUPABASE_ANON_KEY') || envKey);
  const [syncStatus, setSyncStatus] = useState<'idle' | 'saved'>('idle');

  const initialUserState: Partial<UserAccount> = {
    username: '',
    password: '',
    name: '',
    role: Role.SCHEDULER,
    departmentScope: ''
  };

  const [formData, setFormData] = useState<Partial<UserAccount>>(initialUserState);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (formData.username && formData.name) {
      if (isEditing && editingUserId) {
        const updatedUsers = users.map(u => u.id === editingUserId ? { ...u, ...formData as UserAccount } : u);
        onUpdateUsers(updatedUsers);
      } else {
        const user: UserAccount = {
          id: `u-${Date.now()}`,
          username: formData.username,
          password: formData.password || 'password123',
          name: formData.name,
          role: formData.role || Role.SCHEDULER,
          departmentScope: formData.departmentScope || 'All',
        };
        onUpdateUsers([...users, user]);
      }
      closeModal();
    }
  };

  const saveBackendConfig = () => {
    if (apiEndpoint && apiKey) {
      localStorage.setItem('VITE_SUPABASE_URL', apiEndpoint);
      localStorage.setItem('VITE_SUPABASE_ANON_KEY', apiKey);
      setSyncStatus('saved');
      setTimeout(() => window.location.reload(), 1500);
    } else {
      // Guard: don't silently wipe credentials — ask for confirmation first.
      const hasExisting = localStorage.getItem('VITE_SUPABASE_URL') || usingEnvVars;
      if (hasExisting) {
        if (!confirm('Both fields are empty. This will REMOVE the saved Supabase connection. Are you sure?')) return;
      }
      localStorage.removeItem('VITE_SUPABASE_URL');
      localStorage.removeItem('VITE_SUPABASE_ANON_KEY');
      setSyncStatus('saved');
      setTimeout(() => window.location.reload(), 1500);
    }
  };

  const closeModal = () => {
    setIsAdding(false);
    setIsEditing(false);
    setEditingUserId(null);
    setFormData(initialUserState);
  };

  const openEditModal = (user: UserAccount) => {
    setFormData({
      username: user.username,
      password: user.password,
      name: user.name,
      role: user.role,
      departmentScope: user.departmentScope
    });
    setEditingUserId(user.id);
    setIsEditing(true);
    setIsAdding(true);
  };

  const deleteUser = (id: string) => {
    if (id === currentUser.id) {
      alert("You cannot delete your own account.");
      return;
    }
    if (confirm('Are you sure you want to remove this team member?')) {
      onUpdateUsers(users.filter(u => u.id !== id));
    }
  };

  const filteredUsers = users.filter(u => 
    u.name.toLowerCase().includes(searchTerm.toLowerCase()) || 
    u.username.toLowerCase().includes(searchTerm.toLowerCase()) ||
    u.departmentScope.toLowerCase().includes(searchTerm.toLowerCase())
  );

  const sqlSchema = `
-- 1. Create Tables
CREATE TABLE IF NOT EXISTS public.users (
    id TEXT PRIMARY KEY,
    username TEXT NOT NULL UNIQUE,
    password TEXT,
    name TEXT NOT NULL,
    role TEXT NOT NULL,
    "departmentScope" TEXT NOT NULL,
    "lastLogin" TIMESTAMP WITH TIME ZONE
);

CREATE TABLE IF NOT EXISTS public.terms (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    "startDate" TEXT NOT NULL,
    "endDate" TEXT NOT NULL,
    "academicYear" TEXT NOT NULL,
    "isActive" BOOLEAN DEFAULT false
);

CREATE TABLE IF NOT EXISTS public.courses (
    id TEXT PRIMARY KEY,
    "termId" TEXT,
    code TEXT NOT NULL,
    name TEXT NOT NULL,
    credits NUMERIC NOT NULL,
    department TEXT NOT NULL,
    duration NUMERIC NOT NULL,
    type TEXT NOT NULL,
    color TEXT
);

CREATE TABLE IF NOT EXISTS public.faculties (
    id TEXT PRIMARY KEY,
    "facultyId" TEXT,
    "termId" TEXT,
    name TEXT NOT NULL,
    department TEXT NOT NULL,
    availability TEXT[] DEFAULT '{}',
    "maxHoursPerWeek" NUMERIC DEFAULT 18
);

CREATE TABLE IF NOT EXISTS public.rooms (
    id TEXT PRIMARY KEY,
    "termId" TEXT,
    name TEXT NOT NULL,
    capacity NUMERIC NOT NULL,
    type TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS public.groups (
    id TEXT PRIMARY KEY,
    "termId" TEXT,
    name TEXT NOT NULL,
    program TEXT NOT NULL,
    semester NUMERIC NOT NULL,
    "studentCount" NUMERIC NOT NULL
);

CREATE TABLE IF NOT EXISTS public.schedule (
    id TEXT PRIMARY KEY,
    "termId" TEXT NOT NULL,
    "courseId" TEXT NOT NULL,
    "facultyId" TEXT NOT NULL,
    "roomId" TEXT NOT NULL,
    "groupIds" TEXT[] NOT NULL,
    day TEXT NOT NULL,
    "startTime" TEXT NOT NULL,
    "endTime" TEXT NOT NULL,
    "departmentId" TEXT NOT NULL,
    weeks INTEGER[] NOT NULL,
    category TEXT
);

-- 2. Enable RLS
ALTER TABLE public.users ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.terms ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.courses ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.faculties ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.rooms ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.groups ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.schedule ENABLE ROW LEVEL SECURITY;

-- 3. Create Policies (Development: Allow all access)
CREATE POLICY "Allow all access" ON public.users FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "Allow all access" ON public.terms FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "Allow all access" ON public.courses FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "Allow all access" ON public.faculties FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "Allow all access" ON public.rooms FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "Allow all access" ON public.groups FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "Allow all access" ON public.schedule FOR ALL USING (true) WITH CHECK (true);
  `;

  const copySql = () => {
    navigator.clipboard.writeText(sqlSchema);
    alert('SQL Schema copied to clipboard! Paste it into your Supabase SQL Editor and run it.');
  };

  return (
    <div className="p-2 h-full flex flex-col pt-3">
      {/* Page Header */}
      <div className="flex justify-between items-end border-b-2 border-[#185baf] pb-1 mx-2 mb-4">
        <div>
          <h2 className="text-[16px] font-black text-[#185baf] uppercase tracking-wide">Administrative Control Area</h2>
          <p className="text-[10px] text-[#666] font-bold uppercase tracking-widest">Manage Personnel Access & Backend Infrastructure</p>
        </div>
      </div>

      <div className="px-2 grid grid-cols-1 lg:grid-cols-12 gap-4 flex-1 overflow-y-auto mb-10 pb-20 custom-scrollbar">
        {/* Left Column: Personnel & Migration */}
        <div className="lg:col-span-8 flex flex-col gap-4">
          
          {/* Personnel Directory Panel */}
          <div className="bg-[#f0f0f0] border-2 border-[#185baf] shadow-md flex flex-col">
            <div className="bg-[#185baf] text-white px-3 py-1.5 flex justify-between items-center">
              <div className="flex items-center gap-2">
                 <Users className="w-4 h-4" />
                 <span className="text-[11px] font-bold tracking-wide uppercase">Personnel Directory</span>
              </div>
              <button 
                onClick={() => { setIsEditing(false); setIsAdding(true); }}
                className="bg-[#f0f0f0] text-[#185baf] px-2 py-0.5 hover:bg-white border border-[#185baf] font-bold text-[10px] uppercase tracking-widest flex items-center gap-1"
              >
                <UserPlus className="w-3 h-3" /> Add Member
              </button>
            </div>

            <div className="px-3 py-2 bg-[#e0e0e0] border-b border-[#ccc]">
               <div className="flex bg-white border border-[#ccc] p-[2px]">
                  <div className="bg-[#f0f0f0] px-2 py-1 flex items-center justify-center border-r border-[#ccc]">
                    <Search className="w-3 h-3 text-[#666]" />
                  </div>
                  <input 
                    type="text" 
                    placeholder="Search personnel by name, username or scope..."
                    className="w-full px-2 py-1 text-[11px] font-bold outline-none uppercase tracking-wide"
                    value={searchTerm}
                    onChange={(e) => setSearchTerm(e.target.value)}
                  />
               </div>
            </div>

            <div className="bg-white p-2 min-h-[250px] overflow-y-auto custom-scrollbar">
              <table className="w-full text-left border-collapse">
                <thead>
                  <tr className="border-b border-[#ccc] bg-[#f8f9fa]">
                    <th className="p-2 text-[10px] font-bold text-[#666] uppercase tracking-wider w-[40%]">Identity</th>
                    <th className="p-2 text-[10px] font-bold text-[#666] uppercase tracking-wider text-center">Permissions</th>
                    <th className="p-2 text-[10px] font-bold text-[#666] uppercase tracking-wider text-center">Operational Scope</th>
                    <th className="p-2 text-[10px] font-bold text-[#666] uppercase tracking-wider text-right">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredUsers.map((user) => (
                    <tr key={user.id} className="border-b border-[#eee] hover:bg-[#f5f5f5]">
                      <td className="p-2">
                        <div className="flex items-center gap-2">
                          <div className="w-6 h-6 border border-[#ccc] bg-[#e0e0e0] text-[#333] flex items-center justify-center font-black text-[10px]">
                            {user.name.charAt(0)}
                          </div>
                          <div>
                            <p className="text-[11px] font-black text-[#333] tracking-wide">{user.name}</p>
                            <p className="text-[9px] font-bold text-[#666] uppercase">@{user.username}</p>
                          </div>
                        </div>
                      </td>
                      <td className="p-2 text-center">
                        <span className={`px-2 py-0.5 border text-[9px] font-bold uppercase tracking-widest ${
                          user.role === Role.SUPER_ADMIN ? 'bg-blue-50 text-blue-700 border-blue-300' : 'bg-[#e0e0e0] text-[#333] border-[#ccc]'
                        }`}>
                          {user.role}
                        </span>
                      </td>
                      <td className="p-2 text-center">
                        <div className="inline-flex flex-col items-center">
                          <span className="text-[10px] font-bold text-[#333] uppercase tracking-tight">
                            {user.departmentScope}
                          </span>
                        </div>
                      </td>
                      <td className="p-2 text-right">
                        <div className="flex items-center justify-end gap-1">
                          <button onClick={() => openEditModal(user)} className="bg-[#f0f0f0] border border-[#ccc] p-1 text-[#333] hover:bg-[#e0e0e0]" title="Edit">
                            <Edit2 className="w-3 h-3" />
                          </button>
                          <button onClick={() => deleteUser(user.id)} className="bg-[#fdedec] border border-[#d9534f] p-1 text-[#d9534f] hover:bg-[#d9534f] hover:text-white" title="Delete">
                            <Trash2 className="w-3 h-3" />
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))}
                  {filteredUsers.length === 0 && (
                     <tr>
                        <td colSpan={4} className="p-4 text-center text-[10px] font-bold text-[#666] uppercase">NO PERSONNEL FOUND MATCHING QUERY</td>
                     </tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>

          {/* SQL Migration Roadmap Panel */}
          <div className="bg-[#f0f0f0] border-2 border-[#185baf] shadow-md flex flex-col">
             <div className="bg-[#185baf] text-white px-3 py-1.5 flex items-center gap-2">
                <Database className="w-4 h-4" />
                <span className="text-[11px] font-bold tracking-wide uppercase">SQL Migration Roadmap</span>
             </div>
             <div className="p-4 grid grid-cols-1 md:grid-cols-3 gap-3">
                <div className="p-3 bg-white border border-[#ccc]">
                   <h4 className="text-[9px] font-black uppercase text-[#666] tracking-widest mb-1 border-b border-[#eee] pb-1">Phase 1: Database</h4>
                   <p className="text-[10px] font-bold text-[#333] leading-relaxed mb-3 mt-2">Translate LocalData to a PostgreSQL instance on <span className="text-[#185baf]">Supabase</span>.</p>
                   <div className="inline-block bg-[#eafbef] text-[#2e7d32] border border-[#a5d6a7] px-1 text-[8px] font-black uppercase">Free Tier Ready</div>
                </div>

                <div className="p-3 bg-white border border-[#ccc]">
                   <h4 className="text-[9px] font-black uppercase text-[#666] tracking-widest mb-1 border-b border-[#eee] pb-1">Phase 2: API Layer</h4>
                   <p className="text-[10px] font-bold text-[#333] leading-relaxed mb-3 mt-2">Build a Node.js server container to process UniTime requests safely.</p>
                   <div className="inline-block bg-[#e0ebf9] text-[#185baf] border border-[#b2d4f5] px-1 text-[8px] font-black uppercase">REST / GraphQL</div>
                </div>

                <div className="p-3 bg-white border border-[#ccc]">
                   <h4 className="text-[9px] font-black uppercase text-[#666] tracking-widest mb-1 border-b border-[#eee] pb-1">Phase 3: Scale Out</h4>
                   <p className="text-[10px] font-bold text-[#333] leading-relaxed mb-3 mt-2">Transition to paid hosting tiers when database limits are exceeded (&gt;500MB).</p>
                   <div className="inline-block bg-[#f0f0f0] text-[#666] border border-[#ccc] px-1 text-[8px] font-black uppercase">Cost Projected</div>
                </div>
             </div>
          </div>
        </div>

        {/* Right Column: Supabase Settings */}
        <div className="lg:col-span-4 flex flex-col gap-4">
          <div className="bg-[#f0f0f0] border-2 border-[#185baf] shadow-md flex flex-col">
             <div className="bg-[#185baf] text-white px-3 py-1.5 flex justify-between items-center">
                <div className="flex items-center gap-2">
                  <Server className="w-4 h-4" />
                  <span className="text-[11px] font-bold tracking-wide uppercase">Supabase Config</span>
                </div>
             </div>
             
             <div className="p-4 space-y-4 bg-white">
                <div className="flex items-center justify-between border-b border-[#eee] pb-2">
                  <span className="text-[10px] font-bold text-[#333] uppercase tracking-widest">Active State</span>
                  <span className={`text-[9px] font-bold uppercase px-2 shadow-[2px_2px_0_#ccc] border ${(localStorage.getItem('VITE_SUPABASE_URL') || usingEnvVars) ? 'bg-green-100 text-green-700 border-green-500' : 'bg-[#f0f0f0] text-[#666] border-[#999]'}`}>
                    {usingEnvVars && !localStorage.getItem('VITE_SUPABASE_URL') ? 'LIVE (ENV VARS)' : localStorage.getItem('VITE_SUPABASE_URL') ? 'LIVE LINK' : 'SANDBOX / LOCAL'}
                  </span>
                </div>

                {usingEnvVars && !localStorage.getItem('VITE_SUPABASE_URL') && (
                  <div className="bg-blue-50 border border-blue-200 px-2 py-1.5 text-[9px] font-bold text-blue-700 uppercase tracking-wide">
                    Connection configured via Vercel environment variables — all team members connect automatically. No manual entry needed.
                  </div>
                )}

                <div className="space-y-1">
                   <label className="text-[10px] font-bold text-[#666] uppercase tracking-wide">Project URL</label>
                   <input 
                     type="text" 
                     value={apiEndpoint}
                     onChange={(e) => setApiEndpoint(e.target.value)}
                     placeholder="https://xyz.supabase.co"
                     className="w-full border-2 border-[#ccc] px-2 py-1.5 text-[11px] font-bold outline-none focus:border-[#185baf] text-[#185baf] placeholder:text-[#999]"
                   />
                </div>

                <div className="space-y-1">
                   <label className="text-[10px] font-bold text-[#666] uppercase tracking-wide">Anon Public Key</label>
                   <input 
                     type="password" 
                     value={apiKey}
                     onChange={(e) => setApiKey(e.target.value)}
                     placeholder="sb_publishable_..."
                     className="w-full border-2 border-[#ccc] px-2 py-1.5 text-[11px] font-bold outline-none focus:border-[#185baf] text-[#185baf] placeholder:text-[#999]"
                   />
                </div>

                <div className="pt-2 space-y-2">
                  <button 
                    onClick={saveBackendConfig}
                    className="btn-primary w-full py-2 flex items-center justify-center gap-2 shadow-[2px_2px_0_#00479b]"
                  >
                     {syncStatus === 'saved' ? <CheckCircle2 className="w-4 h-4" /> : <Save className="w-4 h-4" />}
                     {syncStatus === 'saved' ? 'CREDENTIALS APPLIED' : 'BIND CONNECTION'}
                  </button>

                  <button 
                    onClick={onFullSync}
                    className="w-full py-2 bg-[#f0f0f0] border-2 border-[#185baf] text-[#185baf] font-black text-[10px] uppercase tracking-widest flex items-center justify-center gap-2 hover:bg-white transition-colors"
                  >
                     <CloudLightning className="w-4 h-4" /> REPAIR DATABASE CONNECTIONS
                  </button>

                  <button 
                    onClick={onWipeAllData}
                    className="w-full py-2 bg-red-50 border-2 border-red-600 text-red-600 font-black text-[10px] uppercase tracking-widest flex items-center justify-center gap-2 hover:bg-red-600 hover:text-white transition-all shadow-[2px_2px_0_#991b1b]"
                  >
                     <Trash2 className="w-4 h-4" /> FACTORY RESET / PURGE DATA
                  </button>
                </div>
             </div>
          </div>

          <div className="bg-[#f0f0f0] border border-[#ccc] shadow-sm flex flex-col mt-2">
             <div className="bg-[#e0e0e0] border-b border-[#ccc] px-3 py-1 flex items-center justify-between">
                <span className="text-[10px] font-bold text-[#333] uppercase flex items-center gap-1"><Shield className="w-3 h-3"/> Warning</span>
             </div>
             <div className="p-3 bg-white">
               <p className="text-[10px] text-[#666] font-bold leading-relaxed mb-3">
                  System currently uses plaintext user objects for local memory. This sandbox is exclusively designed for interface testing, NOT production routing.
               </p>
               <button 
                 onClick={copySql}
                 className="w-full p-1.5 bg-[#f0f0f0] border border-[#ccc] text-[9px] font-bold uppercase tracking-widest flex items-center justify-center gap-1 hover:bg-[#e6e6e6] text-[#333]"
               >
                  <Database className="w-3 h-3" /> EXPORT SQL SCHEMA
               </button>
             </div>
          </div>
        </div>
      </div>

      {isAdding && (
        <div className="fixed inset-0 z-[1000] flex items-center justify-center p-4 bg-black/20">
          <div className="bg-[#f0f0f0] border-2 border-[#185baf] shadow-2xl w-full max-w-lg">
            {/* Modal Title Bar */}
            <div className="bg-[#185baf] text-white px-3 py-1.5 flex justify-between items-center cursor-default">
              <div className="flex items-center gap-2">
                <UserPlus className="w-4 h-4" />
                <span className="text-[12px] font-bold tracking-wide uppercase">
                  {isEditing ? 'Modify Personnel Access' : 'New System Entry'}
                </span>
              </div>
              <button onClick={closeModal} className="bg-[#d9534f] text-white px-2 py-0.5 hover:bg-[#c9302c] border border-white/20 font-bold leading-none text-xs">✕</button>
            </div>
            
            <form onSubmit={handleSubmit} className="p-4">
              <div className="bg-white border border-[#ccc] p-4 space-y-4">
                <div className="space-y-1">
                  <label className="text-[10px] font-bold text-[#666] uppercase tracking-wide">Full Personnel Name</label>
                  <input type="text" placeholder="e.g., Sarah Wilson" className="w-full border border-[#ccc] px-2 py-1 pb-[3px] text-[11px] font-bold outline-none focus:border-[#185baf]" value={formData.name} onChange={e => setFormData({...formData, name: e.target.value})} required />
                </div>
                
                <div className="grid grid-cols-2 gap-4">
                  <div className="space-y-1">
                    <label className="text-[10px] font-bold text-[#666] uppercase tracking-wide">Login ID</label>
                    <input type="text" placeholder="swilson" className="w-full border border-[#ccc] px-2 py-1 pb-[3px] text-[11px] font-bold outline-none focus:border-[#185baf] uppercase disabled:bg-[#f0f0f0]" value={formData.username} onChange={e => setFormData({...formData, username: e.target.value})} disabled={isEditing} required />
                  </div>
                  <div className="space-y-1">
                    <label className="text-[10px] font-bold text-[#666] uppercase tracking-wide">Secret Token</label>
                    <input type="password" placeholder="••••••••" className="w-full border border-[#ccc] px-2 py-1 pb-[3px] text-[11px] font-bold outline-none focus:border-[#185baf]" value={formData.password} onChange={e => setFormData({...formData, password: e.target.value})} required={!isEditing} />
                  </div>
                </div>
                
                <div className="grid grid-cols-2 gap-4">
                  <div className="space-y-1">
                    <label className="text-[10px] font-bold text-[#666] uppercase tracking-wide">Access Level</label>
                    <select className="w-full border border-[#ccc] bg-white px-2 py-1 pb-[3px] text-[11px] font-bold outline-none focus:border-[#185baf] uppercase cursor-pointer" value={formData.role} onChange={e => setFormData({...formData, role: e.target.value as Role})}>
                      <option value={Role.SCHEDULER}>Scheduler</option>
                      <option value={Role.ADMIN}>Administrator</option>
                      <option value={Role.SUPER_ADMIN}>Chief Architect</option>
                      <option value={Role.VIEWER}>Read Only Viewer</option>
                    </select>
                  </div>
                  <div className="space-y-1">
                    <label className="text-[10px] font-bold text-[#666] uppercase tracking-wide">Operational Zone</label>
                    <input type="text" placeholder="All, CS, Law..." className="w-full border border-[#ccc] px-2 py-1 pb-[3px] text-[11px] font-bold outline-none focus:border-[#185baf] uppercase" value={formData.departmentScope} onChange={e => setFormData({...formData, departmentScope: e.target.value})} required />
                  </div>
                </div>
              </div>
              
              <div className="pt-4 flex justify-end gap-2 px-1">
                <button type="button" onClick={closeModal} className="btn-secondary min-w-[80px]">Cancel</button>
                <button type="submit" className="btn-primary min-w-[80px]">
                  {isEditing ? 'Save Modify' : '+ Generate'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};

export default AdminPanel;
