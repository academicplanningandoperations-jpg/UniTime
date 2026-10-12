import React, { useState, useRef, useEffect } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import {
  Wrench, ChevronDown, Save, LogOut, FileText, FileUp, Users, MapPin, GraduationCap, BookOpen, LayoutGrid, Cloud, Menu, X
} from 'lucide-react';
import { Role, UserAccount, ViewType, Term } from '../types';
import Logo from './Logo';

interface TopNavProps {
  activeTab: string;
  setActiveTab: (tab: string) => void;
  currentUser: UserAccount;
  onLogout: () => void;
  isSupabaseConnected?: boolean;
  activeTermName?: string;
  terms?: Term[];
  currentTermId?: string;
  onSwitchTerm?: (termId: string) => void;
  onAddPanel?: (type: ViewType) => void;
  onAutoTile?: () => void;
  onRoomFinder?: () => void;
  onExportPDF?: () => void;
  onExportExcel?: () => void;
}

const TopNav: React.FC<TopNavProps> = ({
  activeTab,
  setActiveTab,
  currentUser,
  onLogout,
  isSupabaseConnected = false,
  activeTermName = 'No Term',
  terms = [],
  currentTermId,
  onSwitchTerm,
  onAddPanel,
  onAutoTile,
  onRoomFinder,
  onExportPDF,
  onExportExcel,
}) => {
  // Term switcher — every edit, upload and report applies to the term chosen here.
  // The choice is per person (remembered on this computer); it doesn't change
  // which term anyone else is working in.
  const termSwitcher = (compact: boolean) => terms.length === 0 ? null : (
    <label
      className={`flex items-center gap-1.5 bg-[#fff7d6] text-[#7a4f00] border border-[#e0b100] font-bold ${compact ? 'px-2 py-1 text-[11px] w-full' : 'px-2 py-0.5 text-[11px]'}`}
      title="The term you are working in. Everything you add or change goes into this term."
    >
      <span className="uppercase tracking-widest text-[9px]">Term</span>
      <select
        value={currentTermId ?? ''}
        onChange={e => e.target.value && onSwitchTerm?.(e.target.value)}
        className={`bg-transparent font-bold outline-none cursor-pointer text-[#7a4f00] ${compact ? 'flex-1' : 'max-w-[190px]'}`}
      >
        {!currentTermId && <option value="">{activeTermName}</option>}
        {terms.map(t => (
          <option key={t.id} value={t.id} className="text-black">{t.name}{t.isActive ? ' (default)' : ''}</option>
        ))}
      </select>
    </label>
  );

  const [isToolsOpen, setIsToolsOpen] = useState(false);
  const [isExportOpen, setIsExportOpen] = useState(false);
  const [isMobileMenuOpen, setIsMobileMenuOpen] = useState(false);
  const [mobileToolsOpen, setMobileToolsOpen] = useState(false);
  const toolsRef = useRef<HTMLDivElement>(null);
  const exportRef = useRef<HTMLDivElement>(null);
  const mobileMenuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (toolsRef.current && !toolsRef.current.contains(event.target as Node)) setIsToolsOpen(false);
      if (exportRef.current && !exportRef.current.contains(event.target as Node)) setIsExportOpen(false);
      if (mobileMenuRef.current && !mobileMenuRef.current.contains(event.target as Node)) setIsMobileMenuOpen(false);
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  const toolItems = [
    { id: 'reports', label: 'Reports', roles: [Role.SUPER_ADMIN, Role.ADMIN, Role.SCHEDULER] },
    { id: 'terms', label: 'Academic Terms', roles: [Role.SUPER_ADMIN, Role.ADMIN, Role.SCHEDULER] },
    { id: 'data', label: 'Resources & Data', roles: [Role.SUPER_ADMIN, Role.ADMIN] },
    { id: 'autoschedule', label: 'Auto Scheduler', roles: [Role.SUPER_ADMIN, Role.ADMIN] },
    { id: 'backlog', label: 'Backlog Analyzer', roles: [Role.SUPER_ADMIN, Role.ADMIN, Role.SCHEDULER] },
    { id: 'admin', label: 'Team Workspace', roles: [Role.SUPER_ADMIN] },
  ];

  const filteredTools = toolItems.filter(item => !item.roles || item.roles.includes(currentUser.role));

  const NavItem: React.FC<{ icon?: React.ReactNode, label: string, onClick?: () => void, isActive?: boolean }> = ({ icon, label, onClick, isActive }) => (
    <button
      onClick={onClick}
      className={`flex items-center gap-1.5 px-3 py-1.5 text-[12px] font-bold transition-all h-full
        ${isActive ? 'bg-[#124584] text-white' : 'text-slate-100 hover:bg-[#124584] hover:text-white'}`}
    >
      {icon}
      {label}
    </button>
  );

  const Separator = () => <div className="w-px h-4 bg-[#3876c2] mx-1" />;

  const closeMobile = () => setIsMobileMenuOpen(false);

  return (
    <header className="shrink-0 font-sans z-[1000]" style={{ background: 'linear-gradient(180deg, #1e6ad4 0%, #185baf 60%, #124a99 100%)', borderBottom: '1px solid #0a2d6e', boxShadow: '0 2px 12px rgba(0,0,0,0.4)' }}>
      {/* ── Desktop bar ───────────────────────────────────────────────────────── */}
      <div className="h-[34px] hidden md:flex items-center justify-between px-2 text-white">
        <div className="flex items-center h-full">
          <div className="flex items-center gap-2 px-2 mr-2 cursor-pointer" onClick={() => setActiveTab('dashboard')}>
            <Logo className="w-6 h-6" />
            <span className="font-bold text-[13px] tracking-wide">UniTime</span>
          </div>

          <Separator />

          <div className="relative h-full flex items-center" ref={toolsRef}>
            <button
              onClick={() => setIsToolsOpen(!isToolsOpen)}
              className={`flex items-center gap-1.5 px-3 py-1.5 text-[12px] font-bold transition-all h-full ${isToolsOpen ? 'bg-[#124584]' : 'hover:bg-[#124584]'}`}
            >
              <Wrench className="w-3.5 h-3.5" /> Tools <ChevronDown className="w-3 h-3" />
            </button>
            {isToolsOpen && (
              <div className="absolute top-full left-0 bg-white border border-[#ccc] shadow-lg min-w-[200px] py-1 z-50">
                {filteredTools.map(item => (
                  <button
                    key={item.id}
                    onClick={() => { setActiveTab(item.id); setIsToolsOpen(false); }}
                    className="w-full text-left px-4 py-1.5 text-[12px] text-[#333] hover:bg-[#185baf] hover:text-white"
                  >
                    {item.label}
                  </button>
                ))}
              </div>
            )}
          </div>

          <Separator />
          <NavItem icon={<Save className="w-3.5 h-3.5" />} label="Timetable Builder" isActive={activeTab === 'builder'} onClick={() => setActiveTab('builder')} />
          <Separator />
          <NavItem icon={<Users className="w-3.5 h-3.5" />} label="Cohort" onClick={() => onAddPanel?.('Group')} />
          <NavItem icon={<MapPin className="w-3.5 h-3.5" />} label="Room" onClick={() => onAddPanel?.('Room')} />
          <NavItem icon={<GraduationCap className="w-3.5 h-3.5" />} label="Faculty" onClick={() => onAddPanel?.('Faculty')} />
          <NavItem icon={<BookOpen className="w-3.5 h-3.5" />} label="Module" onClick={() => onAddPanel?.('Course')} />
          <Separator />
          <NavItem icon={<LayoutGrid className="w-3.5 h-3.5" />} label="4-Up View" onClick={onAutoTile} />
          <NavItem icon={<MapPin className="w-3.5 h-3.5" />} label="Availability" onClick={onRoomFinder} />

          <div className="relative h-full flex items-center" ref={exportRef}>
            <button
              onClick={() => setIsExportOpen(!isExportOpen)}
              className={`flex items-center gap-1.5 px-3 py-1.5 text-[12px] font-bold transition-all h-full ${isExportOpen ? 'bg-[#124584]' : 'hover:bg-[#124584]'}`}
            >
              Export <ChevronDown className="w-3 h-3" />
            </button>
            {isExportOpen && (
              <div className="absolute top-full left-0 bg-white border border-[#ccc] shadow-lg min-w-[150px] py-1 z-50">
                <button onClick={() => { onExportPDF?.(); setIsExportOpen(false); }} className="w-full text-left px-4 py-1.5 text-[12px] text-[#333] hover:bg-[#185baf] hover:text-white">
                  Export PDF
                </button>
                <button onClick={() => { onExportExcel?.(); setIsExportOpen(false); }} className="w-full text-left px-4 py-1.5 text-[12px] text-[#333] hover:bg-[#185baf] hover:text-white">
                  Export Excel
                </button>
              </div>
            )}
          </div>
        </div>

        <div className="flex items-center gap-3 h-full pb-[2px]">
          {termSwitcher(false)}
          {isSupabaseConnected && (
            <div className="flex items-center gap-1.5 px-2 py-0.5 bg-[#eafbef] text-[#2e7d32] border border-[#a5d6a7] text-[10px] uppercase font-bold">
              <Cloud className="w-3 h-3" /> SYNC
            </div>
          )}
          <div className="flex items-center gap-1.5 bg-white text-[#185baf] px-2 py-0.5 border border-[#ccc] text-[11px] font-bold cursor-default">
            <div className="bg-[#185baf] text-white w-4 h-4 flex items-center justify-center font-bold">S</div>
            {currentUser.name}
          </div>
          <button
            onClick={onLogout}
            className="flex items-center gap-1.5 px-3 py-1 bg-[#d9534f] text-white border border-[#a94442] text-[10px] font-bold uppercase tracking-widest ml-1 hover:bg-[#c9302c] transition-colors"
          >
            <LogOut className="w-3 h-3" /> Sign Out
          </button>
        </div>
      </div>

      {/* ── Mobile bar ────────────────────────────────────────────────────────── */}
      <div className="h-[44px] flex md:hidden items-center justify-between px-3 text-white" ref={mobileMenuRef}>
        <div className="flex items-center gap-2 cursor-pointer" onClick={() => { setActiveTab('dashboard'); closeMobile(); }}>
          <Logo className="w-6 h-6" />
          <span className="font-bold text-[14px] tracking-wide">UniTime</span>
        </div>

        <div className="flex items-center gap-2">
          {isSupabaseConnected && (
            <div className="flex items-center gap-1 px-1.5 py-0.5 bg-[#eafbef] text-[#2e7d32] border border-[#a5d6a7] text-[9px] uppercase font-bold">
              <Cloud className="w-2.5 h-2.5" /> SYNC
            </div>
          )}
          <button
            onClick={() => setIsMobileMenuOpen(prev => !prev)}
            className="flex items-center justify-center w-8 h-8 hover:bg-[#124584] transition-colors"
          >
            {isMobileMenuOpen ? <X className="w-5 h-5" /> : <Menu className="w-5 h-5" />}
          </button>
        </div>

        {/* Mobile dropdown */}
        <AnimatePresence>
          {isMobileMenuOpen && (
            <motion.div
              initial={{ opacity: 0, y: -8 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -8 }}
              transition={{ duration: 0.15 }}
              className="absolute top-[44px] left-0 right-0 bg-white border-b border-[#ccc] shadow-xl z-50 overflow-y-auto"
              style={{ maxHeight: 'calc(100vh - 44px)' }}
            >
              {/* User row */}
              <div className="flex items-center justify-between px-4 py-3 bg-[#f0f6ff] border-b border-[#dbeafe]">
                <div className="flex items-center gap-2">
                  <div className="bg-[#185baf] text-white w-6 h-6 flex items-center justify-center font-bold text-[11px]">S</div>
                  <span className="text-[13px] font-bold text-[#185baf]">{currentUser.name}</span>
                </div>
                <button
                  onClick={() => { onLogout(); closeMobile(); }}
                  className="flex items-center gap-1.5 px-3 py-1.5 bg-[#d9534f] text-white text-[11px] font-bold uppercase tracking-widest hover:bg-[#c9302c] transition-colors"
                >
                  <LogOut className="w-3 h-3" /> Sign Out
                </button>
              </div>

              <div className="px-4 py-2 border-b border-[#dbeafe]">{termSwitcher(true)}</div>

              {/* Nav sections */}
              <div className="divide-y divide-[#f1f5f9]">
                {/* Dashboard */}
                <MobileItem icon={<LayoutGrid className="w-4 h-4" />} label="Dashboard" onClick={() => { setActiveTab('dashboard'); closeMobile(); }} active={activeTab === 'dashboard'} />
                <MobileItem icon={<Save className="w-4 h-4" />} label="Timetable Builder" onClick={() => { setActiveTab('builder'); closeMobile(); }} active={activeTab === 'builder'} />

                {/* Views */}
                <div className="px-4 pt-3 pb-1">
                  <p className="text-[9px] font-black uppercase tracking-widest text-[#94a3b8] mb-1">Add Panel</p>
                </div>
                <MobileItem icon={<Users className="w-4 h-4" />} label="Cohort" onClick={() => { onAddPanel?.('Group'); closeMobile(); }} />
                <MobileItem icon={<MapPin className="w-4 h-4" />} label="Room" onClick={() => { onAddPanel?.('Room'); closeMobile(); }} />
                <MobileItem icon={<GraduationCap className="w-4 h-4" />} label="Faculty" onClick={() => { onAddPanel?.('Faculty'); closeMobile(); }} />
                <MobileItem icon={<BookOpen className="w-4 h-4" />} label="Module" onClick={() => { onAddPanel?.('Course'); closeMobile(); }} />

                {/* Utilities */}
                <div className="px-4 pt-3 pb-1">
                  <p className="text-[9px] font-black uppercase tracking-widest text-[#94a3b8] mb-1">Utilities</p>
                </div>
                <MobileItem icon={<LayoutGrid className="w-4 h-4" />} label="4-Up View" onClick={() => { onAutoTile?.(); closeMobile(); }} />
                <MobileItem icon={<MapPin className="w-4 h-4" />} label="Room Availability" onClick={() => { onRoomFinder?.(); closeMobile(); }} />

                {/* Export */}
                <div className="px-4 pt-3 pb-1">
                  <p className="text-[9px] font-black uppercase tracking-widest text-[#94a3b8] mb-1">Export</p>
                </div>
                <MobileItem icon={<FileText className="w-4 h-4" />} label="Export PDF" onClick={() => { onExportPDF?.(); closeMobile(); }} />
                <MobileItem icon={<FileUp className="w-4 h-4" />} label="Export Excel" onClick={() => { onExportExcel?.(); closeMobile(); }} />

                {/* Tools */}
                {filteredTools.length > 0 && (
                  <>
                    <div className="px-4 pt-3 pb-1">
                      <p className="text-[9px] font-black uppercase tracking-widest text-[#94a3b8] mb-1">Tools</p>
                    </div>
                    {filteredTools.map(item => (
                      <MobileItem key={item.id} icon={<Wrench className="w-4 h-4" />} label={item.label} onClick={() => { setActiveTab(item.id); closeMobile(); }} active={activeTab === item.id} />
                    ))}
                  </>
                )}

                <div className="h-4" />
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </header>
  );
};

const MobileItem: React.FC<{ icon: React.ReactNode; label: string; onClick: () => void; active?: boolean }> = ({ icon, label, onClick, active }) => (
  <button
    onClick={onClick}
    className={`w-full flex items-center gap-3 px-5 py-3 text-[13px] font-semibold transition-colors text-left
      ${active ? 'bg-[#eff6ff] text-[#185baf]' : 'text-[#1e293b] hover:bg-[#f8fafc]'}`}
  >
    <span className={active ? 'text-[#185baf]' : 'text-[#64748b]'}>{icon}</span>
    {label}
  </button>
);

export default TopNav;
