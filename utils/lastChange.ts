import type { ScheduleEntry } from '../types';

// The most recent change to a session — its edit if it has been edited since it
// was created, otherwise its creation. Names and times are stamped by the
// database from the signed-in account, so they can't be typed in by hand.
export interface LastChange { verb: 'Created' | 'Edited'; by: string; at?: string }

export function lastChange(e: Pick<ScheduleEntry, 'createdBy' | 'createdAt' | 'updatedBy' | 'updatedAt'>): LastChange | null {
  const edited = !!e.updatedBy && (!e.createdAt || !e.updatedAt || e.updatedAt >= e.createdAt);
  if (edited) return { verb: 'Edited', by: e.updatedBy!, at: e.updatedAt };
  if (e.createdBy) return { verb: 'Created', by: e.createdBy, at: e.createdAt };
  return null;
}

// "16 Oct 2026, 10:42 am"
export function formatChangeTime(iso?: string): string {
  if (!iso) return '';
  const d = new Date(iso);
  if (isNaN(d.getTime())) return '';
  return d.toLocaleString('en-IN', { day: 'numeric', month: 'short', year: 'numeric', hour: 'numeric', minute: '2-digit' });
}

// Audit fields are filled in by the database, so they are left out when
// comparing two versions of a session for "did someone change this?".
export function withoutAudit(e: ScheduleEntry): Omit<ScheduleEntry, 'createdBy' | 'createdAt' | 'updatedBy' | 'updatedAt'> {
  const { createdBy: _a, createdAt: _b, updatedBy: _c, updatedAt: _d, ...rest } = e;
  return rest;
}
