import type { ScheduleEntry } from '../types';
import type { SchedulerResult, SolverProblem, UnresolvedSession } from './autoScheduler';

// Talks to the UniTime Solver program (solver/unitime_solver.py) running on
// this computer. Only this computer can reach it; it calculates and answers,
// and UniTime saves the result as usual when Apply is clicked.
export const SOLVER_URL = 'http://127.0.0.1:8765';
export const SOLVER_MIN_VERSION = '1.0.0';

export interface SolverStatus { ok: boolean; version: string; busy: boolean }

const newer = (a: string, b: string) => {
  const pa = a.split('.').map(Number), pb = b.split('.').map(Number);
  for (let i = 0; i < 3; i++) if ((pa[i] || 0) !== (pb[i] || 0)) return (pa[i] || 0) > (pb[i] || 0);
  return true;
};
export const solverOutdated = (s: SolverStatus | null) => !!s && !newer(s.version, SOLVER_MIN_VERSION);

export async function checkSolver(timeoutMs = 1500): Promise<SolverStatus | null> {
  try {
    const ctl = new AbortController();
    const t = setTimeout(() => ctl.abort(), timeoutMs);
    const r = await fetch(`${SOLVER_URL}/health`, { signal: ctl.signal });
    clearTimeout(t);
    if (!r.ok) return null;
    const j = await r.json();
    return j?.ok ? j as SolverStatus : null;
  } catch {
    return null;
  }
}

interface SolverAnswer {
  ok: boolean;
  error?: string;
  placed: [number, string, string, string, string][];   // row, day, start, end, room
  unplaced: { row: number; placed: number; reason: string; refused: Record<string, number> }[];
  stats: { placed: number; needed: number; standardPlaced: number; upperBound: number; proven: boolean; seconds: number };
}

export async function runSolver(
  problem: SolverProblem,
  timeLimitSec: number,
  onProgress: (text: string, fraction: number) => void,
): Promise<SolverAnswer> {
  // The rows' original sheet data stays here; the solver doesn't need it.
  const payload = { ...problem, rows: problem.rows.map(({ asgn: _a, ...r }) => r) };
  const started = Date.now();
  const total = problem.rows.reduce((s, r) => s + r.sessions, 0);
  const timer = setInterval(async () => {
    const secs = Math.round((Date.now() - started) / 1000);
    let text = `Solver working · ${secs}s of up to ${timeLimitSec}s`;
    try {
      const p = await (await fetch(`${SOLVER_URL}/progress`)).json();
      if (p?.phase === 'placing' && typeof p.best === 'number') text += ` · best so far: ${p.best} of ${total} placed`;
      else if (p?.phase) text += ` · ${p.phase}`;
    } catch { /* progress is optional */ }
    onProgress(text, Math.min(0.99, secs / (timeLimitSec + 15)));
  }, 2000);
  try {
    const r = await fetch(`${SOLVER_URL}/solve`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ problem: payload, timeLimit: timeLimitSec }),
    });
    const j = await r.json();
    if (!r.ok || !j.ok) throw new Error(j?.error || `Solver answered ${r.status}`);
    return j as SolverAnswer;
  } finally {
    clearInterval(timer);
  }
}

// Turn the solver's answer into the same result shape the Standard method
// gives, so preview, the Excel conflict report and Apply work unchanged.
export function resultFromSolver(problem: SolverProblem, ans: SolverAnswer, termId: string, weeks: number[]): SchedulerResult {
  const stamp = Date.now();
  const entries: ScheduleEntry[] = ans.placed.map(([r, day, startTime, endTime, roomId], i) => {
    const row = problem.rows[r];
    return {
      id: `solver-${stamp}-${i}`,
      termId,
      courseId: row.courseId,
      facultyId: row.facultyId,
      roomId,
      groupIds: row.groupIds,
      day: day as ScheduleEntry['day'],
      startTime,
      endTime,
      departmentId: 'General',
      weeks,
      category: row.category,
      school: row.school,
    } as ScheduleEntry;
  });
  const unresolved: UnresolvedSession[] = [...problem.preUnresolved];
  for (const u of ans.unplaced) {
    const row = problem.rows[u.row];
    const a = row.asgn;
    const f = u.refused || {};
    unresolved.push({
      courseCode: a.courseCode,
      courseName: a.courseName,
      facultyId: a.facultyId,
      facultyName: a.facultyName,
      cohorts: a.cohorts,
      category: a.category,
      sessionsNeeded: row.sessions,
      sessionsPlaced: u.placed,
      reason: u.reason,
      diagnostics: {
        primaryReason: u.reason,
        totalCandidates: row.cands.length,
        rejectedByFacultyClash: f['Faculty busy'] ?? 0,
        rejectedByCohortClash: f['Cohort busy'] ?? 0,
        rejectedByConsecutiveHours: f['Faculty would teach 3 hours in a row'] ?? 0,
        rejectedByFixedRoom: 0,
        rejectedByNoRoom: f['No free room'] ?? 0,
        suggestions: [
          'The solver tried all classes together. To place this one, one of its rules has to give: ' +
          'wider faculty or cohort hours, more working days, more allowed rooms, or fewer blocked hours.',
        ],
      },
    });
  }
  return {
    entries,
    unresolved,
    roomless: [],
    stats: { totalSessions: problem.totalSessions, placed: entries.length, unresolvedCount: problem.totalSessions - entries.length },
  };
}
