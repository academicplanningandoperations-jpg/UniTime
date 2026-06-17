import React, { useState, useMemo } from 'react';
import { Room, ScheduleEntry, DayOfWeek, StudentGroup, Faculty, ViewType } from '../types';
import { DAYS, TIME_SLOTS, TOTAL_WEEKS } from '../constants';
import { Search, MapPin, Clock, Calendar, Users, User, AlertTriangle, CheckCircle2, XCircle } from 'lucide-react';
import { motion, AnimatePresence, useDragControls } from 'motion/react';
import { formatTime12h } from '../services/utils';

type ResourceType = 'Room' | 'Faculty' | 'Cohort';

interface ResourceFinderProps {
  rooms: Room[];
  faculties: Faculty[];
  groups: StudentGroup[];
  schedule: ScheduleEntry[];
  isOpen: boolean;
  onClose: () => void;
  onCellDoubleClick: (resourceType: ViewType, resourceId: string, day: DayOfWeek, time: string) => void;
}

const ResourceFinder: React.FC<ResourceFinderProps> = ({
  rooms, faculties, groups, schedule, isOpen, onClose, onCellDoubleClick
}) => {
  const [resourceType, setResourceType] = useState<ResourceType>('Room');
  const [day, setDay] = useState<DayOfWeek>('Monday');
  const [week, setWeek] = useState(1);
  const [startTimeFilter, setStartTimeFilter] = useState('08:00');
  const [endTimeFilter, setEndTimeFilter] = useState('19:00');
  const [searchQuery, setSearchQuery] = useState('');
  const dragControls = useDragControls();

  const filteredTimeSlots = useMemo(() => {
    return TIME_SLOTS.filter(t => t >= startTimeFilter && t <= endTimeFilter);
  }, [startTimeFilter, endTimeFilter]);

  const resources = useMemo(() => {
    const q = searchQuery.toLowerCase();
    if (resourceType === 'Room') {
      return rooms
        .filter(r => !q || r.name.toLowerCase().includes(q) || r.type.toLowerCase().includes(q))
        .map(r => ({ id: r.id, name: r.name, sub: `${r.type} · Cap: ${r.capacity}` }));
    }
    if (resourceType === 'Faculty') {
      return faculties
        .filter(f => !q || f.name.toLowerCase().includes(q) || (f.facultyId || '').toLowerCase().includes(q))
        .map(f => ({ id: f.id, name: f.name, sub: f.department }));
    }
    return groups
      .filter(g => !q || g.name.toLowerCase().includes(q) || g.program.toLowerCase().includes(q))
      .map(g => ({ id: g.id, name: g.name, sub: `${g.program} · Sem ${g.semester}` }));
  }, [resourceType, rooms, faculties, groups, searchQuery]);

  const getSlotUsage = (resourceId: string, time: string) => {
    const sessions = schedule.filter(s => {
      const matchesResource =
        (resourceType === 'Room' && s.roomId === resourceId) ||
        (resourceType === 'Faculty' && s.facultyId === resourceId) ||
        (resourceType === 'Cohort' && s.groupIds?.includes(resourceId));
      return matchesResource && s.day === day && s.weeks.includes(week) && time >= s.startTime && time < s.endTime;
    });
    if (sessions.length === 0) return { status: 'free' as const };
    if (sessions.length > 1) return { status: 'conflict' as const, sessions };
    return { status: 'busy' as const, session: sessions[0] };
  };

  const viewTypeMap: Record<ResourceType, ViewType> = {
    Room: 'Room',
    Faculty: 'Faculty',
    Cohort: 'Group',
  };

  const typeConfig: Record<ResourceType, { label: string; icon: React.ReactNode; accent: string }> = {
    Room:    { label: 'Room',    icon: <MapPin className="w-3.5 h-3.5" />,  accent: '#185baf' },
    Faculty: { label: 'Faculty', icon: <User className="w-3.5 h-3.5" />,   accent: '#7c3aed' },
    Cohort:  { label: 'Cohort',  icon: <Users className="w-3.5 h-3.5" />,  accent: '#0891b2' },
  };

  // Count busy slots per time column for the heat bar
  const columnBusy = useMemo(() => {
    const map: Record<string, number> = {};
    filteredTimeSlots.forEach(t => {
      map[t] = resources.filter(r => getSlotUsage(r.id, t).status !== 'free').length;
    });
    return map;
  }, [filteredTimeSlots, resources, schedule, day, week, resourceType]);

  if (!isOpen) return null;

  const current = typeConfig[resourceType];
  const accentColor = current.accent;

  const selectCls = "bg-[#f8fafc] text-[#0f172a] border border-[#cbd5e1] px-2.5 py-1.5 text-[11px] font-bold outline-none focus:border-[#185baf] cursor-pointer transition-colors rounded-sm";

  return (
    <AnimatePresence>
      <div className="fixed inset-0 z-[9999] flex items-center justify-center p-4 pointer-events-none">
        <motion.div
          drag
          dragMomentum={false}
          dragListener={false}
          dragControls={dragControls}
          initial={{ scale: 0.96, opacity: 0, y: 12 }}
          animate={{ scale: 1, opacity: 1, y: 0 }}
          exit={{ scale: 0.96, opacity: 0, y: 12 }}
          transition={{ duration: 0.2 }}
          className="relative pointer-events-auto flex flex-col bg-white overflow-hidden"
          style={{
            width: '750px',
            maxWidth: '95vw',
            height: '85vh',
            minHeight: '400px',
            boxShadow: '0 32px 80px rgba(0,0,0,0.2), 0 0 0 1px rgba(0,0,0,0.05)',
            borderRadius: 8,
            resize: 'both',
            overflow: 'auto',
          }}
        >
          {/* ── Title Bar ───────────────────────────────────── */}
          <div
            className="flex justify-between items-center px-4 py-2.5 cursor-move select-none shrink-0 border-b border-[#e2e8f0]"
            style={{ background: '#f8fafc' }}
            onPointerDown={(e) => dragControls.start(e)}
          >
            <div className="flex items-center gap-3">
              <div className="flex items-center justify-center w-7 h-7 rounded" style={{ background: `${accentColor}15`, border: `1px solid ${accentColor}30` }}>
                <span style={{ color: accentColor }}>{current.icon}</span>
              </div>
              <div>
                <h2 className="text-[13px] font-black text-[#0f172a] tracking-wide uppercase">{current.label} Availability</h2>
                <p className="text-[9px] font-bold text-[#64748b] uppercase tracking-widest leading-none mt-0.5">Usage Chart · {day} · Week {week}</p>
              </div>
            </div>

            <div className="flex items-center gap-5">
              {/* Legend */}
              <div className="flex gap-3 items-center border-r border-[#e2e8f0] pr-5">
                {[
                  { color: '#15803d', bg: '#dcfce7', label: 'Free', icon: <CheckCircle2 className="w-3 h-3" /> },
                  { color: '#b91c1c', bg: '#fee2e2', label: 'Busy', icon: <XCircle className="w-3 h-3" /> },
                  { color: '#b45309', bg: '#fef3c7', label: 'Conflict', icon: <AlertTriangle className="w-3 h-3" /> },
                ].map(l => (
                  <div key={l.label} className="flex items-center gap-1.5 px-2 py-1 rounded" style={{ background: l.bg }}>
                    <span style={{ color: l.color }}>{l.icon}</span>
                    <span className="text-[9px] font-bold uppercase tracking-widest" style={{ color: l.color }}>{l.label}</span>
                  </div>
                ))}
              </div>
              <span className="text-[9px] text-[#94a3b8] font-bold uppercase tracking-widest hidden lg:block">Double-click → create event</span>
              <button
                onClick={onClose}
                className="w-7 h-7 flex items-center justify-center text-[#64748b] hover:text-[#0f172a] hover:bg-[#e2e8f0] rounded transition-colors font-bold text-sm"
              >✕</button>
            </div>
          </div>

          {/* ── Controls Bar ────────────────────────────────── */}
          <div className="shrink-0 px-4 py-2.5 flex items-center gap-4 flex-wrap border-b border-[#e2e8f0]" style={{ background: '#fff' }}>

            {/* Resource type — segmented pills */}
            <div className="flex items-center rounded-full p-0.5 gap-0.5" style={{ background: '#f1f5f9' }}>
              {(['Room', 'Faculty', 'Cohort'] as ResourceType[]).map(type => (
                <button
                  key={type}
                  onClick={() => { setResourceType(type); setSearchQuery(''); }}
                  className="flex items-center gap-1.5 px-3 py-1 text-[10px] font-bold uppercase tracking-wide rounded-full transition-all"
                  style={resourceType === type
                    ? { background: typeConfig[type].accent, color: '#fff', boxShadow: '0 1px 3px rgba(0,0,0,0.1)' }
                    : { color: '#64748b' }
                  }
                >
                  {typeConfig[type].icon}
                  {typeConfig[type].label}
                </button>
              ))}
            </div>

            <div className="w-px h-5 bg-[#e2e8f0]" />

            {/* Day */}
            <div className="flex items-center gap-2">
              <span className="text-[9px] font-black uppercase tracking-widest text-[#94a3b8]">Day</span>
              <select value={day} onChange={e => setDay(e.target.value as DayOfWeek)} className={selectCls}>
                {DAYS.map(d => <option key={d} value={d}>{d}</option>)}
              </select>
            </div>

            {/* Time range */}
            <div className="flex items-center gap-2">
              <span className="text-[9px] font-black uppercase tracking-widest text-[#94a3b8]">From</span>
              <select value={startTimeFilter} onChange={e => setStartTimeFilter(e.target.value)} className={selectCls}>
                {TIME_SLOTS.map(t => <option key={t} value={t}>{formatTime12h(t)}</option>)}
              </select>
              <span className="text-[9px] font-black uppercase tracking-widest text-[#94a3b8]">To</span>
              <select value={endTimeFilter} onChange={e => setEndTimeFilter(e.target.value)} className={selectCls}>
                {TIME_SLOTS.map(t => <option key={t} value={t}>{formatTime12h(t)}</option>)}
              </select>
            </div>

            {/* Week */}
            <div className="flex items-center gap-2">
              <span className="text-[9px] font-black uppercase tracking-widest text-[#94a3b8]">Week</span>
              <select value={week} onChange={e => setWeek(Number(e.target.value))} className={selectCls}>
                {Array.from({ length: TOTAL_WEEKS }, (_, i) => i + 1).map(w => <option key={w} value={w}>Week {w}</option>)}
              </select>
            </div>

            <div className="w-px h-5 bg-[#e2e8f0]" />

            {/* Search */}
            <div className="flex-1 min-w-[200px] relative">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 pointer-events-none text-[#94a3b8]" />
              <input
                type="text"
                placeholder={`Search ${resourceType.toLowerCase()}s…`}
                value={searchQuery}
                onChange={e => setSearchQuery(e.target.value)}
                className="w-full pl-9 pr-4 py-1.5 text-[11px] font-bold outline-none transition-colors placeholder:text-[#94a3b8] rounded-sm"
                style={{
                  background: '#f8fafc',
                  border: '1px solid #cbd5e1',
                  color: '#0f172a',
                }}
              />
            </div>
          </div>

          {/* ── Grid ────────────────────────────────────────── */}
          <div className="flex-1 overflow-auto custom-scrollbar" style={{ background: '#f1f5f9' }}>
            <table className="w-full border-collapse table-fixed">
              <thead className="sticky top-0 z-20">
                <tr>
                  {/* Resource header */}
                  <th className="sticky left-0 z-30 w-[160px] px-3 py-2 text-left border-r border-b"
                    style={{ background: '#f8fafc', borderColor: '#e2e8f0' }}>
                    <div className="flex items-center gap-1.5" style={{ color: accentColor }}>
                      {current.icon}
                      <span className="text-[9px] font-black uppercase tracking-widest">{resourceType}</span>
                    </div>
                  </th>
                  {/* Time slot headers */}
                  {filteredTimeSlots.map(t => {
                    const isHour = t.endsWith(':00');
                    const busyCount = columnBusy[t] || 0;
                    const heatPct = resources.length > 0 ? (busyCount / resources.length) * 100 : 0;
                    return (
                      <th key={t}
                        className="border-b border-r p-0 relative"
                        style={{
                          borderColor: '#e2e8f0',
                          background: '#f8fafc',
                          minWidth: 28,
                        }}>
                        {/* Heat strip */}
                        {heatPct > 0 && (
                          <div className="absolute bottom-0 left-0 right-0"
                            style={{ height: `${Math.min(heatPct * 0.6, 4)}px`, background: heatPct > 60 ? '#ef4444' : '#f59e0b', opacity: 0.7 }} />
                        )}
                        <div className="py-1.5 flex items-center justify-center">
                          {isHour ? (
                            <span className="text-[9px] font-black text-[#475569] tracking-tight">
                              {formatTime12h(t).replace(':00', '').replace(' ', '')}
                            </span>
                          ) : (
                            <span className="text-[7px] font-bold text-[#cbd5e1]">·</span>
                          )}
                        </div>
                      </th>
                    );
                  })}
                </tr>
              </thead>
              <tbody>
                {resources.map((resource, rowIdx) => (
                  <tr key={resource.id} className="group">
                    {/* Resource label */}
                    <td className="sticky left-0 z-10 w-[160px] px-3 py-1.5 border-r border-b"
                      style={{
                        background: rowIdx % 2 === 0 ? '#fff' : '#f8fafc',
                        borderColor: '#e2e8f0',
                        borderLeft: `3px solid ${accentColor}`,
                      }}>
                      <div className="text-[10px] font-bold truncate" style={{ color: accentColor }}>{resource.name}</div>
                      <div className="text-[8px] font-bold text-[#94a3b8] uppercase tracking-tight truncate mt-0.5">{resource.sub}</div>
                    </td>

                    {/* Time cells */}
                    {filteredTimeSlots.map(t => {
                      const usage = getSlotUsage(resource.id, t);
                      const isHour = t.endsWith(':00');

                      let cellStyle: React.CSSProperties = {
                        background: rowIdx % 2 === 0 ? '#fff' : '#f8fafc',
                        borderRight: isHour ? '1px solid #cbd5e1' : '1px solid #e2e8f0',
                        borderBottom: '1px solid #e2e8f0',
                        cursor: 'pointer',
                      };
                      let content: React.ReactNode = null;

                      if (usage.status === 'busy') {
                        cellStyle.background = '#fee2e2';
                        cellStyle.borderBottom = '1px solid #fca5a5';
                        const firstGroup = groups.find(g => g.id === (usage.session!.groupIds || [])[0]);
                        content = (
                          <div className="w-full h-full flex flex-col items-center justify-center gap-0.5">
                            <div className="w-full h-[3px]" style={{ background: '#ef4444' }} />
                            <span className="text-[6px] font-black text-[#991b1b] uppercase tracking-tight px-0.5 text-center leading-tight">
                              {firstGroup?.name?.substring(0, 6) || '●'}
                            </span>
                          </div>
                        );
                      } else if (usage.status === 'conflict') {
                        cellStyle.background = '#fef3c7';
                        cellStyle.borderBottom = '1px solid #fcd34d';
                        content = (
                          <div className="w-full h-full flex flex-col items-center justify-center">
                            <div className="w-full h-[3px]" style={{ background: '#f59e0b' }} />
                            <span className="text-[7px] font-black text-[#92400e]">⚠</span>
                          </div>
                        );
                      }

                      const titleText = usage.status === 'free'
                        ? `${resource.name} — ${formatTime12h(t)} — Free. Double-click to create event.`
                        : usage.status === 'busy'
                        ? `${resource.name} — ${formatTime12h(usage.session!.startTime)} to ${formatTime12h(usage.session!.endTime)} — Busy. Double-click to open timetable.`
                        : `CONFLICT at ${resource.name} — ${formatTime12h(t)}`;

                      return (
                        <td
                          key={t}
                          title={titleText}
                          style={cellStyle}
                          className="p-0 h-8 select-none transition-all"
                          onDoubleClick={() => {
                            onCellDoubleClick(viewTypeMap[resourceType], resource.id, day, t);
                            onClose();
                          }}
                          onMouseEnter={e => {
                            if (usage.status === 'free') (e.currentTarget as HTMLElement).style.background = '#dbeafe';
                            else if (usage.status === 'busy') (e.currentTarget as HTMLElement).style.background = '#fecaca';
                            else (e.currentTarget as HTMLElement).style.background = '#fde68a';
                          }}
                          onMouseLeave={e => {
                            if (usage.status === 'free') (e.currentTarget as HTMLElement).style.background = rowIdx % 2 === 0 ? '#fff' : '#f8fafc';
                            else if (usage.status === 'busy') (e.currentTarget as HTMLElement).style.background = '#fee2e2';
                            else (e.currentTarget as HTMLElement).style.background = '#fef3c7';
                          }}
                        >
                          <div className="w-full h-full flex items-center justify-center overflow-hidden">
                            {content}
                          </div>
                        </td>
                      );
                    })}
                  </tr>
                ))}

                {resources.length === 0 && (
                  <tr>
                    <td colSpan={filteredTimeSlots.length + 1} className="py-16 text-center">
                      <div className="flex flex-col items-center gap-2 opacity-60">
                        <Search className="w-8 h-8 text-[#94a3b8]" />
                        <p className="text-[11px] font-bold text-[#94a3b8] uppercase tracking-widest">No {resourceType.toLowerCase()}s found</p>
                      </div>
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>

          {/* ── Footer ──────────────────────────────────────── */}
          <div className="shrink-0 px-4 py-2 flex justify-between items-center border-t border-[#e2e8f0]" style={{ background: '#f8fafc' }}>
            <div className="flex items-center gap-4 text-[9px] font-black uppercase tracking-widest">
              <span className="flex items-center gap-1.5 text-[#64748b]">
                <Calendar className="w-3.5 h-3.5" />
                {day} · Week {week}
              </span>
              <span className="w-px h-3 bg-[#cbd5e1]" />
              <span style={{ color: accentColor }}>{resources.length} {resourceType.toLowerCase()}s shown</span>
              <span className="w-px h-3 bg-[#cbd5e1]" />
              <span className="text-[#64748b]">{filteredTimeSlots.length} time slots</span>
            </div>
            <span className="text-[8px] font-bold text-[#94a3b8] uppercase tracking-widest italic">
              Double-click any cell to create event or open timetable
            </span>
          </div>
        </motion.div>
      </div>
    </AnimatePresence>
  );
};

export default ResourceFinder;
