import { ScheduleEntry, Faculty, Clash } from '../types';
import { supabase } from './supabase';

// ─── Schema whitelist ─────────────────────────────────────────────────────────
// Only these columns are sent to Supabase. Any extra React-only fields are stripped.
const SCHEMA: Record<string, string[]> = {
  users:     ['id', 'username', 'password', 'name', 'role', 'departmentScope', 'lastLogin'],
  terms:     ['id', 'name', 'startDate', 'endDate', 'academicYear', 'isActive'],
  courses:   ['id', 'termId', 'code', 'name', 'credits', 'department', 'duration', 'type', 'color'],
  faculties: ['id', 'facultyId', 'termId', 'name', 'department', 'availability', 'maxHoursPerWeek'],
  rooms:     ['id', 'termId', 'name', 'capacity', 'type'],
  groups:    ['id', 'termId', 'name', 'program', 'semester', 'studentCount'],
  schedule:  ['id', 'termId', 'courseId', 'facultyId', 'roomId', 'groupIds', 'day', 'startTime', 'endTime', 'departmentId', 'weeks', 'category'],
};

// Term-scoped tables — all reads/writes are filtered by termId
const TERM_SCOPED = new Set(['courses', 'faculties', 'rooms', 'groups', 'schedule']);

export class DataService {
  private static SCHEDULE_KEY = 'unitime_full_dataset';

  // ─── Private helpers ────────────────────────────────────────────────────────

  private static sanitize(tableName: string, item: any, termId?: string | null): any {
    const cols = SCHEMA[tableName] || [];
    const out: any = {};
    cols.forEach(k => { if (item[k] !== undefined) out[k] = item[k]; });
    if (termId && TERM_SCOPED.has(tableName)) out.termId = termId;
    if (tableName === 'users' && out.lastLogin && out.lastLogin.length < 5) out.lastLogin = null;
    return out;
  }

  // Paginate past Supabase's 1000-row SELECT limit
  private static async fetchAllPages<T>(
    buildQuery: (from: number, to: number) => any
  ): Promise<{ data: T[]; error: any }> {
    const PAGE = 1000;
    const all: T[] = [];
    let from = 0;
    while (true) {
      const { data, error } = await buildQuery(from, from + PAGE - 1);
      if (error) return { data: [], error };
      if (!data || data.length === 0) break;
      all.push(...data);
      if (data.length < PAGE) break;
      from += PAGE;
    }
    return { data: all, error: null };
  }

  private static async upsertBatch(tableName: string, rows: any[]): Promise<string | null> {
    const BATCH = 500;
    for (let i = 0; i < rows.length; i += BATCH) {
      const { error } = await supabase!.from(tableName).upsert(rows.slice(i, i + BATCH), { onConflict: 'id' });
      if (error) return error.message;
    }
    return null;
  }

  // ─── Core fetch ────────────────────────────────────────────────────────────
  // Supabase is the single source of truth.
  // If 0 rows returned for the active term, checks if data exists under ANY termId
  // and auto-migrates it — fixes the "data in Supabase but 0 in app" problem permanently.

  static async fetchTable<T>(tableName: string, termId?: string): Promise<T[] | null> {
    if (!supabase) return null;
    try {
      const { data, error } = await this.fetchAllPages<T>((from, to) => {
        let q = supabase!.from(tableName).select('*').range(from, to);
        if (termId && TERM_SCOPED.has(tableName)) q = q.eq('termId', termId);
        return q;
      });

      if (error) {
        console.error(`[DB] fetch ${tableName} failed:`, error);
        return null;
      }

      // Auto-migrate: if 0 rows for this term but data exists elsewhere, re-tag it all
      if (data.length === 0 && termId && TERM_SCOPED.has(tableName)) {
        const { data: all, error: allErr } = await this.fetchAllPages<any>((from, to) =>
          supabase!.from(tableName).select('*').range(from, to)
        );
        if (!allErr && all.length > 0) {
          console.log(`[DB] Auto-migrating ${all.length} ${tableName} rows → termId ${termId}`);
          const sanitized = all.map((r: any) => this.sanitize(tableName, r, termId));
          const err = await this.upsertBatch(tableName, sanitized);
          if (err) {
            console.error(`[DB] Auto-migrate upsert failed for ${tableName}:`, err);
            return all as T[]; // return original even if upsert failed
          }
          return all.map((r: any) => ({ ...r, termId })) as T[];
        }
      }

      console.log(`[DB] ${tableName}: loaded ${data.length} rows${termId ? ` (term ${termId})` : ''}`);
      return data;
    } catch (err) {
      console.error(`[DB] fetchTable(${tableName}) crash:`, err);
      return null;
    }
  }

