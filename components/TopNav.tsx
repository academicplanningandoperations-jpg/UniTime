import React, { useState, useRef, useEffect } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import {
  Wrench, ChevronDown, Save, LogOut, FileText, FileUp, Users, MapPin, GraduationCap, BookOpen, LayoutGrid, Cloud
} from 'lucide-react';
import { Role, UserAccount, ViewType } from '../types';
import Logo from './Logo';

interface TopNavProps {
  activeTab: string;
  setActiveTab: (tab: string) => void;
  currentUser: UserAccount;
  onLogout: () => void;
  isSupabaseConnected?: boolean;
  activeTermName?: string;
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
  onAddPanel,
  onAutoTile,
  onRoomFinder,
  onExportPDF,
  onExportExcel
}) => {
  const [isToolsOpen, setIsToolsOpen] = useState(false);
  const [isExportOpen, setIsExportOpen] = useState(false);
  const toolsRef = useRef<HTMLDivElement>(null);
  const exportRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (toolsRef.current && !toolsRef.current.contains(event.target as Node)) setIsToolsOpen(false);
      if (exportRef.current && !exportRef.current.contains(event.target as Node)) setIsExportOpen(false);
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  const toolItems = [
    { id: 'reports', label: 'Reports', roles: [Role.SUPER_ADMIN, Role.ADMIN, Role.SCHEDULER] },
    { id: 'terms', label: 'Academic Terms', roles: [Role.SUPER_ADMIN, Role.ADMIN, Role.SCHEDULER] },
    { id: 'data', label: 'Resources & Data', roles: [Role.SUPER_ADMIN, Role.ADMIN] },
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

  return (
    <header className="h-[34px] flex items-center justify-between px-2 text-white shrink-0 font-sans z-[1000]" style={{ background: 'linear-gradient(180deg, #1e6ad4 0%, #185baf 60%, #124a99 100%)', borderBottom: '1px solid #0a2d6e', boxShadow: '0 2px 12px rgba(0,0,0,0.4)' }}>
      <div className="flex items-center h-full">
        <div className="flex items-center gap-2 px-2 mr-2 cursor-pointer" onClick={() => setActiveTab('dashboard')}>
          <Logo className="w-5 h-5 rounded-full bg-white" />
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
    </header>
  );
};

export default TopNav;
