import React, { useState, useRef } from 'react';
import * as XLSX from 'xlsx';
import {
  Upload, Download, FileSpreadsheet, CheckCircle2, AlertTriangle,
  Loader2, X, BookOpen, BarChart2, RefreshCw, Info
} from 'lucide-react';

// ─── Types ────────────────────────────────────────────────────────────────────

interface GradeRow {
  studentId: string;
  studentName: string;
  programCode: string;
  programName: string;
  semester: number;
  course: string;
  credits: number;
  status: 'PASS' | 'FAIL';
}

interface ProgramCourse {
  programCode: string;
  programName: string;
  semester: number;
  course: string;
  credits: number;
}

interface TTSession {
  day: string;
  startMin: number;
  endMin: number;
  moduleId: string;
  cohort: string;
}

interface OutputRow {
  studentId: string;
  studentName: string;
  programCode: string;
  programName: string;
  course: string;
  credits: number;
  source: string;
  allocationStatus: string;
  targetSemester: string | number;
  availableCohorts: string;
  recommendedCohort: string;
  clashWith: string;
  remarks: string;
}

interface StudentSummary {
  studentId: string;
  studentName: string;
  programCode: string;
  programName: string;
  detained: boolean;
  failureRate: number;
  totalCredits: number;
  failedCredits: number;
  rows: OutputRow[];
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

const BUDGET = 27;

function col(row: Record<string, unknown>, ...keys: string[]): string {
  for (const k of keys) {
    if (row[k] !== undefined && row[k] !== null && row[k] !== '') return String(row[k]).trim();
    const norm = k.toLowerCase().replace(/[\s_-]/g, '');
    const found = Object.keys(row).find(rk => rk.toLowerCase().replace(/[\s_-]/g, '') === norm);
    if (found !== undefined && row[found] !== undefined && row[found] !== null && row[found] !== '') return String(row[found]).trim();
  }
  return '';
}

function parseSem(val: string | number): number {
  const s = String(val || 0);
  const m = s.match(/\d+/);
  return m ? parseInt(m[0]) : 0;
}

function toMin(t: string): number {
  const parts = String(t || '').split(':');
  return (parseInt(parts[0]) || 0) * 60 + (parseInt(parts[1]) || 0);
}

function normalId(id: string): string {
  return id.toUpperCase().replace(/\s+/g, '');
}

function sessionsClash(a: TTSession, b: TTSession): boolean {
  return a.day === b.day && a.startMin < b.endMin && b.startMin < a.endMin;
}

function isFailStatus(s: string): boolean {
  const u = s.toUpperCase().trim();
  return u === 'FAIL' || u === 'F' || u === 'AB' || u === 'ABSENT' || u === 'U' || u === 'E' || u === 'WF';
}

// ─── Parsers ──────────────────────────────────────────────────────────────────

function parseGrades(rows: Record<string, unknown>[]): GradeRow[] {
  return rows.filter(r => col(r, 'Student ID', 'StudentID', 'Roll No', 'Roll Number')).map(r => ({
    studentId: col(r, 'Student ID', 'StudentID', 'student_id', 'STUDENT ID', 'Roll No', 'Roll Number'),
    studentName: col(r, 'Student Name', 'StudentName', 'student_name', 'STUDENT NAME', 'Name', 'NAME'),
    programCode: col(r, 'Program Code', 'ProgramCode', 'program_code', 'PROGRAM CODE', 'Programme Code', 'Program'),
    programName: col(r, 'Program Name', 'ProgramName', 'program_name', 'PROGRAM NAME', 'Programme Name'),
    semester: parseSem(col(r, 'Semester', 'SEM', 'sem', 'SEMESTER', 'Sem No', 'Sem')),
    course: col(r, 'Course', 'COURSE', 'Course ID', 'CourseID', 'course_id', 'Course Code', 'Module', 'Subject Code', 'Subject'),
    credits: parseFloat(col(r, 'Credits', 'CREDITS', 'Credit', 'credit', 'Credit Hours')) || 0,
    status: isFailStatus(col(r, 'Status', 'STATUS', 'Pass/Fail', 'Result', 'RESULT', 'Pass / Fail', 'Grade Status')) ? 'FAIL' : 'PASS',
  }));
}

function parseProgramCourses(rows: Record<string, unknown>[]): ProgramCourse[] {
  return rows.filter(r => col(r, 'Program Code', 'ProgramCode', 'program_code', 'Programme Code')).map(r => ({
    programCode: col(r, 'Program Code', 'ProgramCode', 'program_code', 'Programme Code', 'Program'),
    programName: col(r, 'Program Name', 'ProgramName', 'program_name', 'Programme Name'),
    semester: parseSem(col(r, 'Semester', 'SEM', 'sem', 'SEMESTER')),
    course: col(r, 'Course', 'COURSE', 'Course ID', 'CourseID', 'course_id', 'Course Code', 'Subject Code', 'Subject'),
    credits: parseFloat(col(r, 'Credits', 'CREDITS', 'Credit', 'credit')) || 0,
  }));
}

function parseTimetable(rows: Record<string, unknown>[]): TTSession[] {
  return rows
    .filter(r => col(r, '_day_of_week', 'Day', 'day', 'DAY'))
    .map(r => ({
      day: col(r, '_day_of_week', 'Day', 'day').toLowerCase(),
      startMin: toMin(col(r, '_start_time', 'Start Time', 'startTime', 'start', 'From', 'Start')),
      endMin: toMin(col(r, '_end_time', 'End Time', 'endTime', 'end', 'To', 'End')),
      moduleId: normalId(col(r, 'Module Unique ID', '_module_id', 'ModuleID', 'Module ID', 'Course', 'Course ID', 'CourseID', 'Subject Code', 'Module')),
      cohort: col(r, 'Cohort', 'cohort', 'Group', 'group', 'COHORT', 'Student Group', 'Batch'),
    }))
    .filter(s => s.day && s.endMin > s.startMin && s.moduleId);
}

// ─── Core algorithm ───────────────────────────────────────────────────────────

function sessionsForCourse(courseId: string, tt: TTSession[]): TTSession[] {
  const nid = normalId(courseId);
  return tt.filter(s => s.moduleId === nid || s.moduleId.startsWith(nid) || nid.startsWith(s.moduleId));
}

function cohortsForCourse(courseId: string, tt: TTSession[]): string[] {
  return [...new Set(sessionsForCourse(courseId, tt).map(s => s.cohort).filter(Boolean))];
}

function clashCountBetween(cA: string, cB: string, tt: TTSession[]): number {
  const sA = sessionsForCourse(cA, tt);
  const sB = sessionsForCourse(cB, tt);
  let n = 0;
  for (const a of sA) for (const b of sB) if (sessionsClash(a, b)) n++;
  return n;
}

function bestCohort(courseId: string, avoidSessions: TTSession[], tt: TTSession[]): string {
  const cohorts = cohortsForCourse(courseId, tt);
  if (cohorts.length === 0) return '';
  const nid = normalId(courseId);
  for (const c of cohorts) {
    const mine = tt.filter(s => s.cohort === c && (s.moduleId === nid || s.moduleId.startsWith(nid) || nid.startsWith(s.moduleId)));
    if (!mine.some(m => avoidSessions.some(o => sessionsClash(m, o)))) return c;
  }
  return cohorts[0];
}

function allocateBacklogs(
  studentId: string, studentName: string, programCode: string, programName: string,
  backlogs: GradeRow[], mainSem: number,
  programCourses: ProgramCourse[], tt: TTSession[], rows: OutputRow[],
  budget: number
) {
  const backlogCredits = backlogs.reduce((s, g) => s + g.credits, 0);
  const remaining = budget - backlogCredits;
  const backlogSessions: TTSession[] = backlogs.flatMap(bg => sessionsForCourse(bg.course, tt));

  for (const bg of backlogs) {
    const cohorts = cohortsForCourse(bg.course, tt);
    const mySessions = sessionsForCourse(bg.course, tt);
    const otherBacklogSessions = backlogSessions.filter(s => !mySessions.includes(s));
    const rec = bestCohort(bg.course, otherBacklogSessions, tt);
    rows.push({
      studentId, studentName, programCode, programName,
      course: bg.course, credits: bg.credits,
      source: `Sem ${bg.semester} Backlog`,
      allocationStatus: 'MAPPED — Mandatory',
      targetSemester: mainSem,
      availableCohorts: cohorts.join(', ') || 'Not in timetable',
      recommendedCohort: rec || '—', clashWith: '—',
      remarks: cohorts.length === 0 ? 'Course not found in timetable — manual mapping needed' : 'Backlog course — mandatory',
    });
  }

  const mainCourses = programCourses.filter(pc => pc.programCode === programCode && pc.semester === mainSem);

  if (remaining <= 0) {
    for (const mc of mainCourses) {
      rows.push({
        studentId, studentName, programCode, programName,
        course: mc.course, credits: mc.credits,
        source: `Sem ${mainSem} Main`,
        allocationStatus: 'NOT MAPPED — Budget Exceeded',
        targetSemester: mainSem,
        availableCohorts: '—', recommendedCohort: '—', clashWith: '—',
        remarks: `Backlog credits (${backlogCredits}) already reach/exceed budget (${budget}) — Sem ${mainSem} course not mapped`,
      });
    }
    return;
  }

  const scored = mainCourses.map(mc => {
    let clashTotal = 0;
    const clashWith: string[] = [];
    for (const bg of backlogs) {
      const cnt = clashCountBetween(mc.course, bg.course, tt);
      if (cnt > 0) { clashTotal += cnt; clashWith.push(`${bg.course}(${cnt})`); }
    }
    return { mc, clashTotal, clashWith: clashWith.join(', ') };
  });

  scored.sort((a, b) => a.clashTotal - b.clashTotal);

  let budgetUsed = 0;
  for (const { mc, clashTotal, clashWith } of scored) {
    if (budgetUsed + mc.credits <= remaining) {
      const cohorts = cohortsForCourse(mc.course, tt);
      const rec = bestCohort(mc.course, backlogSessions, tt);
      rows.push({
        studentId, studentName, programCode, programName,
        course: mc.course, credits: mc.credits,
        source: `Sem ${mainSem} Main`,
        allocationStatus: clashTotal === 0 ? 'SELECTED' : 'SELECTED — Has Clashes',
        targetSemester: mainSem,
        availableCohorts: cohorts.join(', ') || 'Not in timetable',
        recommendedCohort: rec || '—',
        clashWith: clashWith || '—',
        remarks: clashTotal === 0
          ? 'Selected — no clash with backlog sessions'
          : `Selected — ${clashTotal} session clash(es) with backlog; verify cohort`,
      });
      budgetUsed += mc.credits;
    } else {
      rows.push({
        studentId, studentName, programCode, programName,
        course: mc.course, credits: mc.credits,
        source: `Sem ${mainSem} Main`,
        allocationStatus: 'NOT MAPPED — Budget Exceeded',
        targetSemester: mainSem,
        availableCohorts: '—', recommendedCohort: '—',
        clashWith: clashWith || '—',
        remarks: `Budget exhausted (${budget} credit limit: ${backlogCredits} backlog + ${budgetUsed} Sem ${mainSem} used) — not mapped`,
      });
    }
  }
}

function computeAll(grades: GradeRow[], programCourses: ProgramCourse[], tt: TTSession[]): StudentSummary[] {
  const studentMap = new Map<string, { grades: GradeRow[]; first: GradeRow }>();
  for (const g of grades) {
    const existing = studentMap.get(g.studentId);
    if (existing) existing.grades.push(g);
    else studentMap.set(g.studentId, { grades: [g], first: g });
  }

  return [...studentMap.entries()].map(([sid, { grades: sg, first }]) => {
    const sem1and2 = sg.filter(g => g.semester === 1 || g.semester === 2);
    const totalCredits = sem1and2.reduce((s, g) => s + g.credits, 0);
    const failedCredits = sem1and2.filter(g => g.status === 'FAIL').reduce((s, g) => s + g.credits, 0);
    const failureRate = totalCredits > 0 ? failedCredits / totalCredits : 0;
    const detained = failureRate >= 0.5;
    const rows: OutputRow[] = [];

    if (!detained) {
      rows.push({
        studentId: sid, studentName: first.studentName, programCode: first.programCode, programName: first.programName,
        course: '—', credits: 0, source: '—',
        allocationStatus: 'NOT DETAINED', targetSemester: '—',
        availableCohorts: '—', recommendedCohort: '—', clashWith: '—',
        remarks: `Failure rate ${(failureRate * 100).toFixed(1)}% < 50% — normal progression`,
      });
    } else {
      const sem1fails = sg.filter(g => g.semester === 1 && g.status === 'FAIL');
      if (sem1fails.length > 0) {
        // Budget = min(27, sum of all Sem 3 course credits for this program in the master)
        const sem3Credits = programCourses
          .filter(pc => pc.programCode === first.programCode && pc.semester === 3)
          .reduce((s, pc) => s + pc.credits, 0);
        const budget = sem3Credits > 0 ? Math.min(27, sem3Credits) : 27;
        allocateBacklogs(sid, first.studentName, first.programCode, first.programName, sem1fails, 3, programCourses, tt, rows, budget);
      }
    }

    return { studentId: sid, studentName: first.studentName, programCode: first.programCode, programName: first.programName, detained, failureRate, totalCredits, failedCredits, rows };
  });
}

// ─── Excel helpers ────────────────────────────────────────────────────────────

function readFirstSheet(file: File): Promise<Record<string, unknown>[]> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = e => {
      try {
        const data = new Uint8Array(e.target!.result as ArrayBuffer);
        const wb = XLSX.read(data, { type: 'array' });
        const ws = wb.Sheets[wb.SheetNames[0]];
        resolve(XLSX.utils.sheet_to_json(ws, { defval: '' }) as Record<string, unknown>[]);
      } catch (err) { reject(err); }
    };
    reader.onerror = reject;
    reader.readAsArrayBuffer(file);
  });
}

