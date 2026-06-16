import React, { useState, useRef, useCallback, useMemo, useEffect } from 'react';
import Papa from 'papaparse';
import * as XLSX from 'xlsx';
import { Download, Upload, Zap, CheckCircle, AlertTriangle, FileText, X, ChevronDown, ChevronUp, MapPin, Clock, Coffee, Calendar, GraduationCap } from 'lucide-react';
import type { Course, Faculty, Room, StudentGroup, ScheduleEntry, Term, UserAccount } from '../types';
import {
  runAutoScheduler,
  COURSE_TEMPLATE_CSV,
  ROOM_CAMPUS_TEMPLATE_CSV,
  type CourseAssignment,
  type UnresolvedSession,
  type SchedulerResult,
} from '../utils/autoScheduler';

interface Props {
  courses: Course[];
  faculties: Faculty[];
  rooms: Room[];
  groups: StudentGroup[];
  terms: Term[];
  activeTermId: string | null;
  onApplySchedule: (entries: Omit<ScheduleEntry, 'id' | 'departmentId'>[]) => Promise<void>;
  currentUser: UserAccount;
  schedule: ScheduleEntry[];
}

type Stage = 'idle' | 'running' | 'done';

function downloadCSV(filename: string, content: string) {
  const blob = new Blob([content], { type: 'text/csv' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = filename; a.click();
  URL.revokeObjectURL(url);
}

function getErrorCategory(u: UnresolvedSession): string {
  const d = u.diagnostics;
  if (!d) return 'No Viable Slot';
  if (u.sessionsPlaced > 0 && u.sessionsPlaced < u.sessionsNeeded) return 'Partial Placement';
  const drivers = [
    { label: 'Fixed Room Unavailable', val: d.rejectedByFixedRoom },
    { label: 'Faculty Overloaded',     val: d.rejectedByFacultyClash },
    { label: 'Cohort Overbooked',      val: d.rejectedByCohortClash },
    { label: 'Teaching Hours Limit',   val: d.rejectedByConsecutiveHours },
  ].sort((a, b) => b.val - a.val);
  if (drivers[0].val > 0) return drivers[0].label;
  return 'No Viable Slot';
}

function downloadConflictReport(unresolved: UnresolvedSession[], termName: string) {
  const headers = [
    'Error Category',
    'Course Code', 'Course Name', 'Faculty ID', 'Faculty Name', 'Cohorts', 'Category',
    'Placed', 'Needed', 'Primary Reason',
    'Faculty Clash Slots', 'Cohort Clash Slots', 'Consecutive Hr Rejections',
    'Fixed Room Rejections', 'Placed Without Room', 'Total Candidate Slots',
    'Suggestion 1', 'Suggestion 2', 'Suggestion 3',
  ];
  const rows = unresolved.map(u => {
    const d = u.diagnostics;
    return [
      getErrorCategory(u),
      u.courseCode, u.courseName, u.facultyId, u.facultyName,
      u.cohorts.join(', '), u.category,
      u.sessionsPlaced, u.sessionsNeeded,
      d?.primaryReason ?? u.reason,
      d?.rejectedByFacultyClash ?? '', d?.rejectedByCohortClash ?? '',
      d?.rejectedByConsecutiveHours ?? '', d?.rejectedByFixedRoom ?? '',
      d?.noRoomAssigned ?? '', d?.totalCandidates ?? '',
      d?.suggestions[0] ?? '', d?.suggestions[1] ?? '', d?.suggestions[2] ?? '',
    ];
  });

  const ws = XLSX.utils.aoa_to_sheet([headers, ...rows]);
  ws['!cols'] = [
    { wch: 22 },
    { wch: 12 }, { wch: 26 }, { wch: 12 }, { wch: 22 }, { wch: 30 }, { wch: 10 },
    { wch: 7 },  { wch: 7 },  { wch: 54 },
    { wch: 16 }, { wch: 16 }, { wch: 20 },
    { wch: 18 }, { wch: 18 }, { wch: 16 },
    { wch: 65 }, { wch: 65 }, { wch: 65 },
  ];
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, 'Conflict Report');
  const date = new Date().toISOString().slice(0, 10);
  XLSX.writeFile(wb, `conflict_report_${termName.replace(/\s+/g, '_')}_${date}.xlsx`);
}

function getTermWeeks(term: Term | undefined): number[] {
  if (!term?.startDate || !term?.endDate) return Array.from({ length: 20 }, (_, i) => i + 1);
  const ms = new Date(term.endDate).getTime() - new Date(term.startDate).getTime();
  const n = Math.max(1, Math.ceil(ms / (7 * 24 * 60 * 60 * 1000)));
  return Array.from({ length: n }, (_, i) => i + 1);
}

const COLS: [string, string, string, string, string][] = [
  ['FacultyID',          'e.g. 600001',               '#4338ca', '#eef2ff', '#c7d2fe'],
  ['FacultyName',        'e.g. John Smith',            '#4338ca', '#eef2ff', '#c7d2fe'],
  ['School',             'School of Engineering…',     '#0891b2', '#ecfeff', '#a5f3fc'],
  ['CourseCode',         'e.g. CS301',                 '#7c3aed', '#f5f3ff', '#ddd6fe'],
  ['CourseName',         'e.g. Data Structures',       '#7c3aed', '#f5f3ff', '#ddd6fe'],
  ['Credits',            '3 = 3 sessions/week',        '#059669', '#ecfdf5', '#a7f3d0'],
  ['Category',           'Theory/Lab/Studio/MBA/Edge',  '#059669', '#ecfdf5', '#a7f3d0'],
  ['Campus',             'K1, K2, AB, RD…',           '#0891b2', '#ecfeff', '#a5f3fc'],
  ['Cohort1–12',         'shared cohorts on one row',  '#0891b2', '#ecfeff', '#a5f3fc'],
  ['FixedRoom',          'locks to this exact room',   '#d97706', '#fffbeb', '#fde68a'],
  ['PreferredRooms',     'R1|R2 pipe-separated',       '#d97706', '#fffbeb', '#fde68a'],
  ['LabHours',           '2 or 4  (numbers only)',     '#7c3aed', '#f5f3ff', '#ddd6fe'],
  ['Semester',           'label e.g. Semester 1',      '#059669', '#ecfdf5', '#a7f3d0'],
  ['Explo-Day-Block',    'blocks both faculty+cohort', '#b45309', '#fffbeb', '#fde68a'],
  ['Explo-Time-Block',   '"10" or "8,9" (hours)',      '#b45309', '#fffbeb', '#fde68a'],
  ['Course-Day-Block',   'restrict course to days only e.g. Mon-Wed', '#0f766e', '#f0fdfa', '#99f6e4'],
  ['Course-Time-Block',  'restrict course to start hours e.g. 13,14,15,16', '#0f766e', '#f0fdfa', '#99f6e4'],
  ['FacultyBlockDay',    'Mon / "Mon|Wed" to block',   '#e11d48', '#fff1f2', '#fecdd3'],
  ['FacultyBlockTime',   '"10" or "8|9|14" (hours)',   '#e11d48', '#fff1f2', '#fecdd3'],
  ['CohortBlockDay',     'Mon / "Mon|Wed" to block',   '#dc2626', '#fff1f2', '#fecdd3'],
  ['CohortBlockTime',    '"10" or "8|9|14" (hours)',   '#dc2626', '#fff1f2', '#fecdd3'],
  ['FacultyWorkingDays', 'Mon-Fri or Tue-Sat (blank = Step 3 default)', '#d97706', '#fffbeb', '#fde68a'],
  ['FacultyTimeStart',   '8 or 10 (faculty roster)',   '#64748b', '#f8fafc', '#e2e8f0'],
  ['FacultyTimeEnd',     '16 or 18 (faculty roster)',  '#64748b', '#f8fafc', '#e2e8f0'],
  ['CohortLunchStart',   '12, 13, or 14 (cohort)',     '#64748b', '#f8fafc', '#e2e8f0'],
];

const STEP_GRADS = [
  'linear-gradient(135deg, #4338ca, #6366f1)',
  'linear-gradient(135deg, #7c3aed, #a855f7)',
  'linear-gradient(135deg, #d97706, #f59e0b)',
];

function applyDefaultDays(
  assignments: CourseAssignment[],
  fallback: 'Mon-Fri' | 'Tue-Sat',
): CourseAssignment[] {
  // Explicit CSV value wins; blank rows use the Step 3 UI default.
  return assignments.map(a => ({
    ...a,
    workingDays: (a.workingDays as string).trim() || fallback,
  }));
}

const AutoSchedulePanel: React.FC<Props> = ({
  courses, faculties, rooms, groups, terms, activeTermId, onApplySchedule, schedule,
}) => {
  const courseFileRef = useRef<HTMLInputElement>(null);
  const roomFileRef   = useRef<HTMLInputElement>(null);
  const [courseFileName, setCourseFileName] = useState('');
  const [roomFileName,   setRoomFileName]   = useState('');
  const [assignments,    setAssignments]    = useState<CourseAssignment[]>([]);
  const [roomCampusMap,  setRoomCampusMap]  = useState<Map<string, string>>(new Map());
  const [parseError,     setParseError]     = useState('');

  const [defDays,  setDefDays]  = useState<'Mon-Fri' | 'Tue-Sat'>('Mon-Fri');
  const [defStart, setDefStart] = useState<8 | 10>(8);
  const [defEnd,   setDefEnd]   = useState<16 | 18>(16);
  const [defLunch, setDefLunch] = useState<12 | 13 | 14>(13);

  const [stage,          setStage]         = useState<Stage>('idle');
  const [progress,       setProgress]      = useState(0);
  const [label,          setLabel]         = useState('');
  const [result,         setResult]        = useState<SchedulerResult | null>(null);
  const [showUnresolved, setShowUnresolved] = useState(false);
  const [applying,       setApplying]      = useState(false);
  const [isApplied,      setIsApplied]     = useState(false);

  // Reset result when the timetable is cleared externally
  useEffect(() => {
    if (result !== null && schedule.length === 0) {
      setResult(null);
      setStage('idle');
      setProgress(0);
      setLabel('');
      setShowUnresolved(false);
    }
  }, [schedule.length]);

  const activeTerm = terms.find(t => t.id === activeTermId);

  const schoolReport = useMemo(() => {
    if (!assignments.length) return [];
    const balanced = applyDefaultDays(assignments, defDays);
    const schoolMap = new Map<string, Map<string, 'Mon-Fri' | 'Tue-Sat'>>();
    for (const a of balanced) {
      if (!a.facultyId) continue;
      const school = a.school.trim() || 'Unspecified';
      if (!schoolMap.has(school)) schoolMap.set(school, new Map());
      schoolMap.get(school)!.set(a.facultyId, a.workingDays as any);
    }
    return Array.from(schoolMap.entries())
      .map(([school, fac]) => {
        const total = fac.size;
        const mf = Array.from(fac.values()).filter(d => d === 'Mon-Fri').length;
        const ts = total - mf;
        return { school, total, mf, ts, mfPct: total ? Math.round((mf / total) * 100) : 0, tsPct: total ? Math.round((ts / total) * 100) : 0 };
      })
      .sort((a, b) => a.school.localeCompare(b.school));
  }, [assignments, defDays]);

  const parseCourseFile = useCallback((file: File) => {
    setParseError('');
    Papa.parse(file, {
      header: true, skipEmptyLines: true,
      complete: (res) => {
        const rows = res.data as Record<string, string>[];
        if (!rows.length) { setParseError('Course file is empty'); return; }
        const parsed: CourseAssignment[] = rows.map(r => ({
          facultyId:      (r.FacultyID      || '').trim(),
          facultyName:    (r.FacultyName    || '').trim(),
          school:         (r.School         || '').trim(),
          courseCode:     (r.CourseCode     || '').trim(),
          courseName:     (r.CourseName     || '').trim(),
          credits:        Math.max(0, parseInt(r.Credits) || 0),
          category:       (r.Category       || 'Theory').trim(),
          campus:         (r.Campus         || '').trim(),
          cohorts:        Array.from({ length: 12 }, (_, i) => (r[`Cohort${i + 1}`] || '').trim()).filter(Boolean),
          fixedRoom:      (r.FixedRoom      || '').trim(),
          preferredRooms:   (r.PreferredRooms   || '').split('|').map((s: string) => s.trim()).filter(Boolean),
          labHours:         Math.max(1, parseInt(r.LabHours) || 2),
          semester:         (r.Semester           || '').trim(),
          dayForBlock:      (r['Explo-Day-Block']  || r['Day-For-Block']  || '').trim(),
          timeForBlock:     (r['Explo-Time-Block'] || r['Time-For-Block'] || '').trim(),
          courseDayBlock:   (r['Course-Day-Block']  || '').trim(),
          courseTimeBlock:  (r['Course-Time-Block'] || '').trim(),
          facultyBlockDay:  (r.FacultyBlockDay   || '').trim(),
          facultyBlockTime: (r.FacultyBlockTime  || '').trim(),
          cohortBlockDay:   (r.CohortBlockDay    || '').trim(),
          cohortBlockTime:  (r.CohortBlockTime   || '').trim(),
          workingDays:    (r.FacultyWorkingDays || '').trim() as any,
          timeStart:      parseInt(r.FacultyTimeStart) || defStart,
          timeEnd:        parseInt(r.FacultyTimeEnd)   || defEnd,
          lunchStart:     parseInt(r.CohortLunchStart) || defLunch,
        })).filter(a => a.facultyId);
        if (!parsed.length) { setParseError('No valid rows — check column headers match template'); return; }
        setAssignments(parsed); setCourseFileName(file.name); setResult(null); setIsApplied(false);
      },
      error: (e) => setParseError(e.message),
    });
  }, [defStart, defEnd, defLunch]);

  const parseRoomFile = useCallback((file: File) => {
    Papa.parse(file, {
      header: true, skipEmptyLines: true,
      complete: (res) => {
        const map = new Map<string, string>();
        (res.data as Record<string, string>[]).forEach(r => {
          const name = (r.RoomName || '').trim(), campus = (r.Campus || '').trim();
          if (name && campus) map.set(name, campus);
        });
        setRoomCampusMap(map); setRoomFileName(file.name);
      },
    });
  }, []);

  const handleGenerate = async () => {
    if (!assignments.length) return;
    setStage('running'); setProgress(0); setLabel('Starting…'); setResult(null);
    const balanced = applyDefaultDays(assignments, defDays);
    const res = await runAutoScheduler(
      balanced, roomCampusMap, courses, faculties, rooms, groups,
      activeTermId || '', getTermWeeks(activeTerm),
      (placed, total, lbl) => { setProgress(total > 0 ? Math.round((placed / total) * 100) : 0); setLabel(lbl); },
      schedule,
    );
    setResult(res); setStage('done'); setProgress(100); setLabel('Complete');
  };

  const handleApply = async () => {
    if (!result || isApplied) return;
    setApplying(true);
    await onApplySchedule(result.entries.map(({ id: _id, departmentId: _d, ...rest }) => rest) as any);
    setApplying(false);
    setIsApplied(true);
    alert(`✅ ${result.entries.length} sessions applied. Switch to Timetable Builder to view them.`);
  };

  const Chip = ({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) => (
    <button type="button" onClick={onClick}
      className={`px-2.5 py-1 text-[10px] font-black uppercase tracking-wide border transition-all ${active ? 'text-white border-transparent shadow-sm' : 'bg-white text-[#64748b] border-[#e2e8f0] hover:border-[#94a3b8]'}`}
      style={active ? { background: STEP_GRADS[2] } : {}}>
      {children}
    </button>
  );

  const StepBadge = ({ n, grad }: { n: string; grad: string }) => (
    <div className="w-5 h-5 flex items-center justify-center text-[10px] font-black text-white shrink-0 shadow-sm" style={{ background: grad }}>{n}</div>
  );

  const pct = progress;
  const isReady = assignments.length > 0 && stage !== 'running';

  return (
    <div className="h-full flex flex-col overflow-hidden">

      {/* ── Header (shrink-0) ───────────────────────────────────────────────── */}
      <div className="shrink-0 overflow-hidden relative" style={{ background: 'linear-gradient(135deg, #0c1b3a 0%, #1e1b4b 35%, #312e81 65%, #4338ca 100%)' }}>
        <div className="absolute inset-0" style={{ backgroundImage: 'radial-gradient(circle at 75% 50%, rgba(99,102,241,0.3) 0%, transparent 60%)' }} />
        <div className="relative px-5 py-3 flex justify-between items-center">
          <div>
            <h2 className="text-[16px] font-black text-white tracking-tight flex items-center gap-2">
              <Zap className="w-4 h-4 text-yellow-300" /> Auto Timetable Generator
            </h2>
            <p className="text-[10px] text-indigo-200 font-medium mt-0.5">Upload assignments → configure constraints → generate clash-free timetable</p>
          </div>
          {activeTerm ? (
            <div className="bg-white/10 border border-white/20 px-3 py-1.5 text-right">
              <p className="text-[9px] font-bold text-indigo-300 uppercase tracking-widest">Active Term</p>
              <p className="text-[12px] font-black text-white">{activeTerm.name}</p>
            </div>
          ) : (
            <div className="bg-white/10 border border-white/20 px-3 py-1.5">
              <p className="text-[10px] font-bold text-white/50">No active term set</p>
            </div>
          )}
        </div>
      </div>

      {/* ── Two-column grid fills remaining height ─────────────────────────── */}
      <div className="flex-1 min-h-0 grid grid-cols-1 lg:grid-cols-2 gap-3 p-3 overflow-hidden">

        {/* ── LEFT COLUMN — scrollable internally ───────────────────────────── */}
        <div className="flex flex-col gap-2 overflow-y-auto custom-scrollbar pr-0.5">

          {/* Step 1 */}
          <div className="bg-white border border-[#e2e8f0] shadow-sm shrink-0">
            <div className="flex items-center gap-2 px-3 py-2 border-b border-[#f1f5f9]" style={{ background: 'linear-gradient(135deg, #eef2ff, #f5f3ff)' }}>
              <StepBadge n="1" grad={STEP_GRADS[0]} />
              <span className="text-[11px] font-black text-[#0f172a] uppercase tracking-wide">Download Templates</span>
            </div>
            <div className="p-3 space-y-2">
              <div className="flex gap-2">
                <button onClick={() => downloadCSV('course_assignment_template.csv', COURSE_TEMPLATE_CSV)}
                  className="flex-1 flex items-center justify-center gap-1.5 py-2 text-white text-[10px] font-black uppercase tracking-widest hover:opacity-90 transition-opacity shadow-sm"
                  style={{ background: STEP_GRADS[0] }}>
                  <Download className="w-3 h-3" /> Course Template
                </button>
                <button onClick={() => downloadCSV('room_campus_template.csv', ROOM_CAMPUS_TEMPLATE_CSV)}
                  className="flex-1 flex items-center justify-center gap-1.5 py-2 text-[#4338ca] text-[10px] font-black uppercase tracking-widest border-2 border-[#6366f1] hover:bg-[#eef2ff] transition-colors">
                  <Download className="w-3 h-3" /> Room-Campus
                </button>
              </div>
              <p className="text-[9px] text-[#4338ca] leading-relaxed bg-[#eef2ff] border border-[#c7d2fe] px-2 py-1.5">
                Leave <strong>FacultyWorkingDays</strong> blank to use the default days set in Step 3. Explicit "Mon-Fri" or "Tue-Sat" values are always respected. <strong>PreferredRooms</strong>: "R1|R2" pipe-separated. Block columns accept pipe-sep days/hours. Faculty max 2 consecutive hours (4-hr labs exempt).
              </p>
            </div>
          </div>

          {/* Step 2 */}
          <div className="bg-white border border-[#e2e8f0] shadow-sm shrink-0">
            <div className="flex items-center gap-2 px-3 py-2 border-b border-[#f1f5f9]" style={{ background: 'linear-gradient(135deg, #f5f3ff, #faf5ff)' }}>
              <StepBadge n="2" grad={STEP_GRADS[1]} />
              <span className="text-[11px] font-black text-[#0f172a] uppercase tracking-wide">Upload Files</span>
            </div>
            <div className="p-3 space-y-2">
              {/* Course file */}
              <div>
                <div className="flex items-center gap-1.5 mb-1">
                  <FileText className="w-3 h-3 text-[#7c3aed]" />
                  <span className="text-[9px] font-black text-[#334155] uppercase tracking-widest">Course Assignment File</span>
                  <span className="text-[9px] font-bold text-[#e11d48]">*</span>
                </div>
                {assignments.length > 0 ? (
                  <div className="flex items-center gap-2 px-2.5 py-2 border-2 border-[#a855f7] bg-[#faf5ff]">
                    <CheckCircle className="w-3.5 h-3.5 text-[#7c3aed] shrink-0" />
                    <div className="flex-1 min-w-0">
                      <p className="text-[9px] font-black text-[#7c3aed] truncate">{courseFileName}</p>
                      <p className="text-[8px] text-[#a855f7]">{assignments.length} assignments ready</p>
                    </div>
                    <button onClick={() => { setCourseFileName(''); setAssignments([]); setResult(null); }} className="p-1 text-[#7c3aed] hover:bg-[#ede9fe]">
                      <X className="w-3 h-3" />
                    </button>
                  </div>
                ) : (
                  <button onClick={() => courseFileRef.current?.click()}
                    className="w-full flex items-center justify-center gap-2 py-3 border-2 border-dashed border-[#c4b5fd] bg-[#faf5ff] hover:bg-[#f5f3ff] hover:border-[#7c3aed] transition-all group">
                    <Upload className="w-3.5 h-3.5 text-[#c4b5fd] group-hover:text-[#7c3aed] transition-colors" />
                    <span className="text-[9px] font-black text-[#94a3b8] group-hover:text-[#7c3aed] uppercase tracking-widest transition-colors">Click to upload CSV</span>
                  </button>
                )}
                <input ref={courseFileRef} type="file" accept=".csv" className="hidden"
                  onChange={e => e.target.files?.[0] && parseCourseFile(e.target.files[0])} />
              </div>

              {/* Room-campus file */}
              <div>
                <div className="flex items-center gap-1.5 mb-1">
                  <MapPin className="w-3 h-3 text-[#0891b2]" />
                  <span className="text-[9px] font-black text-[#334155] uppercase tracking-widest">Room-Campus Mapping</span>
                  <span className="text-[9px] text-[#94a3b8]">(optional)</span>
                </div>
                {roomCampusMap.size > 0 ? (
                  <div className="flex items-center gap-2 px-2.5 py-2 border-2 border-[#06b6d4] bg-[#ecfeff]">
                    <CheckCircle className="w-3.5 h-3.5 text-[#0891b2] shrink-0" />
                    <div className="flex-1 min-w-0">
                      <p className="text-[9px] font-black text-[#0891b2] truncate">{roomFileName}</p>
                      <p className="text-[8px] text-[#06b6d4]">{roomCampusMap.size} rooms mapped</p>
                    </div>
                    <button onClick={() => { setRoomFileName(''); setRoomCampusMap(new Map()); }} className="p-1 text-[#0891b2] hover:bg-[#cffafe]">
                      <X className="w-3 h-3" />
                    </button>
                  </div>
                ) : (
                  <button onClick={() => roomFileRef.current?.click()}
                    className="w-full flex items-center justify-center gap-2 py-2.5 border-2 border-dashed border-[#a5f3fc] bg-[#ecfeff] hover:bg-[#cffafe] hover:border-[#0891b2] transition-all group">
                    <Upload className="w-3.5 h-3.5 text-[#a5f3fc] group-hover:text-[#0891b2] transition-colors" />
                    <span className="text-[9px] font-black text-[#94a3b8] group-hover:text-[#0891b2] uppercase tracking-widest transition-colors">Click to upload CSV</span>
                  </button>
                )}
                <input ref={roomFileRef} type="file" accept=".csv" className="hidden"
                  onChange={e => e.target.files?.[0] && parseRoomFile(e.target.files[0])} />
              </div>

              {parseError && (
                <div className="flex items-center gap-2 px-2.5 py-1.5 border border-[#fecdd3] bg-[#fff1f2] text-[#e11d48]">
                  <AlertTriangle className="w-3 h-3 shrink-0" />
                  <span className="text-[9px] font-bold">{parseError}</span>
                </div>
              )}
            </div>
          </div>

          {/* School Roster Distribution — visible after CSV upload */}
          {schoolReport.length > 0 && (
            <div className="bg-white border border-[#e2e8f0] shadow-sm shrink-0">
              <div className="flex items-center gap-2 px-3 py-2 border-b border-[#f1f5f9]" style={{ background: 'linear-gradient(135deg, #ecfeff, #cffafe)' }}>
                <GraduationCap className="w-3.5 h-3.5 text-[#0891b2]" />
                <span className="text-[11px] font-black text-[#0f172a] uppercase tracking-wide">School Roster Distribution</span>
                <span className="text-[9px] text-[#0891b2] ml-1">working day distribution</span>
              </div>
              <div className="overflow-x-auto">
                <table className="w-full text-[9px]">
                  <thead>
                    <tr style={{ background: 'linear-gradient(135deg, #ecfeff, #cffafe)' }}>
                      {['School', 'Mon–Fri', '%', 'Tue–Sat', '%', 'Total'].map(h => (
                        <th key={h} className="px-2 py-1.5 text-left font-black text-[#0e7490] uppercase tracking-wider border-b border-[#a5f3fc] whitespace-nowrap">{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-[#ecfeff]">
                    {schoolReport.map(row => (
                      <tr key={row.school} className="hover:bg-[#ecfeff] transition-colors">
                        <td className="px-2 py-1.5 font-bold text-[#0f172a] max-w-[120px] truncate">{row.school}</td>
                        <td className="px-2 py-1.5 font-black text-[#059669]">{row.mf}</td>
                        <td className="px-2 py-1.5">
                          <span className="px-1 py-0.5 text-[8px] font-black bg-[#eff6ff] text-[#185baf]">
                            {row.mfPct}%
                          </span>
                        </td>
                        <td className="px-2 py-1.5 font-black text-[#7c3aed]">{row.ts}</td>
                        <td className="px-2 py-1.5">
                          <span className="px-1 py-0.5 text-[8px] font-black bg-[#f5f3ff] text-[#7c3aed]">
                            {row.tsPct}%
                          </span>
                        </td>
                        <td className="px-2 py-1.5 text-[#475569]">{row.total}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <p className="text-[8px] text-[#64748b] px-3 py-1.5 border-t border-[#ecfeff]">
                Explicit Mon-Fri / Tue-Sat in FacultyWorkingDays is respected. Blank rows use the Step 3 default.
              </p>
            </div>
          )}

          {/* Step 3 */}
          <div className="bg-white border border-[#e2e8f0] shadow-sm shrink-0">
            <div className="flex items-center gap-2 px-3 py-2 border-b border-[#f1f5f9]" style={{ background: 'linear-gradient(135deg, #fffbeb, #fef3c7)' }}>
              <StepBadge n="3" grad={STEP_GRADS[2]} />
              <span className="text-[11px] font-black text-[#0f172a] uppercase tracking-wide">Default Constraints</span>
              <span className="text-[9px] text-[#94a3b8] ml-1">when CSV columns blank</span>
            </div>
            <div className="p-3 grid grid-cols-3 gap-3">
              <div>
                <div className="flex items-center gap-1 mb-1.5">
                  <Calendar className="w-3 h-3 text-[#d97706]" />
                  <span className="text-[9px] font-black text-[#334155] uppercase tracking-widest">Days</span>
                </div>
                <div className="flex flex-col gap-1">
                  <Chip active={defDays === 'Mon-Fri'} onClick={() => setDefDays('Mon-Fri')}>Mon–Fri</Chip>
                  <Chip active={defDays === 'Tue-Sat'} onClick={() => setDefDays('Tue-Sat')}>Tue–Sat</Chip>
                </div>
              </div>
              <div>
                <div className="flex items-center gap-1 mb-1.5">
                  <Clock className="w-3 h-3 text-[#d97706]" />
                  <span className="text-[9px] font-black text-[#334155] uppercase tracking-widest">Window</span>
                </div>
                <div className="flex flex-col gap-1">
                  <Chip active={defStart === 8}  onClick={() => { setDefStart(8);  setDefEnd(16); }}>8 am–4 pm</Chip>
                  <Chip active={defStart === 10} onClick={() => { setDefStart(10); setDefEnd(18); }}>10 am–6 pm</Chip>
                </div>
              </div>
              <div>
                <div className="flex items-center gap-1 mb-1.5">
                  <Coffee className="w-3 h-3 text-[#d97706]" />
                  <span className="text-[9px] font-black text-[#334155] uppercase tracking-widest">Lunch</span>
                </div>
                <div className="flex flex-col gap-1">
                  <Chip active={defLunch === 12} onClick={() => setDefLunch(12)}>12–1 pm</Chip>
                  <Chip active={defLunch === 13} onClick={() => setDefLunch(13)}>1–2 pm</Chip>
                  <Chip active={defLunch === 14} onClick={() => setDefLunch(14)}>2–3 pm</Chip>
                </div>
              </div>
            </div>
          </div>

          {/* Generate — pinned to bottom of left column */}
          <div className="mt-auto shrink-0">
            <button
              onClick={handleGenerate}
              disabled={!isReady}
              className="w-full flex items-center justify-center gap-2 py-3 text-[12px] font-black uppercase tracking-widest text-white transition-all disabled:opacity-40 disabled:cursor-not-allowed shadow-md hover:shadow-lg hover:-translate-y-0.5 active:translate-y-0"
              style={{ background: isReady ? 'linear-gradient(135deg, #4338ca, #7c3aed, #0891b2)' : '#94a3b8' }}
            >
              <Zap className="w-4 h-4" />
              {stage === 'running' ? 'Generating…' : 'Generate Timetable'}
            </button>
          </div>
        </div>

        {/* ── RIGHT COLUMN — flex column, fills height ───────────────────────── */}
        <div className="flex flex-col gap-2 min-h-0 overflow-hidden">

          {/* Results / Progress / Idle — grows to fill */}
          <div className="flex-1 min-h-0 overflow-hidden flex flex-col">

            {stage === 'idle' && (
              <div className="flex-1 min-h-0 relative overflow-hidden flex flex-col items-center justify-center"
                style={{ background: 'linear-gradient(135deg, #0c1b3a, #1e1b4b, #312e81)' }}>
                <div className="absolute inset-0" style={{ backgroundImage: 'radial-gradient(circle at 50% 40%, rgba(99,102,241,0.25) 0%, transparent 60%)' }} />
                <div className="relative text-center">
                  <div className="w-12 h-12 mx-auto mb-3 flex items-center justify-center" style={{ background: 'rgba(99,102,241,0.2)', border: '2px solid rgba(99,102,241,0.3)' }}>
                    <Zap className="w-6 h-6 text-indigo-300" />
                  </div>
                  <p className="text-[12px] font-black text-white uppercase tracking-widest">Results Appear Here</p>
                  <p className="text-[10px] text-indigo-300 mt-1">Upload a course template and click Generate</p>
                </div>
              </div>
            )}

            {(stage === 'running' || stage === 'done') && (
              <div className="flex-1 min-h-0 flex flex-col bg-white border border-[#e2e8f0] shadow-sm overflow-hidden">
                {/* Status bar */}
                <div className="shrink-0 px-4 py-2.5 border-b border-[#f1f5f9] flex items-center gap-2"
                  style={{ background: stage === 'done' ? 'linear-gradient(135deg, #ecfdf5, #d1fae5)' : 'linear-gradient(135deg, #eff6ff, #dbeafe)' }}>
                  <div className={`w-2 h-2 rounded-full ${stage === 'running' ? 'animate-pulse bg-[#3b82f6]' : 'bg-[#059669]'}`} />
                  <p className="text-[11px] font-black uppercase tracking-wide" style={{ color: stage === 'done' ? '#059669' : '#185baf' }}>
                    {stage === 'running' ? 'Generating…' : '✓ Complete'}
                  </p>
                  <span className="ml-auto text-[16px] font-black" style={{ color: pct === 100 ? '#059669' : '#4338ca' }}>{pct}%</span>
                  {/* Conflict report icon — always visible in status bar after completion */}
                  {result && stage === 'done' && (
                    <button
                      onClick={() => downloadConflictReport(result.unresolved, activeTerm?.name ?? 'term')}
                      className="w-6 h-6 flex items-center justify-center shrink-0 ml-1 hover:opacity-80 transition-opacity"
                      style={{ background: result.unresolved.length > 0 ? 'linear-gradient(135deg,#d97706,#b45309)' : 'linear-gradient(135deg,#059669,#047857)' }}
                      title={result.unresolved.length > 0 ? `Download conflict report (${result.unresolved.length} unresolved)` : 'Download report — all sessions placed successfully'}>
                      <Download className="w-3 h-3 text-white" />
                    </button>
                  )}
                </div>

                <div className="flex-1 min-h-0 overflow-y-auto p-3 space-y-3 custom-scrollbar">
                  {/* Progress bar */}
                  <div>
                    <div className="h-2.5 bg-[#f1f5f9] overflow-hidden mb-1">
                      <div className="h-full transition-all duration-300"
                        style={{ width: `${pct}%`, background: pct === 100 ? 'linear-gradient(90deg,#059669,#10b981)' : 'linear-gradient(90deg,#4338ca,#7c3aed,#0891b2)' }} />
                    </div>
                    <p className="text-[9px] text-[#64748b] truncate">{label}</p>
                  </div>

                  {/* Stat cards */}
                  {result && (
                    <div className="grid grid-cols-3 gap-2">
                      {[
                        { icon: CheckCircle, value: result.stats.placed,          label: 'Placed',     bg: '#ecfdf5', border: '#a7f3d0', color: '#059669', grad: 'linear-gradient(135deg,#ecfdf5,#d1fae5)' },
                        { icon: AlertTriangle, value: result.unresolved.length, label: 'Unresolved', bg: result.unresolved.length > 0 ? '#fffbeb' : '#ecfdf5', border: result.unresolved.length > 0 ? '#fde68a' : '#a7f3d0', color: result.unresolved.length > 0 ? '#d97706' : '#059669', grad: result.unresolved.length > 0 ? 'linear-gradient(135deg,#fffbeb,#fef3c7)' : 'linear-gradient(135deg,#ecfdf5,#d1fae5)' },
                        { icon: Zap,           value: result.stats.totalSessions,  label: 'Total',      bg: '#eef2ff', border: '#c7d2fe', color: '#4338ca', grad: 'linear-gradient(135deg,#eef2ff,#e0e7ff)' },
                      ].map(({ icon: Icon, value, label: lbl, border, color, grad }) => (
                        <div key={lbl} className="border-2 p-3 text-center" style={{ background: grad, borderColor: border }}>
                          <Icon className="w-4 h-4 mx-auto mb-1" style={{ color }} />
                          <p className="text-[22px] font-black leading-none" style={{ color }}>{value}</p>
                          <p className="text-[9px] font-black uppercase tracking-widest mt-0.5" style={{ color }}>{lbl}</p>
                        </div>
                      ))}
                    </div>
                  )}

                  {/* Apply */}
                  {result && result.entries.length > 0 && (
                    <button onClick={handleApply} disabled={applying || isApplied}
                      className="w-full flex items-center justify-center gap-2 py-2.5 text-[11px] font-black uppercase tracking-widest text-white transition-all disabled:cursor-not-allowed"
                      style={{ background: isApplied ? 'linear-gradient(135deg,#64748b,#475569)' : 'linear-gradient(135deg,#059669,#0d9488,#10b981)', opacity: applying ? 0.6 : 1 }}>
                      <CheckCircle className="w-4 h-4" />
                      {applying ? 'Applying…' : isApplied ? `✓ Sessions Already Applied — Re-upload CSV to apply again` : `Apply ${result.entries.length} Sessions to Timetable`}
                    </button>
                  )}

                  {/* Unresolved */}
                  {result && result.unresolved.length > 0 && (
                    <div className="border-2 border-[#fde68a] overflow-hidden">
                      {/* Toggle header */}
                      <button
                        onClick={() => setShowUnresolved(s => !s)}
                        className="w-full flex items-center gap-1.5 px-3 py-2 text-[9px] font-black text-[#d97706] uppercase tracking-widest hover:opacity-80 transition-opacity text-left"
                        style={{ background: 'linear-gradient(135deg,#fffbeb,#fef3c7)' }}>
                        <AlertTriangle className="w-3 h-3 shrink-0" />
                        <span className="flex-1">{result.unresolved.length} Unresolved Sessions</span>
                        {showUnresolved ? <ChevronUp className="w-3 h-3 shrink-0" /> : <ChevronDown className="w-3 h-3 shrink-0" />}
                      </button>
                      {/* Download button — full width so it's always visible */}
                      <button
                        onClick={() => downloadConflictReport(result.unresolved, activeTerm?.name ?? 'term')}
                        className="w-full flex items-center justify-center gap-1.5 py-2 text-[10px] font-black uppercase tracking-widest text-white hover:opacity-90 transition-opacity"
                        style={{ background: 'linear-gradient(135deg,#d97706,#b45309)' }}>
                        <Download className="w-3.5 h-3.5" /> Download Conflict Report (Excel)
                      </button>

                      {showUnresolved && (
                        <div className="overflow-x-auto">
                          <table className="w-full text-[9px]">
                            <thead>
                              <tr className="border-b-2 border-[#fde68a] bg-[#fef3c7]">
                                {['Course', 'Faculty', 'Slots', 'Primary Reason', 'Top Suggestion'].map(h => (
                                  <th key={h} className="px-2 py-1.5 text-left font-black text-[#92400e] uppercase tracking-wider whitespace-nowrap">{h}</th>
                                ))}
                              </tr>
                            </thead>
                            <tbody className="divide-y divide-[#fef3c7]">
                              {result.unresolved.map((u: UnresolvedSession, i: number) => {
                                const d = u.diagnostics;
                                const bars = d ? [
                                  { label: 'Fac', val: d.rejectedByFacultyClash, color: '#e11d48' },
                                  { label: 'Coh', val: d.rejectedByCohortClash, color: '#7c3aed' },
                                  { label: 'Con', val: d.rejectedByConsecutiveHours, color: '#0891b2' },
                                  { label: 'Rm',  val: d.rejectedByFixedRoom, color: '#d97706' },
                                ].filter(b => b.val > 0) : [];
                                return (
                                  <tr key={i} className="hover:bg-[#fffbeb] transition-colors align-top">
                                    <td className="px-2 py-1.5 font-bold text-[#0f172a] whitespace-nowrap">
                                      {u.courseCode}
                                      <span className="block text-[8px] font-normal text-[#64748b]">{u.courseName}</span>
                                      <span className="text-[8px] font-normal text-[#94a3b8]">{u.category}</span>
                                    </td>
                                    <td className="px-2 py-1.5 text-[#475569] whitespace-nowrap">
                                      {u.facultyName}
                                      <span className="block text-[8px] font-normal text-[#94a3b8]">ID: {u.facultyId}</span>
                                    </td>
                                    <td className="px-2 py-1.5 whitespace-nowrap">
                                      <span className="font-black" style={{ color: u.sessionsPlaced === 0 ? '#e11d48' : '#d97706' }}>
                                        {u.sessionsPlaced}/{u.sessionsNeeded}
                                      </span>
                                      {bars.length > 0 && (
                                        <div className="flex gap-1 mt-1 flex-wrap">
                                          {bars.map(b => (
                                            <span key={b.label} className="text-[7px] font-black px-1 text-white" style={{ background: b.color }}>
                                              {b.label} {b.val}
                                            </span>
                                          ))}
                                        </div>
                                      )}
                                    </td>
                                    <td className="px-2 py-1.5 text-[#92400e] max-w-[160px]">
                                      <span className="block leading-tight">{u.reason}</span>
                                      {d && (
                                        <span className="block text-[8px] text-[#b45309] mt-0.5">
                                          {d.totalCandidates} candidates checked
                                        </span>
                                      )}
                                    </td>
                                    <td className="px-2 py-1.5 text-[#64748b] max-w-[180px]">
                                      <span className="block leading-tight text-[8px]">
                                        {d?.suggestions[0] ?? '—'}
                                      </span>
                                    </td>
                                  </tr>
                                );
                              })}
                            </tbody>
                          </table>
                        </div>
                      )}
                    </div>
                  )}
                </div>
              </div>
            )}
          </div>

          {/* Column Reference — fixed at bottom of right column */}
          <div className="shrink-0 bg-white border border-[#e2e8f0] shadow-sm overflow-hidden">
            <div className="px-3 py-2 border-b border-[#f1f5f9] flex items-center gap-2" style={{ background: 'linear-gradient(135deg,#f8fafc,#f1f5f9)' }}>
              <FileText className="w-3 h-3 text-[#64748b]" />
              <span className="text-[10px] font-black text-[#0f172a] uppercase tracking-wide">Template Column Reference</span>
            </div>
            <div className="p-2.5 grid grid-cols-3 gap-1">
              {COLS.map(([col, desc, color, bg, border]) => (
                <div key={col} className="flex items-start gap-1">
                  <span className="text-[8px] font-black px-1 py-0.5 border shrink-0 leading-tight" style={{ color, background: bg, borderColor: border }}>{col}</span>
                  <span className="text-[8px] text-[#64748b] leading-tight pt-0.5 truncate">{desc}</span>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

export default AutoSchedulePanel;
