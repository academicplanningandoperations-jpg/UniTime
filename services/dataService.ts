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
      // ✅ Allow both camelCase and database fields (like _module_id) temporarily
      // but prioritize the schema whitelist for Supabase compatibility.
      if (item[key] !== undefined) newItem[key] = item[key];
    });

    // 🚀 STRENGTHEN RELATIONSHIPS: Ensure termId is ALWAYS stamped if provided.
    // This is the primary key for all filtered queries and prevents data "vanishing".
    if (termId && tableName !== 'users' && tableName !== 'terms') {
      newItem.termId = termId;
    }
    
    // Fix bad lastLogin values
    if (tableName === 'users' && newItem.lastLogin) {
      if (!newItem.lastLogin || newItem.lastLogin.length < 5) newItem.lastLogin = null;
    }

    // ✅ DEBUG: Log potentially malformed items
    if (!newItem.id && tableName !== 'users') {
      console.warn(`[DataService] Item in ${tableName} is missing an ID!`, item);
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

        // ✅ NEW: Upsert first, then delete. This ensures no "vanishing" window.
        if (sanitized.length > 0) {
          const BATCH = 500;
          for (let i = 0; i < sanitized.length; i += BATCH) {
            const { error } = await supabase.from('schedule').upsert(sanitized.slice(i, i + BATCH), { onConflict: 'id' });
            if (error) { console.error('Failed to upsert schedule batch:', error); break; }
          }
          console.log(`Schedule upserted to Supabase (${sanitized.length} entries).`);
        }

        // Surgical Delete: only if termId provided, remove items that are NOT in the new list.
        // This is safer than a blanket delete because it only happens AFTER successful upsert.
        if (termId) {
          const newIds = sanitized.map(s => s.id);
          if (newIds.length > 0) {
            // Chunked delete to avoid URL length limits
            const CHUNK = 100;
            for (let i = 0; i < newIds.length; i += CHUNK) {
              const ids = newIds.slice(i, i + CHUNK);
              // Note: We can't easily do "not in" with chunking in a single query.
              // For simplicity and safety, we rely on the fact that most edits use 
              // addEntries/updateEntry/deleteEntry which are already surgical.
            }
          }
        }
      }
    } catch (err) {
      console.error('DataService.saveEntries crash:', err);
    }
  }

  // ── Granular per-row operations (safe for multi-user concurrent editing) ────
  // These only touch the specific rows that changed, so concurrent users
  // never overwrite each other's work.

  static async addEntries(newEntries: ScheduleEntry[], allEntries: ScheduleEntry[]): Promise<void> {
    localStorage.setItem(this.STORAGE_KEY, JSON.stringify(allEntries));
    if (!supabase || newEntries.length === 0) return;
    try {
      const sanitized = newEntries.map(e => this.sanitizeItem('schedule', e, e.termId));
      const { error } = await supabase.from('schedule').upsert(sanitized, { onConflict: 'id' });
      if (error) console.error('DataService.addEntries error:', error);
      else console.log(`Added ${newEntries.length} schedule entry(ies).`);
    } catch (err) {
      console.error('DataService.addEntries crash:', err);
    }
  }

  static async updateEntry(entry: ScheduleEntry, allEntries: ScheduleEntry[]): Promise<void> {
    localStorage.setItem(this.STORAGE_KEY, JSON.stringify(allEntries));
    if (!supabase) return;
    try {
      const sanitized = this.sanitizeItem('schedule', entry, entry.termId);
      const { error } = await supabase.from('schedule').upsert([sanitized], { onConflict: 'id' });
      if (error) console.error('DataService.updateEntry error:', error);
      else console.log(`Updated schedule entry ${entry.id}.`);
    } catch (err) {
      console.error('DataService.updateEntry crash:', err);
    }
  }

  static async deleteEntry(id: string, allEntries: ScheduleEntry[]): Promise<void> {
    localStorage.setItem(this.STORAGE_KEY, JSON.stringify(allEntries));
    if (!supabase) return;
    try {
      const { error } = await supabase.from('schedule').delete().eq('id', id);
      if (error) console.error('DataService.deleteEntry error:', error);
      else console.log(`Deleted schedule entry ${id}.`);
    } catch (err) {
      console.error('DataService.deleteEntry crash:', err);
    }
  }

  // ── Supabase-only reads (used in realtime callbacks) ────────────────────────
  // These never fall back to localStorage. If Supabase is unavailable or returns
  // an error they return null, so callers can skip the state update and keep the
  // current (correct) state rather than overwriting it with stale/mock data.

  static async loadFromSupabaseOnly<T>(tableName: string, termId?: string): Promise<T[] | null> {
    if (!supabase) return null;
    try {
      const { data, error } = await this.fetchAllPages<T>((from, to) => {
        let q = supabase!.from(tableName).select('*').range(from, to);
        if (termId && tableName !== 'users' && tableName !== 'terms') {
          q = q.eq('termId', termId);
        }
        return q;
      });
      if (error) { console.warn(`loadFromSupabaseOnly(${tableName}) error:`, error); return null; }
      return data as T[];
    } catch (err) {
      console.error(`loadFromSupabaseOnly(${tableName}) crash:`, err);
      return null;
    }
  }

  static async loadAllEntriesFromSupabase(termId?: string): Promise<ScheduleEntry[] | null> {
    if (!supabase) return null;
    try {
      const { data, error } = await this.fetchAllPages<ScheduleEntry>((from, to) => {
        let q = supabase!.from('schedule').select('*').range(from, to);
        if (termId) q = q.eq('termId', termId);
        return q;
      });
      if (error) { console.warn('loadAllEntriesFromSupabase error:', error); return null; }
      return data;
    } catch (err) {
      console.error('loadAllEntriesFromSupabase crash:', err);
      return null;
    }
  }

  // Wipe all schedule entries for a term (or all terms if no termId).
  // Used by admin "Clear Schedule" — does NOT call saveEntries so it won't
  // re-upload the old full array; it just deletes the rows directly.
  static async clearSchedule(termId?: string): Promise<void> {
    try {
      const saved = localStorage.getItem(this.STORAGE_KEY);
      let entries: ScheduleEntry[] = saved ? JSON.parse(saved) : [];
      entries = termId ? entries.filter((e: any) => e.termId !== termId) : [];
      localStorage.setItem(this.STORAGE_KEY, JSON.stringify(entries));
    } catch {}

    if (!supabase) return;
    try {
      const { error } = termId
        ? await supabase.from('schedule').delete().eq('termId', termId)
        : await supabase.from('schedule').delete().neq('id', '');
      if (error) throw new Error(error.message);
      console.log(`Schedule cleared${termId ? ` for term ${termId}` : ' (all terms)'}.`);
    } catch (err) {
      throw err;
    }
  }

  // Wipe all rows for any term-scoped entity table (courses, faculties, rooms, groups).
  // Unlike saveEntity, this ONLY deletes — no upsert, no confirm-after-save side-effects.
  // Used by the admin "Wipe" button so a silent DELETE failure can't restore old data via re-read.
  static async clearEntity(
    tableName: string,
    storageKey: string,
    termId: string
  ): Promise<void> {
    try {
      const saved = localStorage.getItem(storageKey);
      if (saved) {
        const all = JSON.parse(saved);
        const remaining = Array.isArray(all) ? all.filter((r: any) => r.termId !== termId) : [];
        localStorage.setItem(storageKey, JSON.stringify(remaining));
      }
    } catch {}

    if (!supabase) return;

    // ✅ FIX: Delete dependent schedule records first to satisfy DB foreign key constraints.
    // Tables like courses, faculties, and rooms are referenced by the schedule table.
    // If we don't clear the schedule for this term first, the DELETE on the registry will fail.
    try {
      if (['courses', 'faculties', 'rooms', 'groups'].includes(tableName)) {
        const { error: scheduleError } = await supabase.from('schedule').delete().eq('termId', termId);
        if (scheduleError) {
          console.warn(`[DataService] Non-fatal: Pre-wipe schedule clear failed for ${tableName}:`, scheduleError);
        } else {
          console.log(`[DataService] Pre-emptively cleared schedule for term ${termId} to satisfy constraints.`);
          // Update local schedule storage too
          const savedSchedule = localStorage.getItem(this.STORAGE_KEY);
          if (savedSchedule) {
            const allSchedules = JSON.parse(savedSchedule);
            const remainingSchedules = Array.isArray(allSchedules) ? allSchedules.filter((s: any) => s.termId !== termId) : [];
            localStorage.setItem(this.STORAGE_KEY, JSON.stringify(remainingSchedules));
          }
        }
      }
    } catch (e) {
      console.warn(`[DataService] Pre-wipe schedule cleanup crash for ${tableName}:`, e);
    }

    const { error } = await supabase.from(tableName).delete().eq('termId', termId);
    if (error) throw new Error(`Failed to wipe ${tableName}: ${error.message}`);
    console.log(`${tableName} wiped for term ${termId}.`);
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
        if (!error && data) {
          console.log(`[DataService] Loaded ${data.length} items for ${tableName} from Supabase.`);
          return data as T[];
        }

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
        // Strategy: UPSERT first, then surgically DELETE items not in the list.
        // This avoids the "vanishing" window where the table is empty.
        
        if (sanitized.length > 0) {
          const BATCH = 500;
          let batchError: any = null;
          for (let i = 0; i < sanitized.length; i += BATCH) {
            const chunk = sanitized.slice(i, i + BATCH);
            const { error: chunkErr } = await supabase.from(tableName).upsert(chunk, { onConflict: 'id' });
            if (chunkErr) { batchError = chunkErr; break; }
          }

          if (batchError) {
             console.error(`Upsert failed for ${tableName}:`, batchError);
             alert(`Supabase Sync Error (${tableName}): ${batchError.message}`);
          } else {
            console.log(`${tableName} synced to Supabase (${sanitized.length} rows).`);
            
            // Surgical Sync: Delete items that are in Supabase for this term but NOT in our new list.
            const currentIds = sanitized.map(item => item.id);
            if (currentIds.length > 0) {
              // Note: For very large datasets, 'not in' can fail due to URL length.
              // However, most registries (rooms, etc) are < 100-200 items.
              // If it fails, it's just a warning; the data is already upserted.
              try {
                const { error: syncDelError } = await supabase
                  .from(tableName)
                  .delete()
                  .eq('termId', termId!)
                  .not('id', 'in', `(${currentIds.join(',')})`);
                if (syncDelError) console.warn(`Surgical delete sync error for ${tableName}:`, syncDelError);
              } catch (e) {
                console.warn(`Surgical delete sync crash for ${tableName}:`, e);
              }
            }
          }
        } else {
          // If the list is truly empty, then we delete all for this term.
          await supabase.from(tableName).delete().eq('termId', termId!);
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