function dlTemplate(type: 1 | 2) {
  let ws: XLSX.WorkSheet;
  let sheetName: string;
  let fileName: string;
  if (type === 1) {
    ws = XLSX.utils.aoa_to_sheet([
      ['Student ID', 'Student Name', 'Program Code', 'Program Name', 'Semester', 'Course', 'Credits', 'Grade', 'Status'],
      ['STU001', 'John Smith', 'BCA', 'Bachelor of Computer Applications', 1, 'MATH101', 4, 'F', 'FAIL'],
      ['STU001', 'John Smith', 'BCA', 'Bachelor of Computer Applications', 1, 'CS101', 3, 'B+', 'PASS'],
      ['STU001', 'John Smith', 'BCA', 'Bachelor of Computer Applications', 2, 'PHYS201', 4, 'F', 'FAIL'],
      ['STU002', 'Jane Doe', 'BCA', 'Bachelor of Computer Applications', 1, 'MATH101', 4, 'C', 'PASS'],
    ]);
    sheetName = 'Student Grades'; fileName = 'Template_StudentGrades.xlsx';
  } else {
    ws = XLSX.utils.aoa_to_sheet([
      ['Program Code', 'Program Name', 'Semester', 'Course', 'Credits'],
      ['BCA', 'Bachelor of Computer Applications', 1, 'MATH101', 4],
      ['BCA', 'Bachelor of Computer Applications', 1, 'CS101', 3],
      ['BCA', 'Bachelor of Computer Applications', 2, 'PHYS201', 4],
      ['BCA', 'Bachelor of Computer Applications', 3, 'DBMS301', 4],
      ['BCA', 'Bachelor of Computer Applications', 3, 'OS301', 3],
    ]);
    sheetName = 'Program Courses'; fileName = 'Template_ProgramCourseMaster.xlsx';
  }
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, sheetName);
  XLSX.writeFile(wb, fileName);
}

