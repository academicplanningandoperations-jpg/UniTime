import type { Course, Faculty, Room, StudentGroup, ScheduleEntry } from '../types';
import { parseElective, baseCategory } from './electives';

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
  // Daily time window for the cohorts on this row, e.g. Sem 2 = 8–13, Sem 4 = 13–18,
  // so two semesters sharing faculty/rooms never overlap. Applies to the cohort on
  // EVERY row it appears in, so it only needs filling once per cohort. null = no limit.
  cohortTimeStart?: number | null;
  cohortTimeEnd?: number | null;
}

// "13", "13:00", "13:30", "8.5" → hours as a number (13, 13, 13.5, 8.5).
// Excel sometimes stores a time as a fraction of a day (0.5416 = 13:00) — handled too.
// Blank or unreadable → null.
export function parseClockHour(raw: string | undefined | null): number | null {
  const t = String(raw ?? '').trim();
  if (!t) return null;
  const hm = t.match(/^(\d{1,2})(?::(\d{2}))?(?::\d{2})?\s*(am|pm)?$/i);
  let h: number;
  if (hm) {
    h = parseInt(hm[1], 10) + (hm[2] ? parseInt(hm[2], 10) / 60 : 0);
    const ap = hm[3]?.toLowerCase();
    if (ap === 'pm' && h < 12) h += 12;
    if (ap === 'am' && h >= 12) h -= 12;
  } else {
    const n = parseFloat(t);
    if (isNaN(n)) return null;
    h = n > 0 && n < 1 ? n * 24 : n;
  }
  h = Math.round(h * 2) / 2; // slots are built on the half hour at most
  return h >= 0 && h <= 24 ? h : null;
}

const fmtHour = (h: number) => padTime(h);

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
  facultyNotFound?: boolean;
  windowTooNarrow?: boolean;   // cohort time window ∩ faculty hours can't fit one session
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

// `occs` lists what takes a lunch hour away: classes and Explo blocks. A
// CohortBlockDay/Time hour is left out on purpose — it only means "no class
// here", so lunch can fall on the same hour (e.g. block Wed 12 + lunch 12).
function leavesLunchFree(occs: Map<string, Set<string>>[], id: string, day: string, lunchHours: number[], keysToAdd: string[]) {
  const sets = occs.map(o => o.get(id)).filter(Boolean) as Set<string>[];
  let freeCount = 0;
  for (const lh of lunchHours) {
    // Key must match the format used by slotKeys/markBusy: "Monday~12:00"
    const k = `${day}~${pad(lh)}`;
    const isCurrentlyFree = sets.every(s => !s.has(k));
    const isToBeOccupied = keysToAdd.includes(k);
    if (isCurrentlyFree && !isToBeOccupied) freeCount++;
  }
  return freeCount > 0;
}

function markBusy(occ: Map<string, Set<string>>, id: string, keys: string[]) {
  if (!occ.has(id)) occ.set(id, new Set());
  keys.forEach(k => occ.get(id)!.add(k));
}

