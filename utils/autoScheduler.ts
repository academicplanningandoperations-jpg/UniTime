import type { Course, Faculty, Room, StudentGroup, ScheduleEntry } from '../types';

export interface CourseAssignment {
  facultyId: string;
  facultyName: string;
  courseCode: string;
  courseName: string;
  credits: number;
  category: string;        // 'Theory' | 'Lab' | 'Tutorial' | 'Studio'
  campus: string;
  cohorts: string[];       // cohort names — may be 1 or many (shared session)
  fixedRoom: string;
  workingDays: string;     // 'Mon-Fri' | 'Tue-Sat'
  timeStart: number;       // 8 or 10
  timeEnd: number;         // 16 or 18
  lunchStart: number;      // e.g. 13  →  13:00–14:00 is lunch
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

function pad(h: number) { return `${String(h).padStart(2, '0')}:00`; }

function buildSlots(start: number, end: number, lunch: number, dur: number) {
  const out: { startTime: string; endTime: string }[] = [];
  for (let h = start; h + dur <= end; h++) {
    // skip if any hour in this slot falls inside the 1-hr lunch window
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

// ─── main scheduler ──────────────────────────────────────────────────────────

export async function runAutoScheduler(
  assignments: CourseAssignment[],
  roomCampusMap: Map<string, string>,      // roomName → campus code
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

  // Per-entity occupancy: id → Set of "Day~HH:00" keys
  const facultyOcc = new Map<string, Set<string>>();
  const cohortOcc  = new Map<string, Set<string>>();
  const roomOcc    = new Map<string, Set<string>>();

  // Per-assignment day tracking — no two sessions of same course on same day
  const usedDays = new Map<string, Set<string>>();

  // Registry lookups
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

  const totalSessions = assignments.reduce((s, a) => s + Math.max(1, a.credits || 1), 0);

  // Harder assignments first: Lab (2 hr) → many cohorts → theory
  const sorted = [...assignments].sort((a, b) => {
    const al = a.category === 'Lab' ? 0 : 1;
    const bl = b.category === 'Lab' ? 0 : 1;
    if (al !== bl) return al - bl;
    return b.cohorts.length - a.cohorts.length;
  });

  for (let ai = 0; ai < sorted.length; ai++) {
    const asgn = sorted[ai];
    const isLab      = asgn.category === 'Lab';
    const duration   = isLab ? 2 : 1;
    const sessionsNeeded = Math.max(1, asgn.credits || 1);
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

      // Constraint checks
      if (faculty && !isFree(facultyOcc, faculty.id, keys)) continue;
      if (groups.some(g => !isFree(cohortOcc, g.id, keys))) continue;

      // Room selection
      let pickedRoom: Room | undefined;

      if (asgn.fixedRoom) {
        const r = findRoom(asgn.fixedRoom);
        if (r && isFree(roomOcc, r.id, keys)) pickedRoom = r;
      } else {
        const campusRooms = existingRooms.filter(r => {
          const campus = roomCampusMap.get(r.name)
            ?? roomCampusMap.get((r as any)._unique_name ?? '')
            ?? '';
          return !asgn.campus || campus === asgn.campus;
        });

        // Prefer type-matched room (Lab→lab, Studio→studio, Theory→non-lab)
        const preferred = campusRooms.filter(r => {
          const t = (r.type || '').toLowerCase();
          if (isLab) return t.includes('lab');
          if (asgn.category === 'Studio') return t.includes('studio');
          return !t.includes('lab') && !t.includes('studio') && !t.includes('audit');
        });

        pickedRoom = preferred.find(r => isFree(roomOcc, r.id, keys))
          ?? campusRooms.find(r => isFree(roomOcc, r.id, keys));
      }

      // Mark all occupancies
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

    // Yield every 5 assignments so React can re-render the progress bar
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

export const COURSE_TEMPLATE_CSV = [
  'FacultyID,FacultyName,CourseCode,CourseName,Credits,Category,Campus,' +
  'Cohort1,Cohort2,Cohort3,Cohort4,Cohort5,Cohort6,Cohort7,Cohort8,Cohort9,Cohort10,Cohort11,Cohort12,' +
  'FixedRoom,WorkingDays,TimeStart,TimeEnd,LunchStart',
  '600001,John Smith,CS301,Data Structures,3,Theory,K1,CS-Y3-A,CS-Y3-B,,,,,,,,,,,,Mon-Fri,8,16,13',
  '600002,Jane Doe,CS401,Lab Practical,2,Lab,K1,CS-Y4-A,,,,,,,,,,,,IT201,Mon-Fri,8,16,13',
  '600003,Alice Brown,DES501,Design Studio,2,Studio,AB,DES-Y5-A,,,,,,,,,,,,,Tue-Sat,10,18,13',
].join('\n');

export const ROOM_CAMPUS_TEMPLATE_CSV = [
  'RoomName,Campus',
  'K1007,K1',
  'K2001,K2',
  'AB-11L-005,AB',
  'IT201,K1',
  'RD001,RD',
].join('\n');
