import React, { useState } from 'react';
import * as XLSX from 'xlsx';
import { FileText, Download, Table, AlertTriangle, Calendar, Users, Briefcase, List, Trash2, Search, ChevronUp, ChevronDown, User, MapPin, BookOpen, Clock, ShieldAlert } from 'lucide-react';
import { ScheduleEntry, Course, Faculty, Room, StudentGroup, Term, Clash, UserAccount, Role } from '../types';
import { DataService } from '../services/dataService';

interface ReportsPanelProps {
  schedule: ScheduleEntry[];
  courses: Course[];
  faculties: Faculty[];
  rooms: Room[];
  groups: StudentGroup[];
  terms: Term[];
  clashes: Clash[];
  currentUser: UserAccount;
  activeTermId?: string;
  onDeleteEntry?: (id: string) => void;
  onDeleteMultiple?: (ids: string[]) => Promise<void>;
}

const ReportsPanel: React.FC<ReportsPanelProps> = ({
  schedule,
  courses,
  faculties,
  rooms,
  groups,
  terms,
  clashes,
  currentUser,
  activeTermId,
  onDeleteEntry,
  onDeleteMultiple
}) => {
  const [activeReportTab, setActiveReportTab] = useState<'reports' | 'entries' | 'clashes'>('reports');
  const [clashTypeFilter, setClashTypeFilter] = useState<'all' | 'Room' | 'Faculty' | 'Cohort' | 'LoadViolation'>('all');
  const [searchQuery, setSearchQuery] = useState('');
  const [sortField, setSortField] = useState<string>('day');
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('asc');
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [isDeleting, setIsDeleting] = useState(false);

  const isAdmin = currentUser.role === Role.ADMIN || currentUser.role === Role.SUPER_ADMIN;

  const DAY_ORDER = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];

  const handleSort = (field: string) => {
    if (sortField === field) {
      setSortDir(d => d === 'asc' ? 'desc' : 'asc');
    } else {
      setSortField(field);
      setSortDir('asc');
    }
  };

  const SortIcon: React.FC<{ field: string }> = ({ field }) => {
    if (sortField !== field) return <ChevronDown className="w-3 h-3 opacity-30" />;
    return sortDir === 'asc' ? <ChevronUp className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />;
  };

  const downloadCSV = (data: any[], filename: string) => {
    if (data.length === 0) {
      alert("No data available for this report.");
      return;
    }
    const headers = Object.keys(data[0]);
    const csvRows = [
      headers.join(','),
      ...data.map(row =>
        headers.map(fieldName => {
          const value = row[fieldName] || '';
          const escaped = ('' + value).replace(/"/g, '""');
          return `"${escaped}"`;
        }).join(',')
      )
    ];
    const csvContent = csvRows.join('\n');
    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.setAttribute('href', url);
    link.setAttribute('download', `${filename}_${new Date().toISOString().split('T')[0]}.csv`);
    link.style.visibility = 'hidden';
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  const getFilteredSchedule = () => {
    return activeTermId
      ? schedule.filter(s => s.termId === activeTermId)
      : schedule;
  };

  const getFullTimetableData = (filteredSchedule: ScheduleEntry[]) => {
    const rows: any[] = [];
    filteredSchedule.forEach((s, index) => {
      const eventId = index + 1;
      const course = courses.find(c => c.id === s.courseId);
      const faculty = faculties.find(f => f.id === s.facultyId);
      const room = rooms.find(r => r.id === s.roomId);
      const sessionGroups = groups.filter(g => s.groupIds?.includes(g.id));

      if (sessionGroups.length === 0) {
        rows.push({
          '_event_id': eventId,
          '_day_of_week': s.day,
          '_start_time': s.startTime,
          '_end_time': s.endTime,
          '_weeks': s.weeks.join(','),
          '_event_type': s.category || 'Theory',
          'Module Unique ID': (course as any)?._unique_name || course?.code || '',
          'Module': (course as any)?._name || course?.name || '',
          'Room': (room as any)?._unique_name || room?.name || '',
          'Faculty_ID': (faculty as any)?._Faculty_ID || faculty?.id || '',
          'Faculty_Name': (faculty as any)?._Faculty_name || faculty?.name || '',
          'Cohort': ''
        });
      } else {
        sessionGroups.forEach(g => {
          rows.push({
            '_event_id': eventId,
            '_day_of_week': s.day,
            '_start_time': s.startTime,
            '_end_time': s.endTime,
            '_weeks': s.weeks.join(','),
            '_event_type': s.category || 'Theory',
            'Module Unique ID': (course as any)?._unique_name || course?.code || '',
            'Module': (course as any)?._name || course?.name || '',
            'Room': (room as any)?._unique_name || room?.name || '',
            'Faculty_ID': (faculty as any)?._Faculty_ID || faculty?.id || '',
            'Faculty_Name': (faculty as any)?._Faculty_name || faculty?.name || '',
            'Cohort': (g as any)._unique_name || g.name
          });
        });
      }
    });
    return rows;
  };

  // Build detail for each affected schedule entry in a clash
  const getEntryDetail = (entryId: string) => {
    const s = schedule.find(e => e.id === entryId);
    if (!s) return null;
    const course = courses.find(c => c.id === s.courseId);
    const faculty = faculties.find(f => f.id === s.facultyId);
    const room = rooms.find(r => r.id === s.roomId);
    const cohortNames = groups.filter(g => s.groupIds?.includes(g.id)).map(g => (g as any)._unique_name || g.name).join(', ');
    return {
      day: s.day,
      startTime: s.startTime,
      endTime: s.endTime,
      module: (course as any)?._name || course?.name || '',
      faculty: (faculty as any)?._Faculty_name || faculty?.name || '',
      room: (room as any)?._unique_name || room?.name || '',
      cohorts: cohortNames,
      category: s.category || '',
    };
  };

  const downloadClashExcel = () => {
    const cohortClashes = clashes.filter(c => c.type === 'Cohort');
    const facultyClashes = clashes.filter(c => c.type === 'Faculty');
    const roomClashes = clashes.filter(c => c.type === 'Room');

    const buildSheet = (clashList: Clash[], extraColLabel: string) => {
      return clashList.map((clash, idx) => {
        const [id1, id2] = clash.affectedIds;
        const e1 = getEntryDetail(id1);
        const e2 = getEntryDetail(id2);
        return {
          '#': idx + 1,
          'Clash Description': clash.message,
          'Session 1 — Day': e1?.day || '',
          'Session 1 — Time': e1 ? `${e1.startTime}–${e1.endTime}` : '',
          'Session 1 — Module': e1?.module || '',
          'Session 1 — Faculty': e1?.faculty || '',
          'Session 1 — Room': e1?.room || '',
          'Session 1 — Cohorts': e1?.cohorts || '',
          'Session 2 — Day': e2?.day || '',
          'Session 2 — Time': e2 ? `${e2.startTime}–${e2.endTime}` : '',
          'Session 2 — Module': e2?.module || '',
          'Session 2 — Faculty': e2?.faculty || '',
          'Session 2 — Room': e2?.room || '',
          'Session 2 — Cohorts': e2?.cohorts || '',
        };
      });
    };

    const loadViolations = clashes.filter(c => c.type === 'LoadViolation').map((c, idx) => ({
      '#': idx + 1,
      'Description': c.message,
    }));

    const wb = XLSX.utils.book_new();

    const cohortData = buildSheet(cohortClashes, 'Cohort');
    const facultyData = buildSheet(facultyClashes, 'Faculty');
    const roomData = buildSheet(roomClashes, 'Room');

    const appendSheet = (data: any[], sheetName: string, emptyMsg: string) => {
      const ws = XLSX.utils.json_to_sheet(
        data.length > 0 ? data : [{ Note: emptyMsg }]
      );
      XLSX.utils.book_append_sheet(wb, ws, sheetName);
    };

    appendSheet(cohortData, 'Cohort Clashes', 'No cohort clashes detected.');
    appendSheet(facultyData, 'Faculty Clashes', 'No faculty clashes detected.');
    appendSheet(roomData, 'Room Clashes', 'No room clashes detected.');
    appendSheet(loadViolations, 'Load Violations', 'No load violations detected.');

    const filename = `Clash_Report_${new Date().toISOString().split('T')[0]}.xlsx`;
    XLSX.writeFile(wb, filename);
  };

  const reportCards = [
    {
      id: 'full',
      title: 'Full Institutional Timetable',
      description: 'Complete list of all scheduled sessions across all colleges and departments.',
      icon: <Table className="w-5 h-5" />,
      buttonLabel: 'Download Excel Report',
      action: () => {
        const data = getFullTimetableData(getFilteredSchedule());
        if (data.length === 0) { alert('No schedule data available for this term.'); return; }
        const ws = XLSX.utils.json_to_sheet(data);
        const wb = XLSX.utils.book_new();
        XLSX.utils.book_append_sheet(wb, ws, 'Full Timetable');
        XLSX.writeFile(wb, `Full_University_Timetable_${new Date().toISOString().split('T')[0]}.xlsx`);
      }
    },
    {
      id: 'clashes',
      title: 'Conflict & Clash Report',
      description: 'Multi-sheet Excel report with separate tabs for Cohort, Faculty, and Room clashes.',
      icon: <AlertTriangle className="w-5 h-5" />,
      action: downloadClashExcel,
      buttonLabel: 'Download Excel Report'
    },
    {
      id: 'resources',
      title: 'Resource Utilization',
      description: 'Summary of room capacity vs student enrollment for scheduled sessions.',
      icon: <Calendar className="w-5 h-5" />,
      action: () => {
        const data = getFilteredSchedule().map(s => {
          const room = rooms.find(r => r.id === s.roomId);
          const selectedGroups = groups.filter(g => s.groupIds?.includes(g.id));
          const totalStudents = selectedGroups.reduce((sum, g) => sum + (g.studentCount || 0), 0);
          const cohortNames = selectedGroups.map(g => g.name).join(', ');
          return {
            'Room': room?.name,
            'Capacity': room?.capacity,
            'Cohorts': cohortNames,
            'Total Students': totalStudents,
            'Utilization %': room ? Math.round(totalStudents / room.capacity * 100) : 0
          };
        });
        downloadCSV(data, 'Resource_Utilization_Report');
      }
    },
    {
      id: 'faculty_load',
      title: 'Faculty Load Report',
      description: 'Audit of faculty teaching hours and subject allocation for the active term.',
      icon: <Briefcase className="w-5 h-5" />,
      action: () => {
        const filteredSchedule = getFilteredSchedule();
        const data = faculties.map(f => {
          const facultySessions = filteredSchedule.filter(s => s.facultyId === f.id);
          const totalWeeklyMinutes = facultySessions.reduce((acc, s) => {
            return acc + (DataService.getDuration(s.startTime, s.endTime) * 60);
          }, 0);
          return {
            '_Faculty_ID': (f as any)?._Faculty_ID || f.id,
            '_Faculty_name': (f as any)?._Faculty_name || f.name,
            '_deptName': (f as any)?._deptName || f.department,
            'Faculty Load (hrs)': Math.round(totalWeeklyMinutes / 60)
          };
        });
        downloadCSV(data, 'Faculty_Load_Report');
      }
    }
  ];

  const activeSchedule = activeTermId ? schedule.filter(s => s.termId === activeTermId) : schedule;

  const enrichedEntries = activeSchedule.map(s => {
    const course = courses.find(c => c.id === s.courseId);
    const faculty = faculties.find(f => f.id === s.facultyId);
    const room = rooms.find(r => r.id === s.roomId);
    const sessionGroups = groups.filter(g => s.groupIds?.includes(g.id));
    return { ...s, course, faculty, room, sessionGroups };
  });

  const searchedEntries = enrichedEntries.filter(e => {
    if (!searchQuery) return true;
    const q = searchQuery.toLowerCase();
    return (
      e.day?.toLowerCase().includes(q) ||
      e.startTime?.includes(q) ||
      e.course?.name?.toLowerCase().includes(q) ||
      (e.course as any)?._name?.toLowerCase().includes(q) ||
      e.faculty?.name?.toLowerCase().includes(q) ||
      (e.faculty as any)?._Faculty_name?.toLowerCase().includes(q) ||
      e.room?.name?.toLowerCase().includes(q) ||
      e.sessionGroups.some(g => g.name?.toLowerCase().includes(q)) ||
      e.category?.toLowerCase().includes(q)
    );
  });

  const sortedEntries = [...searchedEntries].sort((a, b) => {
    let aVal: any, bVal: any;
    if (sortField === 'day') {
      aVal = DAY_ORDER.indexOf(a.day); bVal = DAY_ORDER.indexOf(b.day);
      if (aVal === bVal) { aVal = a.startTime; bVal = b.startTime; }
    } else if (sortField === 'time') {
      aVal = a.startTime; bVal = b.startTime;
    } else if (sortField === 'course') {
      aVal = ((a.course as any)?._name || a.course?.name || '').toLowerCase();
      bVal = ((b.course as any)?._name || b.course?.name || '').toLowerCase();
    } else if (sortField === 'faculty') {
      aVal = ((a.faculty as any)?._Faculty_name || a.faculty?.name || '').toLowerCase();
      bVal = ((b.faculty as any)?._Faculty_name || b.faculty?.name || '').toLowerCase();
    } else if (sortField === 'room') {
      aVal = (a.room?.name || '').toLowerCase();
      bVal = (b.room?.name || '').toLowerCase();
    } else if (sortField === 'category') {
      aVal = (a.category || '').toLowerCase();
      bVal = (b.category || '').toLowerCase();
    } else {
      aVal = ''; bVal = '';
    }
    if (aVal < bVal) return sortDir === 'asc' ? -1 : 1;
    if (aVal > bVal) return sortDir === 'asc' ? 1 : -1;
    return 0;
  });

  const ThBtn: React.FC<{ field: string; label: string; className?: string }> = ({ field, label, className }) => (
    <th
      className={`px-3 py-2 text-left text-[11px] font-bold text-[#333] uppercase tracking-wide cursor-pointer hover:bg-[#e8e8e8] select-none ${className || ''}`}
      onClick={() => handleSort(field)}
    >
      <div className="flex items-center gap-1">{label}<SortIcon field={field} /></div>
    </th>
  );

  return (
    <div className="space-y-4 p-2">
      {/* Header */}
      <div className="flex justify-between items-end border-b-2 border-[#185baf] pb-1 mx-2 mb-0">
        <div>
          <h2 className="text-[16px] font-black text-[#185baf] uppercase tracking-wide">Reports & Analytics</h2>
          <p className="text-[10px] text-[#666] font-bold uppercase tracking-widest">
            {activeTermId ? terms.find(t => t.id === activeTermId)?.name : 'All Terms'}
          </p>
        </div>
      </div>

      {/* Tab switcher */}
      <div className="flex mx-2 border-b border-[#ccc]">
        <button
          onClick={() => setActiveReportTab('reports')}
          className={`flex items-center gap-2 px-5 py-2 text-[12px] font-bold border-b-2 transition-all ${
            activeReportTab === 'reports'
              ? 'border-[#185baf] text-[#185baf] bg-white'
              : 'border-transparent text-[#666] hover:text-[#185baf] hover:bg-[#f5f5f5]'
          }`}
        >
          <FileText className="w-3.5 h-3.5" /> Reports
        </button>
        <button
          onClick={() => setActiveReportTab('entries')}
          className={`flex items-center gap-2 px-5 py-2 text-[12px] font-bold border-b-2 transition-all ${
            activeReportTab === 'entries'
              ? 'border-[#185baf] text-[#185baf] bg-white'
              : 'border-transparent text-[#666] hover:text-[#185baf] hover:bg-[#f5f5f5]'
          }`}
        >
          <List className="w-3.5 h-3.5" />
          Schedule Entries
          <span className="ml-1 bg-[#185baf] text-white text-[9px] font-bold px-1.5 py-0.5 rounded-sm">
            {activeSchedule.length}
          </span>
        </button>
        <button
          onClick={() => setActiveReportTab('clashes')}
          className={`flex items-center gap-2 px-5 py-2 text-[12px] font-bold border-b-2 transition-all ${
            activeReportTab === 'clashes'
              ? 'border-[#ac2925] text-[#ac2925] bg-white'
              : 'border-transparent text-[#666] hover:text-[#ac2925] hover:bg-[#f5f5f5]'
          }`}
        >
          <ShieldAlert className="w-3.5 h-3.5" />
          Clashes
          {clashes.length > 0 && (
            <span className="ml-1 bg-[#ac2925] text-white text-[9px] font-bold px-1.5 py-0.5 rounded-sm">
              {clashes.length}
            </span>
          )}
        </button>
      </div>

      {/* ── REPORTS TAB ── */}
      {activeReportTab === 'reports' && (
        <>
          {/* Clash summary bar */}
          {clashes.length > 0 && (
            <div className="mx-2 flex flex-wrap gap-2">
              {(['Cohort', 'Faculty', 'Room', 'LoadViolation'] as const).map(type => {
                const count = clashes.filter(c => c.type === type).length;
                if (count === 0) return null;
                const label = type === 'LoadViolation' ? 'Load Violations' : `${type} Clashes`;
                return (
                  <div key={type} className="flex items-center gap-1.5 px-2 py-1 bg-[#fdedec] border border-[#f5c6cb] text-[#a94442] text-[10px] font-bold uppercase">
                    <AlertTriangle className="w-3 h-3" />
                    {count} {label}
                  </div>
                );
              })}
            </div>
          )}

          <div className="px-2 grid grid-cols-1 md:grid-cols-2 gap-4">
            {reportCards.map((report) => (
              <div
                key={report.id}
                className="bg-[#f0f0f0] border-2 border-[#185baf] shadow-md flex flex-col justify-between"
              >
                <div className="p-4 bg-white flex-1">
                  <div className="flex items-center gap-3 border-b border-[#eee] pb-3 mb-3">
                    <div className="w-10 h-10 bg-[#f0f0f0] border-2 border-[#185baf] flex items-center justify-center text-[#185baf] shrink-0">
                      {report.icon}
                    </div>
                    <div>
                      <h3 className="text-[12px] font-black text-[#185baf] uppercase tracking-wide">{report.title}</h3>
                      <p className="text-[9px] text-[#666] font-bold uppercase tracking-widest mt-0.5">System Audit</p>
                    </div>
                  </div>
                  <p className="text-[11px] text-[#333] font-medium leading-relaxed">{report.description}</p>
                </div>
                <div className="p-2 bg-[#e0e0e0] border-t border-[#ccc]">
                  <button
                    onClick={report.action}
                    className="w-full py-1.5 btn-primary text-sm flex items-center justify-center gap-2 shadow-sm"
                  >
                    <Download className="w-3.5 h-3.5" />
                    {(report as any).buttonLabel || 'Download CSV Report'}
                  </button>
                </div>
              </div>
            ))}
          </div>

          <div className="mx-2 mt-2 bg-[#185baf] p-4 border border-[#00479b] shadow-md text-white flex gap-4 items-center">
            <div className="w-12 h-12 bg-white/10 border border-white/20 flex items-center justify-center shrink-0">
              <FileText className="w-6 h-6 text-white" />
            </div>
            <div className="flex-1">
              <h4 className="text-[11px] font-black uppercase tracking-wider">Custom Reporting Service</h4>
              <p className="text-[10px] text-[#e0e0e0] mt-1 font-bold leading-relaxed">
                Need a specific layout or data format? Our team can configure custom templates.
              </p>
            </div>
            <div>
              <button className="bg-white text-[#185baf] border flex items-center gap-1 border-[#185baf] px-4 py-1.5 text-[11px] font-bold uppercase hover:bg-[#f0f0f0] transition-colors leading-none tracking-wider whitespace-nowrap">
                Request Custom Template
              </button>
            </div>
          </div>
        </>
      )}

      {/* ── CLASHES TAB ── */}
      {activeReportTab === 'clashes' && (
        <div className="mx-2 space-y-3">
          {/* Filter chips */}
          <div className="flex items-center gap-2 flex-wrap">
            {([
              { key: 'all', label: `All Clashes`, count: clashes.length },
              { key: 'Room', label: 'Room', count: clashes.filter(c => c.type === 'Room').length },
              { key: 'Faculty', label: 'Faculty', count: clashes.filter(c => c.type === 'Faculty').length },
              { key: 'Cohort', label: 'Cohort', count: clashes.filter(c => c.type === 'Cohort').length },
              { key: 'LoadViolation', label: 'Load Violations', count: clashes.filter(c => c.type === 'LoadViolation').length },
            ] as const).map(({ key, label, count }) => (
              <button
                key={key}
                onClick={() => setClashTypeFilter(key)}
                className={`px-3 py-1 text-[11px] font-bold uppercase border transition-all flex items-center gap-1.5 ${
                  clashTypeFilter === key
                    ? 'bg-[#185baf] text-white border-[#185baf]'
                    : count === 0 ? 'bg-[#fafafa] text-[#bbb] border-[#e0e0e0] cursor-default'
                    : 'bg-white text-[#555] border-[#ccc] hover:border-[#185baf] hover:text-[#185baf]'
                }`}
              >
                {label}
                <span className={`text-[9px] font-black px-1 py-0.5 ${clashTypeFilter === key ? 'bg-white/20' : 'bg-[#f0f0f0]'}`}>
                  {count}
                </span>
              </button>
            ))}
          </div>

          {(() => {
            const filtered = clashTypeFilter === 'all' ? clashes : clashes.filter(c => c.type === clashTypeFilter);

            const typeConfig = {
              Room: { color: 'bg-red-50 border-red-200', badge: 'bg-red-100 text-red-700 border-red-300', icon: <MapPin className="w-3.5 h-3.5" />, label: 'Room Clash' },
              Faculty: { color: 'bg-amber-50 border-amber-200', badge: 'bg-amber-100 text-amber-700 border-amber-300', icon: <User className="w-3.5 h-3.5" />, label: 'Faculty Clash' },
              Cohort: { color: 'bg-blue-50 border-blue-200', badge: 'bg-blue-100 text-blue-700 border-blue-300', icon: <Users className="w-3.5 h-3.5" />, label: 'Cohort Clash' },
              LoadViolation: { color: 'bg-purple-50 border-purple-200', badge: 'bg-purple-100 text-purple-700 border-purple-300', icon: <AlertTriangle className="w-3.5 h-3.5" />, label: 'Load Violation' },
            };

            if (filtered.length === 0) return (
              <div className="py-16 bg-[#f9f9f9] border border-[#ccc] flex flex-col items-center justify-center text-center">
                <ShieldAlert className="w-8 h-8 text-[#ccc] mb-3" />
                <p className="text-[12px] font-bold text-[#666] uppercase tracking-wide">
                  {clashes.length === 0 ? 'No clashes detected — timetable is clean' : 'No clashes match the selected filter'}
                </p>
              </div>
            );

            return (
              <div className="space-y-3 pb-8">
                {filtered.map((clash, idx) => {
                  const cfg = typeConfig[clash.type] || typeConfig.Room;
                  const [id1, id2] = clash.affectedIds;
                  const e1 = getEntryDetail(id1);
                  const e2 = clash.type !== 'LoadViolation' ? getEntryDetail(id2) : null;

                  const SessionBlock = ({ detail, label }: { detail: ReturnType<typeof getEntryDetail>; label: string }) => (
                    <div className="p-4 space-y-2.5">
                      <div className="text-[9px] font-black text-[#999] uppercase tracking-[0.15em] mb-3">{label}</div>
                      {detail ? (
                        <>
                          <div className="flex items-center gap-2">
                            <span className="text-[12px] font-black text-[#185baf]">{detail.day}</span>
                            <span className="flex items-center gap-1 text-[11px] font-mono bg-[#f0f0f0] border border-[#ddd] px-2 py-0.5 text-[#333]">
                              <Clock className="w-3 h-3 text-[#999]" />
                              {detail.startTime} – {detail.endTime}
                            </span>
                            {detail.category && (
                              <span className="text-[9px] font-bold uppercase px-1.5 py-0.5 bg-[#e8f0fe] text-[#185baf] border border-[#c5d6f8]">
                                {detail.category}
                              </span>
                            )}
                          </div>
                          <div className="flex items-start gap-2 text-[11px]">
                            <BookOpen className="w-3.5 h-3.5 text-[#185baf] mt-0.5 shrink-0" />
                            <span className="font-bold text-[#333] leading-tight">{detail.module || <span className="text-[#bbb] italic font-normal">No module</span>}</span>
                          </div>
                          <div className="flex items-center gap-2 text-[11px]">
                            <User className="w-3.5 h-3.5 text-[#555] shrink-0" />
                            <span className="text-[#555]">{detail.faculty || <span className="text-[#bbb] italic">No faculty</span>}</span>
                          </div>
                          <div className="flex items-center gap-2 text-[11px]">
                            <MapPin className="w-3.5 h-3.5 text-[#555] shrink-0" />
                            <span className="text-[#555]">{detail.room || <span className="text-[#bbb] italic">No room</span>}</span>
                          </div>
                          {detail.cohorts && (
                            <div className="flex items-start gap-2 text-[11px]">
                              <Users className="w-3.5 h-3.5 text-[#555] shrink-0 mt-0.5" />
                              <span className="text-[#555] leading-snug">{detail.cohorts}</span>
                            </div>
                          )}
                        </>
                      ) : (
                        <p className="text-[11px] text-[#bbb] italic">Session not found</p>
                      )}
                    </div>
                  );

                  return (
                    <div key={idx} className={`border rounded-none overflow-hidden shadow-sm ${cfg.color}`}>
                      {/* Clash header */}
                      <div className="px-4 py-2.5 flex items-center gap-3 bg-white border-b border-[#e0e0e0]">
                        <span className={`flex items-center gap-1.5 text-[10px] font-black uppercase tracking-widest px-2.5 py-1 border ${cfg.badge} shrink-0`}>
                          {cfg.icon} {cfg.label}
                        </span>
                        <p className="text-[11px] font-bold text-[#333] leading-snug flex-1">{clash.message}</p>
                        <span className="text-[10px] text-[#999] font-bold shrink-0">#{idx + 1}</span>
                      </div>

                      {/* Session details */}
                      {clash.type !== 'LoadViolation' ? (
                        <div className="grid grid-cols-2 divide-x divide-[#e0e0e0]">
                          <SessionBlock detail={e1} label="Session 1 (conflicting)" />
                          <SessionBlock detail={e2} label="Session 2 (conflicting)" />
                        </div>
                      ) : (
                        <div className="p-4">
                          <p className="text-[10px] font-black text-[#999] uppercase tracking-widest mb-3">Affected sessions ({clash.affectedIds.length})</p>
                          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-2">
                            {clash.affectedIds.map((aid, ai) => {
                              const d = getEntryDetail(aid);
                              return d ? (
                                <div key={ai} className="bg-white border border-[#e0e0e0] px-3 py-2 text-[11px] space-y-0.5">
                                  <div className="font-black text-[#185baf]">{d.day} <span className="font-mono">{d.startTime}–{d.endTime}</span></div>
                                  <div className="font-bold text-[#333] truncate">{d.module}</div>
                                  <div className="text-[#666]">{d.cohorts}</div>
                                </div>
                              ) : null;
                            })}
                          </div>
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            );
          })()}
        </div>
      )}

      {/* ── SCHEDULE ENTRIES TAB ── */}
      {activeReportTab === 'entries' && (
        <div className="mx-2 space-y-3">
          <div className="flex items-center justify-between gap-3 flex-wrap">
            <div className="flex items-center gap-2 bg-white border border-[#ccc] px-2 py-1.5 min-w-[260px]">
              <Search className="w-3.5 h-3.5 text-[#999]" />
              <input
                type="text"
                placeholder="Search by module, faculty, room, cohort, day..."
                value={searchQuery}
                onChange={e => setSearchQuery(e.target.value)}
                className="text-xs outline-none w-full text-[#333] placeholder:text-[#aaa]"
              />
              {searchQuery && (
                <button onClick={() => setSearchQuery('')} className="text-[#999] hover:text-[#333] text-xs font-bold">✕</button>
              )}
            </div>
            <div className="flex items-center gap-2 flex-wrap">
              <span className="text-[11px] font-bold text-[#666] uppercase tracking-wider">
                {sortedEntries.length} of {activeSchedule.length} entries
              </span>
              {isAdmin && selectedIds.size > 0 && onDeleteMultiple && (
                <button
                  disabled={isDeleting}
                  onClick={async () => {
                    if (!confirm(`Permanently delete ${selectedIds.size} selected session${selectedIds.size > 1 ? 's' : ''}?`)) return;
                    setIsDeleting(true);
                    try {
                      await onDeleteMultiple([...selectedIds]);
                      setSelectedIds(new Set());
                    } finally {
                      setIsDeleting(false);
                    }
                  }}
                  className="flex items-center gap-1.5 px-3 py-1.5 bg-[#ac2925] text-white text-[11px] font-bold uppercase hover:bg-[#8a2020] transition-colors disabled:opacity-50"
                >
                  <Trash2 className="w-3 h-3" />
                  {isDeleting ? 'Deleting…' : `Delete Selected (${selectedIds.size})`}
                </button>
              )}
              {isAdmin && selectedIds.size === 0 && sortedEntries.length > 0 && (
                <span className="text-[10px] text-[#ac2925] font-bold uppercase tracking-wider border border-[#ac2925] px-2 py-0.5">
                  Admin: Select rows to delete
                </span>
              )}
            </div>
          </div>

          {sortedEntries.length === 0 ? (
            <div className="py-16 bg-[#f9f9f9] border border-[#ccc] flex flex-col items-center justify-center text-center">
              <List className="w-8 h-8 text-[#ccc] mb-3" />
              <p className="text-[12px] font-bold text-[#666] uppercase tracking-wide">
                {activeSchedule.length === 0 ? 'No schedule entries for this term' : 'No entries match your search'}
              </p>
            </div>
          ) : (
            <div className="bg-white border border-[#ccc] shadow-sm overflow-hidden">
              <div className="overflow-x-auto">
                <div className="max-h-[calc(100vh-280px)] overflow-y-auto">
                  <table className="w-full text-left border-collapse text-xs">
                    <thead className="bg-[#f0f0f0] sticky top-0 z-10 border-b-2 border-[#185baf]">
                      <tr>
                        {isAdmin && onDeleteMultiple && (
                          <th className="px-3 py-2 w-8">
                            <input
                              type="checkbox"
                              className="w-3.5 h-3.5 accent-[#185baf]"
                              checked={sortedEntries.length > 0 && sortedEntries.every(e => selectedIds.has(e.id))}
                              onChange={ev => setSelectedIds(ev.target.checked ? new Set(sortedEntries.map(e => e.id)) : new Set())}
                              title="Select all visible"
                            />
                          </th>
                        )}
                        <th className="px-3 py-2 text-[11px] font-bold text-[#185baf] uppercase w-8">#</th>
                        <ThBtn field="day" label="Day" />
                        <ThBtn field="time" label="Time" />
                        <ThBtn field="course" label="Module" />
                        <th className="px-3 py-2 text-[11px] font-bold text-[#333] uppercase tracking-wide">Module ID</th>
                        <ThBtn field="faculty" label="Faculty" />
                        <th className="px-3 py-2 text-[11px] font-bold text-[#333] uppercase tracking-wide">Faculty ID</th>
                        <ThBtn field="room" label="Room" />
                        <th className="px-3 py-2 text-[11px] font-bold text-[#333] uppercase tracking-wide">Cohorts</th>
                        <th className="px-3 py-2 text-[11px] font-bold text-[#333] uppercase tracking-wide">Weeks</th>
                        <ThBtn field="category" label="Type" />
                        <th className="px-3 py-2 text-[11px] font-bold text-[#333] uppercase tracking-wide">Created By</th>
                        <th className="px-3 py-2 text-[11px] font-bold text-[#333] uppercase tracking-wide">Last Edited By</th>
                        {isAdmin && onDeleteEntry && (
                          <th className="px-3 py-2 text-[11px] font-bold text-[#ac2925] uppercase tracking-wide text-right">Delete</th>
                        )}
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-[#eee]">
                      {sortedEntries.map((entry, idx) => (
                        <tr key={entry.id} className={`transition-colors ${selectedIds.has(entry.id) ? 'bg-[#e8f0fe]' : 'hover:bg-[#f5f8ff]'}`}>
                          {isAdmin && onDeleteMultiple && (
                            <td className="px-3 py-2">
                              <input
                                type="checkbox"
                                className="w-3.5 h-3.5 accent-[#185baf]"
                                checked={selectedIds.has(entry.id)}
                                onChange={() => {
                                  const next = new Set(selectedIds);
                                  next.has(entry.id) ? next.delete(entry.id) : next.add(entry.id);
                                  setSelectedIds(next);
                                }}
                              />
                            </td>
                          )}
                          <td className="px-3 py-2 text-[#999] font-bold">{idx + 1}</td>
                          <td className="px-3 py-2 font-bold text-[#185baf] whitespace-nowrap">{entry.day}</td>
                          <td className="px-3 py-2 whitespace-nowrap font-mono text-[11px]">
                            {entry.startTime} – {entry.endTime}
                          </td>
                          <td className="px-3 py-2 font-bold text-[#333] max-w-[180px] truncate" title={(entry.course as any)?._name || entry.course?.name || '—'}>
                            {(entry.course as any)?._name || entry.course?.name || <span className="text-[#ccc]">—</span>}
                          </td>
                          <td className="px-3 py-2 text-[#666] font-mono text-[10px]">
                            {(entry.course as any)?._unique_name || entry.course?.code || '—'}
                          </td>
                          <td className="px-3 py-2 text-[#333] max-w-[160px] truncate" title={(entry.faculty as any)?._Faculty_name || entry.faculty?.name || '—'}>
                            {(entry.faculty as any)?._Faculty_name || entry.faculty?.name || <span className="text-[#ccc]">—</span>}
                          </td>
                          <td className="px-3 py-2 text-[#666] font-mono text-[10px]">
                            {(entry.faculty as any)?._Faculty_ID || entry.faculty?.id || '—'}
                          </td>
                          <td className="px-3 py-2 text-[#333] whitespace-nowrap">
                            {(entry.room as any)?._unique_name || entry.room?.name || <span className="text-[#ccc]">—</span>}
                          </td>
                          <td className="px-3 py-2 max-w-[200px]">
                            <div className="flex flex-wrap gap-1">
                              {entry.sessionGroups.length > 0
                                ? entry.sessionGroups.map(g => (
                                    <span key={g.id} className="bg-[#e8f0fe] text-[#185baf] text-[9px] font-bold px-1.5 py-0.5 border border-[#c5d6f8] whitespace-nowrap">
                                      {(g as any)._unique_name || g.name}
                                    </span>
                                  ))
                                : <span className="text-[#ccc]">—</span>
                              }
                            </div>
                          </td>
                          <td className="px-3 py-2 text-[#666] text-[10px] whitespace-nowrap">
                            {Array.isArray(entry.weeks) && entry.weeks.length > 0
                              ? entry.weeks.length > 5
                                ? `Wk ${entry.weeks[0]}–${entry.weeks[entry.weeks.length - 1]} (${entry.weeks.length})`
                                : entry.weeks.map(w => `W${w}`).join(', ')
                              : <span className="text-[#ccc]">—</span>
                            }
                          </td>
                          <td className="px-3 py-2">
                            <span className={`text-[9px] font-bold px-1.5 py-0.5 uppercase border ${
                              entry.category === 'Lab'
                                ? 'bg-purple-50 text-purple-700 border-purple-200'
                                : entry.category === 'Seminar'
                                ? 'bg-amber-50 text-amber-700 border-amber-200'
                                : entry.category === 'Tutorial'
                                ? 'bg-green-50 text-green-700 border-green-200'
                                : 'bg-blue-50 text-blue-700 border-blue-200'
                            }`}>
                              {entry.category || 'Theory'}
                            </span>
                          </td>
                          <td className="px-3 py-2 text-[10px] text-[#555] whitespace-nowrap">
                            {entry.createdBy ? (
                              <div>
                                <div className="font-bold">{entry.createdBy}</div>
                                {entry.createdAt && (
                                  <div className="text-[#999]">{new Date(entry.createdAt).toLocaleDateString()}</div>
                                )}
                              </div>
                            ) : <span className="text-[#ccc]">—</span>}
                          </td>
                          <td className="px-3 py-2 text-[10px] text-[#555] whitespace-nowrap">
                            {entry.updatedBy ? (
                              <div>
                                <div className="font-bold">{entry.updatedBy}</div>
                                {entry.updatedAt && (
                                  <div className="text-[#999]">{new Date(entry.updatedAt).toLocaleDateString()}</div>
                                )}
                              </div>
                            ) : <span className="text-[#ccc]">—</span>}
                          </td>
                          {isAdmin && onDeleteEntry && (
                            <td className="px-3 py-2 text-right">
                              <button
                                onClick={() => {
                                  if (confirm(`Delete this ${entry.day} ${entry.startTime} session for "${(entry.course as any)?._name || entry.course?.name || 'Unknown'}"?`)) {
                                    onDeleteEntry(entry.id);
                                  }
                                }}
                                className="p-1.5 text-[#ac2925] hover:bg-[#fdecea] border border-transparent hover:border-[#ac2925] transition-all"
                                title="Delete this entry"
                              >
                                <Trash2 className="w-3.5 h-3.5" />
                              </button>
                            </td>
                          )}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
              <div className="px-3 py-2 bg-[#f9f9f9] border-t border-[#eee] flex items-center justify-between">
                <span className="text-[10px] font-bold text-[#666] uppercase tracking-wider">
                  Showing {sortedEntries.length} entries
                  {searchQuery && ` matching "${searchQuery}"`}
                </span>
                {!isAdmin && (
                  <span className="text-[10px] text-[#999] font-bold uppercase tracking-wider">
                    View only — contact an admin to delete entries
                  </span>
                )}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
};

export default ReportsPanel;
