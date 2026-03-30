import { ScheduleEntry, Faculty, Clash, Course, Room, StudentGroup, Term, UserAccount } from '../types';
import { supabase } from './supabase';

export class DataService {
  private static STORAGE_KEY = 'unitime_full_dataset';

  // ✅ FIX: Schema whitelist now matches EXACT Supabase column names (quoted camelCase)
  private static SCHEMA_WHITELIST: Record<string, string[]> = {
    users:    ['id', 'username', 'password', 'name', 'role', 'departmentScope', 'lastLogin'],
    terms:    ['id', 'name', 'startDate', 'endDate', 'academicYear', 'isActive'],
    courses:  ['id', 'termId', 'code', 'name', 'credits', 'department', 'duration', 'type', 'color'],
    faculties:['id', 'facultyId', 'termId', 'name', 'department', 'availability', 'maxHoursPerWeek'],
    rooms:    ['id', 'termId', 'name', 'capacity', 'type'],
    groups:   ['id', 'termId', 'name', 'program', 'semester', 'studentCount'],
    schedule: ['id', 'termId', 'courseId', 'facultyId', 'roomId', 'groupIds', 'day', 'startTime', 'endTime', 'departmentId', 'weeks', 'category']
  };

  // ✅ FIX: Sanitize item to only allowed keys, with termId injected
  private static sanitizeItem(tableName: string, item: any, termId?: string | null): any {
    const schema = this.SCHEMA_WHITELIST[tableName] || [];
    const newItem: any = {};
    schema.forEach(key => {
      if (item[key] !== undefined) newItem[key] = item[key];
    });

    // ✅ FIX: Ensure termId is ALWAYS stamped if provided, even for items that don't have it.
    // This prevents data from "vanishing" into a global scope where it becomes invisible to the current term filter.
    if (termId && tableName !== 'users' && tableName !== 'terms') {
      newItem.termId = termId;
    }
    
    // Fix bad lastLogin values
    if (tableName === 'users' && newItem.lastLogin) {
      if (!newItem.lastLogin || newItem.lastLogin.length < 5) newItem.lastLogin = null;
    }
    return newItem;
  }

  // =========================================================
  // SCHEDULE
  // =========================================================
  // Fetch all rows from a Supabase table, paginating past the default 1000-row limit.
  private static async fetchAllPages<T>(
    buildQuery: (from: number, to: number) => any
  ): Promise<{ data: T[] | null; error: any }> {
    const PAGE = 1000;
    const all: T[] = [];
    let from = 0;
    while (true) {
      const { data, error } = await buildQuery(from, from + PAGE - 1);
      if (error) return { data: null, error };
      if (!data || data.length === 0) break;
      all.push(...data);
      if (data.length < PAGE) break;
      from += PAGE;
    }
    return { data: all, error: null };
  }

  static async loadAllEntries(termId?: string): Promise<ScheduleEntry[]> {
    try {
      if (supabase) {
        const { data, error } = await this.fetchAllPages<ScheduleEntry>((from, to) => {
          let q = supabase!.from('schedule').select('*').range(from, to);
          if (termId) q = q.eq('termId', termId);
          return q;
        });
        if (!error && data) return data;
        if (error) console.warn('Supabase loadAllEntries error:', error);
      }
    } catch (err) {
      console.error('DataService.loadAllEntries crash:', err);
    }

    // Fallback: localStorage
    try {
      const saved = localStorage.getItem(this.STORAGE_KEY);
      let entries: ScheduleEntry[] = saved ? JSON.parse(saved) : [];
      if (!Array.isArray(entries)) entries = [];
      if (termId) return entries.filter(e => e.termId === termId);
      return entries;
    } catch {
      return [];
    }
  }

  static async saveEntries(entries: ScheduleEntry[], termId?: string): Promise<void> {
    // Always save to localStorage first (instant, no network)
    localStorage.setItem(this.STORAGE_KEY, JSON.stringify(entries));

    try {
      if (supabase) {
        const sanitized = entries.map(e => this.sanitizeItem('schedule', e, termId || e.termId));

        // Delete-then-upsert: avoids NOT IN URL-length limits for large schedules.
        if (termId) {
          await supabase.from('schedule').delete().eq('termId', termId);
        }
        if (sanitized.length > 0) {
          const { error } = await supabase.from('schedule').upsert(sanitized, { onConflict: 'id' });
          if (error) {
            console.error('Failed to upsert schedule:', error);
          } else {
            console.log(`Schedule synced to Supabase (${sanitized.length} entries).`);
          }
        }
      }
    } catch (err) {
      console.error('DataService.saveEntries crash:', err);
    }
  }

