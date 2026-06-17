
import React, { useState } from 'react';
import { UserAccount, Role, ScheduleEntry, Course, Faculty, Room, StudentGroup } from '../types';
import {
  UserPlus,
  Shield,
  Users,
  Trash2,
  Edit2,
  CheckCircle2,
  Search,
  Server,
  Database,
  Save,
  CloudLightning,
  Calendar,
  AlertTriangle,
  RefreshCcw
} from 'lucide-react';

interface AdminPanelProps {
  users: UserAccount[];
  onUpdateUsers: (users: UserAccount[]) => void;
  currentUser: UserAccount;
  schedule: ScheduleEntry[];
  courses: Course[];
  faculties: Faculty[];
  rooms: Room[];
  groups: StudentGroup[];
  activeTermId?: string;
  activeTermName?: string;
  onClearSchedule: () => Promise<void>;
}

const AdminPanel: React.FC<AdminPanelProps> = ({ users, onUpdateUsers, currentUser, schedule, courses, faculties, rooms, groups, activeTermId, activeTermName, onClearSchedule }) => {
  const [isAdding, setIsAdding] = useState(false);
  const [isEditing, setIsEditing] = useState(false);
  const [editingUserId, setEditingUserId] = useState<string | null>(null);
  const [searchTerm, setSearchTerm] = useState('');
  
  // Active Supabase URL check (if using env vars)
  const envUrl = (import.meta as any).env?.VITE_SUPABASE_URL || '';
  const usingEnvVars = !!(envUrl && !envUrl.includes('xyz.supabase.co'));

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
    "courseId" TEXT,
    "facultyId" TEXT,
    "roomId" TEXT,
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
      <div className="mx-2 mb-4 overflow-hidden relative" style={{ background: 'linear-gradient(135deg, #0c1b3a 0%, #0f2d5e 35%, #185baf 70%, #1a7fd4 100%)' }}>
        <div className="absolute inset-0" style={{ backgroundImage: 'radial-gradient(circle at 80% 50%, rgba(255,255,255,0.06) 0%, transparent 60%)' }} />
        <div className="absolute right-0 top-0 bottom-0 w-32 opacity-[0.04]" style={{ backgroundImage: 'repeating-linear-gradient(-45deg, white 0px, white 1px, transparent 1px, transparent 12px)' }} />
        <div className="relative px-5 py-4">
          <h2 className="text-[17px] font-black text-white tracking-tight">Team Workspace</h2>
          <p className="text-[11px] text-blue-200 font-medium mt-0.5">Manage personnel access & backend infrastructure</p>
        </div>
      </div>

      <div className="px-2 grid grid-cols-1 gap-4 flex-1 overflow-y-auto mb-10 pb-20 custom-scrollbar">
        {/* Main Column: Personnel & Migration */}
        <div className="flex flex-col gap-4">

          {/* Personnel Directory Panel */}
          <div className="bg-white border border-[#e2e8f0] shadow-sm overflow-hidden">
            <div className="px-4 py-3 flex justify-between items-center border-b border-[#e2e8f0]" style={{ background: 'linear-gradient(135deg, #f8fafc, #eff6ff)' }}>
              <div className="flex items-center gap-2">
                <Users className="w-4 h-4 text-[#185baf]" />
                <span className="text-[12px] font-black text-[#0f172a] tracking-tight uppercase">Personnel Directory</span>
                <span className="text-[9px] font-black bg-[#185baf] text-white px-1.5 py-0.5">{filteredUsers.length}</span>
              </div>
              <button
                onClick={() => { setIsEditing(false); setIsAdding(true); }}
                className="flex items-center gap-1.5 px-3 py-1.5 text-white text-[10px] font-black uppercase tracking-widest shadow-sm hover:opacity-90 transition-opacity"
                style={{ background: 'linear-gradient(135deg, #185baf, #0891b2)' }}
              >
                <UserPlus className="w-3 h-3" /> Add Member
              </button>
            </div>

            <div className="px-4 py-2.5 border-b border-[#f1f5f9] bg-[#fafbff]">
              <div className="flex items-center gap-2 bg-white border border-[#e2e8f0] px-2.5 py-1.5">
                <Search className="w-3.5 h-3.5 text-[#94a3b8]" />
                <input
                  type="text"
                  placeholder="Search personnel by name, username or scope..."
                  className="w-full text-[11px] outline-none text-[#334155] placeholder:text-[#94a3b8]"
                  value={searchTerm}
                  onChange={(e) => setSearchTerm(e.target.value)}
                />
              </div>
            </div>

            <div className="min-h-[250px] overflow-y-auto custom-scrollbar divide-y divide-[#f1f5f9]">
              {filteredUsers.map((user, idx) => {
                const avatarColors = ['#185baf','#7c3aed','#059669','#d97706','#e11d48','#0891b2'];
                const avatarColor = avatarColors[idx % avatarColors.length];
                const roleBadge: Record<string, { bg: string; color: string; border: string }> = {
                  [Role.SUPER_ADMIN]: { bg: '#eff6ff', color: '#185baf', border: '#bfdbfe' },
                  [Role.ADMIN]:       { bg: '#f5f3ff', color: '#7c3aed', border: '#ddd6fe' },
                  [Role.SCHEDULER]:   { bg: '#ecfdf5', color: '#059669', border: '#a7f3d0' },
                  [Role.VIEWER]:      { bg: '#f8fafc', color: '#64748b', border: '#e2e8f0' },
                };
                const badge = roleBadge[user.role] || roleBadge[Role.VIEWER];
                return (
                  <div key={user.id} className="flex items-center px-4 py-3 hover:bg-[#fafbff] transition-colors">
                    <div className="w-8 h-8 flex items-center justify-center font-black text-white text-[12px] shrink-0 mr-3" style={{ background: avatarColor }}>
                      {user.name.charAt(0).toUpperCase()}
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-[12px] font-black text-[#0f172a] truncate">{user.name}</p>
                      <p className="text-[9px] text-[#94a3b8] font-bold">@{user.username} · {user.departmentScope}</p>
                    </div>
                    <span className="text-[9px] font-black uppercase tracking-widest px-2 py-0.5 border mx-4 shrink-0"
                      style={{ color: badge.color, background: badge.bg, borderColor: badge.border }}>
                      {user.role}
                    </span>
                    <div className="flex items-center gap-1 shrink-0">
                      <button onClick={() => openEditModal(user)} className="p-1.5 bg-[#f8fafc] border border-[#e2e8f0] text-[#64748b] hover:bg-[#eff6ff] hover:border-[#185baf] hover:text-[#185baf] transition-colors" title="Edit">
                        <Edit2 className="w-3 h-3" />
                      </button>
                      <button onClick={() => deleteUser(user.id)} className="p-1.5 bg-[#fff1f2] border border-[#fecdd3] text-[#e11d48] hover:bg-[#e11d48] hover:text-white transition-colors" title="Delete">
                        <Trash2 className="w-3 h-3" />
                      </button>
                    </div>
                  </div>
                );
              })}
              {filteredUsers.length === 0 && (
                <div className="py-10 text-center">
                  <Users className="w-8 h-8 text-[#e2e8f0] mx-auto mb-2" />
                  <p className="text-[10px] font-bold text-[#94a3b8] uppercase tracking-widest">No personnel found matching query</p>
                </div>
              )}
            </div>
          </div>

          {/* ── Schedule Management Panel ─────────────────────────────── */}
          <div className="bg-white border border-[#e2e8f0] shadow-sm overflow-hidden">
            <div className="px-4 py-3 flex justify-between items-center border-b border-[#e2e8f0]" style={{ background: 'linear-gradient(135deg, #f8fafc, #eff6ff)' }}>
              <div className="flex items-center gap-2">
                <Calendar className="w-4 h-4 text-[#185baf]" />
                <span className="text-[12px] font-black text-[#0f172a] uppercase tracking-tight">Timetable Entries</span>
                <span className="text-[9px] font-black bg-[#185baf] text-white px-1.5 py-0.5">
                  {schedule.filter((e: any) => e.termId === activeTermId).length}
                  {activeTermName ? ` · ${activeTermName}` : ''}
                </span>
              </div>
              <button
                onClick={onClearSchedule}
                className="flex items-center gap-1.5 px-3 py-1.5 text-white text-[10px] font-black uppercase tracking-widest shadow-sm hover:opacity-90 transition-opacity border border-red-800"
                style={{ background: 'linear-gradient(135deg, #be123c, #e11d48)' }}
              >
                <Trash2 className="w-3 h-3" /> Clear All
              </button>
            </div>

            {/* Entries table */}
            <div className="overflow-y-auto custom-scrollbar" style={{ maxHeight: 320 }}>
              {schedule.filter((e: any) => e.termId === activeTermId).length === 0 ? (
                <div className="p-6 text-center">
                  <AlertTriangle className="w-6 h-6 text-[#999] mx-auto mb-2" />
                  <p className="text-[10px] font-bold text-[#999] uppercase tracking-widest">No timetable entries for this term</p>
                </div>
              ) : (
                <table className="w-full text-left border-collapse">
                  <thead className="sticky top-0 z-10">
                    <tr className="bg-[#f0f6ff] border-b-2 border-[#c8ddf8]">
                      {['Day', 'Time', 'Module', 'Faculty', 'Room', 'Groups', 'Type'].map(h => (
                        <th key={h} className="px-2 py-1.5 text-[9px] font-black text-[#555] uppercase tracking-wider whitespace-nowrap">{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {schedule
                      .filter((e: any) => e.termId === activeTermId)
                      .sort((a, b) => {
                        const days = ['Monday','Tuesday','Wednesday','Thursday','Friday','Saturday','Sunday'];
                        if (a.day !== b.day) return days.indexOf(a.day) - days.indexOf(b.day);
                        return a.startTime.localeCompare(b.startTime);
                      })
                      .map((entry, idx) => {
                        const course = courses.find(c => c.id === entry.courseId);
                        const faculty = faculties.find(f => f.id === entry.facultyId);
                        const room = rooms.find(r => r.id === entry.roomId);
                        const entryGroups = groups.filter(g => entry.groupIds?.includes(g.id)).map(g => g.name).join(', ');
                        return (
                          <tr key={entry.id} className={`border-b border-[#eee] ${idx % 2 === 0 ? 'bg-white' : 'bg-[#f8f8f8]'} hover:bg-blue-50`}>
                            <td className="px-2 py-1 text-[10px] font-bold text-[#333] whitespace-nowrap">{entry.day}</td>
                            <td className="px-2 py-1 text-[10px] font-mono text-[#555] whitespace-nowrap">{entry.startTime}–{entry.endTime}</td>
                            <td className="px-2 py-1 text-[10px] font-bold text-[#185baf] max-w-[180px] truncate" title={course ? `${course.code}: ${course.name}` : entry.courseId}>
                              {course ? `${course.code}` : <span className="text-[#999]">—</span>}
                            </td>
                            <td className="px-2 py-1 text-[10px] text-[#444] max-w-[120px] truncate" title={faculty?.name}>{faculty?.name || <span className="text-[#999]">—</span>}</td>
                            <td className="px-2 py-1 text-[10px] text-[#444] whitespace-nowrap">{room?.name || <span className="text-[#999]">—</span>}</td>
                            <td className="px-2 py-1 text-[10px] text-[#444] max-w-[140px] truncate" title={entryGroups}>{entryGroups || <span className="text-[#999]">—</span>}</td>
                            <td className="px-2 py-1">
                              <span className="text-[8px] font-black uppercase px-1 py-0.5 bg-[#e0e0e0] text-[#555] border border-[#ccc]">{entry.category || 'Theory'}</span>
                            </td>
                          </tr>
                        );
                      })
                    }
                  </tbody>
                </table>
              )}
            </div>
          </div>

          {/* SQL Migration Roadmap Panel */}
          <div className="bg-white border border-[#e2e8f0] shadow-sm overflow-hidden">
            <div className="px-4 py-3 border-b border-[#e2e8f0] flex items-center gap-2" style={{ background: 'linear-gradient(135deg, #f8fafc, #eff6ff)' }}>
              <Database className="w-4 h-4 text-[#185baf]" />
              <span className="text-[12px] font-black text-[#0f172a] uppercase tracking-tight">Migration Roadmap</span>
            </div>
            <div className="p-4 grid grid-cols-1 md:grid-cols-3 gap-3">
              {[
                { phase: '01', title: 'Database', desc: 'Translate local data to a PostgreSQL instance on Supabase.', badge: 'Free Tier Ready', bg: '#ecfdf5', color: '#059669', border: '#a7f3d0' },
                { phase: '02', title: 'API Layer', desc: 'Build a Node.js server container to process UniTime requests safely.', badge: 'REST / GraphQL', bg: '#eff6ff', color: '#185baf', border: '#bfdbfe' },
                { phase: '03', title: 'Scale Out', desc: 'Transition to paid tiers when database limits are exceeded (>500 MB).', badge: 'Cost Projected', bg: '#f8fafc', color: '#64748b', border: '#e2e8f0' },
              ].map(item => (
                <div key={item.phase} className="border border-[#e2e8f0] p-4 hover:shadow-sm transition-shadow">
                  <div className="flex items-center gap-2 mb-3">
                    <div className="w-6 h-6 flex items-center justify-center text-[10px] font-black text-white" style={{ background: 'linear-gradient(135deg, #185baf, #0891b2)' }}>
                      {item.phase}
                    </div>
                    <h4 className="text-[11px] font-black text-[#0f172a] uppercase tracking-wide">{item.title}</h4>
                  </div>
                  <p className="text-[11px] text-[#64748b] leading-relaxed mb-3">{item.desc}</p>
                  <span className="text-[9px] font-black uppercase tracking-widest px-2 py-0.5 border"
                    style={{ color: item.color, background: item.bg, borderColor: item.border }}>
                    {item.badge}
                  </span>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
      {isAdding && (
        <div className="fixed inset-0 z-[1000] flex items-center justify-center p-4 bg-black/20">
          <div className="bg-white border border-[#c8ddf8] shadow-2xl w-full max-w-lg">
            {/* Modal Title Bar */}
            <div className="text-white px-3 py-1.5 flex justify-between items-center cursor-default" style={{ background: 'linear-gradient(135deg, #0f3d8c, #185baf)' }}>
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
