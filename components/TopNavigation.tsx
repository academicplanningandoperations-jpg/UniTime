
import React, { useState } from 'react';
import { 
  LayoutDashboard, 
  FileUp, 
  Settings, 
  School,
  Calendar,
  FileBarChart,
  FolderOpen,
  Save,
  Printer,
  Copy,
  Clipboard,
  Search,
  Plus,
  Minus,
  ChevronLeft,
  ChevronRight,
  User,
  MapPin,
  Users,
  BookOpen,
  LogOut,
  Monitor,
  HelpCircle,
  Maximize2
} from 'lucide-react';
import { Role } from '../types';

interface TopNavigationProps {
  activeTab: string;
  setActiveTab: (tab: string) => void;
  userRole: Role;
  userName: string;
  onLogout: () => void;
  isSyncing: boolean;
  onAddSession: () => void;
  onRoomFinder: () => void;
  onAddPanel: () => void;
}

const TopNavigation: React.FC<TopNavigationProps> = ({ 
  activeTab, 
  setActiveTab, 
  userRole,
  userName,
  onLogout,
  isSyncing,
  onAddSession,
  onRoomFinder,
  onAddPanel
}) => {
  const [activeMenu, setActiveMenu] = useState<string | null>(null);

  const menuItems = [
    { id: 'dashboard', label: 'Dashboard', icon: <LayoutDashboard className="w-4 h-4" /> },
    { id: 'builder', label: 'Timetable Builder', icon: <School className="w-4 h-4" /> },
    { id: 'reports', label: 'Reports', icon: <FileBarChart className="w-4 h-4" />, roles: [Role.SUPER_ADMIN, Role.ADMIN, Role.SCHEDULER] },
    { id: 'terms', label: 'Academic Terms', icon: <Calendar className="w-4 h-4" />, roles: [Role.SUPER_ADMIN, Role.ADMIN, Role.SCHEDULER] },
    { id: 'data', label: 'Resources & Data', icon: <FileUp className="w-4 h-4" />, roles: [Role.SUPER_ADMIN, Role.ADMIN] },
    { id: 'admin', label: 'Team Workspace', icon: <Settings className="w-4 h-4" />, roles: [Role.SUPER_ADMIN] },
  ];

  const filteredItems = menuItems.filter(item => !item.roles || item.roles.includes(userRole));

  const menus = [
    { label: 'File', items: ['New Project', 'Open...', 'Save', 'Save As...', 'Import Data', 'Export Data', 'Print...', 'Exit'] },
    { label: 'Edit', items: ['Undo', 'Redo', 'Cut', 'Copy', 'Paste', 'Delete', 'Select All'] },
    { label: 'View', items: ['Dashboard', 'Timetable Builder', 'Reports', 'Academic Terms', 'Resources', 'Full Screen'] },
    { label: 'Tools', items: ['Conflict Checker', 'Room Finder', 'Load Analyzer', 'Auto-Scheduler'] },
    { label: 'Window', items: ['Cascade', 'Tile Horizontally', 'Tile Vertically', 'Close All'] },
    { label: 'Help', items: ['Documentation', 'Keyboard Shortcuts', 'Check for Updates', 'About UniTime'] },
  ];

  return (
    <div className="flex flex-col w-full bg-[#f0f0f0] border-b border-slate-300 select-none shrink-0 z-[100]">
      {/* Title Bar */}
      <div className="h-7 bg-white flex items-center justify-between px-2 border-b border-slate-200">
        <div className="flex items-center gap-2">
          <div className="w-4 h-4 bg-blue-600 rounded flex items-center justify-center">
            <Monitor className="w-2.5 h-2.5 text-white" />
          </div>
          <span className="text-[11px] font-bold text-slate-700">UniTime Timetabler Client - {userName}</span>
        </div>
        <div className="flex items-center">
          <button className="h-7 px-3 hover:bg-slate-100 text-slate-500 transition-colors"><Minus className="w-3.5 h-3.5" /></button>
          <button className="h-7 px-3 hover:bg-slate-100 text-slate-500 transition-colors"><Maximize2 className="w-3.5 h-3.5" /></button>
          <button onClick={onLogout} className="h-7 px-3 hover:bg-red-500 hover:text-white text-slate-500 transition-colors">✕</button>
        </div>
      </div>

      {/* Menu Bar */}
      <div className="h-6 flex items-center px-1 gap-1">
        {menus.map((menu) => (
          <div key={menu.label} className="relative group">
            <button 
              className={`px-2 py-0.5 text-[11px] hover:bg-blue-600 hover:text-white rounded transition-colors ${activeMenu === menu.label ? 'bg-blue-600 text-white' : 'text-slate-800'}`}
              onMouseEnter={() => activeMenu && setActiveMenu(menu.label)}
              onClick={() => setActiveMenu(activeMenu === menu.label ? null : menu.label)}
            >
              {menu.label}
            </button>
            {activeMenu === menu.label && (
              <div className="absolute top-full left-0 w-48 bg-white border border-slate-300 shadow-xl py-1 z-[110] animate-in fade-in slide-in-from-top-1 duration-100">
                {menu.items.map((item, idx) => (
                  <React.Fragment key={item}>
                    <button className="w-full text-left px-4 py-1.5 text-[11px] hover:bg-blue-600 hover:text-white text-slate-700 flex justify-between items-center">
                      <span>{item}</span>
                      {idx === 2 && <span className="text-[9px] opacity-50">Ctrl+S</span>}
                    </button>
                    {(idx === 1 || idx === 5) && <div className="my-1 border-t border-slate-100" />}
                  </React.Fragment>
                ))}
              </div>
            )}
          </div>
        ))}
      </div>

      {/* Toolbar */}
      <div className="h-10 flex items-center px-2 gap-0.5 bg-[#f8f9fa] border-t border-slate-200">
        <div className="flex items-center gap-0.5 pr-2 border-r border-slate-300 mr-1">
          <ToolbarButton icon={<FolderOpen className="w-4 h-4" />} title="Open Project" />
          <ToolbarButton icon={<Save className="w-4 h-4" />} title="Save Changes" />
          <ToolbarButton icon={<Printer className="w-4 h-4" />} title="Print View" />
        </div>

        <div className="flex items-center gap-0.5 pr-2 border-r border-slate-300 mr-1">
          <ToolbarButton icon={<Copy className="w-4 h-4" />} title="Copy" />
          <ToolbarButton icon={<Clipboard className="w-4 h-4" />} title="Paste" />
        </div>

        <div className="flex items-center gap-0.5 pr-2 border-r border-slate-300 mr-1">
          {filteredItems.map(item => (
            <ToolbarButton 
              key={item.id}
              icon={item.icon} 
              title={item.label}
              active={activeTab === item.id}
              onClick={() => setActiveTab(item.id)}
            />
          ))}
        </div>

        <div className="flex items-center gap-0.5 pr-2 border-r border-slate-300 mr-1">
          <ToolbarButton icon={<Plus className="w-4 h-4" />} title="Add New Session" onClick={onAddSession} />
          <ToolbarButton icon={<MapPin className="w-4 h-4" />} title="Room Finder" onClick={onRoomFinder} />
          <ToolbarButton icon={<Monitor className="w-4 h-4" />} title="New Timetable Window" onClick={onAddPanel} />
        </div>

        <div className="flex items-center gap-0.5 pr-2 border-r border-slate-300 mr-1">
          <ToolbarButton icon={<Search className="w-4 h-4" />} title="Search" />
          <ToolbarButton icon={<Plus className="w-4 h-4" />} title="Zoom In" />
          <ToolbarButton icon={<Minus className="w-4 h-4" />} title="Zoom Out" />
        </div>

        <div className="flex items-center gap-0.5 pr-2 border-r border-slate-300 mr-1">
          <ToolbarButton icon={<ChevronLeft className="w-4 h-4" />} title="Previous" />
          <ToolbarButton icon={<ChevronRight className="w-4 h-4" />} title="Next" />
        </div>

        <div className="flex items-center gap-0.5 ml-auto">
          <div className={`flex items-center gap-1.5 px-2 py-1 rounded border ${isSyncing ? 'bg-blue-50 border-blue-200 text-blue-600' : 'bg-emerald-50 border-emerald-200 text-emerald-600'}`}>
            <div className={`w-1.5 h-1.5 rounded-full ${isSyncing ? 'bg-blue-500 animate-pulse' : 'bg-emerald-500'}`} />
            <span className="text-[9px] font-bold uppercase">{isSyncing ? 'Syncing' : 'Online'}</span>
          </div>
          <ToolbarButton icon={<HelpCircle className="w-4 h-4" />} title="Help" />
        </div>
      </div>
    </div>
  );
};

const ToolbarButton: React.FC<{ 
  icon: React.ReactNode; 
  title: string; 
  active?: boolean;
  onClick?: () => void;
}> = ({ icon, title, active, onClick }) => (
  <button 
    onClick={onClick}
    title={title}
    className={`p-1.5 rounded hover:bg-slate-200 transition-colors flex items-center justify-center ${active ? 'bg-blue-100 text-blue-700 border border-blue-200 shadow-inner' : 'text-slate-600'}`}
  >
    {icon}
  </button>
);

export default TopNavigation;