  // =========================================================
  // GENERIC ENTITY LOAD
  // =========================================================
  static async loadEntity<T>(tableName: string, storageKey: string, defaultValue: T[], termId?: string): Promise<T[]> {
    try {
      if (supabase) {
        const { data, error } = await this.fetchAllPages<T>((from, to) => {
          let q = supabase!.from(tableName).select('*').range(from, to);
          if (termId && tableName !== 'users' && tableName !== 'terms') {
            q = q.eq('termId', termId);
          }
          return q;
        });
        if (!error && data) return data as T[];

        // If termId column missing, retry without filter
        if (error && (error.message.includes('termId') || error.code === '42703')) {
          console.warn(`termId column missing for ${tableName}, retrying without filter...`);
          const { data: fallback, error: fallbackErr } = await this.fetchAllPages<T>((from, to) =>
            supabase!.from(tableName).select('*').range(from, to)
          );
          if (!fallbackErr && fallback) return fallback as T[];
        }
        if (error) console.warn(`Supabase loadEntity(${tableName}) error:`, error);
      }
    } catch (err) {
      console.error(`DataService.loadEntity(${tableName}) crash:`, err);
    }

    // Fallback: localStorage
    try {
      const saved = localStorage.getItem(storageKey);
      let data: any[] = saved ? JSON.parse(saved) : defaultValue;
      if (!Array.isArray(data)) data = defaultValue as any[];
      if (termId && tableName !== 'users' && tableName !== 'terms') {
        // ✅ Strict isolation: only return items explicitly tagged to this term
        // Items with no termId are legacy data — exclude them for clean isolation
        return data.filter((item: any) => item.termId === termId) as T[];
      }
      return data as T[];
    } catch {
      return defaultValue;
    }
  }

  // =========================================================
  // GENERIC ENTITY SAVE
  // =========================================================
  static async saveEntity<T extends { id: string; termId?: string }>(
    tableName: string,
    storageKey: string,
    data: T[],
    termId?: string
  ): Promise<void> {
    // Always save full array to localStorage
    localStorage.setItem(storageKey, JSON.stringify(data));

    if (!supabase) return;

    try {
      // Only sync items belonging to this term (if termId provided)
      let itemsToSync = data;
      if (termId && tableName !== 'users' && tableName !== 'terms') {
        itemsToSync = data.filter((item: any) => item.termId === termId || !item.termId);
      }

      if (itemsToSync.length === 0 && data.length > 0 && termId) {
        console.warn(`No items matched termId ${termId} for ${tableName}, but data was provided. This might be a tagging issue.`);
      }

      const sanitized = itemsToSync.map(item => this.sanitizeItem(tableName, item, termId));

      const isTermScoped = !!(termId && tableName !== 'users' && tableName !== 'terms');

      if (isTermScoped) {
        // ── Term-scoped tables (courses, faculties, rooms, groups) ──────────────
        // Strategy: DELETE all rows for this term first, then INSERT fresh data.
        // This is far more reliable than upsert + NOT IN delete:
        //   • NOT IN with 100s of IDs blows the PostgREST URL length limit and fails silently.
        //   • Delete-then-insert is atomic from the app's perspective (isSyncingRef blocks
        //     the realtime re-fetch during the window between the two operations).
        const { error: preDeleteError } = await supabase
          .from(tableName)
          .delete()
          .eq('termId', termId!);
        if (preDeleteError) {
          console.warn(`Pre-insert delete failed for ${tableName} (term ${termId}):`, preDeleteError);
        }

        if (sanitized.length > 0) {
          const BATCH = 500;
          let batchError: any = null;
          for (let i = 0; i < sanitized.length; i += BATCH) {
            const chunk = sanitized.slice(i, i + BATCH);
            const { error: chunkErr } = await supabase.from(tableName).upsert(chunk, { onConflict: 'id' });
            if (chunkErr) { batchError = chunkErr; break; }
          }

          if (batchError) {
            if (batchError.message.includes('facultyId') && tableName === 'faculties') {
              console.warn('facultyId column missing, retrying without it...');
              let retryError: any = null;
              const fallback = sanitized.map(({ facultyId, ...rest }: any) => rest);
              for (let i = 0; i < fallback.length; i += BATCH) {
                const chunk = fallback.slice(i, i + BATCH);
                const { error: retryErr } = await supabase.from(tableName).upsert(chunk, { onConflict: 'id' });
                if (retryErr) { retryError = retryErr; break; }
              }
              if (retryError) {
                console.error(`Retry upsert failed for ${tableName}:`, retryError);
                alert(`Supabase Sync Error (${tableName}): ${retryError.message}`);
              } else {
                console.log(`${tableName} synced (without facultyId, ${sanitized.length} rows).`);
              }
            } else {
              console.error(`Upsert failed for ${tableName}:`, batchError);
              alert(`Supabase Sync Error (${tableName}): ${batchError.message}`);
            }
          } else {
            console.log(`${tableName} synced to Supabase (${sanitized.length} rows).`);
          }
        } else {
          console.log(`${tableName}: all rows cleared for term ${termId}.`);
        }
      } else {
        // ── Non-term-scoped tables (users, terms) ────────────────────────────────
        // Strategy: upsert by id, then delete rows that are no longer in the list.
        const { error: upsertError } = await supabase
          .from(tableName)
          .upsert(sanitized, { onConflict: 'id' });

        if (upsertError) {
          if (tableName === 'users' && upsertError.message.includes('users_username_key')) {
            // Username unique constraint violated — retry row-by-row, skipping conflicts.
            console.warn('Username conflict detected — upserting users individually...');
            let savedCount = 0;
            for (const item of sanitized) {
              const { error: rowErr } = await supabase.from(tableName).upsert([item], { onConflict: 'id' });
              if (rowErr) {
                if (rowErr.message.includes('users_username_key')) {
                  console.warn(`Skipped user "${item.username}" — username already exists with a different id.`);
                } else {
                  console.error(`Failed to upsert user "${item.username}":`, rowErr);
                }
              } else {
                savedCount++;
              }
            }
            console.log(`Users synced individually: ${savedCount}/${sanitized.length} saved.`);
          } else {
            console.error(`Upsert failed for ${tableName}:`, upsertError);
            alert(`Supabase Sync Error (${tableName}): ${upsertError.message}`);
          }
        } else {
          console.log(`${tableName} upserted to Supabase.`);
        }

        // Delete rows that are no longer in our list.
        const syncedIds = sanitized.map((item: any) => item.id);
        if (syncedIds.length > 0) {
          const { error: deleteError } = await supabase
            .from(tableName)
            .delete()
            .not('id', 'in', `(${syncedIds.join(',')})`);
          if (deleteError) console.warn(`Delete sync error for ${tableName}:`, deleteError);
        } else if (data.length === 0) {
          const { error: deleteAllError } = await supabase.from(tableName).delete();
          if (deleteAllError) console.warn(`Full delete sync error for ${tableName}:`, deleteAllError);
        }
      }

      console.log(`${tableName} synchronization complete.`);
    } catch (err) {
      console.error(`DataService.saveEntity(${tableName}) crash:`, err);
    }
  }

