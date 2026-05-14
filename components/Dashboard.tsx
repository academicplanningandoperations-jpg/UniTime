import React, { useMemo, useState, useEffect, useRef } from 'react';
import { MapPin, AlertTriangle, Clock, BookOpen, Database, Calendar, Filter, X, ChevronLeft, ChevronRight } from 'lucide-react';
import {
  LineChart, Line, BarChart, Bar, Tooltip, XAxis, YAxis, CartesianGrid,
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

const Dashboard: React.FC<DashboardProps> = ({ courses, rooms, groups, schedule, clashes, activeTerm, faculties }) => {

  const [selectedSchool, setSelectedSchool] = useState<string | null>(null);
  const slicerScrollRef = useRef<HTMLDivElement>(null);

  // Reset slicer when active term changes
  useEffect(() => { setSelectedSchool(null); }, [activeTerm?.id]);

  // Term-filtered schedule (base)
  const effectiveSchedule = useMemo(() => {
    return activeTerm ? schedule.filter(s => s.termId === activeTerm.id) : schedule;
  }, [schedule, activeTerm]);

  // All schools that appear in the effective schedule
  const allSchools = useMemo(() => {
    if (!faculties) return [];
    const set = new Set<string>();
    effectiveSchedule.forEach(s => {
      const f = faculties.find(f => f.id === s.facultyId);
      const dept = (f as any)?._deptName || f?.department;
      if (dept) set.add(dept);
    });
    return Array.from(set).sort();
  }, [effectiveSchedule, faculties]);

  // School-sliced schedule (what everything else reacts to)
  const slicedSchedule = useMemo(() => {
    if (!selectedSchool) return effectiveSchedule;
    return effectiveSchedule.filter(s => {
      const f = faculties?.find(f => f.id === s.facultyId);
      const dept = (f as any)?._deptName || f?.department || 'General';
      return dept === selectedSchool;
    });
  }, [effectiveSchedule, selectedSchool, faculties]);

  // Derived ID sets for filtered stat counts
  const slicedCourseIds = useMemo(() => new Set(slicedSchedule.map(s => s.courseId)), [slicedSchedule]);
  const slicedRoomIds   = useMemo(() => new Set(slicedSchedule.map(s => s.roomId)),   [slicedSchedule]);
  const slicedFacultyIds = useMemo(() => new Set(slicedSchedule.map(s => s.facultyId)), [slicedSchedule]);

  const totalHours = useMemo(() => {
    return slicedSchedule.reduce((acc, curr) => acc + DataService.getDuration(curr.startTime, curr.endTime), 0);
  }, [slicedSchedule]);

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

  // School chart always shows ALL schools (for comparison); dims non-selected
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
      schoolsToShow.forEach(school => {
        const count = effectiveSchedule.filter(s => {
          const f = faculties?.find(f => f.id === s.facultyId);
          const dept = (f as any)?._deptName || f?.department || 'General';
          return dept === school && s.day === day;
        }).length;
        entry[school] = count;
        total += count;
      });
      entry._total = total;
      return entry;
    });
  }, [effectiveSchedule, faculties, allSchools, selectedSchool]);

  const statCards = [
    { icon: BookOpen, title: 'COURSES',  value: selectedSchool ? slicedCourseIds.size : courses.length,    sub: 'Modules',   color: '#6366f1', grad: 'linear-gradient(135deg,#4338ca,#6366f1)', bg: '#eef2ff' },
    { icon: MapPin,   title: 'ROOMS',    value: selectedSchool ? slicedRoomIds.size   : rooms.length,      sub: 'Venues',    color: '#0891b2', grad: 'linear-gradient(135deg,#0e7490,#06b6d4)', bg: '#ecfeff' },
    { icon: Calendar, title: 'ENTRIES',  value: slicedSchedule.length,                                     sub: 'Timetable', color: '#059669', grad: 'linear-gradient(135deg,#047857,#10b981)', bg: '#ecfdf5' },
    { icon: Clock,    title: 'LOAD',     value: `${Math.round(totalHours)}h`,                              sub: 'Weekly',    color: '#d97706', grad: 'linear-gradient(135deg,#b45309,#f59e0b)', bg: '#fffbeb' },
    { icon: AlertTriangle, title: 'CLASHES', value: clashes.length,                                        sub: 'Conflicts', color: '#e11d48', grad: 'linear-gradient(135deg,#be123c,#e11d48)', bg: '#fff1f2' },
  ];

  const resourceRows = [
    { label: 'Schedule Entries', value: slicedSchedule.length,                                            badge: 'Optimal', bc: '#2e7d32', bb: '#eafbef', bbr: '#a5d6a7' },
    { label: 'Active Courses',   value: selectedSchool ? slicedCourseIds.size : courses.length,           badge: 'Loaded',  bc: '#185baf', bb: '#e8f2fc', bbr: '#b2d1f7' },
    { label: 'Faculty Count',    value: selectedSchool ? slicedFacultyIds.size : (faculties?.length ?? 0), badge: 'Synced',  bc: '#7c3aed', bb: '#f5f3ff', bbr: '#c4b5fd' },
    { label: 'Rooms Active',     value: selectedSchool ? slicedRoomIds.size   : rooms.length,             badge: 'Ready',   bc: '#0891b2', bb: '#ecfeff', bbr: '#a5f3fc' },
  ];

  return (
    <div className="p-4 max-w-[1400px] mx-auto min-h-screen font-sans">

      {/* Header */}
      <header className="p-4 mb-4 text-white flex justify-between items-center"
        style={{ background: 'linear-gradient(135deg, #0f172a 0%, #1e3a5f 40%, #185baf 100%)' }}>
        <div>
          <h2 className="text-[18px] font-black tracking-wide uppercase">System Overview</h2>
          <p className="text-[11px] font-bold text-blue-200 uppercase tracking-wide mt-0.5">
            Active Term: <span className="text-white">{activeTerm?.name || 'All Terms'}</span>
            {selectedSchool && (
              <span className="ml-3 text-yellow-300">— {selectedSchool}</span>
            )}
          </p>
        </div>
        <div className="flex items-center gap-3">
          <div className="flex items-center gap-2">
            <div className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse" />
            <span className="text-[9px] font-bold uppercase tracking-widest text-emerald-300">System Operational</span>
          </div>
          <button className="px-5 py-1.5 bg-white/10 backdrop-blur-sm text-white text-[11px] font-bold border border-white/20 uppercase tracking-wide hover:bg-white/20 transition-colors">
            SYSTEM ONLINE
          </button>
        </div>
      </header>

      {/* School Slicer */}
      {allSchools.length > 0 && (
        <div className="mb-4 bg-[#f8faff] border border-[#d0e4f8] p-3">
          <div className="flex items-center gap-2 mb-2">
            <Filter className="w-3.5 h-3.5 text-[#5a7ba8]" />
            <span className="text-[10px] font-bold text-[#5a7ba8] uppercase tracking-widest">Filter by School</span>
            {selectedSchool && (
              <button
                onClick={() => setSelectedSchool(null)}
                className="ml-auto flex items-center gap-1 text-[9px] font-bold text-[#e11d48] uppercase tracking-wide hover:underline">
                <X className="w-3 h-3" /> Clear Filter
              </button>
            )}
          </div>
          <div className="relative flex items-center gap-1">
            <button
              onClick={() => slicerScrollRef.current?.scrollBy({ left: -200, behavior: 'smooth' })}
              className="shrink-0 w-6 h-6 flex items-center justify-center border border-[#ccc] bg-white hover:bg-[#f0f5ff] hover:border-[#185baf] text-[#555] hover:text-[#185baf] transition-all rounded-full"
            >
              <ChevronLeft className="w-3.5 h-3.5" />
            </button>
            <div ref={slicerScrollRef} className="flex gap-2 overflow-x-auto pb-1 flex-1" style={{ scrollbarWidth: 'none' }}>
              <button
                onClick={() => setSelectedSchool(null)}
                className={`shrink-0 px-3 py-1 text-[10px] font-bold uppercase tracking-wide rounded-full border transition-all ${
                  !selectedSchool
                    ? 'bg-[#185baf] text-white border-[#185baf] shadow'
                    : 'bg-white text-[#555] border-[#ccc] hover:border-[#185baf] hover:text-[#185baf]'
                }`}>
                All Schools
              </button>
              {allSchools.map(school => (
                <button
                  key={school}
                  onClick={() => setSelectedSchool(s => s === school ? null : school)}
                  className={`shrink-0 px-3 py-1 text-[10px] font-bold uppercase tracking-wide rounded-full border transition-all whitespace-nowrap ${
                    selectedSchool === school
                      ? 'bg-[#185baf] text-white border-[#185baf] shadow'
                      : 'bg-white text-[#555] border-[#ccc] hover:border-[#185baf] hover:text-[#185baf]'
                  }`}>
                  {school}
                </button>
              ))}
            </div>
            <button
              onClick={() => slicerScrollRef.current?.scrollBy({ left: 200, behavior: 'smooth' })}
              className="shrink-0 w-6 h-6 flex items-center justify-center border border-[#ccc] bg-white hover:bg-[#f0f5ff] hover:border-[#185baf] text-[#555] hover:text-[#185baf] transition-all rounded-full"
            >
              <ChevronRight className="w-3.5 h-3.5" />
            </button>
          </div>
        </div>
      )}

      {/* Stat Boxes */}
      <div className="flex flex-wrap gap-2 mb-4">
        {statCards.map((stat) => (
          <div key={stat.title} className="flex min-w-[150px] flex-1 border overflow-hidden hover:shadow-md transition-shadow"
            style={{ borderColor: `${stat.color}30`, background: stat.bg }}>
            <div className="w-12 flex items-center justify-center shrink-0" style={{ background: stat.grad }}>
              <stat.icon className="w-5 h-5 text-white" />
            </div>
            <div className="p-2 pl-3 flex flex-col justify-center">
              <span className="text-[10px] font-bold tracking-wide" style={{ color: stat.color }}>{stat.title}</span>
              <div className="flex items-baseline gap-1 mt-0.5">
                <span className="text-[15px] font-bold text-[#333]">{stat.value}</span>
                <span className="text-[10px] text-[#777]">{stat.sub}</span>
              </div>
            </div>
          </div>
        ))}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-3">

        {/* Left column */}
        <div className="lg:col-span-2 flex flex-col gap-3">

          {/* Sessions Per Day */}
          <div className="bg-white border border-[#ccc] p-3 flex flex-col">
            <div className="flex justify-between items-center mb-3 border-b border-[#eee] pb-2">
              <h4 className="text-[12px] font-bold text-[#333] tracking-wide uppercase">
                Sessions Per Day
                {selectedSchool && <span className="ml-2 text-[#185baf] normal-case font-medium text-[11px]">— {selectedSchool}</span>}
              </h4>
              <div className="flex items-center gap-1.5">
                <div className="w-2 h-2 bg-[#185baf]" />
                <span className="text-[10px] font-bold text-[#555]">SESSION COUNT</span>
              </div>
            </div>
            <div className="h-[220px] w-full">
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={dailyData} margin={{ top: 22, right: 20, left: -20, bottom: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#eee" />
                  <XAxis dataKey="name" axisLine={{ stroke: '#999' }} tickLine={false} tick={{ fontSize: 11, fill: '#666' }} dy={10} />
                  <YAxis axisLine={{ stroke: '#999' }} tickLine={false} tick={{ fontSize: 11, fill: '#666' }} />
                  <Tooltip
                    contentStyle={{ fontSize: '11px', fontWeight: 'bold', padding: '6px 10px' }}
                    formatter={(v: any) => [v, 'Sessions']}
                  />
                  <Line type="monotone" dataKey="sessions" stroke="#185baf" strokeWidth={2}
                    dot={{ r: 4, fill: '#185baf', strokeWidth: 0 }} activeDot={{ r: 6 }}>
                    <LabelList dataKey="sessions" position="top"
                      style={{ fontSize: 10, fontWeight: 'bold', fill: '#185baf' }}
                      formatter={(v: number) => v > 0 ? v : ''} />
                  </Line>
                </LineChart>
              </ResponsiveContainer>
            </div>
          </div>

          {/* School-wise Sessions — always shows all schools, highlights selected */}
          <div className="bg-white border border-[#ccc] p-3 flex flex-col">
            <div className="flex justify-between items-center mb-3 border-b border-[#eee] pb-2">
              <h4 className="text-[12px] font-bold text-[#333] tracking-wide uppercase">School-wise Sessions</h4>
              <span className="text-[10px] font-bold text-[#888] uppercase">
                {selectedSchool ? `Highlighted: ${selectedSchool}` : 'All Departments'}
              </span>
            </div>
            <div className="h-[260px] w-full">
              {schoolData.length > 0 ? (
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={schoolData} layout="vertical" margin={{ top: 0, right: 55, left: 8, bottom: 0 }}>
                    <CartesianGrid strokeDasharray="3 3" horizontal={false} vertical={true} stroke="#f0f0f0" />
                    <XAxis type="number" axisLine={{ stroke: '#ccc' }} tickLine={false} tick={{ fontSize: 9, fill: '#888' }} />
                    <YAxis dataKey="name" type="category" axisLine={false} tickLine={false}
                      tick={{ fontSize: 10, fill: '#333', fontWeight: 'bold' }} width={160} />
                    <Tooltip
                      cursor={{ fill: '#f5f5f5' }}
                      contentStyle={{ fontSize: '11px', fontWeight: 'bold', padding: '6px 10px' }}
                      formatter={(v: any) => [v, 'Sessions']}
                    />
                    <Bar dataKey="sessions" barSize={16} radius={[0, 4, 4, 0]}>
                      {schoolData.map((entry, i) => (
                        <Cell
                          key={i}
                          fill={SCHOOL_COLORS[i % SCHOOL_COLORS.length]}
                          fillOpacity={!selectedSchool || entry.fullName === selectedSchool ? 1 : 0.2}
                        />
                      ))}
                      <LabelList dataKey="sessions" position="right"
                        style={{ fontSize: 10, fontWeight: 'bold', fill: '#333' }} />
                    </Bar>
                  </BarChart>
                </ResponsiveContainer>
              ) : (
                <div className="h-full flex items-center justify-center text-[10px] font-bold text-[#999] uppercase tracking-wider">
                  No school data available — schedule sessions to see breakdown.
                </div>
              )}
            </div>
          </div>

          {/* Sessions by Weekday — school-synced */}
          <div className="bg-white border border-[#ccc] p-3 flex flex-col">
            <div className="flex justify-between items-center mb-3 border-b border-[#eee] pb-2">
              <h4 className="text-[12px] font-bold text-[#333] tracking-wide uppercase">
                Sessions by Weekday
                {selectedSchool && <span className="ml-2 text-[#185baf] normal-case font-medium text-[11px]">— {selectedSchool}</span>}
              </h4>
              <span className="text-[10px] font-bold text-[#888] uppercase">
                {selectedSchool ? 'School View' : 'All Schools Combined'}
              </span>
            </div>
            <div className="h-[200px] w-full">
              {schoolDayData.some(d => d._total > 0) ? (
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={schoolDayData} margin={{ top: 20, right: 20, left: -20, bottom: 0 }}>
                    <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#eee" />
                    <XAxis dataKey="name" axisLine={{ stroke: '#999' }} tickLine={false} tick={{ fontSize: 11, fill: '#666' }} dy={6} />
                    <YAxis axisLine={{ stroke: '#999' }} tickLine={false} tick={{ fontSize: 10, fill: '#888' }} />
                    <Tooltip
                      contentStyle={{ fontSize: '11px', fontWeight: 'bold', padding: '6px 10px' }}
                      formatter={(v: any) => [v, 'Sessions']}
                    />
                    <Bar dataKey="_total" barSize={32} radius={[3, 3, 0, 0]}>
                      {schoolDayData.map((entry, i) => (
                        <Cell key={i} fill={SCHOOL_COLORS[i % SCHOOL_COLORS.length]} />
                      ))}
                      <LabelList dataKey="_total" position="top"
                        style={{ fontSize: 10, fontWeight: 'bold', fill: '#555' }}
                        formatter={(v: number) => v > 0 ? v : ''} />
                    </Bar>
                  </BarChart>
                </ResponsiveContainer>
              ) : (
                <div className="h-full flex items-center justify-center text-[10px] font-bold text-[#999] uppercase tracking-wider">
                  No session data for selected filters.
                </div>
              )}
            </div>
          </div>
        </div>

        {/* Right column */}
        <div className="flex flex-col gap-3">

          {/* System Resources */}
          <div className="bg-[#f8f9fa] border border-[#ccc] p-3">
            <div className="flex items-center gap-2 mb-3 border-b border-[#ddd] pb-2">
              <Database className="w-4 h-4 text-[#555]" />
              <h4 className="text-[12px] font-bold text-[#333] tracking-wide uppercase">
                {selectedSchool ? 'School Snapshot' : 'System Resources'}
              </h4>
            </div>
            <div className="space-y-2">
              {resourceRows.map(item => (
                <div key={item.label} className="bg-white border border-[#ccc] p-2.5 flex justify-between items-center">
                  <div>
                    <div className="text-[10px] font-bold text-[#666] tracking-wider uppercase">{item.label}</div>
                    <div className="text-[16px] font-bold text-[#333] leading-tight">{item.value}</div>
                  </div>
                  <span className="text-[9px] font-bold border px-1.5 py-0.5 uppercase"
                    style={{ color: item.bc, background: item.bb, borderColor: item.bbr }}>
                    {item.badge}
                  </span>
                </div>
              ))}
            </div>
          </div>

          {/* Top Faculty Workloads */}
          <div className="bg-[#f8f9fa] border border-[#ccc] p-3 flex-1 flex flex-col">
            <h4 className="text-[12px] font-bold text-[#333] tracking-wide uppercase mb-3 border-b border-[#ddd] pb-2">
              Top Faculty Workloads
              {selectedSchool && <span className="ml-1 text-[#185baf] normal-case font-medium text-[10px]">({selectedSchool})</span>}
            </h4>
            <div className="flex-1 w-full min-h-[160px]">
              {facultyData.length > 0 ? (
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={facultyData} layout="vertical" margin={{ top: 0, right: 45, left: -20, bottom: 0 }}>
                    <CartesianGrid strokeDasharray="3 3" horizontal={false} vertical={true} stroke="#eee" />
                    <XAxis type="number" axisLine={{ stroke: '#ccc' }} tickLine={false} tick={{ fontSize: 9, fill: '#888' }} />
                    <YAxis dataKey="name" type="category" axisLine={false} tickLine={false}
                      tick={{ fontSize: 10, fill: '#333', fontWeight: 'bold' }} />
                    <Tooltip
                      cursor={{ fill: '#f0f0f0' }}
                      contentStyle={{ fontSize: '10px', fontWeight: 'bold', padding: '4px 8px' }}
                      formatter={(v: any, _: any, props: any) => [`${v}h — ${props?.payload?.fullName || ''}`, 'Load']}
                    />
                    <Bar dataKey="load" fill="#185baf" barSize={14} radius={[0, 4, 4, 0]}>
                      <LabelList dataKey="load" position="right"
                        style={{ fontSize: 10, fontWeight: 'bold', fill: '#185baf' }}
                        formatter={(v: number) => `${v}h`} />
                    </Bar>
                  </BarChart>
                </ResponsiveContainer>
              ) : (
                <div className="h-full flex items-center justify-center text-[10px] font-bold text-[#999] uppercase tracking-wider">
                  {selectedSchool ? `No sessions for ${selectedSchool}.` : 'No load data available.'}
                </div>
              )}
            </div>
          </div>

        </div>
      </div>
    </div>
  );
};

export default Dashboard;
