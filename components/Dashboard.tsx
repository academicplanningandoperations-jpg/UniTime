import React, { useMemo, useState, useEffect, useRef } from 'react';
import { MapPin, AlertTriangle, Clock, BookOpen, Database, Calendar, Filter, X, ChevronLeft, ChevronRight, TrendingUp } from 'lucide-react';
import {
  AreaChart, Area, LineChart, Line, BarChart, Bar, Tooltip, XAxis, YAxis, CartesianGrid,
  ResponsiveContainer, LabelList, Cell
} from 'recharts';
import { Course, Room, StudentGroup, ScheduleEntry, Clash, Term, Faculty } from '../types';
import { DataService } from '../services/dataService';

interface DashboardProps {
  courses: Course[];
  rooms: Room[];
  groups: StudentGroup[];
  schedule: ScheduleEntry[];
  clashes: Clash[];
  activeTerm?: Term;
  faculties?: Faculty[];
}

const SCHOOL_COLORS = ['#185baf', '#0891b2', '#059669', '#d97706', '#7c3aed', '#e11d48', '#0d9488', '#ea580c'];

const HEAT_STOPS: [number, number, number][] = [
  [34,  197, 94],   // green
  [234, 179, 8],    // yellow
  [249, 115, 22],   // orange
  [220, 38,  38],   // red
];

const heatColor = (val: number, max: number): string => {
  if (max === 0 || val === 0) return '#f1f5f9';
  const t = Math.min(val / max, 1);
  const n = HEAT_STOPS.length - 1;
  const scaled = t * n;
  const i = Math.min(Math.floor(scaled), n - 1);
  const f = scaled - i;
  const [r1, g1, b1] = HEAT_STOPS[i];
  const [r2, g2, b2] = HEAT_STOPS[i + 1];
  return `rgb(${Math.round(r1 + (r2 - r1) * f)},${Math.round(g1 + (g2 - g1) * f)},${Math.round(b1 + (b2 - b1) * f)})`;
};

const heatTextColor = (val: number, max: number): string => {
  if (max === 0 || val === 0) return '#cbd5e1';
  return (val / max) > 0.3 ? '#ffffff' : '#166534';
};