function exportResults(summaries: StudentSummary[]) {
  const allRows = summaries.flatMap(s => s.rows).map(r => ({
    'Student ID': r.studentId,
    'Student Name': r.studentName,
    'Program Code': r.programCode,
    'Program Name': r.programName,
    'Course': r.course,
    'Credits': r.credits,
    'Source': r.source,
    'Allocation Status': r.allocationStatus,
    'Target Semester': r.targetSemester,
    'Available Cohorts': r.availableCohorts,
    'Recommended Cohort': r.recommendedCohort,
    'Clash With': r.clashWith,
    'Remarks': r.remarks,
  }));

  const detained = summaries.filter(s => s.detained).map(s => ({
    'Student ID': s.studentId,
    'Student Name': s.studentName,
    'Program Code': s.programCode,
    'Program Name': s.programName,
    'Total Credits (Sem1+2)': s.totalCredits,
    'Failed Credits': s.failedCredits,
    'Failure Rate %': parseFloat((s.failureRate * 100).toFixed(1)),
    'Status': 'DETAINED',
  }));

  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(allRows), 'Backlog Allocation');
  XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(detained), 'Detained Students');
  XLSX.writeFile(wb, `BacklogAllocation_${new Date().toISOString().slice(0, 10)}.xlsx`);
}

