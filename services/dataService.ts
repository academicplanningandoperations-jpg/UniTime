import { ScheduleEntry, Faculty, Clash, Course, Room, StudentGroup, Term, UserAccount } from '../types';
import { supabase } from './supabase';

/**
 * DataService handles the heavy lifting of managing entries.
 */
export class DataService {
  private static STORAGE_KEY = 'unitime_full_dataset';

  static async loadAllEntries(): Promise<ScheduleEntry[]> {
    try {
      if (supabase) {
        const { data, error } = await supabase.from('schedule').select('*');
        if (!error && data) return data;
        if (error) console.warn('Supabase select error:', error);
      }
    } catch (err) {
      console.error('DataService.loadAllEntries crash:', err);
    }

    const saved = localStorage.getItem(this.STORAGE_KEY);
    return saved ? JSON.parse(saved) : [];
  }

  static async saveEntries(entries: ScheduleEntry[]): Promise<void> {
    try {
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
    } catch (err) {
      console.error('DataService.saveEntries crash:', err);
    }

    localStorage.setItem(this.STORAGE_KEY, JSON.stringify(entries));
  }

  /**
   * Generic methods for other entities
   */
  static async loadEntity<T>(tableName: string, storageKey: string, defaultValue: T[]): Promise<T[]> {
    try {
      if (supabase) {
        const { data, error } = await supabase.from(tableName).select('*');
        if (!error && data && data.length > 0) return data as T[];
        if (error) console.warn(`Supabase load error for ${tableName}:`, error);
      }
    } catch (err) {
      console.error(`DataService.loadEntity(${tableName}) crash:`, err);
    }
    
    const saved = localStorage.getItem(storageKey);
    try {
      return saved ? JSON.parse(saved) : defaultValue;
    } catch {
      return defaultValue;
    }
  }

  static async saveEntity<T>(tableName: string, storageKey: string, data: T[]): Promise<void> {
    try {
      if (supabase) {
        console.log(`Syncing ${tableName} to Supabase...`, data);
        
        // 1. Clear existing data
        const { error: deleteError } = await supabase.from(tableName).delete().not('id', 'is', null);
        if (deleteError) {
          console.error(`Failed to clear ${tableName} in Supabase:`, deleteError);
        }

        // 2. Strict Whitelist Sanitization (to prevent Supabase "column not found" errors)
        const SCHEMA_WHITELIST: Record<string, string[]> = {
          users: ['id', 'username', 'password', 'name', 'role', 'departmentScope', 'lastLogin'],
          terms: ['id', 'name', 'startDate', 'endDate', 'academicYear', 'isActive'],
          courses: ['id', 'code', 'name', 'credits', 'department', 'duration', 'type', 'color'],
          faculties: ['id', 'name', 'department', 'availability', 'maxHoursPerWeek'],
          rooms: ['id', 'name', 'capacity', 'type'],
          groups: ['id', 'name', 'program', 'semester', 'studentCount'],
          schedule: ['id', 'termId', 'courseId', 'facultyId', 'roomId', 'groupIds', 'day', 'startTime', 'endTime', 'departmentId', 'weeks', 'category']
        };

        const sanitizedData = data.map((item: any) => {
          const schema = SCHEMA_WHITELIST[tableName] || [];
          if (schema.length === 0) return item; // If table not in whitelist, send as-is (risky)

          const newItem: any = {};
          schema.forEach(key => {
            if (item[key] !== undefined) newItem[key] = item[key];
          });

          // Special case: Ensure lastLogin is a valid timestamp or null
          if (tableName === 'users' && newItem.lastLogin) {
            if (newItem.lastLogin === '-' || newItem.lastLogin.length < 5) newItem.lastLogin = null;
          }

          return newItem;
        });

        // 3. Batch Insert
        const { error: insertError } = await supabase.from(tableName).insert(sanitizedData);
        if (insertError) {
          console.error(`Failed to insert ${tableName} into Supabase:`, insertError);
          const msg = `Supabase Sync Error (${tableName}): ${insertError.message}\n\nPlease check your CSV headers/schema.`;
          alert(msg);
        } else {
          console.log(`Successfully synced ${tableName} to Supabase.`);
        }
      }
    } catch (err) {
      console.error(`Unexpected crash syncing ${tableName}:`, err);
    }
    
    // Always persist to local storage regardless of Supabase status
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
