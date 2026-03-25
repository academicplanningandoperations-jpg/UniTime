
import React, { useState, useRef, useEffect, useMemo } from 'react';
import { DAYS, TIME_SLOTS, TOTAL_WEEKS } from '../constants';
import { ScheduleEntry, ViewType, Room, Faculty, StudentGroup, Course, DayOfWeek } from '../types';
import { Minus, Square, X, FolderSync, CalendarCheck, AlertTriangle, Search, ChevronDown, Plus, Calendar, Clock, Zap } from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';

const getDayDate = (dayIndex: number, week: number) => {
  const startDate = new Date('2024-09-02');
  const daysToAdd = (week - 1) * 7 + dayIndex;
  const targetDate = new Date(startDate);
  targetDate.setDate(startDate.getDate() + daysToAdd);
  return targetDate.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
};

interface TimetablePanelProps {
  id: string;
  viewType: ViewType;
  viewId: string;
  entries: ScheduleEntry[];
  rooms: Room[];
  faculties: Faculty[];
  groups: StudentGroup[];
  courses: Course[];
  x: number;
  y: number;
  w: number;
  h: number;
  z: number;
  onRemove?: () => void;
  onUpdateView?: (type: ViewType, id: string) => void;
  onUpdateGeometry?: (geometry: { x?: number, y?: number, w?: number, h?: number }) => void;
  onFocus?: () => void;
  onCellClick?: (day: DayOfWeek, time: string, viewType: ViewType, viewId: string) => void;
  onEntryClick?: (entry: ScheduleEntry, cellEntries?: ScheduleEntry[]) => void;
  onMoveEntry?: (entryId: string, newDay: DayOfWeek, newStartTime: string) => void;
  onDuplicateEntry?: (entry: ScheduleEntry) => void;
  onDeleteEntry?: (entryId: string) => void;
  onPasteEntry?: (entry: Omit<ScheduleEntry, 'id' | 'departmentId'>) => void;
  clipboard: Partial<ScheduleEntry> | null;
  setClipboard: (entry: Partial<ScheduleEntry> | null) => void;
  isMobile?: boolean;
  activeTermId?: string;
}