// ─── Sub-components ───────────────────────────────────────────────────────────

interface UploadCardProps {
  number: number;
  title: string;
  description: string;
  columns: string[];
  file: File | null;
  inputRef: React.RefObject<HTMLInputElement>;
  onFileChange: (f: File | null) => void;
  onDownloadTemplate: (() => void) | null;
  footerNote?: string;
}

const UploadCard: React.FC<UploadCardProps> = ({ number, title, description, columns, file, inputRef, onFileChange, onDownloadTemplate, footerNote }) => (
  <div className="bg-white border border-slate-200 p-4 flex flex-col gap-3">
    <div>
      <div className="flex items-center gap-2 mb-1">
        <span className="w-5 h-5 bg-[#185baf] text-white text-[10px] font-bold flex items-center justify-center shrink-0">{number}</span>
        <span className="text-[12px] font-bold text-[#1e293b]">{title}</span>
      </div>
      <p className="text-[10px] text-[#64748b]">{description}</p>
    </div>

    <div className="bg-[#f8faff] border border-dashed border-[#ccd9f0] p-2">
      <p className="text-[9px] text-[#64748b] font-bold uppercase mb-1">Required Columns</p>
      <div className="flex flex-wrap gap-1">
        {columns.map(c => (
          <span key={c} className="text-[9px] bg-[#e8eef8] text-[#3b5ea6] px-1.5 py-0.5 font-mono">{c}</span>
        ))}
      </div>
    </div>

    {file ? (
      <div className="flex items-center gap-2 bg-green-50 border border-green-200 p-2">
        <CheckCircle2 className="w-4 h-4 text-green-600 shrink-0" />
        <div className="min-w-0 flex-1">
          <p className="text-[11px] font-bold text-green-700 truncate">{file.name}</p>
          <p className="text-[10px] text-green-600">{(file.size / 1024).toFixed(1)} KB</p>
        </div>
        <button onClick={() => onFileChange(null)} className="shrink-0 text-green-600 hover:text-red-500 transition-colors">
          <X className="w-3.5 h-3.5" />
        </button>
      </div>
    ) : (
      <button
        onClick={() => inputRef.current?.click()}
        className="flex items-center justify-center gap-2 py-3 border border-dashed border-[#ccc] hover:border-[#185baf] hover:bg-[#f0f6ff] transition-colors text-[11px] text-[#555] font-medium"
      >
        <Upload className="w-4 h-4" />
        Click to upload (.xlsx, .xls, .csv)
      </button>
    )}

    <input
      ref={inputRef}
      type="file"
      accept=".xlsx,.xls,.csv"
      className="hidden"
      onChange={e => { const f = e.target.files?.[0]; onFileChange(f || null); e.target.value = ''; }}
    />

    <div className="mt-auto">
      {onDownloadTemplate ? (
        <button onClick={onDownloadTemplate} className="flex items-center gap-1.5 text-[10px] text-[#185baf] hover:underline">
          <Download className="w-3 h-3" /> Download template
        </button>
      ) : footerNote ? (
        <p className="text-[10px] text-[#94a3b8]">{footerNote}</p>
      ) : null}
    </div>
  </div>
);

