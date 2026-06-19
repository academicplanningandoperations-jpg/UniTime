import type { Course, Faculty, Room, StudentGroup, ScheduleEntry } from '../types';

export interface CourseAssignment {
  facultyId: string;
  facultyName: string;
  school: string;           // e.g. "School of Engineering" — used for 50/50 roster balancing
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
  courseDayBlock: string;     // restrict THIS course to only these days (e.g. "Mon-Wed")
  courseTimeBlock: string;    // restrict THIS course to only these start hours (e.g. "13,14,15,16")
  facultyBlockDay: string;    // days to block for THIS faculty only
  facultyBlockTime: string;   // hours to block for THIS faculty only  (e.g. "8,9,14")
  cohortBlockDay: string;     // days to block for the cohorts in this row
  cohortBlockTime: string;    // hours to block for the cohorts in this row
  workingDays: string;        // 'Mon-Fri' | 'Tue-Sat'
  timeStart: number;          // 8 or 10
  timeEnd: number;            // 16 or 18
  lunchStart: string;         // "13" (fixed) or "12-14" (flexible — rotates per day)
}

export interface ConflictDiagnostics {
  primaryReason: string;
  totalCandidates: number;
  rejectedByFacultyClash: number;
  rejectedByCohortClash: number;
  rejectedByConsecutiveHours: number;
  rejectedByFixedRoom: number;
  rejectedByNoRoom: number;   // rejected because no valid room was available
  suggestions: string[];
}

export interface UnresolvedSession {
  courseCode: string;
  courseName: string;
  facultyId: string;
  facultyName: string;
  cohorts: string[];
  category: string;
  sessionsNeeded: number;
  sessionsPlaced: number;
  reason: string;
  diagnostics?: ConflictDiagnostics;
}

// A session that was placed successfully (day/time/faculty/cohort all resolved)
// but no room could be assigned — shows as "TBD" in the Timetable Builder.
export interface RoomlessSession {
  courseCode: string;
  courseName: string;
  facultyId: string;
  facultyName: string;
  cohorts: string[];
  day: string;
  startTime: string;
  endTime: string;
}

export interface SchedulerResult {
  entries: ScheduleEntry[];
  unresolved: UnresolvedSession[];
  roomless: RoomlessSession[];
  stats: { totalSessions: number; placed: number; unresolvedCount: number };
}

// ─── helpers ────────────────────────────────────────────────────────────────

const DAYS_MAP: Record<string, string[]> = {
  'Mon-Fri': ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday'],
  'Tue-Sat': ['Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'],
  'Mon-Sat': ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'],
};

const ALL_DAYS = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

function pad(h: number) { return `${String(h).padStart(2, '0')}:00`; }

// Handles half-hour increments (e.g. 9.5 → "09:30") for MBA/Edge categories
function padTime(h: number): string {
  const hh = Math.floor(h);
  const mm = (h - hh) >= 0.5 ? '30' : '00';
  return `${String(hh).padStart(2, '0')}:${mm}`;
}

function buildSlots(start: number, end: number, dur: number) {
  const out: { startTime: string; endTime: string }[] = [];
  for (let h = start; h + dur <= end; h++) {
    out.push({ startTime: padTime(h), endTime: padTime(h + dur) });
  }
  return out;
}

function slotKeys(day: string, st: string, et: string): string[] {
  const keys: string[] = [];
  const startH = parseInt(st);
  const [etH, etM] = et.split(':').map(Number);
  // Ceiling: 10:30 occupies hour 10, so endH = 11
  const endH = etM > 0 ? etH + 1 : etH;
  for (let h = startH; h < endH; h++) keys.push(`${day}~${pad(h)}`);
  return keys;
}

function isFree(occ: Map<string, Set<string>>, id: string, keys: string[]) {
  const s = occ.get(id);
  return !s || keys.every(k => !s.has(k));
}

