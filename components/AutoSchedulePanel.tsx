import React, { useState, useRef, useCallback } from 'react';
import Papa from 'papaparse';
import { Download, Upload, Zap, CheckCircle, AlertTriangle, FileText, X, ChevronDown, ChevronUp } from 'lucide-react';
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
}

type Stage = 'idle' | 'running' | 'done';

function downloadCSV(filename: string, content: string) {
  const blob = new Blob([content], { type: 'text/csv' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = filename; a.click();
  URL.revokeObjectURL(url);
}

function getTermWeeks(term: Term | undefined): number[] {
  if (!term?.startDate || !term?.endDate) return Array.from({ length: 20 }, (_, i) => i + 1);
  const ms = new Date(term.endDate).getTime() - new Date(term.startDate).getTime();
  const n = Math.max(1, Math.ceil(ms / (7 * 24 * 60 * 60 * 1000)));
  return Array.from({ length: n }, (_, i) => i + 1);
}

const AutoSchedulePanel: React.FC<Props> = ({
  courses, faculties, rooms, groups, terms, activeTermId, onApplySchedule,
}) => {
  // ── file state ──────────────────────────────────────────────────────────────
  const courseFileRef = useRef<HTMLInputElement>(null);
  const roomFileRef   = useRef<HTMLInputElement>(null);
  const [courseFileName, setCourseFileName] = useState('');
  const [roomFileName,   setRoomFileName]   = useState('');
  const [assignments, setAssignments]       = useState<CourseAssignment[]>([]);
  const [roomCampusMap, setRoomCampusMap]   = useState<Map<string, string>>(new Map());
  const [parseError, setParseError]         = useState('');

  // ── defaults (used when template column is blank) ────────────────────────
  const [defDays,  setDefDays]  = useState<'Mon-Fri' | 'Tue-Sat'>('Mon-Fri');
  const [defStart, setDefStart] = useState<8 | 10>(8);
  const [defEnd,   setDefEnd]   = useState<16 | 18>(16);
  const [defLunch, setDefLunch] = useState<12 | 13 | 14>(13);

  // ── progress / results ───────────────────────────────────────────────────
  const [stage,      setStage]      = useState<Stage>('idle');
  const [progress,   setProgress]   = useState(0);
  const [label,      setLabel]      = useState('');
  const [result,     setResult]     = useState<SchedulerResult | null>(null);
  const [showUnresolved, setShowUnresolved] = useState(false);
  const [applying,   setApplying]   = useState(false);

  const activeTerm = terms.find(t => t.id === activeTermId);

  // ── parse course template ────────────────────────────────────────────────
  const parseCourseFile = useCallback((file: File) => {
    setParseError('');
    Papa.parse(file, {
      header: true,
      skipEmptyLines: true,
      complete: (res) => {
        const rows = res.data as Record<string, string>[];
        if (!rows.length) { setParseError('Course file is empty'); return; }

        const parsed: CourseAssignment[] = rows.map(r => {
          const cohorts = Array.from({ length: 12 }, (_, i) => (r[`Cohort${i + 1}`] || '').trim())
            .filter(Boolean);
          return {
            facultyId:   (r.FacultyID   || '').trim(),
            facultyName: (r.FacultyName || '').trim(),
            courseCode:  (r.CourseCode  || '').trim(),
            courseName:  (r.CourseName  || '').trim(),
            credits:     Math.max(1, parseInt(r.Credits) || 1),
            category:    (r.Category    || 'Theory').trim(),
            campus:      (r.Campus      || '').trim(),
            cohorts,
            fixedRoom:   (r.FixedRoom   || '').trim(),
            workingDays: ((r.WorkingDays || '').trim() || defDays) as any,
            timeStart:   parseInt(r.TimeStart) || defStart,
            timeEnd:     parseInt(r.TimeEnd)   || defEnd,
            lunchStart:  parseInt(r.LunchStart) || defLunch,
          };
        }).filter(a => a.courseCode && a.facultyId);

        if (!parsed.length) { setParseError('No valid rows found — check column headers match template'); return; }
        setAssignments(parsed);
        setCourseFileName(file.name);
        setResult(null);
      },
      error: (e) => setParseError(e.message),
    });
  }, [defDays, defStart, defEnd, defLunch]);

  // ── parse room-campus template ────────────────────────────────────────────
  const parseRoomFile = useCallback((file: File) => {
    Papa.parse(file, {
      header: true,
      skipEmptyLines: true,
      complete: (res) => {
        const rows = res.data as Record<string, string>[];
        const map = new Map<string, string>();
        rows.forEach(r => {
          const name   = (r.RoomName || '').trim();
          const campus = (r.Campus   || '').trim();
          if (name && campus) map.set(name, campus);
        });
        setRoomCampusMap(map);
        setRoomFileName(file.name);
      },
    });
  }, []);

  // ── generate ─────────────────────────────────────────────────────────────
  const handleGenerate = async () => {
    if (!assignments.length) return;
    setStage('running');
    setProgress(0);
    setLabel('Starting…');
    setResult(null);

    const weeks = getTermWeeks(activeTerm);

    const res = await runAutoScheduler(
      assignments,
      roomCampusMap,
      courses, faculties, rooms, groups,
      activeTermId || '',
      weeks,
      (placed, total, lbl) => {
        setProgress(total > 0 ? Math.round((placed / total) * 100) : 0);
        setLabel(lbl);
      },
    );

    setResult(res);
    setStage('done');
    setProgress(100);
    setLabel('Complete');
  };

  // ── apply to schedule ────────────────────────────────────────────────────
  const handleApply = async () => {
    if (!result) return;
    setApplying(true);
    const toApply = result.entries.map(({ id: _id, departmentId: _d, ...rest }) => rest);
    await onApplySchedule(toApply as any);
    setApplying(false);
    alert(`✅ ${result.entries.length} sessions applied to the timetable. Switch to Timetable Builder to view them.`);
  };

  // ── radio helper ─────────────────────────────────────────────────────────
  const Radio = ({ value, current, onChange, label: lbl }: {
    value: any; current: any; onChange: (v: any) => void; label: string;
  }) => (
    <label className="flex items-center gap-1.5 cursor-pointer">
      <input type="radio" checked={current === value} onChange={() => onChange(value)}
        className="accent-[#185baf]" />
      <span className="text-[11px] font-bold text-[#333]">{lbl}</span>
    </label>
  );

  const pct = progress;
  const isReady = assignments.length > 0 && stage !== 'running';

  const StepHeader = ({ n, label }: { n: string; label: string }) => (
    <div className="flex items-center gap-2.5 mb-3 pb-2.5 border-b border-[#f1f5f9]">
      <div className="w-5 h-5 flex items-center justify-center text-[10px] font-black text-white shrink-0"
        style={{ background: 'linear-gradient(135deg, #185baf, #0891b2)' }}>{n}</div>
      <span className="text-[11px] font-black text-[#0f172a] uppercase tracking-wide">{label}</span>
    </div>
  );

  return (
    <div className="h-full overflow-y-auto bg-[#f0f4f8] custom-scrollbar">

      {/* Header */}
      <div className="mb-4 overflow-hidden relative" style={{ background: 'linear-gradient(135deg, #0c1b3a 0%, #0f2d5e 35%, #185baf 70%, #1a7fd4 100%)' }}>
        <div className="absolute inset-0" style={{ backgroundImage: 'radial-gradient(circle at 80% 50%, rgba(255,255,255,0.06) 0%, transparent 60%)' }} />
        <div className="absolute right-0 top-0 bottom-0 w-32 opacity-[0.04]" style={{ backgroundImage: 'repeating-linear-gradient(-45deg, white 0px, white 1px, transparent 1px, transparent 12px)' }} />
        <div className="relative px-5 py-4 flex justify-between items-center">
          <div>
            <h2 className="text-[17px] font-black text-white tracking-tight flex items-center gap-2">
              <Zap className="w-4 h-4 text-yellow-300" /> Auto Timetable Generator
            </h2>
            <p className="text-[11px] text-blue-200 font-medium mt-0.5">
              Upload assignments → configure constraints → generate a clash-free timetable
            </p>
          </div>
          {activeTerm && (
            <div className="bg-white/10 border border-white/20 px-3 py-1.5">
              <p className="text-[9px] font-bold text-blue-200 uppercase tracking-widest">Active Term</p>
              <p className="text-[12px] font-black text-white">{activeTerm.name}</p>
            </div>
          )}
        </div>
      </div>

      <div className="px-4 pb-4 grid grid-cols-1 lg:grid-cols-2 gap-4">

        {/* ── LEFT COLUMN ─────────────────────────────────────────────────── */}
        <div className="space-y-3">

          {/* Step 1 — Download templates */}
          <div className="bg-white border border-[#e2e8f0] shadow-sm p-4 space-y-3">
            <StepHeader n="1" label="Download Templates" />
            <div className="flex gap-2">
              <button
                onClick={() => downloadCSV('course_assignment_template.csv', COURSE_TEMPLATE_CSV)}
                className="flex-1 flex items-center justify-center gap-1.5 px-3 py-2 bg-[#185baf] text-white text-[10px] font-bold uppercase tracking-widest hover:bg-[#124584] transition-colors border border-[#0d3b76]"
              >
                <Download className="w-3.5 h-3.5" /> Course Template
              </button>
              <button
                onClick={() => downloadCSV('room_campus_template.csv', ROOM_CAMPUS_TEMPLATE_CSV)}
                className="flex-1 flex items-center justify-center gap-1.5 px-3 py-2 bg-white text-[#185baf] text-[10px] font-bold uppercase tracking-widest hover:bg-[#f0f6ff] transition-colors border border-[#185baf]"
              >
                <Download className="w-3.5 h-3.5" /> Room-Campus Template
              </button>
            </div>
            <p className="text-[9px] text-[#888] leading-relaxed">
              Fill the <strong>Course Template</strong> with one row per course-faculty combination.
              Multiple cohorts sharing a session → fill Cohort1, Cohort2, etc. on the same row.
              <br />
              Fill the <strong>Room-Campus Template</strong> to map each room to its campus code (K1, K2, AB, etc.).
            </p>
          </div>

          {/* Step 2 — Upload files */}
          <div className="bg-white border border-[#e2e8f0] shadow-sm p-4 space-y-3">
            <StepHeader n="2" label="Upload Files" />

            {/* Course file */}
            <div className="space-y-1">
              <label className="text-[10px] font-bold text-[#444] uppercase tracking-widest flex items-center gap-1.5">
                <FileText className="w-3 h-3" /> Course Assignment File <span className="text-[#ac2925]">*</span>
              </label>
              <div className="flex gap-2">
                <button
                  onClick={() => courseFileRef.current?.click()}
                  className="flex items-center gap-1.5 px-3 py-1.5 bg-[#f8f9fa] border border-[#ccc] text-[10px] font-bold text-[#555] hover:bg-[#eee] transition-colors uppercase tracking-widest"
                >
                  <Upload className="w-3 h-3" /> Choose File
                </button>
                <span className="flex-1 flex items-center text-[10px] text-[#666] border border-[#eee] bg-[#fafafa] px-2 truncate">
                  {courseFileName || 'No file chosen'}
                </span>
                {courseFileName && (
                  <button onClick={() => { setCourseFileName(''); setAssignments([]); setResult(null); }}
                    className="px-2 text-[#ac2925] hover:bg-[#fdecea] border border-transparent hover:border-[#ac2925] transition-colors">
                    <X className="w-3.5 h-3.5" />
                  </button>
                )}
              </div>
              <input ref={courseFileRef} type="file" accept=".csv" className="hidden"
                onChange={e => e.target.files?.[0] && parseCourseFile(e.target.files[0])} />
              {assignments.length > 0 && (
                <p className="text-[9px] text-[#2e7d32] font-bold">
                  ✓ {assignments.length} course assignments loaded
                </p>
              )}
            </div>

            {/* Room-campus file */}
            <div className="space-y-1">
              <label className="text-[10px] font-bold text-[#444] uppercase tracking-widest flex items-center gap-1.5">
                <FileText className="w-3 h-3" /> Room-Campus Mapping <span className="text-[#888] font-normal">(optional)</span>
              </label>
              <div className="flex gap-2">
                <button
                  onClick={() => roomFileRef.current?.click()}
                  className="flex items-center gap-1.5 px-3 py-1.5 bg-[#f8f9fa] border border-[#ccc] text-[10px] font-bold text-[#555] hover:bg-[#eee] transition-colors uppercase tracking-widest"
                >
                  <Upload className="w-3 h-3" /> Choose File
                </button>
                <span className="flex-1 flex items-center text-[10px] text-[#666] border border-[#eee] bg-[#fafafa] px-2 truncate">
                  {roomFileName || 'No file chosen'}
                </span>
                {roomFileName && (
                  <button onClick={() => { setRoomFileName(''); setRoomCampusMap(new Map()); }}
                    className="px-2 text-[#ac2925] hover:bg-[#fdecea] border border-transparent hover:border-[#ac2925] transition-colors">
                    <X className="w-3.5 h-3.5" />
                  </button>
                )}
              </div>
              <input ref={roomFileRef} type="file" accept=".csv" className="hidden"
                onChange={e => e.target.files?.[0] && parseRoomFile(e.target.files[0])} />
              {roomCampusMap.size > 0 && (
                <p className="text-[9px] text-[#2e7d32] font-bold">
                  ✓ {roomCampusMap.size} rooms mapped to campuses
                </p>
              )}
            </div>

            {parseError && (
              <p className="text-[10px] text-[#ac2925] font-bold border border-[#ac2925] bg-[#fdecea] px-2 py-1">
                ⚠ {parseError}
              </p>
            )}
          </div>

          {/* Step 3 — Defaults */}
          <div className="bg-white border border-[#e2e8f0] shadow-sm p-4 space-y-3">
            <StepHeader n="3" label="Default Constraints" />

            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <p className="text-[10px] font-bold text-[#555] uppercase tracking-widest">Working Days</p>
                <div className="flex flex-col gap-1">
                  <Radio value="Mon-Fri" current={defDays} onChange={setDefDays} label="Mon – Fri" />
                  <Radio value="Tue-Sat" current={defDays} onChange={setDefDays} label="Tue – Sat" />
                </div>
              </div>

              <div className="space-y-1.5">
                <p className="text-[10px] font-bold text-[#555] uppercase tracking-widest">Time Window</p>
                <div className="flex flex-col gap-1">
                  <Radio value={8}  current={defStart} onChange={(v) => { setDefStart(v); setDefEnd(v === 8 ? 16 : 18); }} label="8 am – 4 pm" />
                  <Radio value={10} current={defStart} onChange={(v) => { setDefStart(v); setDefEnd(v === 8 ? 16 : 18); }} label="10 am – 6 pm" />
                </div>
              </div>

              <div className="space-y-1.5 col-span-2">
                <p className="text-[10px] font-bold text-[#555] uppercase tracking-widest">Lunch Break</p>
                <div className="flex gap-3">
                  <Radio value={12} current={defLunch} onChange={setDefLunch} label="12 – 1 pm" />
                  <Radio value={13} current={defLunch} onChange={setDefLunch} label="1 – 2 pm" />
                  <Radio value={14} current={defLunch} onChange={setDefLunch} label="2 – 3 pm" />
                </div>
              </div>
            </div>
          </div>

          {/* Generate button */}
          <button
            onClick={handleGenerate}
            disabled={!isReady}
            className="w-full flex items-center justify-center gap-2 py-3 text-[12px] font-black uppercase tracking-widest transition-colors border disabled:opacity-40 disabled:cursor-not-allowed"
            style={{
              background: isReady ? 'linear-gradient(135deg,#185baf,#0891b2)' : '#ccc',
              borderColor: isReady ? '#0d3b76' : '#bbb',
              color: 'white',
            }}
          >
            <Zap className="w-4 h-4" />
            {stage === 'running' ? 'Generating…' : 'Generate Timetable'}
          </button>
        </div>

        {/* ── RIGHT COLUMN ─────────────────────────────────────────────────── */}
        <div className="space-y-3">

          {/* Progress */}
          {(stage === 'running' || stage === 'done') && (
            <div className="bg-white border border-[#e2e8f0] shadow-sm p-4 space-y-4">
              <div className="flex items-center gap-2 pb-2.5 border-b border-[#f1f5f9]">
                <div className={`w-2 h-2 rounded-full ${stage === 'running' ? 'animate-pulse bg-[#185baf]' : 'bg-[#059669]'}`} />
                <p className="text-[11px] font-black text-[#0f172a] uppercase tracking-wide">
                  {stage === 'running' ? 'Generating…' : 'Generation Complete'}
                </p>
              </div>

              {/* Progress bar */}
              <div className="space-y-2">
                <div className="flex justify-between items-center">
                  <span className="text-[10px] font-medium text-[#64748b] truncate max-w-[70%]">{label}</span>
                  <span className="text-[14px] font-black" style={{ color: pct === 100 ? '#059669' : '#185baf' }}>{pct}%</span>
                </div>
                <div className="h-2.5 bg-[#f1f5f9] overflow-hidden">
                  <div
                    className="h-full transition-all duration-300"
                    style={{
                      width: `${pct}%`,
                      background: pct === 100 ? 'linear-gradient(90deg,#059669,#10b981)' : 'linear-gradient(90deg,#185baf,#0891b2)',
                    }}
                  />
                </div>
                {result && (
                  <p className="text-[9px] text-[#94a3b8] font-bold">
                    {result.entries.length} of {result.stats.totalSessions} sessions placed
                  </p>
                )}
              </div>

              {/* Stats */}
              {result && (
                <div className="grid grid-cols-3 gap-2">
                  <div className="border p-3 text-center" style={{ background: '#ecfdf5', borderColor: '#a7f3d0' }}>
                    <CheckCircle className="w-4 h-4 text-[#059669] mx-auto mb-1" />
                    <p className="text-[22px] font-black text-[#059669] leading-none">{result.stats.placed}</p>
                    <p className="text-[9px] font-bold text-[#059669] uppercase tracking-widest mt-0.5">Placed</p>
                  </div>
                  <div className="border p-3 text-center" style={{ background: result.stats.unresolvedCount > 0 ? '#fffbeb' : '#ecfdf5', borderColor: result.stats.unresolvedCount > 0 ? '#fde68a' : '#a7f3d0' }}>
                    <AlertTriangle className={`w-4 h-4 mx-auto mb-1 ${result.stats.unresolvedCount > 0 ? 'text-[#d97706]' : 'text-[#059669]'}`} />
                    <p className={`text-[22px] font-black leading-none ${result.stats.unresolvedCount > 0 ? 'text-[#d97706]' : 'text-[#059669]'}`}>
                      {result.stats.unresolvedCount}
                    </p>
                    <p className={`text-[9px] font-bold uppercase tracking-widest mt-0.5 ${result.stats.unresolvedCount > 0 ? 'text-[#d97706]' : 'text-[#059669]'}`}>
                      Unresolved
                    </p>
                  </div>
                  <div className="border border-[#bfdbfe] bg-[#eff6ff] p-3 text-center">
                    <Zap className="w-4 h-4 text-[#185baf] mx-auto mb-1" />
                    <p className="text-[22px] font-black text-[#185baf] leading-none">{result.stats.totalSessions}</p>
                    <p className="text-[9px] font-bold text-[#185baf] uppercase tracking-widest mt-0.5">Total</p>
                  </div>
                </div>
              )}

              {/* Apply button */}
              {result && result.entries.length > 0 && (
                <button
                  onClick={handleApply}
                  disabled={applying}
                  className="w-full flex items-center justify-center gap-2 py-2.5 text-[11px] font-black uppercase tracking-widest text-white shadow-sm hover:opacity-90 transition-opacity disabled:opacity-50"
                  style={{ background: 'linear-gradient(135deg, #059669, #10b981)' }}
                >
                  <CheckCircle className="w-4 h-4" />
                  {applying ? 'Applying…' : `Apply ${result.entries.length} Sessions to Timetable`}
                </button>
              )}
            </div>
          )}

          {/* Unresolved table */}
          {result && result.unresolved.length > 0 && (
            <div className="bg-white border border-[#ffe082]">
              <button
                onClick={() => setShowUnresolved(s => !s)}
                className="w-full flex items-center justify-between px-3 py-2 bg-[#fff8e1] hover:bg-[#fff3cd] transition-colors"
              >
                <span className="text-[10px] font-black text-[#f57f17] uppercase tracking-widest flex items-center gap-1.5">
                  <AlertTriangle className="w-3.5 h-3.5" />
                  {result.unresolved.length} Unresolved Course{result.unresolved.length > 1 ? 's' : ''}
                </span>
                {showUnresolved ? <ChevronUp className="w-3.5 h-3.5 text-[#f57f17]" /> : <ChevronDown className="w-3.5 h-3.5 text-[#f57f17]" />}
              </button>

              {showUnresolved && (
                <div className="overflow-x-auto">
                  <table className="w-full text-[10px]">
                    <thead>
                      <tr className="bg-[#fff3cd] border-b border-[#ffe082]">
                        <th className="px-3 py-1.5 text-left font-black text-[#5d4037] uppercase tracking-widest">Course</th>
                        <th className="px-3 py-1.5 text-left font-black text-[#5d4037] uppercase tracking-widest">Faculty</th>
                        <th className="px-3 py-1.5 text-left font-black text-[#5d4037] uppercase tracking-widest">Cohorts</th>
                        <th className="px-3 py-1.5 text-left font-black text-[#5d4037] uppercase tracking-widest">Sessions</th>
                        <th className="px-3 py-1.5 text-left font-black text-[#5d4037] uppercase tracking-widest">Reason</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-[#fff3cd]">
                      {result.unresolved.map((u: UnresolvedSession, i: number) => (
                        <tr key={i} className="hover:bg-[#fffde7]">
                          <td className="px-3 py-1.5 font-bold text-[#333]">
                            {u.courseCode}
                            <span className="block text-[9px] font-normal text-[#666]">{u.courseName}</span>
                          </td>
                          <td className="px-3 py-1.5 text-[#555]">{u.facultyName}</td>
                          <td className="px-3 py-1.5 text-[#555] max-w-[120px]">
                            <span className="truncate block">{u.cohorts.join(', ')}</span>
                          </td>
                          <td className="px-3 py-1.5">
                            <span className={`font-bold ${u.sessionsPlaced === 0 ? 'text-[#ac2925]' : 'text-[#f57f17]'}`}>
                              {u.sessionsPlaced}/{u.sessionsNeeded}
                            </span>
                          </td>
                          <td className="px-3 py-1.5 text-[#666]">{u.reason}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          )}

          {/* Idle hint */}
          {stage === 'idle' && (
            <div className="bg-white border border-[#e2e8f0] shadow-sm p-8 text-center space-y-3">
              <div className="w-14 h-14 mx-auto flex items-center justify-center" style={{ background: 'linear-gradient(135deg, #eff6ff, #e0f2fe)' }}>
                <Zap className="w-7 h-7 text-[#93c5fd]" />
              </div>
              <div>
                <p className="text-[12px] font-black text-[#94a3b8] uppercase tracking-widest">Results appear here</p>
                <p className="text-[10px] text-[#cbd5e1] mt-1">Upload a course template and click Generate</p>
              </div>
            </div>
          )}

          {/* Column format reference */}
          <div className="bg-white border border-[#e2e8f0] shadow-sm p-4 space-y-3">
            <div className="flex items-center gap-2 pb-2.5 border-b border-[#f1f5f9]">
              <span className="text-[11px] font-black text-[#0f172a] uppercase tracking-wide">Template Column Reference</span>
            </div>
            <div className="grid grid-cols-2 gap-x-4 gap-y-0.5">
              {[
                ['FacultyID', 'e.g. 600001'],
                ['FacultyName', 'e.g. John Smith'],
                ['CourseCode', 'e.g. CS301'],
                ['CourseName', 'e.g. Data Structures'],
                ['Credits', '3 = 3 sessions/week'],
                ['Category', 'Theory / Lab / Tutorial / Studio'],
                ['Campus', 'K1, K2, AB, RD…'],
                ['Cohort1–12', 'shared cohorts on one row'],
                ['FixedRoom', 'optional specific room'],
                ['WorkingDays', 'Mon-Fri or Tue-Sat'],
                ['TimeStart', '8 or 10'],
                ['TimeEnd', '16 or 18'],
                ['LunchStart', '12, 13, or 14'],
              ].map(([col, desc]) => (
                <div key={col} className="flex gap-1 items-start py-0.5">
                  <span className="text-[9px] font-black text-[#185baf] shrink-0 min-w-[80px]">{col}</span>
                  <span className="text-[9px] text-[#888]">{desc}</span>
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
