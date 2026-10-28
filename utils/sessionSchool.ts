import type { ScheduleEntry } from '../types';

// A session's school comes from the course-assignment sheet (stored on the
// session when the auto-schedule is applied). Sessions added by hand have no
// school of their own, so they take the school their cohorts have on the
// sheet sessions. The faculty's department and the cohort upload's School
// column are never used here.

export const NO_SCHOOL = 'No school (not from a sheet)';

export function cohortSchoolMap(entries: ScheduleEntry[]): Map<string, string> {
  const counts = new Map<string, Map<string, number>>();
  for (const e of entries) {
    const s = (e.school || '').trim();
    if (!s) continue;
    for (const g of e.groupIds || []) {
      const m = counts.get(g) ?? new Map<string, number>();
      m.set(s, (m.get(s) ?? 0) + 1);
      counts.set(g, m);
    }
  }
  // A cohort shared across schools takes the school it has most sessions with.
  const out = new Map<string, string>();
  counts.forEach((m, g) => {
    let best = '', n = -1;
    m.forEach((c, s) => { if (c > n) { best = s; n = c; } });
    out.set(g, best);
  });
  return out;
}

export function schoolFromCohorts(groupIds: string[] | undefined, map: Map<string, string>): string {
  for (const g of groupIds || []) { const s = map.get(g); if (s) return s; }
  return '';
}

export function sessionSchool(e: ScheduleEntry, map: Map<string, string>): string {
  return (e.school || '').trim() || schoolFromCohorts(e.groupIds, map) || NO_SCHOOL;
}
