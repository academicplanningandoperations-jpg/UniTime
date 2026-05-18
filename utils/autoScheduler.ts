import type { Course, Faculty, Room, StudentGroup, ScheduleEntry } from '../types';

export interface CourseAssignment {
  facultyId: string;
  facultyName: string;
  courseCode: string;
  courseName: string;
  credits: number;
  category: string;           // 'Theory' | 'Lab' | 'Tutorial' | 'Studio'
  campus: string;
  cohorts: string[];
  fixedRoom: string;
  preferredRooms: string[];   // pipe-sep in CSV (e.g. "1001|1002") to avoid Excel comma issues
  labHours: number;           // 2 (default) or 4
  semester: string;           // label only — e.g. "Semester 1"
  dayForBlock: string;        // days to block for BOTH faculty AND cohorts on this row
  timeForBlock: string;       // hours to block for BOTH (e.g. "8,9,14")
  facultyBlockDay: string;    // days to block for THIS faculty only
  facultyBlockTime: string;   // hours to block for THIS faculty only  (e.g. "8,9,14")
  cohortBlockDay: string;     // days to block for the cohorts in this row
  cohortBlockTime: string;    // hours to block for the cohorts in this row
  workingDays: string;        // 'Mon-Fri' | 'Tue-Sat'
  timeStart: number;          // 8 or 10
  timeEnd: number;            // 16 or 18
  lunchStart: number;         // e.g. 13
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

function parseDays(s: string): string[] {
  if (!s.trim()) return [];
  if (DAYS_MAP[s.trim()]) return DAYS_MAP[s.trim()];
  return s.split(',').map(d => d.trim()).filter(d => ALL_DAYS.includes(d));
}

function parseHours(s: string): number[] {
  return s.split(',').map(t => parseInt(t.trim())).filter(n => !isNaN(n) && n >= 0 && n <= 23);
}

// Returns true if adding newKeys for entityId on the given day would create
// a run of 3 or more consecutive occupied hours.
function wouldCreateLongRun(
  occ: Map<string, Set<string>>,
  entityId: string,
  day: string,
  newKeys: string[]
): boolean {
  const occupied = new Set<number>();
  const entityOcc = occ.get(entityId);
  const prefix = `${day}~`;

  if (entityOcc) {
    for (const key of entityOcc) {
      if (key.startsWith(prefix)) occupied.add(parseInt(key.slice(prefix.length)));
    }
  }
  for (const key of newKeys) {
    if (key.startsWith(prefix)) occupied.add(parseInt(key.slice(prefix.length)));
  }

  const sorted = Array.from(occupied).sort((a, b) => a - b);
  let run = 1;
  for (let i = 1; i < sorted.length; i++) {
    if (sorted[i] === sorted[i - 1] + 1) {
      if (++run >= 3) return true;
    } else {
      run = 1;
    }
  }
  return false;
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
  onProgress: (placed: number, total: number, label: string) => void,
  existingSchedule: ScheduleEntry[] = [],   // pre-existing sessions to respect
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

  // ── Pre-populate occupancy from already-saved timetable entries ────────────
  // This lets incremental uploads respect sessions from previous runs.
  for (const entry of existingSchedule) {
    if (entry.termId !== termId) continue;
    const keys = slotKeys(entry.day, entry.startTime, entry.endTime);
    if (entry.facultyId) markBusy(facultyOcc, entry.facultyId, keys);
    entry.groupIds?.forEach(gid => markBusy(cohortOcc, gid, keys));
    if (entry.roomId) markBusy(roomOcc, entry.roomId, keys);
  }

  // ── Pre-pass: apply block columns ─────────────────────────────────────────
  for (const asgn of assignments) {
    const faculty = findFaculty(asgn.facultyId, asgn.facultyName);
    const groups  = asgn.cohorts.map(findGroup).filter(Boolean) as StudentGroup[];

    // Day-For-Block / Time-For-Block — blocks BOTH faculty AND cohorts simultaneously
    if (asgn.dayForBlock.trim() && asgn.timeForBlock.trim()) {
      for (const day of parseDays(asgn.dayForBlock)) {
        for (const hour of parseHours(asgn.timeForBlock)) {
          const key = [`${day}~${pad(hour)}`];
          if (faculty) markBusy(facultyOcc, faculty.id, key);
          groups.forEach(g => markBusy(cohortOcc, g.id, key));
        }
      }
    }

    // FacultyBlockDay / FacultyBlockTime — blocks only this faculty
    if (asgn.facultyBlockDay.trim() && asgn.facultyBlockTime.trim() && faculty) {
      for (const day of parseDays(asgn.facultyBlockDay)) {
        for (const hour of parseHours(asgn.facultyBlockTime)) {
          markBusy(facultyOcc, faculty.id, [`${day}~${pad(hour)}`]);
        }
      }
    }

    // CohortBlockDay / CohortBlockTime — blocks only the cohorts in this row
    if (asgn.cohortBlockDay.trim() && asgn.cohortBlockTime.trim() && groups.length > 0) {
      for (const day of parseDays(asgn.cohortBlockDay)) {
        for (const hour of parseHours(asgn.cohortBlockTime)) {
          groups.forEach(g => markBusy(cohortOcc, g.id, [`${day}~${pad(hour)}`]));
        }
      }
    }
  }

  // ── Collect schedulable rows: must have courseCode + credits > 0 ─────────
  const courseRows = assignments.filter(a => a.courseCode.trim() && a.credits > 0);
  const totalSessions = courseRows.reduce((s, a) => s + a.credits, 0);

  // Longer labs first, then by cohort count (hardest to place → schedule first)
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
    const isLab         = asgn.category === 'Lab';
    const duration      = isLab ? (asgn.labHours || 2) : 1;
    const is4HrLab      = isLab && duration >= 4;   // exempt from 3-consecutive-hour rule
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

      // Standard clash checks
      if (faculty && !isFree(facultyOcc, faculty.id, keys)) continue;
      if (groups.some(g => !isFree(cohortOcc, g.id, keys))) continue;

      // No 3 consecutive teaching hours for faculty (4-hr labs are exempt)
      if (!is4HrLab && faculty && wouldCreateLongRun(facultyOcc, faculty.id, day, keys)) continue;

      // Room selection
      let pickedRoom: Room | undefined;

      if (asgn.fixedRoom) {
        const r = findRoom(asgn.fixedRoom);
        if (r && isFree(roomOcc, r.id, keys)) pickedRoom = r;
      } else {
        // Preferred rooms tried first (pipe-separated in CSV)
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
          ? 'No slot available — check clashes with existing timetable or constraints'
          : `Partial: ${placed} of ${sessionsNeeded} placed`,
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

// 33 columns (indices 0-32):
// 0:FacultyID  1:FacultyName  2:CourseCode  3:CourseName  4:Credits  5:Category  6:Campus
// 7-18: Cohort1-12
// 19:FixedRoom  20:PreferredRooms  21:LabHours  22:Semester
// 23:Day-For-Block  24:Time-For-Block  (blocks both faculty AND cohort)
// 25:FacultyBlockDay  26:FacultyBlockTime  27:CohortBlockDay  28:CohortBlockTime
// 29:FacultyWorkingDays  30:FacultyTimeStart  31:FacultyTimeEnd  32:CohortLunchStart

function _row(
  facultyId: string, facultyName: string,
  courseCode: string, courseName: string, credits: string, category: string, campus: string,
  cohorts: string[],
  fixedRoom: string, preferredRooms: string, labHours: string, semester: string,
  dayForBlock: string, timeForBlock: string,
  facultyBlockDay: string, facultyBlockTime: string,
  cohortBlockDay: string, cohortBlockTime: string,
  workingDays: string, timeStart: string, timeEnd: string, lunchStart: string,
): string {
  const c = [...cohorts, ...Array(12).fill('')].slice(0, 12);
  const vals = [
    facultyId, facultyName, courseCode, courseName, credits, category, campus,
    ...c,
    fixedRoom, preferredRooms, labHours, semester,
    dayForBlock, timeForBlock,
    facultyBlockDay, facultyBlockTime,
    cohortBlockDay, cohortBlockTime,
    workingDays, timeStart, timeEnd, lunchStart,
  ];
  // Wrap values containing commas in double-quotes (standard CSV escaping)
  return vals.map(v => v.includes(',') ? `"${v}"` : v).join(',');
}

const _HDR =
  'FacultyID,FacultyName,CourseCode,CourseName,Credits,Category,Campus,' +
  'Cohort1,Cohort2,Cohort3,Cohort4,Cohort5,Cohort6,Cohort7,Cohort8,Cohort9,Cohort10,Cohort11,Cohort12,' +
  'FixedRoom,PreferredRooms,LabHours,Semester,' +
  'Day-For-Block,Time-For-Block,' +
  'FacultyBlockDay,FacultyBlockTime,CohortBlockDay,CohortBlockTime,' +
  'FacultyWorkingDays,FacultyTimeStart,FacultyTimeEnd,CohortLunchStart';

export const COURSE_TEMPLATE_CSV = [
  _HDR,
  // Theory — 3 sessions/week
  _row('600001','John Smith','CS301','Data Structures','3','Theory','K1',
    ['CS-Y3-A','CS-Y3-B'], '','','','1',
    '','', '','', '','',
    'Mon-Fri','8','16','13'),
  // Lab — 2-hour, fixed room
  _row('600002','Jane Doe','CS401','Lab Practical','2','Lab','K1',
    ['CS-Y4-A'], 'IT201','','2','2',
    '','', '','', '','',
    'Mon-Fri','8','16','13'),
  // Lab — 4-hour, multiple preferred rooms (use | not comma to avoid Excel issues)
  _row('600005','Dr. Patel','HS501','Clinical Lab','1','Lab','AB',
    ['HS-Y3-A'], '','AB-Lab1|AB-Lab2','4','3',
    '','', '','', '','',
    'Mon-Fri','8','16','13'),
  // Studio
  _row('600003','Alice Brown','DES501','Design Studio','2','Studio','AB',
    ['DES-Y5-A'], '','','','2',
    '','', '','', '','',
    'Mon-Fri','10','18','13'),
  // Day-For-Block — blocks both faculty AND cohort CS-Y3-A on Tuesday at 10,11
  _row('600001','John Smith','','','0','','',
    ['CS-Y3-A'], '','','','1',
    'Tuesday','10,11', '','', '','',
    'Mon-Fri','8','16','13'),
  // Faculty block — faculty 600001 is unavailable Monday at 9
  _row('600001','John Smith','','','0','','',
    [], '', '','','1',
    '','', 'Monday','9', '','',
    'Mon-Fri','8','16','13'),
  // Cohort block — CS-Y3-A has assembly every Monday at 10:00 and 11:00
  _row('600001','John Smith','','','0','','',
    ['CS-Y3-A'], '','','','1',
    '','', '','', 'Monday','10,11',
    'Mon-Fri','8','16','13'),
  // Combined separate — block faculty Friday pm AND cohort Wednesday morning
  _row('600002','Jane Doe','','','0','','',
    ['CS-Y4-A'], '','','','2',
    '','', 'Friday','14,15', 'Wednesday','8,9',
    'Mon-Fri','8','16','13'),
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