  // ─── Entity load (with localStorage cold-start cache for terms only) ────────
  // For terms: try Supabase, fall back to localStorage cache so the app renders
  //   immediately without a blank screen on cold start.
  // For all other tables: Supabase only — localStorage caused stale/ghost data bugs.

  static async loadEntity<T>(
    tableName: string,
    storageKey: string,
    defaultValue: T[],
    termId?: string
  ): Promise<T[]> {
    const fromSupabase = await this.fetchTable<T>(tableName, termId);

    if (fromSupabase !== null) {
      // Cache only terms (used for cold-start render) — never cache user-sensitive data
      if (tableName === 'terms') {
        try { localStorage.setItem(storageKey, JSON.stringify(fromSupabase)); } catch {}
      }
      return fromSupabase;
    }

    // Supabase failed — use localStorage cache only for terms
    if (tableName === 'terms') {
      try {
        const cached = localStorage.getItem(storageKey);
        if (cached) {
          const parsed = JSON.parse(cached);
          if (Array.isArray(parsed) && parsed.length > 0) return parsed as T[];
        }
      } catch {}
    }

    return defaultValue;
  }

  // ─── Schedule load ──────────────────────────────────────────────────────────

  static async loadAllEntries(termId?: string): Promise<ScheduleEntry[]> {
    const data = await this.fetchTable<ScheduleEntry>('schedule', termId);
    if (data !== null) return data;
    // localStorage fallback for schedule only
    try {
      const saved = localStorage.getItem(this.SCHEDULE_KEY);
      let entries: ScheduleEntry[] = saved ? JSON.parse(saved) : [];
      if (!Array.isArray(entries)) return [];
      return termId ? entries.filter(e => e.termId === termId) : entries;
    } catch { return []; }
  }

  // Supabase-only reads — return null on any failure (callers skip state update)
  static async loadFromSupabaseOnly<T>(tableName: string, termId?: string): Promise<T[] | null> {
    return this.fetchTable<T>(tableName, termId);
  }

  static async loadAllEntriesFromSupabase(termId?: string): Promise<ScheduleEntry[] | null> {
    return this.fetchTable<ScheduleEntry>('schedule', termId);
  }

  // ─── Entity save ────────────────────────────────────────────────────────────
  // Upsert-first strategy: never DELETE before INSERT so there is no empty window.
  // Surgical cleanup of removed rows runs after the upsert succeeds.

  static async saveEntity<T extends { id: string; termId?: string }>(
    tableName: string,
    storageKey: string,
    data: T[],
    termId?: string
  ): Promise<void> {
    // Users are never cached locally — Supabase is the only truth for users
    if (tableName !== 'users') {
      try { localStorage.setItem(storageKey, JSON.stringify(data)); } catch {}
    } else {
      try { localStorage.removeItem(storageKey); } catch {}
    }

    if (!supabase) return;

    try {
      const isTermScoped = !!(termId && TERM_SCOPED.has(tableName));
      let itemsToSync = isTermScoped
        ? data.filter((item: any) => item.termId === termId || !item.termId)
        : data;

      const sanitized = itemsToSync.map(item => this.sanitize(tableName, item, termId));

      if (sanitized.length > 0) {
        const upsertErr = await this.upsertBatch(tableName, sanitized);
        if (upsertErr) {
          // Username conflict — retry one-by-one skipping duplicates
          if (tableName === 'users' && upsertErr.includes('users_username_key')) {
            for (const row of sanitized) {
              const { error } = await supabase.from(tableName).upsert([row], { onConflict: 'id' });
              if (error && !error.message.includes('users_username_key')) {
                console.error(`[DB] User upsert failed for ${row.username}:`, error.message);
              }
            }
          } else {
            console.error(`[DB] saveEntity upsert failed for ${tableName}:`, upsertErr);
            alert(`Supabase sync error (${tableName}): ${upsertErr}`);
            return;
          }
        }
        console.log(`[DB] ${tableName}: upserted ${sanitized.length} rows`);
      }

      // Surgical delete: remove rows no longer in the list (only for manageable sizes)
      const currentIds = sanitized.map((r: any) => r.id);
      if (isTermScoped && currentIds.length > 0 && currentIds.length <= 200) {
        const safeList = `(${currentIds.map(id => `"${id}"`).join(',')})`;
        const { error } = await supabase.from(tableName).delete()
          .eq('termId', termId!).not('id', 'in', safeList);
        if (error) console.warn(`[DB] Surgical delete warning for ${tableName}:`, error.message);
      } else if (!isTermScoped && data.length === 0) {
        await supabase.from(tableName).delete().neq('id', '');
      } else if (!isTermScoped && currentIds.length > 0 && currentIds.length <= 200) {
        const safeList = `(${currentIds.map(id => `"${id}"`).join(',')})`;
        const { error } = await supabase.from(tableName).delete().not('id', 'in', safeList);
        if (error) console.warn(`[DB] Surgical delete (global) warning for ${tableName}:`, error.message);
      }

      console.log(`[DB] ${tableName}: sync complete`);
    } catch (err) {
      console.error(`[DB] saveEntity(${tableName}) crash:`, err);
    }
  }