const StatCard: React.FC<{ label: string; value: number; color?: 'red' | 'green' | 'blue' }> = ({ label, value, color }) => (
  <div className="bg-[#f8f9fa] border border-slate-200 p-3 text-center">
    <div className={`text-[22px] font-black ${color === 'red' ? 'text-red-600' : color === 'green' ? 'text-green-600' : 'text-[#185baf]'}`}>{value}</div>
    <div className="text-[10px] text-[#64748b] font-bold uppercase mt-0.5">{label}</div>
  </div>
);

// ─── Main component ───────────────────────────────────────────────────────────

const BacklogPanel: React.FC = () => {
  const [files, setFiles] = useState<{ f1: File | null; f2: File | null; f3: File | null }>({ f1: null, f2: null, f3: null });
  const [processing, setProcessing] = useState(false);
  const [results, setResults] = useState<StudentSummary[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const ref1 = useRef<HTMLInputElement>(null);
  const ref2 = useRef<HTMLInputElement>(null);
  const ref3 = useRef<HTMLInputElement>(null);

  const handleProcess = async () => {
    if (!files.f1 || !files.f2 || !files.f3) {
      setError('Please upload all three files before processing.');
      return;
    }
    setProcessing(true);
    setError(null);
    setResults(null);
    try {
      const [raw1, raw2, raw3] = await Promise.all([
        readFirstSheet(files.f1),
        readFirstSheet(files.f2),
        readFirstSheet(files.f3),
      ]);
      if (raw1.length === 0) throw new Error('Sheet 1 (Student Grades) is empty or unreadable.');
      if (raw2.length === 0) throw new Error('Sheet 2 (Program Course Master) is empty or unreadable.');

      const grades = parseGrades(raw1);
      const programCourses = parseProgramCourses(raw2);
      const tt = parseTimetable(raw3);

      if (grades.length === 0) throw new Error('Could not parse student grades. Ensure column headers match the template (e.g., "Student ID", "Course", "Status").');
      if (programCourses.length === 0) throw new Error('Could not parse program courses. Ensure column headers match the template (e.g., "Program Code", "Semester", "Course").');

      const summaries = computeAll(grades, programCourses, tt);
      setResults(summaries);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'An error occurred during processing.');
    } finally {
      setProcessing(false);
    }
  };

  const detained = results?.filter(s => s.detained) ?? [];
  const allRows = results?.flatMap(s => s.rows) ?? [];
  const allUploaded = files.f1 && files.f2 && files.f3;

  return (
    <div className="h-full flex flex-col bg-[#f0f6ff] overflow-auto custom-scrollbar">
      {/* Header */}
      <div className="bg-white border-b border-slate-200 px-6 py-4 shrink-0">
        <div className="flex items-center gap-3">
          <div className="w-9 h-9 bg-[#185baf] flex items-center justify-center">
            <BookOpen className="w-5 h-5 text-white" />
          </div>
          <div>
            <h1 className="text-[15px] font-bold text-[#1e293b]">Backlog Student Analyzer</h1>
            <p className="text-[11px] text-[#64748b]">Identify detained students and generate their course allocation plan with clash detection</p>
          </div>
        </div>
      </div>

      <div className="flex-1 px-6 py-5 space-y-5 max-w-5xl mx-auto w-full">
        {/* How it works */}
        <div className="bg-blue-50 border border-blue-200 p-3 text-[11px] text-[#1e3a5f] flex gap-3 items-start">
          <Info className="w-4 h-4 shrink-0 mt-0.5 text-[#185baf]" />
          <div>
            <span className="font-bold">How it works: </span>
            Upload 3 files → click Generate → download the allocation report.
            The tool identifies detained students (≥ 50% of Sem 1 + Sem 2 credits failed),
            maps backlog courses first (mandatory, within 27-credit budget per semester),
            then fills remaining budget with current semester courses — prioritising clash-free options.{' '}
            <strong>This tool is read-only and does not modify any timetable data.</strong>
          </div>
        </div>

        {/* Upload cards */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <UploadCard
            number={1}
            title="Student Grade Data"
            description="All Sem 1 + Sem 2 records with pass/fail status for every student"
            columns={['Student ID', 'Student Name', 'Program Code', 'Semester', 'Course', 'Credits', 'Status']}
            file={files.f1}
            inputRef={ref1}
            onFileChange={f => setFiles(prev => ({ ...prev, f1: f }))}
            onDownloadTemplate={() => dlTemplate(1)}
          />
          <UploadCard
            number={2}
            title="Program Course Master"
            description="Full course structure — which courses belong to which program and semester"
            columns={['Program Code', 'Program Name', 'Semester', 'Course', 'Credits']}
            file={files.f2}
            inputRef={ref2}
            onFileChange={f => setFiles(prev => ({ ...prev, f2: f }))}
            onDownloadTemplate={() => dlTemplate(2)}
          />
          <UploadCard
            number={3}
            title="Combined Timetable"
            description="Merged timetable export from both UniTime deployments in one sheet"
            columns={['_day_of_week', '_start_time', '_end_time', 'Module Unique ID', 'Cohort']}
            file={files.f3}
            inputRef={ref3}
            onFileChange={f => setFiles(prev => ({ ...prev, f3: f }))}
            onDownloadTemplate={null}
            footerNote="Go to Reports → Export Excel in each deployment, then copy all rows into one combined sheet."
          />
        </div>

        {/* Process button */}
        <div className="flex items-center gap-3">
          <button
            onClick={handleProcess}
            disabled={!allUploaded || processing}
            className="flex items-center gap-2 px-5 py-2.5 bg-[#185baf] text-white text-[13px] font-bold disabled:opacity-40 disabled:cursor-not-allowed hover:bg-[#124a99] transition-colors"
          >
            {processing ? <Loader2 className="w-4 h-4 animate-spin" /> : <BarChart2 className="w-4 h-4" />}
            {processing ? 'Processing...' : 'Generate Allocation Report'}
          </button>
          {!allUploaded && !processing && (
            <span className="text-[11px] text-[#94a3b8]">Upload all 3 files to enable</span>
          )}
          {results && (
            <button
              onClick={() => { setResults(null); setFiles({ f1: null, f2: null, f3: null }); setError(null); }}
              className="flex items-center gap-2 px-4 py-2.5 border border-[#ccc] text-[12px] text-[#555] hover:bg-[#f0f0f0] transition-colors"
            >
              <RefreshCw className="w-3.5 h-3.5" /> Reset
            </button>
          )}
        </div>

        {/* Error banner */}
        {error && (
          <div className="flex items-start gap-3 bg-red-50 border border-red-200 p-3 text-[12px] text-red-700">
            <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" />
            <span>{error}</span>
          </div>
        )}

        {/* Results */}
        {results && (
          <div className="space-y-4">
            <div className="bg-white border border-slate-200 p-4">
              <div className="flex items-center justify-between mb-4">
                <h2 className="text-[13px] font-bold text-[#1e293b]">Results</h2>
                <button
                  onClick={() => exportResults(results)}
                  className="flex items-center gap-2 px-4 py-2 bg-[#185baf] text-white text-[12px] font-bold hover:bg-[#124a99] transition-colors"
                >
                  <Download className="w-3.5 h-3.5" /> Download Report (.xlsx)
                </button>
              </div>
              <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                <StatCard label="Total Students" value={results.length} color="blue" />
                <StatCard label="Detained" value={detained.length} color="red" />
                <StatCard label="Not Detained" value={results.length - detained.length} color="green" />
                <StatCard label="Allocation Rows" value={allRows.length} />
              </div>
            </div>

            {detained.length > 0 && (
              <div className="bg-white border border-slate-200">
                <div className="px-4 py-2.5 border-b border-slate-100 flex items-center gap-2">
                  <AlertTriangle className="w-4 h-4 text-orange-500" />
                  <h3 className="text-[12px] font-bold text-[#1e293b]">Detained Students ({detained.length})</h3>
                  <span className="ml-auto text-[10px] text-[#94a3b8]">Full details in downloaded report</span>
                </div>
                <div className="overflow-x-auto">
                  <table className="w-full text-[11px]">
                    <thead>
                      <tr className="bg-[#f8f9fa] border-b border-slate-200">
                        <th className="text-left px-3 py-2 font-bold text-[#666] uppercase tracking-wide">Student ID</th>
                        <th className="text-left px-3 py-2 font-bold text-[#666] uppercase tracking-wide">Name</th>
                        <th className="text-left px-3 py-2 font-bold text-[#666] uppercase tracking-wide">Program</th>
                        <th className="text-right px-3 py-2 font-bold text-[#666] uppercase tracking-wide">Total Credits</th>
                        <th className="text-right px-3 py-2 font-bold text-[#666] uppercase tracking-wide">Failed</th>
                        <th className="text-right px-3 py-2 font-bold text-[#666] uppercase tracking-wide">Rate</th>
                      </tr>
                    </thead>
                    <tbody>
                      {detained.slice(0, 100).map((s, i) => (
                        <tr key={s.studentId} className={`border-b border-slate-100 ${i % 2 === 0 ? '' : 'bg-[#fafafa]'}`}>
                          <td className="px-3 py-1.5 font-mono text-[10px]">{s.studentId}</td>
                          <td className="px-3 py-1.5">{s.studentName}</td>
                          <td className="px-3 py-1.5 text-[#555]">{s.programCode}</td>
                          <td className="px-3 py-1.5 text-right">{s.totalCredits}</td>
                          <td className="px-3 py-1.5 text-right text-red-600 font-bold">{s.failedCredits}</td>
                          <td className="px-3 py-1.5 text-right">
                            <span className="bg-red-100 text-red-700 px-1.5 py-0.5 font-bold text-[10px]">
                              {(s.failureRate * 100).toFixed(1)}%
                            </span>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                  {detained.length > 100 && (
                    <p className="px-4 py-2 text-[11px] text-[#999] border-t border-slate-100">
                      Showing 100 of {detained.length} detained students — download the report for the full list with allocation details.
                    </p>
                  )}
                </div>
              </div>
            )}

            <div className="flex items-center gap-2 text-[11px] text-[#64748b] pb-4">
              <CheckCircle2 className="w-4 h-4 text-green-600" />
              Report generated — the downloaded Excel file contains two sheets: "Backlog Allocation" (all course mappings with cohort suggestions) and "Detained Students" (summary).
            </div>
          </div>
        )}
      </div>
    </div>
  );
};

export default BacklogPanel;