const Dashboard: React.FC<DashboardProps> = ({ courses, rooms, groups, schedule, clashes, activeTerm, faculties }) => {

  const [selectedSchool, setSelectedSchool] = useState<string | null>(null);
  const slicerScrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => { setSelectedSchool(null); }, [activeTerm?.id]);

  const effectiveSchedule = useMemo(() => {
    return activeTerm ? schedule.filter(s => s.termId === activeTerm.id) : schedule;
  }, [schedule, activeTerm]);

  const allSchools = useMemo(() => {
    if (!faculties) return [];
    const set = new Set<string>();
    effectiveSchedule.forEach(s => {
      const f = faculties.find(f => f.id === s.facultyId);
      const dept = (f as any)?._deptName || f?.department || 'General';
      set.add(dept);
    });
    return Array.from(set).sort();
  }, [effectiveSchedule, faculties]);

  const slicedSchedule = useMemo(() => {
    if (!selectedSchool) return effectiveSchedule;
    return effectiveSchedule.filter(s => {
      const f = faculties?.find(f => f.id === s.facultyId);
      const dept = (f as any)?._deptName || f?.department || 'General';
      return dept === selectedSchool;
    });
  }, [effectiveSchedule, selectedSchool, faculties]);

  const slicedCourseIds  = useMemo(() => new Set(slicedSchedule.map(s => s.courseId)),  [slicedSchedule]);
  const slicedRoomIds    = useMemo(() => new Set(slicedSchedule.map(s => s.roomId)),    [slicedSchedule]);
  const slicedFacultyIds = useMemo(() => new Set(slicedSchedule.map(s => s.facultyId)), [slicedSchedule]);

  const totalHours = useMemo(() => {
    return slicedSchedule.reduce((acc, curr) => acc + DataService.getDuration(curr.startTime, curr.endTime), 0);
  }, [slicedSchedule]);

  const avgLoadPerFaculty = useMemo(() => {
    const count = slicedFacultyIds.size;
    return count > 0 ? totalHours / count : 0;
  }, [totalHours, slicedFacultyIds]);

  const dailyData = useMemo(() => {
    const days   = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
    const labels = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
    return days.map((day, i) => {
      const daySessions = slicedSchedule.filter(s => s.day === day);
      return {
        name: labels[i],
        sessions: daySessions.length,
        hours: Math.round(daySessions.reduce((a, c) => a + DataService.getDuration(c.startTime, c.endTime), 0)),
      };
    });
  }, [slicedSchedule]);

  const schoolData = useMemo(() => {
    if (!faculties) return [];
    const deptMap = new Map<string, number>();
    effectiveSchedule.forEach(s => {
      const f = faculties.find(f => f.id === s.facultyId);
      const dept = (f as any)?._deptName || f?.department || 'General';
      deptMap.set(dept, (deptMap.get(dept) || 0) + 1);
    });
    return Array.from(deptMap.entries())
      .map(([fullName, sessions]) => ({
        fullName,
        name: fullName.length > 24 ? fullName.slice(0, 22) + '…' : fullName,
        sessions,
      }))
      .sort((a, b) => b.sessions - a.sessions)
      .slice(0, 8);
  }, [effectiveSchedule, faculties]);

  const facultyData = useMemo(() => {
    if (!faculties) return [];
    return faculties.map(f => {
      const load = slicedSchedule
        .filter(s => s.facultyId === f.id)
        .reduce((acc, curr) => acc + DataService.getDuration(curr.startTime, curr.endTime), 0);
      return { name: f.name.split(' ').pop() as string, fullName: f.name, load: Math.round(load) };
    }).filter(f => f.load > 0).sort((a, b) => b.load - a.load).slice(0, 5);
  }, [faculties, slicedSchedule]);

  const schoolDayData = useMemo(() => {
    const days   = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
    const labels = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
    const schoolsToShow = selectedSchool ? [selectedSchool] : allSchools.slice(0, 6);
    return days.map((day, i) => {
      const entry: Record<string, any> = { name: labels[i] };
      let total = 0;
      let dayHours = 0;
      const facultiesOnDay = new Set<string>();
      schoolsToShow.forEach(school => {
        const daySessions = effectiveSchedule.filter(s => {
          const f = faculties?.find(f => f.id === s.facultyId);
          const dept = (f as any)?._deptName || f?.department || 'General';
          return dept === school && s.day === day;
        });
        entry[school] = daySessions.length;
        total += daySessions.length;
        daySessions.forEach(s => {
          dayHours += DataService.getDuration(s.startTime, s.endTime);
          if (s.facultyId) facultiesOnDay.add(s.facultyId);
        });
      });
      entry._total = total;
      entry._avgLoad = facultiesOnDay.size > 0
        ? Math.round((dayHours / facultiesOnDay.size) * 10) / 10
        : 0;
      return entry;
    });
  }, [effectiveSchedule, faculties, allSchools, selectedSchool]);

  const heatmapData = useMemo(() => {
    const DAYS = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
    const HOURS = [8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18];
    const grid: Record<string, Record<number, number>> = {};
    DAYS.forEach(d => { grid[d] = {}; HOURS.forEach(h => { grid[d][h] = 0; }); });
    slicedSchedule.forEach(s => {
      const h = parseInt(s.startTime);
      if (s.day && grid[s.day] !== undefined && h >= 8 && h <= 18) {
        grid[s.day][h] = (grid[s.day][h] || 0) + 1;
      }
    });
    const maxVal = Math.max(0, ...DAYS.flatMap(d => HOURS.map(h => grid[d][h])));
    return { days: DAYS, hours: HOURS, grid, maxVal };
  }, [slicedSchedule]);

  const statCards = [
    { icon: BookOpen,      title: 'Courses',   value: selectedSchool ? slicedCourseIds.size : courses.length,             sub: 'modules',   color: '#6366f1', grad: 'linear-gradient(135deg,#4338ca,#6366f1)', bg: '#eef2ff', border: '#c7d2fe' },
    { icon: MapPin,        title: 'Rooms',     value: selectedSchool ? slicedRoomIds.size   : rooms.length,               sub: 'venues',    color: '#0891b2', grad: 'linear-gradient(135deg,#0e7490,#06b6d4)', bg: '#ecfeff', border: '#a5f3fc' },
    { icon: Calendar,      title: 'Sessions',  value: slicedSchedule.length,                                               sub: 'entries',   color: '#059669', grad: 'linear-gradient(135deg,#047857,#10b981)', bg: '#ecfdf5', border: '#a7f3d0' },
    { icon: Clock,         title: 'Avg Load',  value: `${avgLoadPerFaculty.toFixed(1)}h`,                                  sub: 'per faculty', color: '#d97706', grad: 'linear-gradient(135deg,#b45309,#f59e0b)', bg: '#fffbeb', border: '#fde68a' },
    { icon: AlertTriangle, title: 'Clashes',   value: clashes.length,                                                      sub: 'conflicts', color: '#e11d48', grad: 'linear-gradient(135deg,#be123c,#e11d48)', bg: '#fff1f2', border: '#fecdd3' },
  ];

  const resourceRows = [
    { label: 'Schedule Entries', value: slicedSchedule.length,                                                badge: 'Optimal', color: '#059669', bg: '#ecfdf5', border: '#a7f3d0' },
    { label: 'Active Courses',   value: selectedSchool ? slicedCourseIds.size  : courses.length,             badge: 'Loaded',  color: '#185baf', bg: '#eff6ff', border: '#bfdbfe' },
    { label: 'Faculty',          value: selectedSchool ? slicedFacultyIds.size : (faculties?.length ?? 0),   badge: 'Synced',  color: '#7c3aed', bg: '#f5f3ff', border: '#ddd6fe' },
    { label: 'Rooms Active',     value: selectedSchool ? slicedRoomIds.size    : rooms.length,               badge: 'Ready',   color: '#0891b2', bg: '#ecfeff', border: '#a5f3fc' },
  ];

  return (
    <div className="p-4 max-w-[1400px] mx-auto min-h-screen font-sans">

      {/* ── Header ──────────────────────────────────────────────────────────── */}
      <header className="mb-4 overflow-hidden relative" style={{ background: 'linear-gradient(135deg, #0c1b3a 0%, #0f2d5e 35%, #185baf 70%, #1a7fd4 100%)' }}>
        <div className="absolute inset-0" style={{ backgroundImage: 'radial-gradient(circle at 80% 50%, rgba(255,255,255,0.06) 0%, transparent 60%), radial-gradient(circle at 20% 80%, rgba(8,145,178,0.15) 0%, transparent 50%)' }} />
        <div className="absolute right-0 top-0 bottom-0 w-40 opacity-[0.04]" style={{ backgroundImage: 'repeating-linear-gradient(-45deg, white 0px, white 1px, transparent 1px, transparent 12px)' }} />
        <div className="relative px-5 py-4 flex justify-between items-center">
          <div>
            <h2 className="text-[17px] font-black text-white tracking-tight flex items-center gap-2">
              <TrendingUp className="w-4 h-4 text-blue-300" />
              System Overview
            </h2>
            <p className="text-[11px] font-medium text-blue-200 mt-0.5">
              {activeTerm?.name || 'All Terms'}
              {selectedSchool && <span className="ml-2 text-yellow-300 font-bold">· {selectedSchool}</span>}
            </p>
          </div>
          <div className="flex items-center gap-3">
            <div className="flex items-center gap-2 bg-white/10 border border-white/20 px-3 py-1.5 backdrop-blur-sm">
              <div className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
              <span className="text-[10px] font-bold uppercase tracking-widest text-emerald-300">Live</span>
            </div>
            <div className="text-right">
              <p className="text-[20px] font-black text-white leading-none">{slicedSchedule.length}</p>
              <p className="text-[9px] text-blue-300 uppercase tracking-widest font-bold">sessions</p>
            </div>
          </div>
        </div>
      </header>

      {/* ── School Slicer ────────────────────────────────────────────────────── */}
      <div className="mb-4 bg-white border border-[#e2e8f0] shadow-sm p-3">
        <div className="flex items-center gap-2 mb-2">
          <Filter className="w-3.5 h-3.5 text-[#6366f1]" />
          <span className="text-[10px] font-black text-[#334155] uppercase tracking-widest">Filter by School</span>
          {selectedSchool && (
            <button onClick={() => setSelectedSchool(null)} className="ml-auto flex items-center gap-1 text-[9px] font-bold text-[#e11d48] uppercase tracking-wide hover:underline">
              <X className="w-3 h-3" /> Clear
            </button>
          )}
        </div>
        <div className="relative flex items-center gap-1">
          <button
            onClick={() => slicerScrollRef.current?.scrollBy({ left: -200, behavior: 'smooth' })}
            className="shrink-0 w-6 h-6 flex items-center justify-center border border-[#e2e8f0] bg-white hover:bg-[#eff6ff] hover:border-[#185baf] text-[#64748b] hover:text-[#185baf] transition-all rounded-full shadow-sm"
          >
            <ChevronLeft className="w-3.5 h-3.5" />
          </button>
          <div ref={slicerScrollRef} className="flex gap-1.5 overflow-x-auto pb-0.5 flex-1" style={{ scrollbarWidth: 'none' }}>
            <button
              onClick={() => setSelectedSchool(null)}
              className={`shrink-0 px-3 py-1 text-[10px] font-bold uppercase tracking-wide rounded-full border transition-all ${
                !selectedSchool ? 'bg-[#185baf] text-white border-[#185baf] shadow-sm' : 'bg-[#f8fafc] text-[#64748b] border-[#e2e8f0] hover:border-[#185baf] hover:text-[#185baf]'
              }`}>
              All Schools
            </button>
            {allSchools.map((school, i) => (
              <button
                key={school}
                onClick={() => setSelectedSchool(s => s === school ? null : school)}
                className={`shrink-0 px-3 py-1 text-[10px] font-bold uppercase tracking-wide rounded-full border transition-all whitespace-nowrap ${
                  selectedSchool === school
                    ? 'text-white border-transparent shadow-sm'
                    : 'bg-[#f8fafc] text-[#64748b] border-[#e2e8f0] hover:border-[#185baf] hover:text-[#185baf]'
                }`}
                style={selectedSchool === school ? { background: SCHOOL_COLORS[i % SCHOOL_COLORS.length], borderColor: SCHOOL_COLORS[i % SCHOOL_COLORS.length] } : {}}>
                {school}
              </button>
            ))}
          </div>
          <button
            onClick={() => slicerScrollRef.current?.scrollBy({ left: 200, behavior: 'smooth' })}
            className="shrink-0 w-6 h-6 flex items-center justify-center border border-[#e2e8f0] bg-white hover:bg-[#eff6ff] hover:border-[#185baf] text-[#64748b] hover:text-[#185baf] transition-all rounded-full shadow-sm"
          >
            <ChevronRight className="w-3.5 h-3.5" />
          </button>
        </div>
      </div>

      {/* ── Stat Cards ───────────────────────────────────────────────────────── */}
      <div className="flex flex-wrap gap-3 mb-4">
        {statCards.map((stat) => (
          <div key={stat.title}
            className="relative flex min-w-[160px] flex-1 overflow-hidden hover:shadow-lg hover:-translate-y-0.5 transition-all duration-200 cursor-default"
            style={{ background: stat.grad, boxShadow: '0 2px 10px rgba(0,0,0,0.18)' }}>
            <div className="absolute inset-0 pointer-events-none" style={{ background: 'radial-gradient(ellipse at 80% 20%, rgba(255,255,255,0.18) 0%, transparent 65%)' }} />
            <div className="relative flex w-full p-3.5 gap-3 items-center">
              <div className="w-11 h-11 flex items-center justify-center shrink-0 rounded-sm" style={{ background: 'rgba(255,255,255,0.2)' }}>
                <stat.icon className="w-5 h-5 text-white" />
              </div>
              <div className="flex flex-col justify-center min-w-0">
                <span className="text-[10px] font-bold tracking-widest uppercase text-white/80">{stat.title}</span>
                <div className="flex items-baseline gap-1.5 mt-0.5">
                  <span className="text-[26px] font-black leading-none text-white">{stat.value}</span>
                  <span className="text-[10px] text-white/70">{stat.sub}</span>
                </div>
              </div>
            </div>
          </div>
        ))}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-3">

        {/* ── Left column ─────────────────────────────────────────────────── */}
        <div className="lg:col-span-2 flex flex-col gap-3">

          {/* Sessions Per Day */}
          <div className="bg-white border border-[#e2e8f0] shadow-sm p-4 flex flex-col hover:shadow-md transition-shadow">
            <div className="flex justify-between items-center mb-3 pb-2 border-b border-[#f1f5f9]">
              <div>
                <h4 className="text-[12px] font-black text-[#0f172a] tracking-tight">
                  Sessions Per Day
                  {selectedSchool && <span className="ml-2 text-[#185baf] font-medium text-[11px]">— {selectedSchool}</span>}
                </h4>
                <p className="text-[9px] text-[#94a3b8] uppercase tracking-widest font-bold mt-0.5">Daily distribution</p>
              </div>
              <div className="flex items-center gap-1.5 bg-[#eff6ff] border border-[#bfdbfe] px-2 py-0.5">
                <div className="w-2 h-2 rounded-full bg-[#185baf]" />
                <span className="text-[9px] font-bold text-[#185baf] uppercase tracking-widest">Sessions</span>
              </div>
            </div>
            <div className="h-[200px] w-full">
              <ResponsiveContainer width="100%" height="100%">
                <AreaChart data={dailyData} margin={{ top: 22, right: 20, left: -20, bottom: 0 }}>
                  <defs>
                    <linearGradient id="sessionsGrad" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%" stopColor="#185baf" stopOpacity={0.55} />
                      <stop offset="95%" stopColor="#185baf" stopOpacity={0.05} />
                    </linearGradient>
                  </defs>
                  <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#f1f5f9" />
                  <XAxis dataKey="name" axisLine={false} tickLine={false} tick={{ fontSize: 11, fill: '#94a3b8', fontWeight: 600 }} dy={8} />
                  <YAxis axisLine={false} tickLine={false} tick={{ fontSize: 10, fill: '#cbd5e1' }} />
                  <Tooltip contentStyle={{ fontSize: '11px', fontWeight: 'bold', padding: '6px 10px', border: '1px solid #e2e8f0', boxShadow: '0 4px 12px rgba(0,0,0,0.1)' }} formatter={(v: any) => [v, 'Sessions']} />
                  <Area type="monotone" dataKey="sessions" stroke="#185baf" strokeWidth={2.5} fill="url(#sessionsGrad)" dot={{ r: 4, fill: '#185baf', strokeWidth: 0 }} activeDot={{ r: 6, fill: '#6366f1' }}>
                    <LabelList dataKey="sessions" position="top" style={{ fontSize: 10, fontWeight: 800, fill: '#185baf' }} formatter={(v: number) => v > 0 ? v : ''} />
                  </Area>
                </AreaChart>
              </ResponsiveContainer>
            </div>
          </div>

          {/* School-wise Sessions */}
          <div className="bg-white border border-[#e2e8f0] shadow-sm p-4 flex flex-col hover:shadow-md transition-shadow">
            <div className="flex justify-between items-center mb-3 pb-2 border-b border-[#f1f5f9]">
              <div>
                <h4 className="text-[12px] font-black text-[#0f172a] tracking-tight">School-wise Sessions</h4>
                <p className="text-[9px] text-[#94a3b8] uppercase tracking-widest font-bold mt-0.5">
                  {selectedSchool ? `Highlighted: ${selectedSchool}` : 'All departments'}
                </p>
              </div>
            </div>
            <div className="h-[240px] w-full">
              {schoolData.length > 0 ? (
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={schoolData} layout="vertical" margin={{ top: 0, right: 55, left: 8, bottom: 0 }}>
                    <CartesianGrid strokeDasharray="3 3" horizontal={false} vertical={true} stroke="#f1f5f9" />
                    <XAxis type="number" axisLine={false} tickLine={false} tick={{ fontSize: 9, fill: '#94a3b8' }} />
                    <YAxis dataKey="name" type="category" axisLine={false} tickLine={false} tick={{ fontSize: 10, fill: '#334155', fontWeight: 'bold' }} width={160} />
                    <Tooltip cursor={{ fill: '#f8fafc' }} contentStyle={{ fontSize: '11px', fontWeight: 'bold', padding: '6px 10px', border: '1px solid #e2e8f0', boxShadow: '0 4px 12px rgba(0,0,0,0.1)' }} formatter={(v: any) => [v, 'Sessions']} />
                    <Bar dataKey="sessions" barSize={14} radius={[0, 6, 6, 0]}>
                      {schoolData.map((entry, i) => (
                        <Cell key={i} fill={SCHOOL_COLORS[i % SCHOOL_COLORS.length]} fillOpacity={!selectedSchool || entry.fullName === selectedSchool ? 1 : 0.15} />
                      ))}
                      <LabelList dataKey="sessions" position="right" style={{ fontSize: 10, fontWeight: 800, fill: '#334155' }} />
                    </Bar>
                  </BarChart>
                </ResponsiveContainer>
              ) : (
                <div className="h-full flex flex-col items-center justify-center gap-2">
                  <Database className="w-8 h-8 text-[#e2e8f0]" />
                  <p className="text-[10px] font-bold text-[#94a3b8] uppercase tracking-wider">No school data — schedule sessions to see breakdown</p>
                </div>
              )}
            </div>
          </div>

          {/* Sessions by Weekday */}
          <div className="bg-white border border-[#e2e8f0] shadow-sm p-4 flex flex-col hover:shadow-md transition-shadow">
            <div className="flex justify-between items-center mb-3 pb-2 border-b border-[#f1f5f9]">
              <div>
                <h4 className="text-[12px] font-black text-[#0f172a] tracking-tight">
                  Avg Load by Weekday
                  {selectedSchool && <span className="ml-2 text-[#185baf] font-medium text-[11px]">— {selectedSchool}</span>}
                </h4>
                <p className="text-[9px] text-[#94a3b8] uppercase tracking-widest font-bold mt-0.5">
                  {selectedSchool ? 'Avg hrs per faculty · school view' : 'Avg hrs per faculty · all schools'}
                </p>
              </div>
            </div>
            <div className="h-[180px] w-full">
              {schoolDayData.some(d => d._total > 0) ? (
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={schoolDayData} margin={{ top: 20, right: 20, left: -20, bottom: 0 }}>
                    <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#f1f5f9" />
                    <XAxis dataKey="name" axisLine={false} tickLine={false} tick={{ fontSize: 11, fill: '#94a3b8', fontWeight: 600 }} dy={6} />
                    <YAxis axisLine={false} tickLine={false} tick={{ fontSize: 10, fill: '#cbd5e1' }} />
                    <Tooltip contentStyle={{ fontSize: '11px', fontWeight: 'bold', padding: '6px 10px', border: '1px solid #e2e8f0', boxShadow: '0 4px 12px rgba(0,0,0,0.1)' }} formatter={(v: any) => [`${v}h`, 'Avg load / faculty']} />
                    <Bar dataKey="_avgLoad" barSize={36} radius={[4, 4, 0, 0]}>
                      {schoolDayData.map((_, i) => (
                        <Cell key={i} fill={SCHOOL_COLORS[i % SCHOOL_COLORS.length]} />
                      ))}
                      <LabelList dataKey="_avgLoad" position="top" style={{ fontSize: 10, fontWeight: 800, fill: '#475569' }} formatter={(v: number) => v > 0 ? `${v}h` : ''} />
                    </Bar>
                  </BarChart>
                </ResponsiveContainer>
              ) : (
                <div className="h-full flex flex-col items-center justify-center gap-2">
                  <Calendar className="w-8 h-8 text-[#e2e8f0]" />
                  <p className="text-[10px] font-bold text-[#94a3b8] uppercase tracking-wider">No session data for selected filters</p>
                </div>
              )}
            </div>
          </div>
        </div>

        {/* ── Right column ─────────────────────────────────────────────────── */}
        <div className="flex flex-col gap-3">

          {/* System Resources */}
          <div className="bg-white border border-[#e2e8f0] shadow-sm overflow-hidden">
            <div className="px-4 py-2.5 border-b border-[#f1f5f9] flex items-center gap-2" style={{ background: 'linear-gradient(135deg, #f8fafc, #eff6ff)' }}>
              <Database className="w-3.5 h-3.5 text-[#185baf]" />
              <h4 className="text-[11px] font-black text-[#0f172a] tracking-tight uppercase">
                {selectedSchool ? 'School Snapshot' : 'System Resources'}
              </h4>
            </div>
            <div className="divide-y divide-[#f1f5f9]">
              {resourceRows.map(item => (
                <div key={item.label} className="px-4 py-3 flex justify-between items-center hover:bg-[#fafbff] transition-colors">
                  <div>
                    <div className="text-[10px] font-bold text-[#64748b] uppercase tracking-widest">{item.label}</div>
                    <div className="text-[22px] font-black leading-tight" style={{ color: '#0f172a' }}>{item.value}</div>
                  </div>
                  <span className="text-[9px] font-black uppercase tracking-widest px-2 py-1 border"
                    style={{ color: item.color, background: item.bg, borderColor: item.border }}>
                    {item.badge}
                  </span>
                </div>
              ))}
            </div>
          </div>

          {/* Top Faculty Workloads */}
          <div className="bg-white border border-[#e2e8f0] shadow-sm overflow-hidden flex-1 flex flex-col">
            <div className="px-4 py-2.5 border-b border-[#f1f5f9] flex items-center gap-2" style={{ background: 'linear-gradient(135deg, #f8fafc, #eff6ff)' }}>
              <Clock className="w-3.5 h-3.5 text-[#185baf]" />
              <h4 className="text-[11px] font-black text-[#0f172a] tracking-tight uppercase">
                Top Faculty Workloads
                {selectedSchool && <span className="ml-1 text-[#185baf] normal-case font-medium text-[10px]">({selectedSchool})</span>}
              </h4>
            </div>
            <div className="flex-1 w-full min-h-[160px] p-4">
              {facultyData.length > 0 ? (
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={facultyData} layout="vertical" margin={{ top: 0, right: 45, left: -20, bottom: 0 }}>
                    <CartesianGrid strokeDasharray="3 3" horizontal={false} vertical={true} stroke="#f1f5f9" />
                    <XAxis type="number" axisLine={false} tickLine={false} tick={{ fontSize: 9, fill: '#94a3b8' }} />
                    <YAxis dataKey="name" type="category" axisLine={false} tickLine={false} tick={{ fontSize: 10, fill: '#334155', fontWeight: 'bold' }} />
                    <Tooltip cursor={{ fill: '#f8fafc' }} contentStyle={{ fontSize: '10px', fontWeight: 'bold', padding: '4px 8px', border: '1px solid #e2e8f0', boxShadow: '0 4px 12px rgba(0,0,0,0.1)' }} formatter={(v: any, _: any, props: any) => [`${v}h — ${props?.payload?.fullName || ''}`, 'Load']} />
                    <Bar dataKey="load" fill="#185baf" barSize={14} radius={[0, 6, 6, 0]}>
                      <LabelList dataKey="load" position="right" style={{ fontSize: 10, fontWeight: 800, fill: '#185baf' }} formatter={(v: number) => `${v}h`} />
                    </Bar>
                  </BarChart>
                </ResponsiveContainer>
              ) : (
                <div className="h-full flex flex-col items-center justify-center gap-2">
                  <Clock className="w-8 h-8 text-[#e2e8f0]" />
                  <p className="text-[10px] font-bold text-[#94a3b8] uppercase tracking-wider text-center">
                    {selectedSchool ? `No sessions for ${selectedSchool}` : 'No load data available'}
                  </p>
                </div>
              )}
            </div>
          </div>

        </div>
      </div>

      {/* ── Session Intensity Heatmap ────────────────────────────────────────── */}
      <div className="mt-3 bg-white border border-[#e2e8f0] shadow-sm p-4 hover:shadow-md transition-shadow">
        <div className="flex flex-wrap justify-between items-center mb-3 pb-2 border-b border-[#f1f5f9] gap-2">
          <div>
            <h4 className="text-[12px] font-black text-[#0f172a] tracking-tight">
              Session Intensity Heatmap
              {selectedSchool && <span className="ml-2 text-[#185baf] font-medium text-[11px]">— {selectedSchool}</span>}
            </h4>
            <p className="text-[9px] text-[#94a3b8] uppercase tracking-widest font-bold mt-0.5">Sessions per day × hour · darker = busier</p>
          </div>
          <div className="flex items-center gap-1.5">
            <span className="text-[9px] font-bold text-[#94a3b8] uppercase tracking-widest">Low</span>
            {[0.12, 0.32, 0.52, 0.72, 0.92].map(t => (
              <div key={t} className="w-5 h-4 rounded-sm" style={{ background: heatColor(t, 1) }} />
            ))}
            <span className="text-[9px] font-bold text-[#94a3b8] uppercase tracking-widest">High</span>
          </div>
        </div>

        {heatmapData.maxVal === 0 ? (
          <div className="h-24 flex flex-col items-center justify-center gap-2">
            <Calendar className="w-8 h-8 text-[#e2e8f0]" />
            <p className="text-[10px] font-bold text-[#94a3b8] uppercase tracking-wider">No session data for selected filters</p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <div className="min-w-[520px]">
              {/* Hour labels */}
              <div className="flex items-center mb-1.5" style={{ paddingLeft: '72px' }}>
                {heatmapData.hours.map(h => (
                  <div key={h} className="flex-1 text-center text-[9px] font-bold text-[#94a3b8] uppercase tracking-wide">
                    {h < 12 ? `${h}a` : h === 12 ? '12p' : `${h - 12}p`}
                  </div>
                ))}
              </div>
              {/* Day rows */}
              {heatmapData.days.map(day => (
                <div key={day} className="flex items-center gap-1 mb-1">
                  <div className="w-[68px] shrink-0 text-[10px] font-bold text-[#475569]">{day.slice(0, 3)}</div>
                  {heatmapData.hours.map(h => {
                    const val = heatmapData.grid[day][h];
                    return (
                      <div
                        key={h}
                        className="flex-1 h-9 flex items-center justify-center text-[11px] font-black rounded-sm transition-all hover:ring-2 hover:ring-[#185baf] hover:ring-offset-1 cursor-default"
                        style={{ background: heatColor(val, heatmapData.maxVal), color: heatTextColor(val, heatmapData.maxVal) }}
                        title={`${day} ${h}:00 — ${val} session${val !== 1 ? 's' : ''}`}
                      >
                        {val > 0 ? val : ''}
                      </div>
                    );
                  })}
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
};

export default Dashboard;
