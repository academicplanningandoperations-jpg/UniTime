import type { Course, Faculty, Room, StudentGroup, ScheduleEntry } from '../types';

export interface CourseAssignment {
  facultyId: string;
  facultyName: string;
  courseCode: string;
  courseName: string;
  credits: number;
  category: string;        // 'Theory' | 'Lab' | 'Tutorial' | 'Studio'
  campus: string;
  cohorts: string[];
  fixedRoom: string;
  preferredRooms: string[];  // tried before campus fallback (comma-sep in CSV)
  labHours: number;          // 2 (default) or 4
  semester: string;          // label only — e.g. "Semester 1", "Sem 3"
  dayForBlock: string;       // e.g. "Monday" or "Monday,Wednesday" — blocks that slot
  timeForBlock: string;      // e.g. "10" or "8,9,14" — hour numbers to block
  workingDays: string;       // 'Mon-Fri' | 'Tue-Sat'
  timeStart: number;         // 8 or 10
  timeEnd: number;           // 16 or 18
  lunchStart: number;        // e.g. 13
}

export interface UnresolvedSession {
  courseCode: string;
  courseName: string;
  facultyName: string;
  cohorts: string[];
  category: string;
  sessionsNeeded: number;
  sessionsPlaced: number;
  reason: string;
}

export interface SchedulerResult {
  entries: ScheduleEntry[];
  unresolved: UnresolvedSession[];
  stats: { totalSessions: number; placed: number; unresolvedCount: number };
}

// ─── helpers ────────────────────────────────────────────────────────────────

const DAYS_MAP: Record<string, string[]> = {
  'Mon-Fri': ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday'],
  'Tue-Sat': ['Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'],
};

const ALL_DAYS = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

function pad(h: number) { return `${String(h).padStart(2, '0')}:00`; }

function buildSlots(start: number, end: number, lunch: number, dur: number) {
  const out: { startTime: string; endTime: string }[] = [];
  for (let h = start; h + dur <= end; h++) {
    if (h < lunch + 1 && h + dur > lunch) continue;
    out.push({ startTime: pad(h), endTime: pad(h + dur) });
  }
  return out;
}

function slotKeys(day: string, st: string, et: string): string[] {
  const keys: string[] = [];
  for (let h = parseInt(st); h < parseInt(et); h++) keys.push(`${day}~${pad(h)}`);
  return keys;
}

function isFree(occ: Map<string, Set<string>>, id: string, keys: string[]) {
  const s = occ.get(id);
  return !s || keys.every(k => !s.has(k));
}

function markBusy(occ: Map<string, Set<string>>, id: string, keys: string[]) {
  if (!occ.has(id)) occ.set(id, new Set());
  keys.forEach(k => occ.get(id)!.add(k));
}