  // =========================================================
  // UTILITIES
  // =========================================================
  static getDuration(start: string, end: string): number {
    if (!start || !end || !start.includes(':') || !end.includes(':')) return 0;
    try {
      const [sH, sM] = start.split(':').map(Number);
      const [eH, eM] = end.split(':').map(Number);
      const duration = (eH + eM / 60) - (sH + sM / 60);
      return isNaN(duration) ? 0 : Math.max(0, duration);
    } catch {
      return 0;
    }
  }

  static detectConflicts(schedule: ScheduleEntry[], facultyList: Faculty[] = []): Clash[] {
    const clashes: Clash[] = [];
    const roomMap = new Map<string, string>();
    const facultyMap = new Map<string, string>();
    const groupMap = new Map<string, string>();
    const loadTracker = new Map<string, number>();

    for (const entry of schedule) {
      const weeks = Array.isArray(entry.weeks) ? entry.weeks : [];
      const duration = DataService.getDuration(entry.startTime, entry.endTime);

      for (const week of weeks) {
        if (!entry.day || !entry.startTime) continue;
        const baseKey = `${week}-${entry.day}-${entry.startTime}`;

        const roomKey = `${baseKey}-room-${entry.roomId}`;
        if (entry.roomId && roomMap.has(roomKey)) {
          clashes.push({ type: 'Room', message: `Room Conflict @ ${entry.day} ${entry.startTime} (Week ${week})`, affectedIds: [entry.id, roomMap.get(roomKey)!] });
        } else if (entry.roomId) {
          roomMap.set(roomKey, entry.id);
        }

        const facultyKey = `${baseKey}-faculty-${entry.facultyId}`;
        if (facultyMap.has(facultyKey)) {
          clashes.push({ type: 'Faculty', message: `Faculty Conflict @ ${entry.day} ${entry.startTime} (Week ${week})`, affectedIds: [entry.id, facultyMap.get(facultyKey)!] });
        } else {
          facultyMap.set(facultyKey, entry.id);
        }

        for (const gId of (entry.groupIds || [])) {
          const groupKey = `${baseKey}-group-${gId}`;
          if (groupMap.has(groupKey)) {
            clashes.push({ type: 'Group', message: `Group Conflict @ ${entry.day} ${entry.startTime} (Week ${week})`, affectedIds: [entry.id, groupMap.get(groupKey)!] });
          } else {
            groupMap.set(groupKey, entry.id);
          }
        }

        const loadKey = `${week}-${entry.facultyId}`;
        loadTracker.set(loadKey, (loadTracker.get(loadKey) || 0) + duration);
      }
    }

    if (facultyList.length > 0) {
      loadTracker.forEach((hours, key) => {
        const [week, fId] = key.split('-');
        const faculty = facultyList.find(f => f.id === fId);
        if (faculty && hours > faculty.maxHoursPerWeek) {
          clashes.push({
            type: 'LoadViolation',
            message: `${faculty.name} is over capacity in Week ${week} (${hours.toFixed(1)}h / ${faculty.maxHoursPerWeek}h limit)`,
            affectedIds: schedule.filter(s => s.facultyId === fId && (s.weeks || []).includes(Number(week))).map(s => s.id)
          });
        }
      });
    }

    return clashes;
  }
}
