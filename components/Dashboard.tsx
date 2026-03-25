import React, { useMemo } from 'react';
import { 
  Users, MapPin, AlertTriangle, Clock, BookOpen, Database, Zap, FileText
} from 'lucide-react';
import { 
  LineChart, Line, BarChart, Bar, Tooltip, XAxis, YAxis, CartesianGrid, ResponsiveContainer
} from 'recharts';
import { Course, Room, StudentGroup, ScheduleEntry, Clash, Term, Faculty } from '../types';

interface DashboardProps {
  courses: Course[];
  rooms: Room[];
  groups: StudentGroup[];
  schedule: ScheduleEntry[];
  clashes: Clash[];
  activeTerm?: Term;
  faculties?: Faculty[];
}

const Dashboard: React.FC<DashboardProps> = ({ courses, rooms, groups, schedule, clashes, activeTerm, faculties }) => {
  
  const effectiveSchedule = useMemo(() => {
    return activeTerm 
      ? schedule.filter(s => s.termId === activeTerm.id)
      : schedule;
  }, [schedule, activeTerm]);

  const totalHours = effectiveSchedule.reduce((acc, curr) => acc + (curr.duration || 0), 0);

  const data = [
    { name: 'Mon', hours: effectiveSchedule.filter(s => s.day === 'Monday').reduce((a, c) => a + (c.duration || 0), 0) },
    { name: 'Tue', hours: effectiveSchedule.filter(s => s.day === 'Tuesday').reduce((a, c) => a + (c.duration || 0), 0) },
    { name: 'Wed', hours: effectiveSchedule.filter(s => s.day === 'Wednesday').reduce((a, c) => a + (c.duration || 0), 0) },
    { name: 'Thu', hours: effectiveSchedule.filter(s => s.day === 'Thursday').reduce((a, c) => a + (c.duration || 0), 0) },
    { name: 'Fri', hours: effectiveSchedule.filter(s => s.day === 'Friday').reduce((a, c) => a + (c.duration || 0), 0) },
    { name: 'Sat', hours: effectiveSchedule.filter(s => s.day === 'Saturday').reduce((a, c) => a + (c.duration || 0), 0) },
  ];

  const facultyData = useMemo(() => {
    if (!faculties) return [];
    return faculties.map(f => {
      const load = effectiveSchedule.filter(s => s.facultyId === f.id).reduce((acc, curr) => acc + (curr.duration || 0), 0);
      return {
        name: f.name.split(' ').pop(), // Last name for brevity
        fullName: f.name,
        load
      };
    }).filter(f => f.load > 0).sort((a, b) => b.load - a.load).slice(0, 5);
  }, [faculties, effectiveSchedule]);

  const StatBox = ({ icon: Icon, title, value, sub }: any) => (
    <div className="flex bg-[#f8f9fa] border border-[#ccc] min-w-[150px] flex-1">
      <div className="w-12 flex items-center justify-center border-r border-[#ccc] bg-white">
        <Icon className="w-5 h-5 text-[#555]" />
      </div>
      <div className="p-2 pl-3 flex flex-col justify-center">
        <span className="text-[10px] font-bold text-[#333] tracking-wide">{title}</span>
        <div className="flex items-baseline gap-1 mt-0.5">
          <span className="text-[15px] font-bold text-[#333]">{value}</span>
          <span className="text-[10px] text-[#777]">{sub}</span>
        </div>
      </div>
    </div>
  );

  return (
    <div className="p-4 max-w-[1400px] mx-auto min-h-screen font-sans bg-[#f1f5f9]">
      <header className="flex justify-between items-center mb-4 border-b pb-2 border-[#ccc]">
        <div>
          <h2 className="text-[16px] font-bold text-[#333] tracking-wide uppercase">System Overview</h2>
          <p className="text-[11px] font-bold text-[#666] uppercase tracking-wide mt-0.5">
            Active Term: <span className="text-[#185baf]">{activeTerm?.name || 'All Terms'}</span>
          </p>
        </div>
        <button className="px-5 py-1.5 bg-[#185baf] text-white text-[11px] font-bold border border-[#0d3b76] uppercase tracking-wide">
          SYSTEM ONLINE
        </button>
      </header>

      <div className="flex flex-wrap gap-2 mb-4">
        <StatBox icon={BookOpen} title="COURSES" value={courses.length} sub="Modules" />
        <StatBox icon={MapPin} title="ROOMS" value={rooms.length} sub="Venues" />
        <StatBox icon={Users} title="STUDENTS" value={groups.length} sub="Enrolled" />
        <StatBox icon={Clock} title="LOAD" value={`${Math.round(totalHours)}h`} sub="Weekly" />
        <StatBox icon={AlertTriangle} title="CLASHES" value={clashes.length} sub="Conflicts" />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-2">
        <div className="lg:col-span-2 flex flex-col gap-2">
          {/* Main Graph */}
          <div className="bg-white border border-[#ccc] p-3 flex flex-col">
            <div className="flex justify-between items-center mb-4 border-b border-[#eee] pb-2">
              <h4 className="text-[12px] font-bold text-[#333] tracking-wide uppercase">Campus Utilization (%)</h4>
              <div className="flex items-center gap-4 text-[10px] font-bold">
                <div className="flex items-center gap-1.5"><div className="w-2 h-2 bg-[#185baf]"></div> <span className="text-[#555]">NORMAL</span></div>
                <div className="flex items-center gap-1.5"><div className="w-2 h-2 bg-[#d9534f]"></div> <span className="text-[#555]">HIGH</span></div>
              </div>
            </div>
            <div className="h-[250px] w-full">
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={data} margin={{ top: 5, right: 20, left: -20, bottom: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#eee" />
                  <XAxis dataKey="name" axisLine={{ stroke: '#999' }} tickLine={false} tick={{ fontSize: 11, fill: '#666' }} dy={10} />
                  <YAxis axisLine={{ stroke: '#999' }} tickLine={false} tick={{ fontSize: 11, fill: '#666' }} ticks={[0, 10, 20, 30, 40, 50]} />
                  <Line type="monotone" dataKey="hours" stroke="#185baf" strokeWidth={2} dot={{ r: 3, fill: '#185baf' }} activeDot={{ r: 5 }} />
                </LineChart>
              </ResponsiveContainer>
            </div>
          </div>

          {/* Efficiency Bar */}
          <div className="bg-[#122b4f] text-white p-3 border border-[#0d1f38] flex flex-col justify-center h-[90px]">
            <div className="flex items-center justify-between mb-3 border-b border-[#1f4070] pb-2">
              <div className="flex items-center gap-2">
                <Zap className="w-4 h-4 text-[#5c9ce6]" />
                <h4 className="text-[12px] font-bold tracking-wide uppercase">Resource Efficiency</h4>
              </div>
            </div>
            <div className="flex justify-between items-center text-[10px] font-bold uppercase tracking-wider mb-2">
              <span>Global Utilization</span>
              <span className="text-[#5c9ce6]">0%</span>
            </div>
            <div className="w-full h-2 bg-[#0d1f38]">
              <div className="h-full bg-[#185baf]" style={{ width: '0%' }}></div>
            </div>
          </div>
        </div>

        <div className="flex flex-col gap-2">
          {/* System Resources */}
          <div className="bg-[#f8f9fa] border border-[#ccc] p-3">
            <div className="flex items-center gap-2 mb-4 border-b border-[#ddd] pb-2">
              <Database className="w-4 h-4 text-[#555]" />
              <h4 className="text-[12px] font-bold text-[#333] tracking-wide uppercase">System Resources</h4>
            </div>
            
            <div className="bg-white border border-[#ccc] p-3 mb-3">
              <div className="flex justify-between items-start mb-1">
                <span className="text-[10px] font-bold text-[#666] tracking-wider uppercase">Database Load</span>
                <span className="text-[9px] font-bold text-[#2e7d32] border border-[#a5d6a7] px-1 bg-[#eafbef] uppercase">Optimal</span>
              </div>
              <div className="text-[18px] font-bold text-[#333]">{effectiveSchedule.length}</div>
              <div className="text-[9px] font-bold text-[#999] text-right uppercase mt-[-10px]">Records</div>
            </div>

            <div className="bg-white border border-[#ccc] p-3">
              <div className="flex justify-between items-center mb-2">
                <span className="text-[10px] font-bold text-[#666] tracking-wider uppercase">Local Cache</span>
                <span className="text-[10px] font-bold text-[#185baf] border border-[#b2d1f7] px-1 bg-[#e8f2fc]">0%</span>
              </div>
              <div className="w-full h-1.5 bg-[#e9ecef] mb-1">
                <div className="h-full bg-[#185baf]" style={{ width: '0%' }}></div>
              </div>
              <div className="text-[9px] font-bold text-[#999] uppercase">1 KB / 5.0 MB</div>
            </div>
          </div>

          {/* Faculty Workload */}
          <div className="bg-[#f8f9fa] border border-[#ccc] p-3 flex-1 flex flex-col">
            <h4 className="text-[12px] font-bold text-[#333] tracking-wide uppercase mb-3 border-b border-[#ddd] pb-2">Top Faculty Workloads</h4>
            
            <div className="flex-1 w-full min-h-[140px]">
              {facultyData.length > 0 ? (
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={facultyData} layout="vertical" margin={{ top: 0, right: 10, left: -25, bottom: -10 }}>
                    <CartesianGrid strokeDasharray="3 3" horizontal={true} vertical={false} stroke="#eee" />
                    <XAxis type="number" axisLine={{ stroke: '#ccc' }} tickLine={false} tick={{ fontSize: 9, fill: '#666' }} />
                    <YAxis dataKey="name" type="category" axisLine={{ stroke: '#ccc' }} tickLine={false} tick={{ fontSize: 10, fill: '#333', fontWeight: 'bold' }} />
                    <Tooltip cursor={{fill: '#eee'}} contentStyle={{ fontSize: '10px', fontWeight: 'bold', padding: '4px 8px' }} />
                    <Bar dataKey="load" fill="#185baf" barSize={14} radius={[0, 4, 4, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              ) : (
                <div className="h-full flex items-center justify-center text-[10px] font-bold text-[#999] uppercase tracking-wider">
                  No load data available.
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
