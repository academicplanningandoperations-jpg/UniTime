import type { ScheduleEntry, StudentGroup } from '../types';

// A session's school comes from the course-assignment sheet (stored on the
// session when the auto-schedule is applied). Sessions added by hand have no
// school of their own, so they take their cohorts' school:
//   1. the school the cohort has on the sheet sessions, else
//   2. the School saved on the cohort itself (cohort upload / edit form; kept
//      in the cohort's `program` field). Older terms' cohorts have "General"
//      there, which means "no school", so those terms are not affected.
// The faculty's department is never used here.

export const NO_SCHOOL = 'No school (not from a sheet)';

// The School saved on a cohort, or '' when it has none.
export const groupSchool = (g?: Pick<StudentGroup, 'program'> | null): string => {
  const p = (g?.program || '').trim();
  return p && p.toLowerCase() !== 'general' ? p : '';
};

export function cohortSchoolMap(entries: ScheduleEntry[], groups: StudentGroup[] = []): Map<string, string> {
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
  // Cohorts with no sheet sessions yet: use the School saved on the cohort.
  for (const g of groups) {
    if (out.has(g.id)) continue;
    const s = groupSchool(g);
    if (s) out.set(g.id, s);
  }
  return out;
}

export function schoolFromCohorts(groupIds: string[] | undefined, map: Map<string, string>): string {
  for (const g of groupIds || []) { const s = map.get(g); if (s) return s; }
  return '';
}

export function sessionSchool(e: ScheduleEntry, map: Map<string, string>): string {
  return (e.school || '').trim() || schoolFromCohorts(e.groupIds, map) || NO_SCHOOL;
}