const TimetablePanel: React.FC<TimetablePanelProps> = ({ 
  viewType, viewId, entries, rooms, faculties, groups, courses, x, y, w, h, z,
  onRemove, onUpdateView, onUpdateGeometry, onFocus, onCellClick, onEntryClick, 
  onMoveEntry, onDuplicateEntry, onDeleteEntry, onPasteEntry, clipboard, setClipboard, isMobile = false, activeTermId
}) => {
  const [isDragging, setIsDragging] = useState(false);
  const [resizeDir, setResizeDir] = useState<string | null>(null);
  const [selectedWeeks, setSelectedWeeks] = useState<number[]>(Array.from({ length: TOTAL_WEEKS }, (_, i) => i + 1));
  const [isSelectorOpen, setIsSelectorOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [contextMenu, setContextMenu] = useState<{ x: number, y: number, entry?: ScheduleEntry, cell?: { day: DayOfWeek, time: string } } | null>(null);

  const dragStart = useRef({ x: 0, y: 0, startX: 0, startY: y });
  const resizeStart = useRef({ startW: 0, startH: 0, startX: 0, startY: 0, mouseX: 0, mouseY: 0 });
  const selectorRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (selectorRef.current && !selectorRef.current.contains(event.target as Node)) {
        setIsSelectorOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  const resourceOptions = useMemo(() => {
    let opts: { id: string, name: string }[] = [];
    if (viewType === 'Room') opts = rooms.map(r => ({ id: r.id, name: r.name }));
    else if (viewType === 'Faculty') opts = faculties.map(f => ({ id: f.id, name: f.name }));
    else if (viewType === 'Group') opts = groups.map(g => ({ id: g.id, name: g.name }));
    else if (viewType === 'Course') opts = courses.map(c => ({ id: c.id, name: `${c.code} ${c.name}` }));
    
    if (!searchQuery) return opts;
    return opts.filter(o => o.name.toLowerCase().includes(searchQuery.toLowerCase()));
  }, [viewType, rooms, faculties, groups, courses, searchQuery]);

  const activeObjectName = useMemo(() => {
    if (viewType === 'Room') return rooms.find(r => r.id === viewId)?.name;
    if (viewType === 'Faculty') return faculties.find(f => f.id === viewId)?.name;
    if (viewType === 'Group') return groups.find(g => g.id === viewId)?.name;
    if (viewType === 'Course') {
        const c = courses.find(c => c.id === viewId);
        return c ? `${c.code} ${c.name}` : undefined;
    }
    return 'Select...';
  }, [viewType, viewId, rooms, faculties, groups, courses]);

  const filteredEntries = useMemo(() => {
    return entries.filter(e => {
      const matchesTerm = !activeTermId || e.termId === activeTermId;
      if (!matchesTerm) return false;

      const matchesTarget = 
        (viewType === 'Room' && e.roomId === viewId) ||
        (viewType === 'Faculty' && e.facultyId === viewId) ||
        (viewType === 'Group' && e.groupIds.includes(viewId)) ||
        (viewType === 'Course' && e.courseId === viewId);
      
      const matchesWeek = e.weeks.some(w => selectedWeeks.includes(w));
      return matchesTarget && matchesWeek;
    });
  }, [entries, viewType, viewId, selectedWeeks, activeTermId]);

  const calculateTotalHours = () => {
    const totalMinutes = filteredEntries.reduce((acc, e) => {
      const [sh, sm] = e.startTime.split(':').map(Number);
      const [eh, em] = e.endTime.split(':').map(Number);
      return acc + ((eh * 60 + em) - (sh * 60 + sm));
    }, 0);
    return `${Math.floor(totalMinutes / 60)}h ${(totalMinutes % 60).toString().padStart(2, '0')}m`;
  };

  const handleMouseDown = (e: React.MouseEvent) => {
    if (isMobile) return;
    onFocus?.();
    setIsDragging(true);
    dragStart.current = { x: e.clientX, y: e.clientY, startX: x, startY: y };
    e.preventDefault();
  };

  const handleResizeStart = (e: React.MouseEvent, dir: string) => {
    if (isMobile) return;
    onFocus?.();
    setResizeDir(dir);
    resizeStart.current = { 
      startW: w, 
      startH: h, 
      startX: x, 
      startY: y, 
      mouseX: e.clientX, 
      mouseY: e.clientY 
    };
    e.stopPropagation(); e.preventDefault();
  };

  useEffect(() => {
    const handleMouseMove = (e: MouseEvent) => {
      if (isDragging) {
        onUpdateGeometry?.({ 
          x: Math.max(0, dragStart.current.startX + (e.clientX - dragStart.current.x)), 
          y: Math.max(0, dragStart.current.startY + (e.clientY - dragStart.current.y)) 
        });
      }
      if (resizeDir) {
        const dx = e.clientX - resizeStart.current.mouseX;
        const dy = e.clientY - resizeStart.current.mouseY;
        const geo: any = {};

        if (resizeDir.includes('e')) geo.w = Math.max(250, resizeStart.current.startW + dx);
        if (resizeDir.includes('s')) geo.h = Math.max(200, resizeStart.current.startH + dy);
        
        if (resizeDir.includes('w')) {
          const newW = Math.max(250, resizeStart.current.startW - dx);
          if (newW !== resizeStart.current.startW) {
            geo.w = newW;
            geo.x = resizeStart.current.startX + (resizeStart.current.startW - newW);
          }
        }
        
        if (resizeDir.includes('n')) {
          const newH = Math.max(200, resizeStart.current.startH - dy);
          if (newH !== resizeStart.current.startH) {
            geo.h = newH;
            geo.y = resizeStart.current.startY + (resizeStart.current.startH - newH);
          }
        }

        onUpdateGeometry?.(geo);
      }
    };
    const handleMouseUp = () => { setIsDragging(false); setResizeDir(null); };
    if (isDragging || resizeDir) { 
      window.addEventListener('mousemove', handleMouseMove); 
      window.addEventListener('mouseup', handleMouseUp); 
      document.body.style.cursor = isDragging ? 'move' : 
        resizeDir === 'e' || resizeDir === 'w' ? 'ew-resize' :
        resizeDir === 'n' || resizeDir === 's' ? 'ns-resize' :
        resizeDir === 'nw' || resizeDir === 'se' ? 'nwse-resize' : 'nesw-resize';
    }
    return () => { 
      window.removeEventListener('mousemove', handleMouseMove); 
      window.removeEventListener('mouseup', handleMouseUp); 
      document.body.style.cursor = 'default'; 
    };
  }, [isDragging, resizeDir, onUpdateGeometry]);

  const handleDragStart = (e: React.DragEvent, entry: ScheduleEntry) => {
    e.dataTransfer.setData('entryId', entry.id);
    e.dataTransfer.effectAllowed = 'move';
  };

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
  };

  const handleDrop = (e: React.DragEvent, day: DayOfWeek, time: string) => {
    e.preventDefault();
    const entryId = e.dataTransfer.getData('entryId');
    if (entryId) {
      onMoveEntry?.(entryId, day, time);
    }
  };

  const handleContextMenu = (e: React.MouseEvent, entry: ScheduleEntry) => {
    e.preventDefault();
    setContextMenu({ x: e.clientX, y: e.clientY, entry });
  };

  const handleCellContextMenu = (e: React.MouseEvent, day: DayOfWeek, time: string) => {
    e.preventDefault();
    setContextMenu({ x: e.clientX, y: e.clientY, cell: { day, time } });
  };

  useEffect(() => {
    const closeContext = () => setContextMenu(null);
    window.addEventListener('click', closeContext);
    return () => window.removeEventListener('click', closeContext);
  }, []);

  const getSlotCount = (start: string, end: string) => {
    const [sh, sm] = start.split(':').map(Number);
    const [eh, em] = end.split(':').map(Number);
    const totalMinutes = (eh * 60 + em) - (sh * 60 + sm);
    return Math.max(1, totalMinutes / 30); // At least 1 slot
  };

  const getThemeClass = () => {
    switch (viewType) {
      case 'Room': return 'tb-rooms';
      case 'Faculty': return 'tb-faculty';
      case 'Group': return 'tb-groups';
      case 'Course': return 'tb-courses';
      default: return 'tb-blue';
    }
  };

  const panelStyles: React.CSSProperties = isMobile 
    ? { width: '100%', height: '100%', position: 'relative', border: 'none', boxShadow: 'none', borderRadius: 0 } 
    : { left: x, top: y, width: w, height: h, zIndex: z, position: 'absolute' };

  return (
    <div 
      className={`bg-white shadow-sm overflow-hidden border border-[#ccc] flex flex-col transition-shadow duration-300 ${isDragging ? 'ring-2 ring-[#185baf]' : ''}`} 
      style={panelStyles} 
      onClick={onFocus}
    >
      {/* Classic Title Bar */}
      <div 
        onMouseDown={handleMouseDown} 
        className={`px-3 py-1.5 flex items-center justify-between cursor-move active:cursor-grabbing border-b border-[#ccc] bg-[#185baf] text-white ${isMobile ? 'cursor-default' : ''}`}
      >
        <div className="flex items-center gap-3 flex-1 min-w-0">
          <Calendar className="text-white w-4 h-4 shrink-0" />
          
          <div className="flex items-center gap-2 flex-1 min-w-0">
            <div className="relative group text-black" onMouseDown={e => e.stopPropagation()}>
              <select 
                value={viewType} 
                onChange={(e) => {
                  const newType = e.target.value as ViewType;
                  let defaultId = '';
                  if (newType === 'Room') defaultId = rooms[0]?.id;
                  else if (newType === 'Faculty') defaultId = faculties[0]?.id;
                  else if (newType === 'Group') defaultId = groups[0]?.id;
                  else if (newType === 'Course') defaultId = courses[0]?.id;
                  onUpdateView?.(newType, defaultId);
                  setSearchQuery('');
                }} 
                className="appearance-none bg-white border border-[#ccc] px-2 py-0.5 pr-6 text-xs font-bold uppercase tracking-widest outline-none cursor-pointer hover:bg-[#e6e6e6] transition-all"
              >
                <option value="Room">Room</option>
                <option value="Faculty">Staff</option>
                <option value="Group">Cohort</option>
                <option value="Course">Module</option>
              </select>
              <ChevronDown className="absolute right-1.5 top-1/2 -translate-y-1/2 w-3 h-3 text-[#666] pointer-events-none" />
            </div>
            
            <div className="relative flex-1 max-w-[200px]" ref={selectorRef} onMouseDown={e => e.stopPropagation()}>
              <button 
                onClick={() => setIsSelectorOpen(!isSelectorOpen)} 
                className="w-full bg-white text-black border border-[#ccc] px-2 py-0.5 text-xs font-bold hover:bg-[#e6e6e6] transition-all flex justify-between items-center gap-2 max-h-[22px]"
              >
                <span className="truncate">{activeObjectName || 'Select...'}</span>
                <ChevronDown className={`w-3 h-3 text-[#666] transition-transform duration-200 ${isSelectorOpen ? 'rotate-180' : ''}`} />
              </button>
              
              {isSelectorOpen && (
                <div className="absolute top-full left-0 mt-1 w-64 bg-white border border-[#ccc] shadow-lg z-50 overflow-hidden">
                  <div className="p-2 border-b border-[#ccc] flex items-center gap-2 bg-[#f0f0f0]">
                    <Search className="w-3.5 h-3.5 text-[#666]" />
                    <input 
                      autoFocus 
                      type="text" 
                      placeholder={`Search ${viewType}...`} 
                      className="w-full bg-white border border-[#ccc] px-2 py-1 outline-none text-xs font-bold text-black placeholder:text-[#999]" 
                      value={searchQuery} 
                      onChange={(e) => setSearchQuery(e.target.value)} 
                    />
                  </div>
                  <div className="max-h-60 overflow-y-auto p-1 text-black custom-scrollbar">
                    {resourceOptions.length > 0 ? resourceOptions.map(opt => (
                      <button 
                        key={opt.id} 
                        onClick={() => { onUpdateView?.(viewType, opt.id); setIsSelectorOpen(false); setSearchQuery(''); }} 
                        className={`w-full text-left px-3 py-1.5 text-xs font-bold transition-all ${viewId === opt.id ? 'bg-[#185baf] text-white' : 'hover:bg-[#e6e6e6] text-[#333]'}`}
                      >
                        {opt.name}
                      </button>
                    )) : (
                      <div className="p-4 text-center text-xs text-[#999] uppercase tracking-widest">No results</div>
                    )}
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>

        {!isMobile && (
          <div className="flex items-center gap-2 ml-4" onMouseDown={e => e.stopPropagation()}>
            <button 
              onClick={onRemove}
              className="p-1 hover:bg-[#c9302c] bg-[#d9534f] text-white border border-transparent transition-all"
            >
              <X className="w-3.5 h-3.5" />
            </button>
          </div>
        )}
      </div>

      {/* Toolbar */}
      <div className="px-3 py-2 bg-[#f0f0f0] flex items-center gap-3 border-b border-[#ccc] overflow-hidden">
        <div className="flex items-center gap-2 shrink-0">
          <button 
            onClick={() => setSelectedWeeks(Array.from({ length: TOTAL_WEEKS }, (_, i) => i + 1))} 
            className={`px-3 py-1 text-[11px] font-bold uppercase tracking-widest transition-all flex items-center gap-2 border ${selectedWeeks.length === TOTAL_WEEKS ? 'bg-[#185baf] text-white border-[#185baf]' : 'bg-white text-[#333] border-[#ccc] hover:bg-[#e6e6e6]'}`}
          >
            <CalendarCheck className="w-3 h-3" />
            All Weeks
          </button>
        </div>
        
        <div className="w-px h-5 bg-[#ccc] shrink-0" />
        
        <div className="flex-1 overflow-x-auto pb-1 no-scrollbar flex gap-1 items-center">
          {Array.from({ length: TOTAL_WEEKS }, (_, i) => i + 1).map(week => (
            <button 
              key={week} 
              onClick={(e) => { 
                if (e.ctrlKey) { 
                  setSelectedWeeks(prev => prev.includes(week) ? (prev.length > 1 ? prev.filter(w => w !== week) : prev) : [...prev, week].sort((a,b)=>a-b)); 
                } else { 
                  setSelectedWeeks([week]); 
                } 
              }} 
              className={`min-w-[24px] h-6 border text-[11px] font-bold transition-all flex items-center justify-center ${selectedWeeks.includes(week) ? 'bg-[#185baf] text-white border-[#185baf]' : 'bg-white text-[#333] border-[#ccc] hover:bg-[#e6e6e6]'}`}
            >
              {week}
            </button>
          ))}
        </div>
      </div>

      {/* Grid */}
      <div className="flex-1 bg-white relative overflow-hidden flex flex-col">
        <div className="absolute inset-0 overflow-auto custom-scrollbar bg-white">
          <table className="w-full border-collapse table-fixed min-w-[800px]">
            <thead>
              <tr className="sticky top-0 z-40 shadow-[0_1px_0_#ccc]">
                <th className="w-16 sticky left-0 z-50 bg-[#f0f0f0] border-b border-r border-[#ccc]"></th>
                {TIME_SLOTS.map(t => (
                  <th 
                    key={t} 
                    className={`h-8 text-[10px] font-bold text-[#666] uppercase tracking-widest border-b border-[#ccc] bg-[#fdfdfd] border-r border-r-[#f0f0f0] ${t.endsWith(':00') ? 'text-[#333]' : ''}`}
                  >
                     {t.endsWith(':00') ? t.split(':')[0] : ''}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {DAYS.map((day, idx) => (
                <tr key={day} className="group/row">
                  <td className="sticky left-0 z-30 bg-[#f9f9f9] border-r border-b border-[#ccc] p-1 text-center group-hover/row:bg-[#f0f0f0] transition-colors">
                    <div className="text-[10px] font-bold text-[#333] uppercase tracking-tighter">{day.substring(0, 3)}</div>
                    {selectedWeeks.length === 1 && <div className="text-[9px] text-[#666] mt-0.5">{getDayDate(idx, selectedWeeks[0])}</div>}
                  </td>
                  {TIME_SLOTS.map(time => {
                    const cellEntries = filteredEntries.filter(e => e.day === day && e.startTime === time);
                    const isCovered = filteredEntries.some(e => e.day === day && time > e.startTime && time < e.endTime);
                    const hasConflict = cellEntries.length > 1;

                    return (
                      <td 
                        key={time} 
                        onClick={() => !isCovered && cellEntries.length === 0 && onCellClick?.(day as DayOfWeek, time, viewType, viewId)} 
                        onContextMenu={(e) => !isCovered && cellEntries.length === 0 && handleCellContextMenu(e, day as DayOfWeek, time)}
                        onDragOver={handleDragOver}
                        onDrop={(e) => handleDrop(e, day as DayOfWeek, time)}
                        className={`relative h-14 border-r border-b border-[#eee] transition-colors ${isCovered ? 'bg-[#f5f5f5]' : 'hover:bg-[#e0ebf9] cursor-pointer group/cell'} ${time.endsWith(':30') ? 'border-r-[#e0e0e0]' : 'border-r-[#f0f0f0]'}`}
                      >
                        {cellEntries.length === 0 && !isCovered && (
                          <div className="absolute inset-0 flex items-center justify-center opacity-0 group-hover/cell:opacity-100 transition-opacity">
                            <Plus className="w-3 h-3 text-[#185baf]/40" />
                          </div>
                        )}
                        <div className={`absolute inset-y-[1px] left-[1px] z-10 pointer-events-none`} style={{ width: 'calc(100% - 2px)', height: 'calc(100% - 2px)' }}>
                          {cellEntries.map((entry, index) => {
                            const course = courses.find(c => c.id === entry.courseId);
                            const slots = getSlotCount(entry.startTime, entry.endTime);
                            
                            const hasConflict = cellEntries.length > 1;
                            const cascadeX = index * 4;
                            const cascadeY = index * 4;

                            return (
                              <div 
                                key={entry.id} 
                                draggable="true"
                                onDragStart={(e) => handleDragStart(e, entry)}
                                onContextMenu={(e) => handleContextMenu(e, entry)}
                                onClick={(e) => { e.stopPropagation(); onEntryClick?.(entry, cellEntries); }} 
                                className={`absolute shadow-[2px_2px_4px_rgba(0,0,0,0.3)] flex flex-col p-1 border hover:border-black transition-all cursor-grab active:cursor-grabbing overflow-hidden pointer-events-auto group/entry ${hasConflict ? 'hover:z-[100]' : ''}`} 
                                style={{ 
                                  top: `${cascadeY}px`,
                                  left: `${cascadeX}px`,
                                  backgroundColor: hasConflict ? '#ef4444' : '#185baf', 
                                  borderColor: hasConflict ? '#b91c1c' : '#00479b', 
                                  color: '#fff',
                                  width: slots > 1 ? `calc(${slots * 100}% + ${(slots - 1) * 1}px - ${cascadeX}px)` : `calc(100% - ${cascadeX}px)`,
                                  height: `calc(100% - ${cascadeY}px)`,
                                  zIndex: 20 + index,
                                }}
                              >
                                {hasConflict && (
                                  <div className="absolute top-0 right-0 bg-white text-[#b91c1c] font-black text-[9px] w-3.5 h-3.5 flex items-center justify-center border-b border-l border-[#b91c1c] shadow-sm pointer-events-none">
                                    {index + 1}
                                  </div>
                                )}
                                <div className="text-[9px] font-bold leading-none uppercase truncate tracking-tight pr-3">{course?.name}</div>
                                <div className="text-[8px] font-normal opacity-90 truncate mt-0.5">{course?.code}</div>
                                
                                <div className="mt-auto flex justify-between items-end">
                                  <span className="text-[8px] truncate max-w-[60%] opacity-90">
                                    {viewType === 'Faculty' 
                                      ? groups.filter(g => entry.groupIds?.includes(g.id)).map(g => g.name).join(', ')
                                      : faculties.find(f => f.id === entry.facultyId)?.name}
                                  </span>
                                  <span className="text-[8px] font-bold bg-white/20 px-1 py-0.5 leading-none">
                                    {viewType === 'Room' 
                                      ? groups.filter(g => entry.groupIds?.includes(g.id)).map(g => g.name).join(', ')
                                      : rooms.find(r => r.id === entry.roomId)?.name}
                                  </span>
                                </div>
                              </div>
                            );
                          })}
                        </div>
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* Footer Info */}
      <div className="px-3 py-1.5 bg-[#f0f0f0] border-t border-[#ccc] flex items-center justify-between text-[10px] text-[#333]">
        <div className="flex items-center gap-4">
           <div className="flex items-center gap-1">
             <Clock className="w-3 h-3 text-[#666]" />
             <span>LOAD: <strong>{calculateTotalHours()}</strong></span>
           </div>
           <div className="flex items-center gap-1">
             <Calendar className="w-3 h-3 text-[#666]" />
             <span>WEEKS: <strong>{selectedWeeks.length}</strong></span>
           </div>
        </div>
        <div className="flex items-center gap-1 font-bold text-[#185baf]">
          <Zap className="w-3 h-3" />
          {activeObjectName}
        </div>
      </div>

      {!isMobile && (
        <>
          <div onMouseDown={(e) => handleResizeStart(e, 'n')} className="absolute top-0 left-0 right-0 h-1 cursor-ns-resize z-50" />
          <div onMouseDown={(e) => handleResizeStart(e, 's')} className="absolute bottom-0 left-0 right-0 h-1 cursor-ns-resize z-50" />
          <div onMouseDown={(e) => handleResizeStart(e, 'e')} className="absolute top-0 bottom-0 right-0 w-1 cursor-ew-resize z-50" />
          <div onMouseDown={(e) => handleResizeStart(e, 'w')} className="absolute top-0 bottom-0 left-0 w-1 cursor-ew-resize z-50" />
          
          <div onMouseDown={(e) => handleResizeStart(e, 'nw')} className="absolute top-0 left-0 w-4 h-4 cursor-nwse-resize z-[60]" />
          <div onMouseDown={(e) => handleResizeStart(e, 'ne')} className="absolute top-0 right-0 w-4 h-4 cursor-nesw-resize z-[60]" />
          <div onMouseDown={(e) => handleResizeStart(e, 'sw')} className="absolute bottom-0 left-0 w-4 h-4 cursor-nesw-resize z-[60]" />
          <div onMouseDown={(e) => handleResizeStart(e, 'se')} className="absolute bottom-0 right-0 w-6 h-6 cursor-nwse-resize z-[60] flex items-end justify-end p-1">
             <div className="w-2 h-2 border-r-2 border-b-2 border-[#666]" />
          </div>
        </>
      )}

      {/* Context Menu */}
      <AnimatePresence>
        {contextMenu && (
          <motion.div 
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.1 }}
            className="fixed bg-[#f0f0f0] border border-[#185baf] shadow-lg z-[10000] py-1 min-w-[140px]"
            style={{ 
              left: contextMenu.x, 
              top: contextMenu.y,
            }}
            onClick={(e) => e.stopPropagation()}
          >
            {contextMenu.entry ? (
              <>
                <div className="px-3 py-1 border-b border-[#ccc] bg-white">
                  <p className="text-[10px] font-bold text-[#666] uppercase tracking-widest">Session Action</p>
                </div>
                <button 
                  onClick={() => { 
                    const { id, ...rest } = contextMenu.entry!;
                    setClipboard(rest);
                    setContextMenu(null); 
                  }}
                  className="w-full text-left px-3 py-1.5 text-[11px] font-bold text-[#333] hover:bg-[#185baf] hover:text-white transition-colors flex items-center gap-2"
                >
                  <FolderSync className="w-3.5 h-3.5" /> Copy Session
                </button>
                <button 
                  onClick={() => { onDuplicateEntry?.(contextMenu.entry!); setContextMenu(null); }}
                  className="w-full text-left px-3 py-1.5 text-[11px] font-bold text-[#333] hover:bg-[#185baf] hover:text-white transition-colors flex items-center gap-2"
                >
                  <Plus className="w-3.5 h-3.5" /> Duplicate
                </button>
                <div className="border-t border-[#ccc] my-0.5" />
                <button 
                  onClick={() => { onDeleteEntry?.(contextMenu.entry!.id); setContextMenu(null); }}
                  className="w-full text-left px-3 py-1.5 text-[11px] font-bold text-[#ac2925] hover:bg-[#ac2925] hover:text-white transition-colors flex items-center gap-2"
                >
                  <X className="w-3.5 h-3.5" /> Delete Session
                </button>
              </>
            ) : contextMenu.cell ? (
              <>
                <div className="px-3 py-1 border-b border-[#ccc] bg-white">
                  <p className="text-[10px] font-bold text-[#666] uppercase tracking-widest">Cell Action</p>
                </div>
                <button 
                  disabled={!clipboard}
                  onClick={() => { 
                    if (clipboard) {
                      const newEntry = { 
                        ...clipboard, 
                        day: contextMenu.cell!.day, 
                        startTime: contextMenu.cell!.time 
                      } as Omit<ScheduleEntry, 'id' | 'departmentId'>;
                      
                      if (clipboard.startTime && clipboard.endTime) {
                        const [sh, sm] = clipboard.startTime.split(':').map(Number);
                        const [eh, em] = clipboard.endTime.split(':').map(Number);
                        const duration = (eh * 60 + em) - (sh * 60 + sm);
                        
                        const [nsh, nsm] = contextMenu.cell!.time.split(':').map(Number);
                        const totalEnd = (nsh * 60 + nsm) + duration;
                        const neh = Math.floor(totalEnd / 60);
                        const nem = totalEnd % 60;
                        newEntry.endTime = `${String(neh).padStart(2, '0')}:${String(nem).padStart(2, '0')}`;
                      }
                      onPasteEntry?.(newEntry);
                      setContextMenu(null);
                    }
                  }}
                  className={`w-full text-left px-3 py-1.5 text-[11px] font-bold transition-colors flex items-center gap-2 ${!clipboard ? 'text-[#999] cursor-not-allowed' : 'text-[#333] hover:bg-[#185baf] hover:text-white'}`}
                >
                  <CalendarCheck className="w-3.5 h-3.5" /> Paste Session
                </button>
              </>
            ) : null}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
};

export default TimetablePanel;