  // ─── Schedule granular operations (multi-user safe) ──────────────────────────
  // Each method only touches the specific rows that changed.

  static async addEntries(newEntries: ScheduleEntry[], allEntries: ScheduleEntry[]): Promise<void> {
    try { localStorage.setItem(this.SCHEDULE_KEY, JSON.stringify(allEntries)); } catch {}
    if (!supabase || newEntries.length === 0) return;
    const sanitized = newEntries.map(e => this.sanitize('schedule', e, e.termId));
    const { error } = await supabase.from('schedule').upsert(sanitized, { onConflict: 'id' });
    if (error) console.error('[DB] addEntries error:', error.message);
    else console.log(`[DB] schedule: added ${newEntries.length} entries`);
  }

  static async updateEntry(entry: ScheduleEntry, allEntries: ScheduleEntry[]): Promise<void> {
    try { localStorage.setItem(this.SCHEDULE_KEY, JSON.stringify(allEntries)); } catch {}
    if (!supabase) return;
    const sanitized = this.sanitize('schedule', entry, entry.termId);
    const { error } = await supabase.from('schedule').upsert([sanitized], { onConflict: 'id' });
    if (error) console.error('[DB] updateEntry error:', error.message);
    else console.log(`[DB] schedule: updated entry ${entry.id}`);
  }

  static async deleteEntry(id: string, allEntries: ScheduleEntry[]): Promise<void> {
    try { localStorage.setItem(this.SCHEDULE_KEY, JSON.stringify(allEntries)); } catch {}
    if (!supabase) return;
    const { error } = await supabase.from('schedule').delete().eq('id', id);
    if (error) console.error('[DB] deleteEntry error:', error.message);
    else console.log(`[DB] schedule: deleted entry ${id}`);
  }

  // ─── Clear operations ───────────────────────────────────────────────────────

  static async clearSchedule(termId?: string): Promise<void> {
    try {
      const saved = localStorage.getItem(this.SCHEDULE_KEY);
      let entries: ScheduleEntry[] = saved ? JSON.parse(saved) : [];
      entries = termId ? entries.filter((e: any) => e.termId !== termId) : [];
      localStorage.setItem(this.SCHEDULE_KEY, JSON.stringify(entries));
    } catch {}
    if (!supabase) return;
    const { error } = termId
      ? await supabase.from('schedule').delete().eq('termId', termId)
      : await supabase.from('schedule').delete().neq('id', '');
    if (error) throw new Error(error.message);
    console.log(`[DB] schedule: cleared${termId ? ` for term ${termId}` : ' (all)'}`);
  }

  static async clearEntity(tableName: string, storageKey: string, termId: string): Promise<void> {
    try {
      const saved = localStorage.getItem(storageKey);
      if (saved) {
        const all = JSON.parse(saved);
        const remaining = Array.isArray(all) ? all.filter((r: any) => r.termId !== termId) : [];
        localStorage.setItem(storageKey, JSON.stringify(remaining));
      }
    } catch {}
    if (!supabase) return;
    // Clear schedule first (foreign key constraint)
    if (TERM_SCOPED.has(tableName) && tableName !== 'schedule') {
      const { error: sErr } = await supabase.from('schedule').delete().eq('termId', termId);
      if (sErr) console.warn(`[DB] Pre-wipe schedule clear warning for ${tableName}:`, sErr.message);
      else console.log(`[DB] Pre-wipe: cleared schedule for term ${termId}`);
    }
    const { error } = await supabase.from(tableName).delete().eq('termId', termId);
    if (error) throw new Error(`Failed to wipe ${tableName}: ${error.message}`);
    console.log(`[DB] ${tableName}: wiped for term ${termId}`);
  }