function removeBusy(occ: Map<string, Set<string>>, id: string, keys: string[]) {
  const s = occ.get(id);
  if (s) keys.forEach(k => s.delete(k));
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

// Gap rule for a cohort's day: between two classes the cohort waits at most
// MAX_GAP_HOURS on the clock, whatever fills that time — lunch, Explo blocks,
// CohortBlockTime or nothing. Only real classes end a gap, so `classOcc` holds
// classes only, never blocked hours.
// Returns true if placing newKeys would add waiting time beyond that limit.
// A day that already breaks the rule (e.g. sessions added by hand) is not
// locked: a placement is refused only if it makes the excess bigger.
// Examples:
//   10–11 and 13–14 → gap [11,12]       = 2 → allow
//   10–11 and 14–15 → gap [11,12,13]    = 3 → reject (even if 13 is lunch)
const MAX_GAP_HOURS = 2;

function gapExcess(hours: Set<number>): number {
  const sorted = Array.from(hours).sort((a, b) => a - b);
  let excess = 0;
  for (let i = 1; i < sorted.length; i++) {
    const gap = sorted[i] - sorted[i - 1] - 1;
    if (gap > MAX_GAP_HOURS) excess += gap - MAX_GAP_HOURS;
  }
  return excess;
}

function wouldBreakGapRule(
  classOcc: Map<string, Set<string>>,
  groupId: string,
  day: string,
  newKeys: string[],
): boolean {
  const prefix = `${day}~`;
  const before = new Set<number>();
  const s = classOcc.get(groupId);
  if (s) for (const k of s) if (k.startsWith(prefix)) { const h = parseInt(k.slice(prefix.length)); if (!isNaN(h)) before.add(h); }
  if (before.size === 0) return false; // first class of the day — no gap yet
  const after = new Set(before);
  for (const k of newKeys) if (k.startsWith(prefix)) { const h = parseInt(k.slice(prefix.length)); if (!isNaN(h)) after.add(h); }
  return gapExcess(after) > gapExcess(before);
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
    suggestions.push(`${facLabel} may be overloaded — reduce total credits or extend FacultyTimeStart/End (currently ${fmtHour(asgn.timeStart)}–${fmtHour(asgn.timeEnd)}, ${asgn.workingDays}).`);
    if (asgn.facultyBlockDay || asgn.dayForBlock)
      suggestions.push(`Block columns (FacultyBlockDay="${asgn.facultyBlockDay}" / Explo-Day-Block="${asgn.dayForBlock}") are reducing slots — verify they are correct.`);
  } else if (top.name === 'cohort' && rejCohort > 0) {
    const list = asgn.cohorts.slice(0, 3).join(', ') + (asgn.cohorts.length > 3 ? '…' : '');
    primaryReason = `Cohort(s) ${list} fully booked on ${rejCohort} of ${totalCandidates} candidate slots`;
    suggestions.push(`Cohorts may be over-scheduled — check CohortBlockDay/Time or other courses sharing ${list}.`);
    suggestions.push(`The gap rule may be limiting it: between two classes a cohort waits at most 2 hours, counting lunch and blocked hours. More free days or fewer blocks give more options.`);
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
    primaryReason = `No viable slot in ${asgn.workingDays} ${fmtHour(asgn.timeStart)}–${fmtHour(asgn.timeEnd)} (${totalCandidates} candidates checked)`;
    suggestions.push(`Widen the scheduling window via FacultyTimeStart/End, CohortTimeStart/End or switch FacultyWorkingDays.`);
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
  // Classes only (no blocked hours) — used for the gap rule, where a blocked
  // hour counts as waiting time rather than as a class.
  const cohortClassOcc   = new Map<string, Set<string>>();
  // Explo-blocked hours only — together with classes, these are what the lunch
  // check treats as taken (see leavesLunchFree).
  const cohortExploOcc   = new Map<string, Set<string>>();
  const lunchOcc         = [cohortClassOcc, cohortExploOcc];
  // Lab hours per cohort — used to line up the labs of cohorts that share theory.
  const cohortLabOcc     = new Map<string, Set<string>>();

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
  // When the sheet gives a Faculty ID, only the ID is used — names repeat and are
  // spelled differently, so falling back to the name could hand the load to the
  // wrong person. The name is used only for rows that have no ID at all.
  const findFaculty = (id: string, name: string) => {
    if (id) {
      const nId = normId(id);
      return existingFaculties.find(f =>
        normId(f.facultyId ?? '') === nId || normId(f.id ?? '') === nId ||
        normId((f as any)._Faculty_ID ?? '') === nId
      );
    }
    if (!name) return undefined;
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
  // Also seeds cohortDaySessionCount so that incremental scheduling does not
  // ignore activity placed by a previous run when choosing day tiers.
  const cohortDaySessionCount = new Map<string, number>();
  // Elective baskets ("PE1 Theory", "PE1 Lab" …): which basket holds a cohort's
  // slot. Courses of the SAME basket may share that slot for the cohort, because
  // each student takes only one of them. Key: `${cohortId}|${slotKey}` → basket
  // key; '#' marks a slot also used by an ordinary session (never shareable).
  const electiveSlot = new Map<string, string>();
  for (const entry of existingSchedule) {
    if (entry.termId !== termId) continue;
    const keys = slotKeys(entry.day, entry.startTime, entry.endTime);
    if (entry.facultyId) {
      markBusy(facultyOcc, entry.facultyId, keys);
      // Also count existing theory sessions (e.g. another school's timetable) for
      // the "no more than 2 hours in a row" rule, not just this run's sessions.
      if (baseCategory(entry.category) !== 'lab') markBusy(facultyNonLabOcc, entry.facultyId, keys);
    }
    const existingElective = parseElective(entry.category);
    entry.groupIds?.forEach(gid => {
      keys.forEach(sk => {
        const ek = `${gid}|${sk}`;
        if (!existingElective) electiveSlot.set(ek, '#');
        else if (!electiveSlot.has(ek)) electiveSlot.set(ek, existingElective.key);
      });
      markBusy(cohortOcc, gid, keys);
      markBusy(cohortClassOcc, gid, keys);
      if (baseCategory(entry.category) === 'lab') markBusy(cohortLabOcc, gid, keys);
      const k = `${gid}~${entry.day}`;
      cohortDaySessionCount.set(k, (cohortDaySessionCount.get(k) ?? 0) + 1);
    });
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
          groups.forEach(g => { markBusy(cohortOcc, g.id, key); markBusy(cohortExploOcc, g.id, key); });
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

  // ── Cohort time windows (CohortTimeStart / CohortTimeEnd) ─────────────────
  // A window set on any row applies to that cohort everywhere it appears. If two
  // rows give the same cohort different windows, the overlap of both is used.
  const cohortWindow = new Map<string, { start: number; end: number }>();
  for (const asgn of assignments) {
    const ws = asgn.cohortTimeStart ?? null;
    const we = asgn.cohortTimeEnd ?? null;
    if (ws === null && we === null) continue;
    for (const g of asgn.cohorts.map(findGroup).filter(Boolean) as StudentGroup[]) {
      const prev = cohortWindow.get(g.id) ?? { start: 0, end: 24 };
      cohortWindow.set(g.id, {
        start: Math.max(prev.start, ws ?? 0),
        end:   Math.min(prev.end,   we ?? 24),
      });
    }
  }
  // Each session's allowed window, for the consolidation pass further down.
  const entryWindow = new Map<ScheduleEntry, { start: number; end: number }>();

  // ── Collect schedulable rows: must have courseCode + credits > 0 ─────────
  const courseRows = assignments.filter(a => a.courseCode.trim() && a.credits > 0);
  const totalSessions = courseRows.reduce((s, a) => s + a.credits, 0);
  const windowedRows = new Set<CourseAssignment>(cohortWindow.size === 0 ? [] :
    courseRows.filter(a => a.cohorts.some(c => { const g = findGroup(c); return !!g && cohortWindow.has(g.id); })));
  const hasCohortWindow = (a: CourseAssignment) => windowedRows.has(a);

  // ── Day rules for every cohort ───────────────────────────────────────────
  //  • A day with classes has at least MIN_DAY_CLASSES classes (a 2-hour lab
  //    is one class) — no coming in for a single class. A course still never
  //    appears twice on the same day.
  //  • At most one free day in the cohort's week (the working days of its
  //    rows), unless it has too few classes to give that many days
  //    MIN_DAY_CLASSES each — then it gets as many days as its classes allow.
  const MIN_DAY_CLASSES = 2;
  const rowSessions = (a: CourseAssignment) => {
    const c = parseElective(a.category)?.base ?? a.category.toLowerCase();
    return c === 'tutorial' ? 1 : c === 'mba' ? Math.round(a.credits / 1.5) : c === 'edge' ? Math.round(a.credits / 2) : a.credits;
  };
  const rowHours = (a: CourseAssignment) => {
    const c = parseElective(a.category)?.base ?? a.category.toLowerCase();
    const sessions = c === 'tutorial' ? 1 : c === 'mba' ? Math.round(a.credits / 1.5) : c === 'edge' ? Math.round(a.credits / 2) : a.credits;
    const dur = c === 'lab' ? (a.labHours || 2) : c === 'mba' ? 1.5 : c === 'edge' ? 2 : 1;
    return sessions * Math.ceil(dur);
  };
  const cohortWeek = new Map<string, Set<string>>();
  const cohortNewClasses = new Map<string, number>();
  for (const a of courseRows) {
    const rowDays = parseDays(a.workingDays).length ? parseDays(a.workingDays) : DAYS_MAP['Mon-Fri'];
    const n = rowSessions(a);
    for (const g of a.cohorts.map(findGroup).filter(Boolean) as StudentGroup[]) {
      const w = cohortWeek.get(g.id) ?? new Set<string>();
      rowDays.forEach(d => w.add(d));
      cohortWeek.set(g.id, w);
      cohortNewClasses.set(g.id, (cohortNewClasses.get(g.id) ?? 0) + n);
    }
  }
  // Class hours a cohort has on a day (blocked hours don't count).
  const dayHours = (gid: string, day: string): number => {
    const set = cohortClassOcc.get(gid);
    if (!set) return 0;
    const prefix = `${day}~`;
    let n = 0;
    for (const k of set) if (k.startsWith(prefix)) n++;
    return n;
  };
  // Classes (sessions) a cohort has on a day.
  const dayClasses = (gid: string, day: string): number => cohortDaySessionCount.get(`${gid}~${day}`) ?? 0;
  const cohortDaysUsed = (gid: string): number => {
    const w = cohortWeek.get(gid);
    if (!w) return 0;
    let n = 0;
    w.forEach(d => { if (dayHours(gid, d) > 0) n++; });
    return n;
  };
  const requiredDays = new Map<string, number>();
  cohortWeek.forEach((w, gid) => {
    let total = cohortNewClasses.get(gid) ?? 0;
    w.forEach(d => { total += dayClasses(gid, d); });
    requiredDays.set(gid, Math.max(Math.min(1, total), Math.min(w.size - 1, Math.floor(total / MIN_DAY_CLASSES))));
  });
  const needsMoreDays = (gid: string) => cohortDaysUsed(gid) < (requiredDays.get(gid) ?? 0);

  // ── Cohorts that share classes (e.g. BT-CSE-B1 + B2 for theory) ──────────
  // Their separate labs are lined up in the same slots, so both batches are
  // in labs together and free together for their shared theory.
  const pairParent = new Map<string, string>();
  const pairRoot = (x: string): string => {
    let r = x;
    while (pairParent.has(r) && pairParent.get(r) !== r) r = pairParent.get(r)!;
    return r;
  };
  for (const a of courseRows) {
    const gs = a.cohorts.map(findGroup).filter(Boolean) as StudentGroup[];
    for (let i = 1; i < gs.length; i++) {
      const ra = pairRoot(gs[0].id), rb = pairRoot(gs[i].id);
      if (ra !== rb) pairParent.set(rb, ra);
    }
  }
  const pairMembers = new Map<string, string[]>();
  cohortWeek.forEach((_, gid) => {
    const r = pairRoot(gid);
    pairMembers.set(r, [...(pairMembers.get(r) ?? []), gid]);
  });
  const siblingsOf = (gid: string): string[] => (pairMembers.get(pairRoot(gid)) ?? []).filter(x => x !== gid);

  // ── Planned class days ────────────────────────────────────────────────────
  // Each group of paired cohorts gets its class days decided up front: its
  // week minus the free day(s) it is allowed. The free day is the one fewest
  // of its rows' faculty can teach on (so it costs the least). Sessions then
  // go to the planned day with the fewest hours so far, which fills every
  // planned day evenly to MIN_DAY_CLASSES and avoids one-class days.
  const plannedDays = new Map<string, Set<string>>();
  pairMembers.forEach(members => {
    const week = new Set<string>();
    members.forEach(g => cohortWeek.get(g)?.forEach(d => week.add(d)));
    const need = Math.max(...members.map(g => requiredDays.get(g) ?? 0), 0);
    const avail = new Map<string, number>();
    for (const a of courseRows) {
      const gs = a.cohorts.map(findGroup).filter(Boolean) as StudentGroup[];
      if (!gs.some(g => members.includes(g.id))) continue;
      const rowDays = parseDays(a.workingDays).length ? parseDays(a.workingDays) : DAYS_MAP['Mon-Fri'];
      rowDays.forEach(d => avail.set(d, (avail.get(d) ?? 0) + rowHours(a)));
    }
    const order = Array.from(week).sort((x, y) => (avail.get(y) ?? 0) - (avail.get(x) ?? 0)); // most-available first
    const days = new Set(order.slice(0, Math.max(1, need)));
    members.forEach(g => plannedDays.set(g, new Set(Array.from(days).filter(d => cohortWeek.get(g)?.has(d)))));
  });
  // What each placed session was allowed to do, so the repair pass at the end
  // only moves it to a day/time its row would have accepted.
  const entryRules = new Map<ScheduleEntry, { days: string[]; hours: Set<number> | null; isLab: boolean; lunch: number[] }>();

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
    // Rows limited to a half-day window have fewer slots, so they pick first.
    const aW = hasCohortWindow(a) ? 0 : 1;
    const bW = hasCohortWindow(b) ? 0 : 1;
    if (aW !== bW) return aW - bW;
    const al = baseCategory(a.category) === 'lab' ? 0 : 1;
    const bl = baseCategory(b.category) === 'lab' ? 0 : 1;
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
    // "PE1 Lab" behaves as a Lab (duration, room type) that belongs to basket PE1.
    const elective      = parseElective(asgn.category);
    const cat           = elective ? elective.base : asgn.category.toLowerCase();
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

    if (asgn.facultyId && !faculty) {
      unresolved.push({
        courseCode:      asgn.courseCode,
        courseName:      asgn.courseName,
        facultyId:       asgn.facultyId,
        facultyName:     asgn.facultyName,
        cohorts:         asgn.cohorts,
        category:        asgn.category,
        sessionsNeeded,
        sessionsPlaced:  0,
        reason:          `Faculty ID "${asgn.facultyId}" not found in the Faculty registry for this term`,
        facultyNotFound: true,
      });
      continue;
    }

    // Daily window = faculty hours, narrowed by every cohort's own window.
    const facStart = asgn.timeStart || 8;
    const facEnd   = asgn.timeEnd   || 16;
    let winStart = facStart, winEnd = facEnd;
    let cohortWin: { start: number; end: number } | null = null;
    for (const g of groups) {
      const w = cohortWindow.get(g.id);
      if (!w) continue;
      cohortWin = cohortWin
        ? { start: Math.max(cohortWin.start, w.start), end: Math.min(cohortWin.end, w.end) }
        : { ...w };
    }
    if (cohortWin) {
      winStart = Math.max(winStart, cohortWin.start);
      winEnd   = Math.min(winEnd,   cohortWin.end);
      if (winEnd - winStart < duration) {
        unresolved.push({
          courseCode:      asgn.courseCode,
          courseName:      asgn.courseName,
          facultyId:       asgn.facultyId,
          facultyName:     asgn.facultyName,
          cohorts:         asgn.cohorts,
          category:        asgn.category,
          sessionsNeeded,
          sessionsPlaced:  0,
          reason:          `Cohort window ${fmtHour(cohortWin.start)}–${fmtHour(cohortWin.end)} and faculty hours ` +
                           `${fmtHour(facStart)}–${fmtHour(facEnd)} leave no room for a ${duration}-hour session — ` +
                           `widen CohortTimeStart/End or FacultyTimeStart/End`,
          windowTooNarrow: true,
        });
        continue;
      }
    }

    // A half-day cohort doesn't need a lunch break at the edge of its window —
    // a 13:00–18:00 cohort eats before it arrives, an 8:00–13:00 one after it leaves.
    // Only lunch hours strictly inside the window are kept free.
    const effLunch = cohortWin
      ? lunchHours.filter(h => h > cohortWin!.start && h + 1 < cohortWin!.end)
      : lunchHours;

    const dayKey =`${asgn.facultyId}::${asgn.courseCode}::${[...asgn.cohorts].sort().join(',')}`;
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
      let daySlots = buildSlots(winStart, winEnd, duration);
      if (allowedHours) daySlots = daySlots.filter(sl => allowedHours.has(parseInt(sl.startTime)));
      // Labs without an explicit courseTimeBlock are restricted to even start hours
      // (8,10,12,14,16,18) so sessions pack as 8-10, 10-12, 14-16, 16-18 with no
      // odd-hour fragments, allowing a faculty to reach 30h without slot waste.
      if (isLab && !asgn.courseTimeBlock.trim()) daySlots = daySlots.filter(sl => parseInt(sl.startTime) % 2 === 0);
      return daySlots.map(sl => ({ day, ...sl }));
    });
    // Candidate order:
    //  1. the cohort's planned class days before any other day;
    //  2. among those, days still under MIN_DAY_CLASSES first, emptiest first —
    //     so every planned day fills evenly up to the minimum;
    //  3. within a day, slots right next to the cohort's other classes, so the
    //     day stays one compact block.
    const closeness = (day: string, startTime: string): number => {
      const st = parseInt(startTime), en = st + Math.ceil(duration);
      let worst = 0;
      for (const gid of groupIds) {
        const prefix = `${day}~`;
        let best = -1;
        cohortClassOcc.get(gid)?.forEach(k => {
          if (!k.startsWith(prefix)) return;
          const h = parseInt(k.slice(prefix.length));
          const d = h < st ? st - h - 1 : h >= en ? h - en : 0;
          if (best < 0 || d < best) best = d;
        });
        if (best > worst) worst = best;
      }
      return worst;
    };
    // Planned days first; among them the one with the fewest hours so far.
    const offPlan = (day: string) => groups.some(g => !(plannedDays.get(g.id)?.has(day) ?? true)) ? 1 : 0;
    const fewest = (day: string) => Math.max(0, ...groupIds.map(g => dayClasses(g, day)));
    const scored = shuffle(rawCandidates).map(c => ({
      c, off: offPlan(c.day), load: fewest(c.day), near: closeness(c.day, c.startTime),
    }));
    scored.sort((x, y) => (x.off - y.off) || (Math.min(x.load, MIN_DAY_CLASSES) - Math.min(y.load, MIN_DAY_CLASSES)) || (x.near - y.near) || (x.load - y.load));
    let tiered = scored.map(x => x.c);
    // Paired cohorts: a lab goes first into a slot where a paired cohort (one
    // it shares theory with) already has its own lab.
    if (isLab) {
      const alignedLab = (c: { day: string; startTime: string; endTime: string }) => {
        const keys = slotKeys(c.day, c.startTime, c.endTime);
        return groups.length > 0 && groups.every(g => siblingsOf(g.id).some(sib => {
          const lab = cohortLabOcc.get(sib);
          return !!lab && keys.every(k => lab.has(k));
        }));
      };
      const flagged = tiered.map(c => ({ c, al: alignedLab(c) }));
      tiered = [...flagged.filter(x => x.al), ...flagged.filter(x => !x.al)].map(x => x.c);
    }

    // Elective basket: a slot the cohort already uses for another course of the
    // same basket counts as free, and such slots are tried FIRST so the basket's
    // courses line up at the same time instead of spreading across the week.
    const inBasket = (gid: string, keys: string[]) =>
      !!elective && keys.every(k => electiveSlot.get(`${gid}|${k}`) === elective.key);
    const cohortFree = (gid: string, keys: string[]) => {
      const s = cohortOcc.get(gid);
      return !s || keys.every(k => !s.has(k) || (!!elective && electiveSlot.get(`${gid}|${k}`) === elective.key));
    };
    let candidates = tiered;
    if (elective && groups.length > 0) {
      const joining: typeof tiered = [], rest: typeof tiered = [];
      for (const c of tiered) {
        const keys = slotKeys(c.day, c.startTime, c.endTime);
        (groups.some(g => inBasket(g.id, keys)) ? joining : rest).push(c);
      }
      candidates = [...joining, ...rest];
    }

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
        if (cat === 'studio') return t.includes('studio');
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
      groups.forEach(g => {
        // Joining a slot the basket already holds adds no new class time for the cohort.
        const sharedSlot = inBasket(g.id, keys);
        markBusy(cohortOcc, g.id, keys);
        markBusy(cohortClassOcc, g.id, keys);
        if (isLab) markBusy(cohortLabOcc, g.id, keys);
        if (elective) keys.forEach(k => electiveSlot.set(`${g.id}|${k}`, elective.key));
        if (sharedSlot) return;
        const dk = `${g.id}~${day}`;
        cohortDaySessionCount.set(dk, (cohortDaySessionCount.get(dk) ?? 0) + 1);
      });
      markBusy(roomOcc, pickedRoom.id, keys);
      takenDays.add(day);

      const entry = {
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
      } as ScheduleEntry;
      entries.push(entry);
      if (cohortWin) entryWindow.set(entry, { start: winStart, end: winEnd });
      entryRules.set(entry, { days: candidateDays, hours: allowedHours, isLab, lunch: effLunch });

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
      if (groups.some(g => !cohortFree(g.id, keys))) { rejCohort++; continue; }
      if (effLunch.length > 0 && groups.some(g => !leavesLunchFree(lunchOcc, g.id, day, effLunch, keys))) { rejCohort++; continue; }
      if (groups.some(g => wouldBreakGapRule(cohortClassOcc, g.id, day, keys))) { rejCohort++; continue; }
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
        { ...asgn, timeStart: winStart, timeEnd: winEnd }, candidates.length,
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

  // ── Post-processing ───────────────────────────────────────────────────────
  // Moves already-placed sessions to fix whole-week problems that one-by-one
  // placement can't see. Every move keeps all rules: no faculty/room/cohort
  // clash, lunch, the 2-hour gap (on the day it leaves and the day it joins),
  // the faculty's 2-hours-in-a-row limit, the row's working days and course
  // day/time blocks, the cohort's time window, the same room, and the same
  // course not twice on one day. Elective-basket sessions stay put.
  const durationOf = (e: ScheduleEntry) => {
    const [sH, sM] = e.startTime.split(':').map(Number);
    const [eH, eM] = e.endTime.split(':').map(Number);
    return (eH - sH) + (eM - sM) / 60;
  };
  const gapOk = (gid: string, day: string): boolean => {
    const prefix = `${day}~`;
    const hrs: number[] = [];
    cohortClassOcc.get(gid)?.forEach(k => { if (k.startsWith(prefix)) hrs.push(parseInt(k.slice(prefix.length))); });
    hrs.sort((x, y) => x - y);
    for (let i = 1; i < hrs.length; i++) if (hrs[i] - hrs[i - 1] - 1 > MAX_GAP_HOURS) return false;
    return true;
  };
  const occupy = (e: ScheduleEntry, keys: string[], on: boolean) => {
    const f = on ? markBusy : removeBusy;
    const isLabE = !!entryRules.get(e)?.isLab;
    if (e.facultyId) { f(facultyOcc, e.facultyId, keys); if (!isLabE) f(facultyNonLabOcc, e.facultyId, keys); }
    (e.groupIds ?? []).forEach(g => { f(cohortOcc, g, keys); f(cohortClassOcc, g, keys); if (isLabE) f(cohortLabOcc, g, keys); });
    if (e.roomId) f(roomOcc, e.roomId, keys);
  };
  const movable = (e: ScheduleEntry) => entryRules.has(e) && !parseElective(e.category);
  const moveEntry = (entry: ScheduleEntry, tDay: string): boolean => {
    const rules = entryRules.get(entry);
    if (!rules || !rules.days.includes(tDay) || entry.day === tDay) return false;
    const gids = entry.groupIds ?? [];
    if (entries.some(e => e !== entry && e.day === tDay && e.courseId === entry.courseId
      && e.facultyId === entry.facultyId && (e.groupIds ?? []).some(g => gids.includes(g)))) return false;
    const oldDay = entry.day as string;
    const oldKeys = slotKeys(oldDay, entry.startTime, entry.endTime);
    occupy(entry, oldKeys, false);
    let best: { startTime: string; endTime: string; score: number } | null = null;
    if (gids.every(g => gapOk(g, oldDay))) {
      const win = entryWindow.get(entry);
      let slots = buildSlots(win ? win.start : 8, win ? win.end : 19, durationOf(entry));
      if (rules.hours) slots = slots.filter(sl => rules.hours!.has(parseInt(sl.startTime)));
      if (rules.isLab && !rules.hours) slots = slots.filter(sl => parseInt(sl.startTime) % 2 === 0);
      for (const sl of slots) {
        const k = slotKeys(tDay, sl.startTime, sl.endTime);
        if (entry.facultyId && !isFree(facultyOcc, entry.facultyId, k)) continue;
        if (gids.some(g => !isFree(cohortOcc, g, k))) continue;
        if (rules.lunch.length > 0 && gids.some(g => !leavesLunchFree(lunchOcc, g, tDay, rules.lunch, k))) continue;
        if (gids.some(g => wouldBreakGapRule(cohortClassOcc, g, tDay, k))) continue;
        if (!rules.isLab && entry.facultyId && wouldCreateLongRun(facultyNonLabOcc, entry.facultyId, tDay, k)) continue;
        if (entry.roomId && !isFree(roomOcc, entry.roomId, k)) continue;
        // Prefer the slot closest to the cohorts' other classes that day.
        const st = parseInt(sl.startTime), en = st + k.length;
        let score = 0;
        for (const g of gids) {
          const prefix = `${tDay}~`;
          let near = -1;
          cohortClassOcc.get(g)?.forEach(key => {
            if (!key.startsWith(prefix)) return;
            const h = parseInt(key.slice(prefix.length));
            const d = h < st ? st - h - 1 : h >= en ? h - en : 0;
            if (near < 0 || d < near) near = d;
          });
          score += Math.max(0, near);
        }
        if (!best || score < best.score) best = { startTime: sl.startTime, endTime: sl.endTime, score };
      }
    }
    if (!best) { occupy(entry, oldKeys, true); return false; }
    entry.day = tDay as typeof entry.day;
    entry.startTime = best.startTime;
    entry.endTime = best.endTime;
    occupy(entry, slotKeys(tDay, best.startTime, best.endTime), true);
    gids.forEach(g => {
      cohortDaySessionCount.set(`${g}~${tDay}`, (cohortDaySessionCount.get(`${g}~${tDay}`) ?? 0) + 1);
      cohortDaySessionCount.set(`${g}~${oldDay}`, Math.max(0, (cohortDaySessionCount.get(`${g}~${oldDay}`) ?? 1) - 1));
    });
    return true;
  };
  const req = (g: string) => requiredDays.get(g) ?? 0;
  // Taking one class off `day` leaves that day fine for cohort g?
  const leavesDayOk = (g: string, day: string) => {
    const left = dayClasses(g, day) - 1;
    return left >= MIN_DAY_CLASSES || (left <= 0 && cohortDaysUsed(g) - 1 >= req(g));
  };
  // Adding one class to `day` doesn't create a new one-class day for cohort g?
  const joinsDayOk = (g: string, day: string) => dayClasses(g, day) > 0;

  for (let round = 0; round < 8; round++) {
    let progress = false;

    // (a) Cohorts with more than one free day: move a class onto an empty day.
    for (const [gid, week] of cohortWeek) {
      if (!needsMoreDays(gid)) continue;
      const emptyDays = Array.from(week).filter(d => dayHours(gid, d) === 0);
      const cands = entries
        .filter(e => movable(e) && (e.groupIds ?? []).includes(gid))
        .filter(e => (e.groupIds ?? []).every(g => leavesDayOk(g, e.day as string)));
      outer: for (const tDay of emptyDays) {
        for (const e of cands) {
          if (!(e.groupIds ?? []).every(g => g === gid || joinsDayOk(g, tDay))) continue;
          if (moveEntry(e, tDay)) { progress = true; break outer; }
        }
      }
    }

    // (b) One-class days (some classes, under MIN_DAY_CLASSES): top them up from
    //     fuller days, or empty them onto the cohort's other class days.
    for (const [gid, week] of cohortWeek) {
      for (const d of week) {
        const h = dayClasses(gid, d);
        if (h === 0 || h >= MIN_DAY_CLASSES) continue;
        const donors = entries
          .filter(e => movable(e) && e.day !== d && (e.groupIds ?? []).includes(gid))
          .filter(e => (e.groupIds ?? []).every(g => leavesDayOk(g, e.day as string)
            && (g === gid || joinsDayOk(g, d))));
        for (const e of donors) {
          if (dayClasses(gid, d) >= MIN_DAY_CLASSES) break;
          if (moveEntry(e, d)) progress = true;
        }
        if (dayClasses(gid, d) >= MIN_DAY_CLASSES || dayClasses(gid, d) === 0) continue;
        if (cohortDaysUsed(gid) - 1 < req(gid)) continue; // this day is needed
        const here = entries.filter(e => movable(e) && e.day === d && (e.groupIds ?? []).includes(gid));
        for (const e of here) {
          for (const tDay of week) {
            if (tDay === d || dayClasses(gid, tDay) === 0) continue;
            if (!(e.groupIds ?? []).every(g => g === gid
              || (leavesDayOk(g, d) && joinsDayOk(g, tDay)))) continue;
            if (moveEntry(e, tDay)) { progress = true; break; }
          }
        }
      }
    }
    if (!progress) break;
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
// 36:CohortTimeStart  37:CohortTimeEnd — daily window for the row's cohorts
//   (e.g. Sem 2 = 8 to 13, Sem 4 = 13 to 18 so the two never overlap). Optional.

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
  cohortTimeStart = '', cohortTimeEnd = '',
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
    cohortTimeStart, cohortTimeEnd,
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
  'FacultyWorkingDays,FacultyTimeStart,FacultyTimeEnd,CohortLunchStart,' +
  'CohortTimeStart,CohortTimeEnd';

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
  // Half-day semesters — Sem 2 cohort only 8:00–13:00, Sem 4 cohort only 13:00–18:00,
  // so the two timetables never overlap even with the same faculty and rooms.
  // Filling the window on one row is enough; it applies to that cohort on every row.
  _row('600001','John Smith','School of Engineering','CS201','Programming II','3','Theory','K1',
    ['CS-SEM2-A'], '','','','2',
    '','', '','', '','', '','',
    'Mon-Fri','8','18','13', '8','13'),
  _row('600001','John Smith','School of Engineering','CS401','Operating Systems','3','Theory','K1',
    ['CS-SEM4-A'], '','','','4',
    '','', '','', '','', '','',
    'Mon-Fri','8','18','13', '13','18'),
  // Elective basket — Physics and Chemistry are both "PE1 Theory" for the same cohort:
  // each student takes one of them, so they are scheduled at the SAME time with
  // different faculty and rooms. Use "PE1 Lab" the same way for the lab choices.
  _row('600007','Ravi Mehta','School of Engineering','PHY101','Physics','3','PE1 Theory','K1',
    ['ME-Y1-A'], '','','','1',
    '','', '','', '','', '','',
    'Mon-Fri','8','16','13'),
  _row('600008','Sara Khan','School of Engineering','CHE101','Chemistry','3','PE1 Theory','K1',
    ['ME-Y1-A'], '','','','1',
    '','', '','', '','', '','',
    'Mon-Fri','8','16','13'),
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