function shuffle<T>(arr: T[]): T[] {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

function parseDayForBlock(s: string): string[] {
  if (!s.trim()) return [];
  if (DAYS_MAP[s.trim()]) return DAYS_MAP[s.trim()];
  return s.split(',').map(d => d.trim()).filter(d => ALL_DAYS.includes(d));
}

function parseTimeForBlock(s: string): number[] {
  return s.split(',').map(t => parseInt(t.trim())).filter(n => !isNaN(n) && n >= 0 && n <= 23);
}

// ─── main scheduler ──────────────────────────────────────────────────────────

export async function runAutoScheduler(
  assignments: CourseAssignment[],
  roomCampusMap: Map<string, string>,
  existingCourses: Course[],
  existingFaculties: Faculty[],
  existingRooms: Room[],
  existingGroups: StudentGroup[],
  termId: string,
  weeks: number[],
  onProgress: (placed: number, total: number, label: string) => void
): Promise<SchedulerResult> {

  const entries: ScheduleEntry[] = [];
  const unresolved: UnresolvedSession[] = [];

  const facultyOcc = new Map<string, Set<string>>();
  const cohortOcc  = new Map<string, Set<string>>();
  const roomOcc    = new Map<string, Set<string>>();
  const usedDays   = new Map<string, Set<string>>();

  const findCourse  = (code: string) =>
    existingCourses.find(c => c.code === code || (c as any)._unique_name === code || c.name === code);

  const findFaculty = (id: string, name: string) =>
    existingFaculties.find(f =>
      f.facultyId === id || f.id === id ||
      (f as any)._Faculty_ID === id ||
      f.name === name || (f as any)._Faculty_name === name
    );

  const findGroup = (name: string) =>
    existingGroups.find(g => g.name === name || (g as any)._unique_name === name);

  const findRoom = (name: string) =>
    existingRooms.find(r => r.name === name || (r as any)._unique_name === name);

  // ── Pre-pass: apply Day-For-Block / Time-For-Block from ANY row ──────────
  // A row with these columns filled marks those slots as occupied for the
  // listed faculty/cohorts BEFORE any session is placed — keeping them free.
  for (const asgn of assignments) {
    if (!asgn.dayForBlock.trim() || !asgn.timeForBlock.trim()) continue;
    const blockDays  = parseDayForBlock(asgn.dayForBlock);
    const blockHours = parseTimeForBlock(asgn.timeForBlock);
    const faculty    = findFaculty(asgn.facultyId, asgn.facultyName);
    const groups     = asgn.cohorts.map(findGroup).filter(Boolean) as StudentGroup[];

    for (const day of blockDays) {
      for (const hour of blockHours) {
        const key = `${day}~${pad(hour)}`;
        if (faculty) markBusy(facultyOcc, faculty.id, [key]);
        groups.forEach(g => markBusy(cohortOcc, g.id, [key]));
      }
    }
  }

  // ── Collect schedulable rows: must have courseCode + credits > 0 ─────────
  const courseRows = assignments.filter(a => a.courseCode.trim() && a.credits > 0);
  const totalSessions = courseRows.reduce((s, a) => s + a.credits, 0);

  // Longer labs first, then by cohort count (harder to place = earlier)
  const sorted = [...courseRows].sort((a, b) => {
    const al = a.category === 'Lab' ? 0 : 1;
    const bl = b.category === 'Lab' ? 0 : 1;
    if (al !== bl) return al - bl;
    if (al === 0) {
      const ah = a.labHours || 2, bh = b.labHours || 2;
      if (ah !== bh) return bh - ah;
    }
    return b.cohorts.length - a.cohorts.length;
  });

  for (let ai = 0; ai < sorted.length; ai++) {
    const asgn = sorted[ai];
    const isLab      = asgn.category === 'Lab';
    const duration   = isLab ? (asgn.labHours || 2) : 1;
    const sessionsNeeded = asgn.credits;
    const days  = DAYS_MAP[asgn.workingDays] || DAYS_MAP['Mon-Fri'];
    const slots = buildSlots(asgn.timeStart || 8, asgn.timeEnd || 16, asgn.lunchStart || 13, duration);

    const course   = findCourse(asgn.courseCode);
    const faculty  = findFaculty(asgn.facultyId, asgn.facultyName);
    const groups   = asgn.cohorts.map(findGroup).filter(Boolean) as StudentGroup[];
    const groupIds = groups.map(g => g.id);

    const dayKey = `${asgn.facultyId}::${asgn.courseCode}::${[...asgn.cohorts].sort().join(',')}`;
    if (!usedDays.has(dayKey)) usedDays.set(dayKey, new Set());
    const takenDays = usedDays.get(dayKey)!;

    let placed = 0;
    const candidates = shuffle(days.flatMap(day => slots.map(sl => ({ day, ...sl }))));

    for (const { day, startTime, endTime } of candidates) {
      if (placed >= sessionsNeeded) break;
      if (takenDays.has(day)) continue;

      const keys = slotKeys(day, startTime, endTime);

      if (faculty && !isFree(facultyOcc, faculty.id, keys)) continue;
      if (groups.some(g => !isFree(cohortOcc, g.id, keys))) continue;

      let pickedRoom: Room | undefined;

      if (asgn.fixedRoom) {
        const r = findRoom(asgn.fixedRoom);
        if (r && isFree(roomOcc, r.id, keys)) pickedRoom = r;
      } else {
        // Try preferred rooms first
        const preferredObjs = asgn.preferredRooms
          .map(name => findRoom(name))
          .filter(Boolean) as Room[];
        pickedRoom = preferredObjs.find(r => isFree(roomOcc, r.id, keys));

        if (!pickedRoom) {
          const campusRooms = existingRooms.filter(r => {
            const campus = roomCampusMap.get(r.name)
              ?? roomCampusMap.get((r as any)._unique_name ?? '')
              ?? '';
            return !asgn.campus || campus === asgn.campus;
          });

          const typeMatched = campusRooms.filter(r => {
            const t = (r.type || '').toLowerCase();
            if (isLab) return t.includes('lab');
            if (asgn.category === 'Studio') return t.includes('studio');
            return !t.includes('lab') && !t.includes('studio') && !t.includes('audit');
          });

          pickedRoom = typeMatched.find(r => isFree(roomOcc, r.id, keys))
            ?? campusRooms.find(r => isFree(roomOcc, r.id, keys));
        }
      }

      if (faculty)    markBusy(facultyOcc, faculty.id, keys);
      groups.forEach(g => markBusy(cohortOcc, g.id, keys));
      if (pickedRoom) markBusy(roomOcc, pickedRoom.id, keys);
      takenDays.add(day);

      entries.push({
        id:           `auto-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
        termId,
        courseId:     course?.id   || asgn.courseCode,
        facultyId:    faculty?.id  || asgn.facultyId,
        roomId:       pickedRoom?.id || '',
        groupIds,
        day,
        startTime,
        endTime,
        departmentId: faculty?.department || course?.department || 'General',
        weeks,
        category:     asgn.category,
      } as ScheduleEntry);

      placed++;
      onProgress(entries.length, totalSessions, `${asgn.courseCode} · ${asgn.cohorts[0] ?? ''}`);
    }

    if (placed < sessionsNeeded) {
      unresolved.push({
        courseCode:     asgn.courseCode,
        courseName:     asgn.courseName,
        facultyName:    asgn.facultyName,
        cohorts:        asgn.cohorts,
        category:       asgn.category,
        sessionsNeeded,
        sessionsPlaced: placed,
        reason: placed === 0
          ? 'No slot available — faculty / cohorts / rooms all booked'
          : `Partial: ${placed} of ${sessionsNeeded} sessions placed`,
      });
    }

    if (ai % 5 === 4) await new Promise(r => setTimeout(r, 0));
  }

  return {
    entries,
    unresolved,
    stats: {
      totalSessions,
      placed: entries.length,
      unresolvedCount: totalSessions - entries.length,
    },
  };
}

// ─── CSV template strings ────────────────────────────────────────────────────

// Header: 29 columns (indices 0-28)
// 0:FacultyID 1:FacultyName 2:CourseCode 3:CourseName 4:Credits 5:Category 6:Campus
// 7-18:Cohort1-12  19:FixedRoom 20:PreferredRooms 21:LabHours 22:Semester
// 23:Day-For-Block 24:Time-For-Block 25:FacultyWorkingDays 26:FacultyTimeStart 27:FacultyTimeEnd 28:CohortLunchStart

function _row(
  facultyId: string, facultyName: string,
  courseCode: string, courseName: string, credits: string, category: string, campus: string,
  cohorts: string[],         // up to 12 — padded to exactly 12 slots
  fixedRoom: string, preferredRooms: string, labHours: string, semester: string,
  dayForBlock: string, timeForBlock: string,
  workingDays: string, timeStart: string, timeEnd: string, lunchStart: string,
): string {
  const c = [...cohorts, ...Array(12).fill('')].slice(0, 12);
  const vals = [
    facultyId, facultyName, courseCode, courseName, credits, category, campus,
    ...c,
    fixedRoom, preferredRooms, labHours, semester,
    dayForBlock, timeForBlock,
    workingDays, timeStart, timeEnd, lunchStart,
  ];
  // Wrap any value that contains a comma in double-quotes (valid CSV)
  return vals.map(v => v.includes(',') ? `"${v}"` : v).join(',');
}

const _HDR =
  'FacultyID,FacultyName,CourseCode,CourseName,Credits,Category,Campus,' +
  'Cohort1,Cohort2,Cohort3,Cohort4,Cohort5,Cohort6,Cohort7,Cohort8,Cohort9,Cohort10,Cohort11,Cohort12,' +
  'FixedRoom,PreferredRooms,LabHours,Semester,Day-For-Block,Time-For-Block,' +
  'FacultyWorkingDays,FacultyTimeStart,FacultyTimeEnd,CohortLunchStart';

export const COURSE_TEMPLATE_CSV = [
  _HDR,
  // Theory — 3 sessions/week, no fixed/preferred room
  _row('600001','John Smith','CS301','Data Structures','3','Theory','K1',
    ['CS-Y3-A','CS-Y3-B'], '','','','1', '','', 'Mon-Fri','8','16','13'),
  // Lab — 2-hour, fixed room
  _row('600002','Jane Doe','CS401','Lab Practical','2','Lab','K1',
    ['CS-Y4-A'], 'IT201','','2','2', '','', 'Mon-Fri','8','16','13'),
  // Lab — 4-hour (Health Sciences), multiple preferred rooms (comma-sep in one cell)
  _row('600005','Dr. Patel','HS501','Clinical Lab','1','Lab','AB',
    ['HS-Y3-A'], '','AB-Lab1,AB-Lab2','4','3', '','', 'Mon-Fri','8','16','13'),
  // Studio
  _row('600003','Alice Brown','DES501','Design Studio','2','Studio','AB',
    ['DES-Y5-A'], '','','','2', '','', 'Mon-Fri','10','18','13'),
  // Block-only — no course: blocks Monday hours 10 and 11 for this faculty+cohort
  _row('600001','John Smith','','','0','','',
    ['CS-Y3-A'], '','','','1', 'Monday','10,11', 'Mon-Fri','8','16','13'),
  // Block-only — blocks entire Mon-Fri at hour 9 (e.g. morning assembly)
  _row('600002','Jane Doe','','','0','','',
    ['CS-Y4-A'], '','','','2', 'Mon-Fri','9', 'Mon-Fri','8','16','13'),
].join('\n');

export const ROOM_CAMPUS_TEMPLATE_CSV = [
  'RoomName,Campus',
  'K1007,K1',
  'K2001,K2',
  'AB-Lab1,AB',
  'AB-Lab2,AB',
  'IT201,K1',
  'RD001,RD',
].join('\n');