function leavesLunchFree(occ: Map<string, Set<string>>, id: string, day: string, lunchHours: number[], keysToAdd: string[]) {
  const s = occ.get(id);
  let freeCount = 0;
  for (const lh of lunchHours) {
    // Key must match the format used by slotKeys/markBusy: "Monday~12:00"
    const k = `${day}~${pad(lh)}`;
    const isCurrentlyFree = !s || !s.has(k);
    const isToBeOccupied = keysToAdd.includes(k);
    if (isCurrentlyFree && !isToBeOccupied) freeCount++;
  }
  return freeCount > 0;
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

const SHORT_TO_FULL: Record<string, string> = {
  Mon: 'Monday', Tue: 'Tuesday', Wed: 'Wednesday',
  Thu: 'Thursday', Fri: 'Friday', Sat: 'Saturday',
};
const SHORT_ORDER = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

function parseDays(s: string): string[] {
  if (!s.trim()) return [];
  if (DAYS_MAP[s.trim()]) return DAYS_MAP[s.trim()];
  // Short-name range: Mon-Wed → Monday, Tuesday, Wednesday
  const rangeMatch = s.trim().match(/^([A-Z][a-z]{2})-([A-Z][a-z]{2})$/);
  if (rangeMatch) {
    const si = SHORT_ORDER.indexOf(rangeMatch[1]);
    const ei = SHORT_ORDER.indexOf(rangeMatch[2]);
    if (si !== -1 && ei !== -1 && si <= ei)
      return SHORT_ORDER.slice(si, ei + 1).map(d => SHORT_TO_FULL[d]);
  }
  return s.split(',').map(d => {
    const t = d.trim();
    return SHORT_TO_FULL[t] ?? t;
  }).filter(d => ALL_DAYS.includes(d));
}

function parseHours(s: string): number[] {
  return s.split(',').map(t => parseInt(t.trim())).filter(n => !isNaN(n) && n >= 0 && n <= 23);
}

// "13" -> [13] (fixed lunch hour every day).
// "12-14" -> [12, 13] (valid 1-hour lunch start times within the 12:00-14:00 window;
// the caller rotates through these across days so lunch can fall on a different hour
// each day, e.g. Monday lunch at 12, Tuesday lunch at 13).
function parseLunchRange(s: string, fallback: number): number[] {
  const t = s.trim();
  if (!t) return [fallback];

  // Try explicit comma separated lists like "12,13,14" or "12, 14"
  if (t.includes(',')) {
    const parts = t.split(',').map(p => parseInt(p.trim(), 10)).filter(n => !isNaN(n));
    if (parts.length > 0) return parts;
  }

  // Try standard formats like "12-14", "12 to 14", "12:14"
  const rangeMatch = t.match(/^(\d{1,2})\s*[-to:]+\s*(\d{1,2})$/i);
  if (rangeMatch) {
    const start = parseInt(rangeMatch[1], 10);
    const end = parseInt(rangeMatch[2], 10);
    if (!isNaN(start) && !isNaN(end) && start < end) {
      const hours: number[] = [];
      for (let h = start; h < end; h++) hours.push(h);
      return hours;
    }
  }

  // Workaround for Excel auto-date conversion (e.g., "12-14" becomes "14-Dec" or "Dec-14")
  const dateMatch1 = t.match(/^(\d{1,2})\s*-\s*([a-zA-Z]{3})$/); // e.g., "14-Dec"
  const dateMatch2 = t.match(/^([a-zA-Z]{3})\s*-\s*(\d{1,2})$/); // e.g., "Dec-14"
  const monthMap: Record<string, number> = {
    jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6,
    jul: 7, aug: 8, sep: 9, oct: 10, nov: 11, dec: 12
  };
  
  let dateA: number | null = null;
  let dateB: number | null = null;

  if (dateMatch1) {
    const m = monthMap[dateMatch1[2].toLowerCase()];
    if (m !== undefined) { dateA = parseInt(dateMatch1[1], 10); dateB = m; }
  } else if (dateMatch2) {
    const m = monthMap[dateMatch2[1].toLowerCase()];
    if (m !== undefined) { dateA = parseInt(dateMatch2[2], 10); dateB = m; }
  } else {
    // Also handle "12/14/2024" or "14/12/2024"
    const slashMatch = t.match(/^(\d{1,2})\/(\d{1,2})(?:\/\d{2,4})?$/);
    if (slashMatch) {
      dateA = parseInt(slashMatch[1], 10);
      dateB = parseInt(slashMatch[2], 10);
    }
  }

  if (dateA !== null && dateB !== null) {
    const start = Math.min(dateA, dateB);
    const end = Math.max(dateA, dateB);
    if (start < end) {
      const hours: number[] = [];
      for (let h = start; h < end; h++) hours.push(h);
      return hours;
    }
  }

  const n = parseInt(t, 10);
  return !isNaN(n) ? [n] : [fallback];
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

// Returns true if placing newKeys for groupId on the given day would leave
// a gap of more than maxFreeHours consecutive free hours between any two
// session blocks. Only applies when the cohort already has sessions that day;
// a fresh day always returns false (no gap to measure).
// Example: existing session at 08:00, new session at 16:00 → 7 free hours → reject.
//          existing session at 08:00, new session at 11:00 → 2 free hours → allow.
function wouldCreateLargeGap(
  cohortOcc: Map<string, Set<string>>,
  groupId: string,
  day: string,
  newKeys: string[],
  maxFreeHours: number = 2
): boolean {
  const prefix = `${day}~`;
  const s = cohortOcc.get(groupId);

  // No existing sessions on this day — no gap possible
  let hasExisting = false;
  if (s) { for (const k of s) { if (k.startsWith(prefix)) { hasExisting = true; break; } } }
  if (!hasExisting) return false;

  // Collect all occupied hour-slots (existing + new)
  const occupied = new Set<number>();
  if (s) {
    for (const k of s) {
      if (k.startsWith(prefix)) {
        const h = parseInt(k.slice(prefix.length));
        if (!isNaN(h)) occupied.add(h);
      }
    }
  }
  for (const k of newKeys) {
    if (k.startsWith(prefix)) {
      const h = parseInt(k.slice(prefix.length));
      if (!isNaN(h)) occupied.add(h);
    }
  }

  const sorted = Array.from(occupied).sort((a, b) => a - b);
  if (sorted.length < 2) return false;

  // Group consecutive hours into session blocks, then measure gaps between blocks
  const blocks: { start: number; end: number }[] = [];
  let bStart = sorted[0], bEnd = sorted[0];
  for (let i = 1; i < sorted.length; i++) {
    if (sorted[i] <= bEnd + 1) { bEnd = sorted[i]; }
    else { blocks.push({ start: bStart, end: bEnd }); bStart = sorted[i]; bEnd = sorted[i]; }
  }
  blocks.push({ start: bStart, end: bEnd });

  for (let i = 1; i < blocks.length; i++) {
    // Free hours sitting between end of block i-1 and start of block i
    const freeHours = blocks[i].start - blocks[i - 1].end - 1;
    if (freeHours > maxFreeHours) return true;
  }
  return false;
}

// ─── conflict diagnostics ────────────────────────────────────────────────────

function buildDiagnostics(
  asgn: CourseAssignment,
  totalCandidates: number,
  rejFaculty: number,
  rejCohort: number,
  rejConsec: number,
  rejFixedRoom: number,
  rejNoRoom: number,
  placed: number,
  needed: number,
): ConflictDiagnostics {
  const suggestions: string[] = [];

  const drivers = [
    { name: 'fixedRoom', val: rejFixedRoom },
    { name: 'faculty',   val: rejFaculty },
    { name: 'cohort',    val: rejCohort },
    { name: 'consec',    val: rejConsec },
    { name: 'noRoom',    val: rejNoRoom },
  ].sort((a, b) => b.val - a.val);
  const top = drivers[0];

  let primaryReason: string;

  if (top.name === 'fixedRoom' && rejFixedRoom > 0) {
    primaryReason = `Fixed room "${asgn.fixedRoom}" unavailable for all ${rejFixedRoom} attempted slots`;
    suggestions.push(`Remove FixedRoom and use PreferredRooms="${asgn.fixedRoom}" to allow fallback when it is taken.`);
    suggestions.push(`Check if "${asgn.fixedRoom}" is over-booked by other courses in the same term.`);
  } else if (top.name === 'faculty' && rejFaculty > 0) {
    const facLabel = `${asgn.facultyName} (ID: ${asgn.facultyId})`;
    primaryReason = `${facLabel} already booked on ${rejFaculty} of ${totalCandidates} candidate slots`;
    suggestions.push(`${facLabel} may be overloaded — reduce total credits or extend FacultyTimeStart/End (currently ${asgn.timeStart}:00–${asgn.timeEnd}:00, ${asgn.workingDays}).`);
    if (asgn.facultyBlockDay || asgn.dayForBlock)
      suggestions.push(`Block columns (FacultyBlockDay="${asgn.facultyBlockDay}" / Explo-Day-Block="${asgn.dayForBlock}") are reducing slots — verify they are correct.`);
  } else if (top.name === 'cohort' && rejCohort > 0) {
    const list = asgn.cohorts.slice(0, 3).join(', ') + (asgn.cohorts.length > 3 ? '…' : '');
    primaryReason = `Cohort(s) ${list} fully booked on ${rejCohort} of ${totalCandidates} candidate slots`;
    suggestions.push(`Cohorts may be over-scheduled — check CohortBlockDay/Time or other courses sharing ${list}.`);
    if (asgn.cohortBlockDay || asgn.dayForBlock)
      suggestions.push(`CohortBlockDay="${asgn.cohortBlockDay}" / Explo-Day-Block="${asgn.dayForBlock}" is further limiting cohort availability.`);
  } else if (top.name === 'consec' && rejConsec > 0) {
    const facLabel = `${asgn.facultyName} (ID: ${asgn.facultyId})`;
    primaryReason = `${rejConsec} slots rejected to prevent ${facLabel} exceeding 2 consecutive teaching hours`;
    suggestions.push(`Spread ${facLabel}'s other courses across more days, or extend their working-hour window.`);
  } else if (top.name === 'noRoom' && rejNoRoom > 0) {
    primaryReason = `No room available on ${rejNoRoom} of ${totalCandidates} candidate slots`;
    suggestions.push(`Rooms matching preferred or campus requirements are fully booked.`);
  } else if (placed > 0) {
    primaryReason = `Partial placement — ${placed} of ${needed} sessions placed`;
    suggestions.push(`${needed - placed} more slot(s) needed. Remaining candidates are blocked by faculty/cohort load.`);
  } else {
    primaryReason = `No viable slot in ${asgn.workingDays} ${asgn.timeStart}:00–${asgn.timeEnd}:00 (${totalCandidates} candidates checked)`;
    suggestions.push(`Widen the scheduling window via FacultyTimeStart/End or switch FacultyWorkingDays.`);
  }

  return {
    primaryReason,
    totalCandidates,
    rejectedByFacultyClash: rejFaculty,
    rejectedByCohortClash: rejCohort,
    rejectedByConsecutiveHours: rejConsec,
    rejectedByFixedRoom: rejFixedRoom,
    rejectedByNoRoom: rejNoRoom,
    suggestions,
  };
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
  const roomless: RoomlessSession[] = [];

  const facultyOcc       = new Map<string, Set<string>>();
  // Tracks only non-lab hours — used for the consecutive-hours check so that
  // lab sessions don't consume a faculty's "3 consecutive hours" budget and
  // block theory sessions in the gap slot immediately after a lab.
  const facultyNonLabOcc = new Map<string, Set<string>>();
  const cohortOcc        = new Map<string, Set<string>>();
  const roomOcc          = new Map<string, Set<string>>();
  const usedDays         = new Map<string, Set<string>>();

  const normName = (s: string) => s.trim().toLowerCase().replace(/\s+/g, ' ');
  const normId   = (s: string) => s.trim().toLowerCase();

  // Case-insensitive, whitespace-tolerant match — same pattern as findRoom/findGroup.
  const findCourse = (code: string) => {
    const nCode = normName(code);
    return existingCourses.find(c =>
      c.code === code || (c as any)._unique_name === code || c.name === code ||
      normName(c.code ?? '') === nCode || normName((c as any)._unique_name ?? '') === nCode || normName(c.name ?? '') === nCode
    );
  };
  // ID match always takes priority over name match. Without this, two different
  // faculty sharing the same name (e.g. two "Rahul Kumar" with different IDs)
  // would collapse onto whichever one happens to appear first in the array,
  // silently merging their workloads. ID comparison is normalized (trim +
  // lowercase) so a CSV value like " 600001" or "ABC-01" with different casing
  // still resolves — an exact-match-only ID check was silently dropping faculty
  // (and showing blank in the timetable) whenever case/whitespace differed.
  const findFaculty = (id: string, name: string) => {
    if (id) {
      const nId = normId(id);
      const byId = existingFaculties.find(f =>
        normId(f.facultyId ?? '') === nId || normId(f.id ?? '') === nId ||
        normId((f as any)._Faculty_ID ?? '') === nId
      );
      if (byId) return byId;
    }
    const nName = normName(name);
    return existingFaculties.find(f =>
      normName(f.name) === nName ||
      ((f as any)._Faculty_name && normName((f as any)._Faculty_name) === nName)
    );
  };

  // Case-insensitive, whitespace-tolerant match — same pattern as findRoom.
  const findGroup = (name: string) => {
    const nName = normName(name);
    return existingGroups.find(g =>
      g.name === name || (g as any)._unique_name === name ||
      normName(g.name) === nName || normName((g as any)._unique_name ?? '') === nName
    );
  };

  // Case-insensitive, whitespace-tolerant match — a CSV room name like "k1007"
  // or " K1007 " must still resolve to the room named "K1007" in the system.
  const findRoom = (name: string) => {
    const nName = normName(name);
    return existingRooms.find(r =>
      r.name === name || (r as any)._unique_name === name ||
      normName(r.name) === nName || normName((r as any)._unique_name ?? '') === nName
    );
  };

  // roomCampusMap (from the Room-Campus CSV upload) is keyed by trimmed-but-
  // not-lowercased RoomName. Rebuild with normalized keys so a Room entity name
  // that differs slightly in case/whitespace still resolves to its campus.
  const normRoomCampusMap = new Map<string, string>();
  roomCampusMap.forEach((campus, name) => normRoomCampusMap.set(normName(name), campus));

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

    // Explo-Day-Block / Explo-Time-Block — blocks BOTH faculty AND cohorts simultaneously
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

  // Sort order (most constrained → least constrained):
  // 1. Course-Day-Block courses first — they have the fewest candidate slots so must
  //    claim them before other courses fill the cohort's schedule. No pre-reservation
  //    needed; going first naturally means they only block the slots they actually use.
  // 2. Labs (long duration, need specific room types)
  // 3. Longer labs before shorter labs
  // 4. Mon-Fri before Tue-Sat (fills cohort's Monday before Saturday)
  // 5. Most cohorts first (shared cohorts are hardest to place)
  const sorted = [...courseRows].sort((a, b) => {
    const aDB = a.courseDayBlock.trim() ? 0 : 1;
    const bDB = b.courseDayBlock.trim() ? 0 : 1;
    if (aDB !== bDB) return aDB - bDB;
    const al = a.category.toLowerCase() === 'lab' ? 0 : 1;
    const bl = b.category.toLowerCase() === 'lab' ? 0 : 1;
    if (al !== bl) return al - bl;
    if (al === 0) {
      const ah = a.labHours || 2, bh = b.labHours || 2;
      if (ah !== bh) return bh - ah;
    }
    const aMF = a.workingDays === 'Mon-Fri' ? 0 : 1;
    const bMF = b.workingDays === 'Mon-Fri' ? 0 : 1;
    if (aMF !== bMF) return aMF - bMF;
    return b.cohorts.length - a.cohorts.length;
  });

  for (let ai = 0; ai < sorted.length; ai++) {
    const asgn = sorted[ai];
    const cat           = asgn.category.toLowerCase();
    const isLab         = cat === 'lab';
    const isMBA         = cat === 'mba';   // 1.5-hour sessions; sessionsNeeded = round(credits/1.5)
    const isEdge        = cat === 'edge';  // 2-hour sessions; sessionsNeeded = round(credits/2)
    const duration      = isLab ? (asgn.labHours || 2) : isMBA ? 1.5 : isEdge ? 2 : 1;
    const sessionsNeeded = cat === 'tutorial' ? 1
      : isMBA  ? Math.round(asgn.credits / 1.5)
      : isEdge ? Math.round(asgn.credits / 2)
      : asgn.credits;
    const days  = parseDays(asgn.workingDays).length ? parseDays(asgn.workingDays) : DAYS_MAP['Mon-Fri'];
    // Lunch hour is chosen dynamically: the scheduler ensures that placing this
    // course leaves at least one of these hours free for the cohort to have lunch.
    const lunchHours = parseLunchRange(asgn.lunchStart, 13);

    const course   = findCourse(asgn.courseCode);
    const faculty  = findFaculty(asgn.facultyId, asgn.facultyName);
    const groups   = asgn.cohorts.map(findGroup).filter(Boolean) as StudentGroup[];
    const groupIds = groups.map(g => g.id);

    const dayKey = `${asgn.facultyId}::${asgn.courseCode}::${[...asgn.cohorts].sort().join(',')}`;
    if (!usedDays.has(dayKey)) usedDays.set(dayKey, new Set());
    const takenDays = usedDays.get(dayKey)!;

    // Course-Day-Block / Course-Time-Block: restrict this course to specific days/start hours
    let candidateDays = days;
    if (asgn.courseDayBlock.trim()) {
      const restricted = parseDays(asgn.courseDayBlock);
      if (restricted.length > 0) candidateDays = days.filter(d => restricted.includes(d));
    }
    const allowedHours = asgn.courseTimeBlock.trim() ? new Set(parseHours(asgn.courseTimeBlock)) : null;

    let placed = 0;
    let rejFaculty = 0, rejCohort = 0, rejConsec = 0, rejFixedRoom = 0, rejNoRoom = 0;
    const rawCandidates = candidateDays.flatMap(day => {
      let daySlots = buildSlots(asgn.timeStart || 8, asgn.timeEnd || 16, duration);
      if (allowedHours) daySlots = daySlots.filter(sl => allowedHours.has(parseInt(sl.startTime)));
      // Labs without an explicit courseTimeBlock are restricted to even start hours
      // (8,10,12,14,16,18) so sessions pack as 8-10, 10-12, 14-16, 16-18 with no
      // odd-hour fragments, allowing a faculty to reach 30h without slot waste.
      if (isLab && !asgn.courseTimeBlock.trim()) daySlots = daySlots.filter(sl => parseInt(sl.startTime) % 2 === 0);
      return daySlots.map(sl => ({ day, ...sl }));
    });
    // 3-tier candidate ordering to minimise single-class days and large gaps:
    //  Tier 1 — days where cohort already has 2+ hours of sessions (most active).
    //            Adding here keeps the day productive and avoids creating new
    //            isolated days.
    //  Tier 2 — days where cohort has exactly 1 hour (one lonely session).
    //            A second session here is strongly preferred over opening a
    //            brand-new day so students aren't wasting a trip for one class.
    //  Tier 3 — fresh days the cohort doesn't attend at all yet (last resort).
    const cohortHoursOnDay = (day: string): number => {
      const prefix = `${day}~`;
      let max = 0;
      for (const gid of groupIds) {
        const s = cohortOcc.get(gid);
        if (!s) continue;
        let cnt = 0;
        for (const k of s) if (k.startsWith(prefix)) cnt++;
        if (cnt > max) max = cnt;
      }
      return max;
    };
    const busyDays  = shuffle(rawCandidates.filter(c => cohortHoursOnDay(c.day) >= 2));
    const lightDays = shuffle(rawCandidates.filter(c => cohortHoursOnDay(c.day) === 1));
    const freshDays = shuffle(rawCandidates.filter(c => cohortHoursOnDay(c.day) === 0));
    const candidates = [...busyDays, ...lightDays, ...freshDays];

    // Candidates that passed faculty/cohort/consecutive-hours checks but had no
    // room available AT THAT SPECIFIC slot. Saved instead of committed immediately,
    // so the scheduler keeps trying other day/time slots first — a room might be
    // free at a different time even if it's busy at this one.
    const pickRoomFor = (keys: string[]): Room | undefined => {
      if (asgn.fixedRoom) {
        const r = findRoom(asgn.fixedRoom);
        return r && isFree(roomOcc, r.id, keys) ? r : undefined;
      }

      // When preferred rooms are specified, ONLY choose from those rooms.
      // Do NOT fall back to arbitrary campus rooms — the user explicitly
      // listed which rooms this course may use.
      const preferredObjs = asgn.preferredRooms.map(name => findRoom(name)).filter(Boolean) as Room[];
      if (preferredObjs.length > 0) {
        return preferredObjs.find(r => isFree(roomOcc, r.id, keys));
      }

      // No preferred rooms specified — search all campus rooms by type
      const campusRooms = existingRooms.filter(r => {
        if (!asgn.campus.trim()) return true; // no campus requirement on this row
        const mappedCampus = normRoomCampusMap.get(normName(r.name)) ?? normRoomCampusMap.get(normName((r as any)._unique_name ?? ''));
        // A room with no campus mapping at all (missing/mismatched Room-Campus
        // upload) is kept as a candidate rather than silently excluded — better
        // to risk a cross-campus room than to starve the pool down to zero.
        if (!mappedCampus) return true;
        return normName(mappedCampus) === normName(asgn.campus);
      });
      const typeMatched = campusRooms.filter(r => {
        const t = (r.type || '').toLowerCase();
        if (isLab) return t.includes('lab');
        if (asgn.category.toLowerCase() === 'studio') return t.includes('studio');
        return !t.includes('lab') && !t.includes('studio') && !t.includes('audit');
      });
      return typeMatched.find(r => isFree(roomOcc, r.id, keys)) ?? campusRooms.find(r => isFree(roomOcc, r.id, keys));
    };

    const commitPlacement = (day: string, startTime: string, endTime: string, pickedRoom: Room) => {
      const keys = slotKeys(day, startTime, endTime);
      if (faculty) {
        markBusy(facultyOcc, faculty.id, keys);
        if (!isLab) markBusy(facultyNonLabOcc, faculty.id, keys);
      }
      groups.forEach(g => markBusy(cohortOcc, g.id, keys));
      markBusy(roomOcc, pickedRoom.id, keys);
      takenDays.add(day);

      entries.push({
        id:           `auto-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
        termId,
        courseId:     course?.id   ?? null,
        facultyId:    faculty?.id  ?? null,
        roomId:       pickedRoom.id,
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
    };

    // Pass 1: require a room. Slots with no room free are saved as fallbacks
    // instead of being accepted immediately, so a later slot with a free room
    // is preferred over giving up at the first room-less candidate.
    for (const { day, startTime, endTime } of candidates) {
      if (placed >= sessionsNeeded) break;
      if (takenDays.has(day)) continue;

      const keys = slotKeys(day, startTime, endTime);

      if (faculty && !isFree(facultyOcc, faculty.id, keys)) { rejFaculty++; continue; }
      if (groups.some(g => !isFree(cohortOcc, g.id, keys))) { rejCohort++; continue; }
      if (groups.some(g => !leavesLunchFree(cohortOcc, g.id, day, lunchHours, keys))) { rejCohort++; continue; }
      if (groups.some(g => wouldCreateLargeGap(cohortOcc, g.id, day, keys, 2))) { rejCohort++; continue; }
      if (!isLab && faculty && wouldCreateLongRun(facultyNonLabOcc, faculty.id, day, keys)) { rejConsec++; continue; }

      const pickedRoom = pickRoomFor(keys);
      if (!pickedRoom) {
        if (asgn.fixedRoom) { rejFixedRoom++; continue; } // fixed room taken — try next slot
        rejNoRoom++;
        continue; // try a different slot since room is busy
      }

      commitPlacement(day, startTime, endTime, pickedRoom);
    }

    if (placed < sessionsNeeded) {
      const diag = buildDiagnostics(
        asgn, candidates.length,
        rejFaculty, rejCohort, rejConsec, rejFixedRoom, rejNoRoom,
        placed, sessionsNeeded,
      );
      unresolved.push({
        courseCode:     asgn.courseCode,
        courseName:     asgn.courseName,
        facultyId:      asgn.facultyId,
        facultyName:    asgn.facultyName,
        cohorts:        asgn.cohorts,
        category:       asgn.category,
        sessionsNeeded,
        sessionsPlaced: placed,
        reason:         diag.primaryReason,
        diagnostics:    diag,
      });
    }

    if (ai % 5 === 4) await new Promise(r => setTimeout(r, 0));
  }

  return {
    entries,
    unresolved,
    roomless,
    stats: {
      totalSessions,
      placed: entries.length,
      unresolvedCount: totalSessions - entries.length,
    },
  };
}

// ─── CSV template strings ────────────────────────────────────────────────────

// 36 columns (indices 0-35):
// 0:FacultyID  1:FacultyName  2:School  3:CourseCode  4:CourseName  5:Credits  6:Category  7:Campus
// 8-19: Cohort1-12
// 20:FixedRoom  21:PreferredRooms  22:LabHours  23:Semester
// 24:Explo-Day-Block  25:Explo-Time-Block  (blocks both faculty AND cohort)
// 26:Course-Day-Block  27:Course-Time-Block  (restrict this course to specific days/hours only)
// 28:FacultyBlockDay  29:FacultyBlockTime  30:CohortBlockDay  31:CohortBlockTime
// 32:FacultyWorkingDays  33:FacultyTimeStart  34:FacultyTimeEnd
// 35:CohortLunchStart — "13" fixes lunch every day; "12-14" rotates the lunch
//   hour across the week (Mon=12, Tue=13, Wed=12, ...) for extra packing flexibility

function _row(
  facultyId: string, facultyName: string, school: string,
  courseCode: string, courseName: string, credits: string, category: string, campus: string,
  cohorts: string[],
  fixedRoom: string, preferredRooms: string, labHours: string, semester: string,
  dayForBlock: string, timeForBlock: string,
  courseDayBlock: string, courseTimeBlock: string,
  facultyBlockDay: string, facultyBlockTime: string,
  cohortBlockDay: string, cohortBlockTime: string,
  workingDays: string, timeStart: string, timeEnd: string, lunchStart: string,
): string {
  const c = [...cohorts, ...Array(12).fill('')].slice(0, 12);
  const vals = [
    facultyId, facultyName, school, courseCode, courseName, credits, category, campus,
    ...c,
    fixedRoom, preferredRooms, labHours, semester,
    dayForBlock, timeForBlock,
    courseDayBlock, courseTimeBlock,
    facultyBlockDay, facultyBlockTime,
    cohortBlockDay, cohortBlockTime,
    workingDays, timeStart, timeEnd, lunchStart,
  ];
  // Wrap values containing commas in double-quotes (standard CSV escaping)
  return vals.map(v => v.includes(',') ? `"${v}"` : v).join(',');
}

const _HDR =
  'FacultyID,FacultyName,School,CourseCode,CourseName,Credits,Category,Campus,' +
  'Cohort1,Cohort2,Cohort3,Cohort4,Cohort5,Cohort6,Cohort7,Cohort8,Cohort9,Cohort10,Cohort11,Cohort12,' +
  'FixedRoom,PreferredRooms,LabHours,Semester,' +
  'Explo-Day-Block,Explo-Time-Block,' +
  'Course-Day-Block,Course-Time-Block,' +
  'FacultyBlockDay,FacultyBlockTime,CohortBlockDay,CohortBlockTime,' +
  'FacultyWorkingDays,FacultyTimeStart,FacultyTimeEnd,CohortLunchStart';

export const COURSE_TEMPLATE_CSV = [
  _HDR,
  // Theory — 3 sessions/week
  _row('600001','John Smith','School of Engineering','CS301','Data Structures','3','Theory','K1',
    ['CS-Y3-A','CS-Y3-B'], '','','','1',
    '','', '','', '','', '','',
    'Mon-Fri','8','16','13'),
  // Lab — 2-hour, fixed room
  _row('600002','Jane Doe','School of Engineering','CS401','Lab Practical','2','Lab','K1',
    ['CS-Y4-A'], 'IT201','','2','2',
    '','', '','', '','', '','',
    'Mon-Fri','8','16','13'),
  // Lab — 4-hour, multiple preferred rooms (use | not comma to avoid Excel issues)
  _row('600005','Dr. Patel','School of Health Sciences','HS501','Clinical Lab','1','Lab','AB',
    ['HS-Y3-A'], '','AB-Lab1|AB-Lab2','4','3',
    '','', '','', '','', '','',
    'Mon-Fri','8','16','13'),
  // Studio — leave School blank → auto-balanced
  _row('600003','Alice Brown','School of Design','DES501','Design Studio','2','Studio','AB',
    ['DES-Y5-A'], '','','','2',
    '','', '','', '','', '','',
    '','10','18','13'),
  // Course-Day-Block + Course-Time-Block: place CS501 ONLY on Mon-Wed between 13:00-16:00
  _row('600001','John Smith','School of Engineering','CS501','Evening Seminar','2','Theory','K1',
    ['CS-Y3-A'], '','','','1',
    '','', 'Mon-Wed','13,14,15,16', '','', '','',
    'Mon-Fri','8','16','13'),
  // Explo-Day-Block — blocks both faculty AND cohort CS-Y3-A on Tuesday at 10,11
  _row('600001','John Smith','School of Engineering','','','0','','',
    ['CS-Y3-A'], '','','','1',
    'Tuesday','10,11', '','', '','', '','',
    '','8','16','13'),
  // Faculty block — faculty 600001 is unavailable Monday at 9
  _row('600001','John Smith','School of Engineering','','','0','','',
    [], '', '','','1',
    '','', '','', 'Monday','9', '','',
    '','8','16','13'),
  // Cohort block — CS-Y3-A has assembly every Monday at 10:00 and 11:00
  _row('600001','John Smith','School of Engineering','','','0','','',
    ['CS-Y3-A'], '','','','1',
    '','', '','', '','', 'Monday','10,11',
    '','8','16','13'),
  // Combined separate — block faculty Friday pm AND cohort Wednesday morning
  _row('600002','Jane Doe','School of Engineering','','','0','','',
    ['CS-Y4-A'], '','','','2',
    '','', '','', 'Friday','14,15', 'Wednesday','8,9',
    '','8','16','13'),
  // Flexible lunch — CohortLunchStart="12-14" rotates lunch Mon=12, Tue=13, Wed=12...
  // instead of one fixed hour every day, giving the scheduler more packing room.
  _row('600006','Maria Garcia','School of Engineering','CS601','Algorithms','3','Theory','K1',
    ['CS-Y3-A'], '','','','1',
    '','', '','', '','', '','',
    'Mon-Fri','8','16','12-14'),
].join('\n');

export const ROOM_CAMPUS_TEMPLATE_CSV = [
  'RoomName,Campus,School',
  'K1007,K1,School of Engineering',
  'K2001,K2,School of Engineering',
  'AB-Lab1,AB,School of Health Sciences',
  'AB-Lab2,AB,School of Health Sciences',
  'IT201,K1,School of Engineering',
  'RD001,RD,School of Management',
].join('\n');
