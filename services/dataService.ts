import { ScheduleEntry, Faculty, Room, StudentGroup, Clash } from '../types';
import { supabase } from './supabase';
import { areParallelElectives } from '../utils/electives';

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

  // Timestamp of the last successful write — background refreshes should
  // skip overwriting state within WRITE_GUARD_MS of a write to avoid
  // a read-before-commit race wiping freshly uploaded data.
  static lastWriteTimestamp = 0;
  private static WRITE_GUARD_MS = 60_000; // 60 seconds — covers large bulk uploads

  /** Returns true if a write happened within the guard window */
  static isWithinWriteGuard(): boolean {
    return Date.now() - this.lastWriteTimestamp < this.WRITE_GUARD_MS;
  }

  // ─── Local-write tracking ───────────────────────────────────────────────────
  // Supabase Realtime echoes this tab's own writes back to it a moment later.
  // Remembering which rows this tab just wrote lets the realtime handler ignore
  // those echoes, instead of re-applying data it already has (which flickers on
  // rapid repeated edits) or re-downloading a whole table after a bulk upload.
  private static recentLocalWrites = new Map<string, number>();
  private static LOCAL_WRITE_TTL_MS = 5_000;

  static markLocalWrite(tableName: string, ids: (string | undefined | null)[]): void {
    const now = Date.now();
    if (this.recentLocalWrites.size > 20_000) {
      for (const [key, at] of this.recentLocalWrites) {
        if (now - at > this.LOCAL_WRITE_TTL_MS) this.recentLocalWrites.delete(key);
      }
    }
    for (const id of ids) if (id) this.recentLocalWrites.set(`${tableName}:${id}`, now);
  }

  static isRecentLocalWrite(tableName: string, id: string | undefined | null): boolean {
    if (!id) return false;
    const at = this.recentLocalWrites.get(`${tableName}:${id}`);
    return at !== undefined && Date.now() - at < this.LOCAL_WRITE_TTL_MS;
  }

  // ─── Offline schedule snapshot ──────────────────────────────────────────────
  // A copy of the schedule is kept in localStorage as a fallback for when
  // Supabase can't be reached. Writing 5,000+ sessions to localStorage is
  // synchronous and briefly freezes the page, so instead of doing it on every
  // single edit it's done at most once every few seconds with the latest data.
  private static snapshotTimer: any = null;
  private static pendingSnapshot: ScheduleEntry[] | null = null;
  private static SNAPSHOT_DELAY_MS = 5_000;

  private static persistScheduleSnapshot(entries: ScheduleEntry[]): void {
    this.pendingSnapshot = entries;
    if (this.snapshotTimer) return;
    this.snapshotTimer = setTimeout(() => {
      this.snapshotTimer = null;
      const data = this.pendingSnapshot;
      this.pendingSnapshot = null;
      if (!data) return;
      try { localStorage.setItem(this.SCHEDULE_KEY, JSON.stringify(data)); } catch {}
    }, this.SNAPSHOT_DELAY_MS);
  }

  static cancelScheduleSnapshot(): void {
    if (this.snapshotTimer) clearTimeout(this.snapshotTimer);
    this.snapshotTimer = null;
    this.pendingSnapshot = null;
  }

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

  private static async upsertBatch(
    tableName: string,
    rows: any[],
    onProgress?: (pct: number, synced: number, total: number) => void
  ): Promise<string | null> {
    const BATCH = 500;       // Safe middle ground: 500 rows per request
    const MAX_RETRIES = 5;
    const BATCH_DELAY = 1000;

    const totalBatches = Math.ceil(rows.length / BATCH);
    let successCount = 0;
    let failedBatches: number[] = [];
    let firstError: any = null;

    for (let i = 0; i < rows.length; i += BATCH) {
      const batchNum = Math.floor(i / BATCH) + 1;
      const chunk = rows.slice(i, i + BATCH);
      let succeeded = false;

      for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
        try {
          const chunkIds = chunk.map((r: any) => r?.id);
          this.markLocalWrite(tableName, chunkIds);
          const { error } = await supabase!.from(tableName).upsert(chunk);
          if (!error) {
            this.markLocalWrite(tableName, chunkIds); // refresh: echoes arrive after commit
            succeeded = true;
            successCount += chunk.length;
            break;
          }
          
          if (!firstError) firstError = error;
          const errMsg = `${error.message || 'Unknown error'} \n${error.details || ''} \nHint: ${error.hint || ''}`;
          console.warn(`[DB] ${tableName} batch ${batchNum}/${totalBatches} attempt ${attempt} failed:`, errMsg);
          
          // DO NOT retry if it's a data validation / schema error (e.g. 23502 null value constraint, 22P02 invalid text representation)
          // Only retry if it's a connection/timeout/network issue.
          if (error.code && (error.code.startsWith('22') || error.code.startsWith('23') || error.code.startsWith('42'))) {
            console.error(`[DB] FATAL schema/data error. Aborting retries for this batch.`);
            break;
          }

        } catch (err: any) {
          if (!firstError) firstError = err;
          console.warn(`[DB] ${tableName} batch ${batchNum}/${totalBatches} attempt ${attempt} network error:`, err);
        }
        
        if (attempt < MAX_RETRIES) {
          await new Promise(r => setTimeout(r, 2000 * attempt));
        }
      }

      if (!succeeded) {
        failedBatches.push(batchNum);
        console.error(`[DB] ${tableName} batch ${batchNum}/${totalBatches} completely FAILED`);
      }

      const pct = Math.round((batchNum / totalBatches) * 100);
      if (onProgress) onProgress(pct, successCount, rows.length);

      if (i + BATCH < rows.length) {
        await new Promise(r => setTimeout(r, BATCH_DELAY));
      }
    }

    console.log(`[DB] ${tableName}: ${successCount}/${rows.length} rows synced (${failedBatches.length} batches failed)`);

    if (failedBatches.length > 0) {
      const msg = firstError
        ? `${firstError.message || 'Unknown error'} (Code: ${firstError.code || 'N/A'}) \nDetails: ${firstError.details || 'None'}`
        : 'Supabase network overloaded or connection reset';
      return `${failedBatches.length}/${totalBatches} batch(es) failed for ${tableName} (${successCount}/${rows.length} rows saved). Supabase says: \n\n${msg}`;
    }

    return null;
  }

  // ─── Core fetch ────────────────────────────────────────────────────────────
  // Supabase is the single source of truth.  Simple SELECT with optional termId filter.

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

      console.log(`[DB] ${tableName}: loaded ${data.length} rows${termId ? ` (term ${termId})` : ''}`);

      // NOTE: there used to be an "auto-migration" block here that, when the
      // active term looked empty, re-tagged EVERY row in the table to the
      // active termId. It trusted whatever term this browser tab believed was
      // active — so a tab that briefly fell back to the mock term ('t1') would
      // rewrite the whole live table to 't1'. It also downloaded the entire
      // unscoped table to decide. Removed: a term that looks empty now simply
      // shows empty. Mislabelled data is fixed deliberately (SQL, or the
      // admin "re-link data" action), never silently by a background read.

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
    termId?: string,
    onProgress?: (pct: number, synced: number, total: number) => void
  ): Promise<void> {
    // Users are never cached locally — Supabase is the only truth for users
    if (tableName !== 'users') {
      try { localStorage.setItem(storageKey, JSON.stringify(data)); } catch {}
    } else {
      try { localStorage.removeItem(storageKey); } catch {}
    }

    console.log(`[DB] saveEntity: syncing ${data.length} rows to ${tableName}`);

    // Mark write timestamp BEFORE the upsert so background refreshes are
    // blocked for the entire duration of the upload, not just after it.
    this.lastWriteTimestamp = Date.now();

    const isTermScoped = !!(termId && TERM_SCOPED.has(tableName));
    let itemsToSync = isTermScoped
      ? data.filter((item: any) => item.termId === termId || !item.termId)
      : data;

    const sanitized = itemsToSync.map(item => this.sanitize(tableName, item, termId));

    // Deduplicate by ID to prevent Postgres Code: 21000 (ON CONFLICT DO UPDATE cannot affect row a second time)
    const uniqueSanitized = [];
    const seenIds = new Set();
    // Traverse backwards to keep the most recent (last) version of any duplicate ID
    for (let i = sanitized.length - 1; i >= 0; i--) {
      const item = sanitized[i];
      if (item && item.id && !seenIds.has(item.id)) {
        seenIds.add(item.id);
        uniqueSanitized.unshift(item);
      }
    }

    if (uniqueSanitized.length > 0) {
      const upsertErr = await this.upsertBatch(tableName, uniqueSanitized, onProgress);
      // Refresh the timestamp after the (potentially long) upload finishes
      this.lastWriteTimestamp = Date.now();

      if (upsertErr) {
        if (tableName === 'users' && upsertErr.includes('users_username_key')) {
          throw new Error('Username already exists in the database. Please use a unique username.');
        } else {
          console.error(`[DB] saveEntity failed for ${tableName}:`, upsertErr);
          // Changed: Throw the EXACT error given by upsertBatch so the UI alerts it
          throw new Error(`Sync issue (${tableName}): \n\n${upsertErr}`);
        }
      }
      console.log(`[DB] ${tableName}: upserted ${sanitized.length} rows`);
    }

    console.log(`[DB] ${tableName}: sync complete`);
  }

  static async deleteRecord(tableName: string, id: string): Promise<void> {
    if (!supabase) return;
    this.markLocalWrite(tableName, [id]);
    const { error } = await supabase.from(tableName).delete().eq('id', id);
    if (error) {
      console.error(`[DB] deleteRecord error for ${tableName}:`, error.message);
      throw new Error(error.message);
    }
    console.log(`[DB] ${tableName}: explicitly deleted record ${id}`);
  }

  // termId (when given) is a safety net: the delete can only ever hit rows of
  // that term, even if an id were somehow shared with another term.
  static async deleteRecords(tableName: string, ids: string[], termId?: string): Promise<void> {
    if (!supabase || ids.length === 0) return;
    this.markLocalWrite(tableName, ids);
    let q = supabase.from(tableName).delete().in('id', ids);
    if (termId && TERM_SCOPED.has(tableName)) q = q.eq('termId', termId);
    const { error } = await q;
    if (error) {
      console.error(`[DB] deleteRecords error for ${tableName}:`, error.message);
      throw new Error(error.message);
    }
    console.log(`[DB] ${tableName}: bulk-deleted ${ids.length} records`);
  }

  // Delete schedule entries referencing a given field/id set.
  // Must be called BEFORE deleting rows from the parent table to avoid FK violations.
  static async deleteScheduleCascade(
    field: 'facultyId' | 'courseId' | 'roomId',
    ids: string[],
    allEntries: ScheduleEntry[],
    termId?: string,
  ): Promise<ScheduleEntry[]> {
    if (!supabase || ids.length === 0) return allEntries;
    const remaining = allEntries.filter(e => !ids.includes((e as any)[field] ?? ''));
    this.markLocalWrite('schedule', allEntries.filter(e => ids.includes((e as any)[field] ?? '')).map(e => e.id));
    let q = supabase.from('schedule').delete().in(field, ids);
    if (termId) q = q.eq('termId', termId);
    const { error } = await q;
    if (error) console.warn(`[DB] schedule cascade-delete (${field}) warning:`, error.message);
    else console.log(`[DB] schedule: cascade-deleted entries for ${field} [${ids.join(',')}]`);
    this.persistScheduleSnapshot(remaining);
    return remaining;
  }

  // ─── Schedule granular operations (multi-user safe) ──────────────────────────
  // Each method only touches the specific rows that changed.

  static async addEntries(newEntries: ScheduleEntry[], allEntries: ScheduleEntry[]): Promise<void> {
    this.persistScheduleSnapshot(allEntries);
    if (!supabase || newEntries.length === 0) return;
    // Use upsertBatch (500-row chunks + retries) — a single upsert silently fails
    // for large restores (100+ rows on Supabase free tier).
    this.lastWriteTimestamp = Date.now();
    const sanitized = newEntries.map(e => this.sanitize('schedule', e, e.termId));
    const err = await this.upsertBatch('schedule', sanitized);
    this.lastWriteTimestamp = Date.now();
    if (err) {
      console.error('[DB] addEntries error:', err);
      throw new Error(`Failed to save ${newEntries.length} session(s) to the database: ${err}`);
    } else {
      console.log(`[DB] schedule: added ${newEntries.length} entries`);
    }
  }

  static async deleteEntries(ids: string[], allEntries: ScheduleEntry[], termId?: string): Promise<void> {
    this.persistScheduleSnapshot(allEntries);
    if (!supabase || ids.length === 0) return;
    this.markLocalWrite('schedule', ids);
    let q = supabase.from('schedule').delete().in('id', ids);
    if (termId) q = q.eq('termId', termId);
    const { error } = await q;
    if (error) console.error('[DB] deleteEntries error:', error.message);
    else console.log(`[DB] schedule: bulk-deleted ${ids.length} entries`);
  }

  static async updateEntry(entry: ScheduleEntry, allEntries: ScheduleEntry[]): Promise<void> {
    this.persistScheduleSnapshot(allEntries);
    if (!supabase) return;
    const sanitized = this.sanitize('schedule', entry, entry.termId);
    this.markLocalWrite('schedule', [entry.id]);
    const { error } = await supabase.from('schedule').upsert([sanitized], { onConflict: 'id' });
    if (error) console.error('[DB] updateEntry error:', error.message);
    else console.log(`[DB] schedule: updated entry ${entry.id}`);
  }

  static async deleteEntry(id: string, allEntries: ScheduleEntry[], termId?: string): Promise<void> {
    this.persistScheduleSnapshot(allEntries);
    if (!supabase) return;
    this.markLocalWrite('schedule', [id]);
    let q = supabase.from('schedule').delete().eq('id', id);
    if (termId) q = q.eq('termId', termId);
    const { error } = await q;
    if (error) console.error('[DB] deleteEntry error:', error.message);
    else console.log(`[DB] schedule: deleted entry ${id}`);
  }

  // ─── Clear operations ───────────────────────────────────────────────────────

  static async clearSchedule(termId?: string): Promise<void> {
    // A snapshot still waiting to be written would otherwise put the cleared
    // sessions back into the offline copy a few seconds later.
    this.cancelScheduleSnapshot();
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

  // ─── Targeted record save ───────────────────────────────────────────────────
  // Save just the given rows (edit one record, copy records into a term) without
  // touching anything else. saveEntity rewrites a whole table and its callers
  // delete whatever isn't in the list they pass — the wrong tool for one record.
  // (The old migrateDataToTerm lived here: it re-tagged EVERY row of every term
  // to one term, breaking past terms. Removed.)
  static async upsertRecords(tableName: string, items: any[], termId?: string): Promise<void> {
    if (!supabase || items.length === 0) return;
    this.lastWriteTimestamp = Date.now();
    const err = await this.upsertBatch(tableName, items.map(i => this.sanitize(tableName, i, termId)));
    this.lastWriteTimestamp = Date.now();
    if (err) throw new Error(`Failed to save ${tableName}: ${err}`);
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

  static detectConflicts(
    schedule: ScheduleEntry[],
    facultyList: Faculty[] = [],
    roomList: Room[] = [],
    groupList: StudentGroup[] = []
  ): Clash[] {
    // Same rule as before — two sessions clash when they're on the same day, start
    // at the same time, share at least one week, and share a room, a faculty or a
    // cohort — but reported ONCE per pair of sessions (listing the weeks), instead
    // of once per week. A double-booking repeated over 18 weeks used to produce 18
    // separate clashes, which made the list huge and slow to build and draw.
    const clashes: Clash[] = [];

    // Name lookups built once (previously up to three full list scans per clash).
    const nameIndex = (list: any[]) => {
      const m = new Map<string, string>();
      for (const x of list) if (x?.id) m.set(x.id, x._Faculty_name || x._unique_name || x.name);
      return m;
    };
    const roomNames = nameIndex(roomList);
    const facultyNames = nameIndex(facultyList);
    const groupNames = nameIndex(groupList);

    // "Week 4" / "Weeks 4–12, 15"
    const formatWeeks = (weeks: number[]) => {
      const sorted = [...new Set(weeks)].sort((a, b) => a - b);
      const parts: string[] = [];
      let start = sorted[0];
      let prev = sorted[0];
      for (let i = 1; i <= sorted.length; i++) {
        const w = sorted[i];
        if (w === prev + 1) { prev = w; continue; }
        parts.push(start === prev ? `${start}` : `${start}–${prev}`);
        start = w;
        prev = w;
      }
      return `${sorted.length === 1 ? 'Week' : 'Weeks'} ${parts.join(', ')}`;
    };

    // Only sessions on the same day and start time can clash, so group by that
    // and compare pairs within each small group — not every session against all.
    const slots = new Map<string, { e: ScheduleEntry; weeks: Set<number> }[]>();
    for (const e of schedule) {
      const weeks = Array.isArray(e.weeks) ? e.weeks : [];
      if (!e.day || !e.startTime || weeks.length === 0) continue;
      const key = `${e.day}|${e.startTime}`;
      let slot = slots.get(key);
      if (!slot) { slot = []; slots.set(key, slot); }
      slot.push({ e, weeks: new Set(weeks) });
    }

    slots.forEach(slot => {
      for (let i = 1; i < slot.length; i++) {
        const b = slot[i];
        const bGroups = b.e.groupIds || [];
        for (let j = 0; j < i; j++) {
          const a = slot[j];
          const sameRoom = !!b.e.roomId && b.e.roomId === a.e.roomId;
          const sameFaculty = !!b.e.facultyId && b.e.facultyId === a.e.facultyId;
          const aGroups = a.e.groupIds || [];
          // Courses of the same elective basket ("PE1 Theory" + "PE1 Theory") are
          // meant to run together for a cohort — each student attends only one —
          // so a shared cohort is not a clash there. Room/faculty still are.
          const sharedGroups = areParallelElectives(a.e.category, b.e.category)
            ? []
            : bGroups.filter(g => aGroups.includes(g));
          if (!sameRoom && !sameFaculty && sharedGroups.length === 0) continue;

          const overlap: number[] = [];
          b.weeks.forEach(w => { if (a.weeks.has(w)) overlap.push(w); });
          if (overlap.length === 0) continue;

          const when = `${b.e.day} at ${b.e.startTime} (${formatWeeks(overlap)})`;
          const affectedIds = [b.e.id, a.e.id];
          if (sameRoom) {
            const roomName = roomNames.get(b.e.roomId!) || `Room #${b.e.roomId!.slice(-6)}`;
            clashes.push({ type: 'Room', message: `Room "${roomName}" is double-booked on ${when}`, affectedIds });
          }
          if (sameFaculty) {
            const facultyName = facultyNames.get(b.e.facultyId!) || `Faculty #${b.e.facultyId!.slice(-6)}`;
            clashes.push({ type: 'Faculty', message: `Faculty "${facultyName}" has overlapping sessions on ${when}`, affectedIds });
          }
          for (const gId of sharedGroups) {
            const cohortName = groupNames.get(gId) || `Cohort #${gId.slice(-6)}`;
            clashes.push({ type: 'Cohort', message: `Cohort "${cohortName}" is scheduled in two sessions simultaneously on ${when}`, affectedIds });
          }
        }
      }
    });

    // Weekly teaching-hours limit — one warning per faculty, listing the weeks over.
    if (facultyList.length > 0) {
      const facultyById = new Map(facultyList.map(f => [f.id, f] as [string, Faculty]));
      const hoursByWeek = new Map<string, Map<number, number>>();
      const sessionsByFaculty = new Map<string, ScheduleEntry[]>();
      for (const e of schedule) {
        if (!e.facultyId || !e.day || !e.startTime) continue;
        const duration = this.getDuration(e.startTime, e.endTime);
        let byWeek = hoursByWeek.get(e.facultyId);
        if (!byWeek) { byWeek = new Map(); hoursByWeek.set(e.facultyId, byWeek); }
        for (const w of (Array.isArray(e.weeks) ? e.weeks : [])) byWeek.set(w, (byWeek.get(w) || 0) + duration);
        let list = sessionsByFaculty.get(e.facultyId);
        if (!list) { list = []; sessionsByFaculty.set(e.facultyId, list); }
        list.push(e);
      }
      hoursByWeek.forEach((byWeek, fId) => {
        const faculty = facultyById.get(fId);
        if (!faculty) return;
        const overWeeks: number[] = [];
        let peak = 0;
        byWeek.forEach((hours, w) => {
          if (hours > faculty.maxHoursPerWeek) { overWeeks.push(w); peak = Math.max(peak, hours); }
        });
        if (overWeeks.length === 0) return;
        const overSet = new Set(overWeeks);
        clashes.push({
          type: 'LoadViolation',
          message: `Faculty "${faculty.name}" over capacity in ${formatWeeks(overWeeks)} (up to ${peak.toFixed(1)}h / ${faculty.maxHoursPerWeek}h)`,
          affectedIds: (sessionsByFaculty.get(fId) || []).filter(s => (s.weeks || []).some(w => overSet.has(w))).map(s => s.id),
        });
      });
    }
    return clashes;
  }
}
