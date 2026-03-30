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
  static async loadAllEntries(termId?: string): Promise<ScheduleEntry[]> {
    try {
      if (supabase) {
        let query = supabase.from('schedule').select('*');
        if (termId) query = query.eq('termId', termId);
        const { data, error } = await query;
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

        // ✅ FIX: Use UPSERT instead of delete+insert to avoid data loss
        const { error } = await supabase.from('schedule').upsert(sanitized, { onConflict: 'id' });
        if (error) {
          console.error('Failed to upsert schedule:', error);
        } else {
          console.log('Schedule synced to Supabase.');
        }

        // Clean up deleted entries from Supabase
        if (termId) {
          const currentIds = entries.map(e => e.id);
          if (currentIds.length > 0) {
            await supabase.from('schedule')
              .delete()
              .eq('termId', termId)
              .not('id', 'in', `(${currentIds.join(',')})`);
          } else {
            // All entries deleted for this term
            await supabase.from('schedule').delete().eq('termId', termId);
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
        let query = supabase.from(tableName).select('*');
        if (termId && tableName !== 'users' && tableName !== 'terms') {
          query = query.eq('termId', termId);
        }
        const { data, error } = await query;
        if (!error && data) return data as T[];

        // If termId column missing, retry without filter
        if (error && (error.message.includes('termId') || error.code === '42703')) {
          console.warn(`termId column missing for ${tableName}, retrying without filter...`);
          const { data: fallback, error: fallbackErr } = await supabase.from(tableName).select('*');
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

      const { error: upsertError } = await supabase
        .from(tableName)
        .upsert(sanitized, { onConflict: 'id' });

      if (upsertError) {
        // If facultyId column doesn't exist, retry without it
        if (upsertError.message.includes('facultyId') && tableName === 'faculties') {
          console.warn('facultyId column missing, retrying without it...');
          const fallback = sanitized.map(({ facultyId, ...rest }: any) => rest);
          const { error: retryErr } = await supabase.from(tableName).upsert(fallback, { onConflict: 'id' });
          if (retryErr) {
            console.error(`Retry upsert failed for ${tableName}:`, retryErr);
            alert(`Supabase Sync Error (${tableName}): ${retryErr.message}`);
          } else {
            console.log(`${tableName} synced (without facultyId).`);
          }
        } else if (tableName === 'users' && upsertError.message.includes('users_username_key')) {
          // Username unique constraint violated — a user with the same username but different id
          // already exists in Supabase (e.g. a previously migrated superadmin).
          // Retry one-by-one: skip rows that still conflict, save the rest (new users).
          console.warn('Username conflict detected — upserting users individually...');
          let savedCount = 0;
          for (const item of sanitized) {
            const { error: rowErr } = await supabase.from(tableName).upsert([item], { onConflict: 'id' });
            if (rowErr) {
              if (rowErr.message.includes('users_username_key')) {
                console.warn(`Skipped user "${item.username}" — username already exists in Supabase with a different id.`);
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

      // ✅ FIX: Synchronization for DELETE.
      // IDs present in Supabase but missing from our list should be removed.
      const syncedIds = sanitized.map((item: any) => item.id);
      let deleteQuery = supabase.from(tableName).delete();
      
      // Scoping the delete to avoid wiping data from other terms.
      if (termId && tableName !== 'users' && tableName !== 'terms') {
        deleteQuery = deleteQuery.eq('termId', termId);
      }
      
      // If we have items left, exclude those IDs from deletion.
      if (syncedIds.length > 0) {
        // Postgrest syntax for NOT IN (...) — values must NOT be double-quoted
        const { error: deleteError } = await deleteQuery.not('id', 'in', `(${syncedIds.join(',')})`);
        if (deleteError) console.warn(`Delete sync error for ${tableName}:`, deleteError);
      } else if (data.length === 0) {
        // If the array is explicitly empty, and we are scoped to a term, delete everything for that term.
        const { error: deleteAllError } = await deleteQuery;
        if (deleteAllError) console.warn(`Full delete sync error for ${tableName}:`, deleteAllError);
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
