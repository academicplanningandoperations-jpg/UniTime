import { ScheduleEntry, Faculty, Clash, Course, Room, StudentGroup, Term, UserAccount } from '../types';
import { supabase } from './supabase';

/**
 * DataService handles the heavy lifting of managing entries.
 */
export class DataService {
  private static STORAGE_KEY = 'unitime_full_dataset';

  static async loadAllEntries(): Promise<ScheduleEntry[]> {
    if (supabase) {
      const { data, error } = await supabase.from('schedule').select('*');
      if (!error && data) return data;
      console.warn('Falling back to local storage due to Supabase error:', error);
    }

    const saved = localStorage.getItem(this.STORAGE_KEY);
    return saved ? JSON.parse(saved) : [];
  }

  static async saveEntries(entries: ScheduleEntry[]): Promise<void> {
    if (supabase) {
      console.log('Syncing schedule to Supabase...', entries);
      const { error: deleteError } = await supabase.from('schedule').delete().neq('id', '0');
      if (deleteError) {
        console.error('Failed to clear schedule in Supabase:', deleteError);
      }
      const { error: insertError } = await supabase.from('schedule').insert(entries);
      if (insertError) {
        console.error('Failed to sync schedule with Supabase:', insertError);
        alert(`Supabase Error (Schedule): ${insertError.message}. Check if table "schedule" exists.`);
      } else {
        console.log('Successfully synced schedule to Supabase.');
      }
    }

    localStorage.setItem(this.STORAGE_KEY, JSON.stringify(entries));
  }

  /**
   * Generic methods for other entities
   */
  static async loadEntity<T>(tableName: string, storageKey: string, defaultValue: T[]): Promise<T[]> {
    if (supabase) {
      const { data, error } = await supabase.from(tableName).select('*');
      if (!error && data && data.length > 0) return data as T[];
    }
    const saved = localStorage.getItem(storageKey);
    return saved ? JSON.parse(saved) : defaultValue;
  }

  static async saveEntity<T>(tableName: string, storageKey: string, data: T[]): Promise<void> {
    if (supabase) {
      try {
        console.log(`Syncing ${tableName} to Supabase...`, data);
        
        // Use a more robust way to delete all records
        // .delete().neq('id', '_non_existent_id_') is generally safe for text/uuid/int
        const { error: deleteError } = await supabase.from(tableName).delete().not('id', 'is', null);
        
        if (deleteError) {
          console.error(`Failed to clear ${tableName} in Supabase:`, deleteError);
          // We don't stop here, try to insert anyway or handle as needed
        }

          // Sanitize data: Remove underscore-prefixed metadata and ensure schema compliance
          const sanitizedData = data.map((item: any) => {
            const newItem: any = {};
            
            // 1. Generic filtering of underscore-prefixed metadata fields (added during CSV import)
            Object.keys(item).forEach(key => {
              if (!key.startsWith('_')) {
                newItem[key] = item[key];
              }
            });

            // 2. Specific table mappings and sanitization
            if (tableName === 'users') {
              // If lastLogin exists but isn't a valid ISO date, set to null
              if (newItem.lastLogin && (newItem.lastLogin === '-' || newItem.lastLogin.length < 10)) {
                newItem.lastLogin = null;
              }
            } else if (tableName === 'courses') {
              // 'academicYear' and 'Semester' are added for UI/Mapping but aren't in the DB schema for courses
              delete newItem.academicYear;
              delete newItem.semester;
              delete newItem.Semester;
            } else if (tableName === 'faculties') {
              // In case any extra fields like 'email' (from CSV) were added to Faculty object
              // Note: types.ts Faculty doesn't have email, but UserAccount does.
              // DB faculties table: id, name, department, availability, "maxHoursPerWeek"
              // We'll keep it simple for now, as _ fields are already gone.
            }
            
            return newItem;
          });

          const { error: insertError } = await supabase.from(tableName).insert(sanitizedData);
          if (insertError) {
            console.error(`Failed to insert ${tableName} into Supabase:`, insertError);
            // Provide a more helpful error message
            const msg = `Supabase Sync Error (${tableName}): ${insertError.message}\n\nProbable causes:\n1. Table "${tableName}" does not exist.\n2. Column names don't match (check "departmentScope" vs "department_scope").\n3. RLS policies are blocking the write.`;
            alert(msg);
          } else {
            console.log(`Successfully synced ${tableName} to Supabase.`);
          }
        } catch (err) {
          console.error(`Unexpected error syncing ${tableName}:`, err);
        }
    }
    localStorage.setItem(storageKey, JSON.stringify(data));
  }

  /**
   * Helper to calculate duration in hours from startTime and endTime
   */
  static getDuration(start: string, end: string): number {
    const [sH, sM] = start.split(':').map(Number);
    const [eH, eM] = end.split(':').map(Number);
    return (eH + eM / 60) - (sH + sM / 60);
  }

  /**
   * High-Performance Clash Detection (O(N))
   */
  static detectConflicts(schedule: ScheduleEntry[], facultyList: Faculty[] = []): Clash[] {
    const clashes: Clash[] = [];
    const roomMap = new Map<string, string>();
    const facultyMap = new Map<string, string>();
    const groupMap = new Map<string, string>();
    
    // Track weekly load per faculty per week
    const loadTracker = new Map<string, number>(); // key: week-facultyId, value: totalHours

    for (const entry of schedule) {
      const weeks = entry.weeks || [];
      const duration = this.getDuration(entry.startTime, entry.endTime);
      
      for (const week of weeks) {
        const baseKey = `${week}-${entry.day}-${entry.startTime}`;
        
        // Overlap Conflicts (Same time, same resource)
        const roomKey = `${baseKey}-room-${entry.roomId}`;
        if (roomMap.has(roomKey)) {
          clashes.push({ type: 'Room', message: `Room Conflict @ ${entry.day} ${entry.startTime} (Week ${week})`, affectedIds: [entry.id, roomMap.get(roomKey)!] });
        } else {
          roomMap.set(roomKey, entry.id);
        }

        const facultyKey = `${baseKey}-faculty-${entry.facultyId}`;
        if (facultyMap.has(facultyKey)) {
          clashes.push({ type: 'Faculty', message: `Faculty Conflict @ ${entry.day} ${entry.startTime} (Week ${week})`, affectedIds: [entry.id, facultyMap.get(facultyKey)!] });
        } else {
          facultyMap.set(facultyKey, entry.id);
        }

        const groupIds = entry.groupIds || [];
        for (const gId of groupIds) {
          const groupKey = `${baseKey}-group-${gId}`;
          if (groupMap.has(groupKey)) {
            clashes.push({ type: 'Group', message: `Group Conflict @ ${entry.day} ${entry.startTime} (Week ${week})`, affectedIds: [entry.id, groupMap.get(groupKey)!] });
          } else {
            groupMap.set(groupKey, entry.id);
          }
        }

        // Load Constraints
        const loadKey = `${week}-${entry.facultyId}`;
        const currentLoad = (loadTracker.get(loadKey) || 0) + duration;
        loadTracker.set(loadKey, currentLoad);
      }
    }

    // Evaluate Load Violations
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