  // ─── Migration ──────────────────────────────────────────────────────────────

  static async migrateDataToTerm(newTermId: string): Promise<{ [table: string]: number }> {
    if (!supabase) throw new Error('Supabase not configured');
    const tables = [
      { name: 'courses',   storageKey: 'unitime_courses' },
      { name: 'faculties', storageKey: 'unitime_faculties' },
      { name: 'rooms',     storageKey: 'unitime_rooms' },
      { name: 'groups',    storageKey: 'unitime_groups' },
    ];
    const counts: { [table: string]: number } = {};
    for (const { name } of tables) {
      const { data, error } = await this.fetchAllPages<any>((from, to) =>
        supabase!.from(name).select('*').range(from, to)
      );
      if (error || !data || data.length === 0) { counts[name] = 0; continue; }
      const sanitized = data.map((r: any) => this.sanitize(name, r, newTermId));
      const err = await this.upsertBatch(name, sanitized);
      if (err) throw new Error(`Migration failed for ${name}: ${err}`);
      counts[name] = data.length;
      console.log(`[DB] Migrated ${data.length} ${name} rows → term ${newTermId}`);
    }
    return counts;
  }

  // ─── Utilities ──────────────────────────────────────────────────────────────

  static getDuration(start: string, end: string): number {
    if (!start || !end || !start.includes(':') || !end.includes(':')) return 0;
    try {
      const [sH, sM] = start.split(':').map(Number);
      const [eH, eM] = end.split(':').map(Number);
      return Math.max(0, (eH + eM / 60) - (sH + sM / 60));
    } catch { return 0; }
  }

  static detectConflicts(schedule: ScheduleEntry[], facultyList: Faculty[] = []): Clash[] {
    const clashes: Clash[] = [];
    const roomMap = new Map<string, string>();
    const facultyMap = new Map<string, string>();
    const groupMap = new Map<string, string>();
    const loadTracker = new Map<string, number>();

    for (const entry of schedule) {
      const weeks = Array.isArray(entry.weeks) ? entry.weeks : [];
      const duration = this.getDuration(entry.startTime, entry.endTime);
      for (const week of weeks) {
        if (!entry.day || !entry.startTime) continue;
        const base = `${week}-${entry.day}-${entry.startTime}`;

        const rk = `${base}-room-${entry.roomId}`;
        if (entry.roomId && roomMap.has(rk)) {
          clashes.push({ type: 'Room', message: `Room conflict @ ${entry.day} ${entry.startTime} (Week ${week})`, affectedIds: [entry.id, roomMap.get(rk)!] });
        } else if (entry.roomId) roomMap.set(rk, entry.id);

        const fk = `${base}-faculty-${entry.facultyId}`;
        if (facultyMap.has(fk)) {
          clashes.push({ type: 'Faculty', message: `Faculty conflict @ ${entry.day} ${entry.startTime} (Week ${week})`, affectedIds: [entry.id, facultyMap.get(fk)!] });
        } else facultyMap.set(fk, entry.id);

        for (const gId of (entry.groupIds || [])) {
          const gk = `${base}-group-${gId}`;
          if (groupMap.has(gk)) {
            clashes.push({ type: 'Group', message: `Group conflict @ ${entry.day} ${entry.startTime} (Week ${week})`, affectedIds: [entry.id, groupMap.get(gk)!] });
          } else groupMap.set(gk, entry.id);
        }

        loadTracker.set(`${week}-${entry.facultyId}`, (loadTracker.get(`${week}-${entry.facultyId}`) || 0) + duration);
      }
    }

    if (facultyList.length > 0) {
      loadTracker.forEach((hours, key) => {
        const [week, fId] = key.split('-');
        const faculty = facultyList.find(f => f.id === fId);
        if (faculty && hours > faculty.maxHoursPerWeek) {
          clashes.push({
            type: 'LoadViolation',
            message: `${faculty.name} over capacity in Week ${week} (${hours.toFixed(1)}h / ${faculty.maxHoursPerWeek}h)`,
            affectedIds: schedule.filter(s => s.facultyId === fId && (s.weeks || []).includes(Number(week))).map(s => s.id),
          });
        }
      });
    }
    return clashes;
  }
}
