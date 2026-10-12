
import React, { useState, useEffect, useRef } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import TopNav from './components/TopNav';
import Dashboard from './components/Dashboard';
import TimetablePanel from './components/TimetablePanel';
import ClashIndicator from './components/ClashIndicator';
import SessionModal from './components/SessionModal';
import SessionDetailModal from './components/SessionDetailModal';
import DataImportPanel from './components/DataImportPanel';
import TermManagement from './components/TermManagement';
import AdminPanel from './components/AdminPanel';
import Login from './components/Login';
import SupabaseSetup from './components/SupabaseSetup';
import ReportsPanel from './components/ReportsPanel';
import AutoSchedulePanel from './components/AutoSchedulePanel';
import RoomAvailabilityTool from './components/RoomAvailabilityTool';
import BacklogPanel from './components/BacklogPanel';
import {
  Term, Course, Faculty, Room, StudentGroup, ScheduleEntry, Clash, Role, ViewType, UserAccount, DayOfWeek
} from './types';
import { 
  MOCK_COURSES, MOCK_FACULTY, MOCK_ROOMS, MOCK_GROUPS
} from './constants';
import { 
  Plus, MapPin, Download, ChevronUp, ChevronDown, Calendar, LayoutGrid, Clock
} from 'lucide-react';
import jsPDF from 'jspdf';
import autoTable from 'jspdf-autotable';
import * as XLSX from 'xlsx';
import { DataService } from './services/dataService';
import { supabase } from './services/supabase';

const MOCK_USERS: UserAccount[] = [
  { id: 'u1', username: 'superadmin', password: 'admin123', name: 'Main Administrator', role: Role.SUPER_ADMIN, departmentScope: 'All', lastLogin: new Date().toISOString() }
];

const App: React.FC = () => {
  const [currentUser, setCurrentUser] = useState<UserAccount | null>(() => {
    const saved = localStorage.getItem('unitime_session');
    try {
      return saved ? JSON.parse(saved) : null;
    } catch (e) {
      console.error('Failed to parse session:', e);
      return null;
    }
  });
  const [activeTab, setActiveTab] = useState('dashboard');
  // Windows open with nothing selected — the user picks what to view.
  const [panels, setPanels] = useState<any[]>([
    { id: 'p1', type: 'Group', viewId: '', x: 20, y: 20, w: 800, h: 350, z: 10 },
  ]);

  const resetUIState = () => {
    setActiveTab('dashboard');
    setPanels([{ id: 'p1', type: 'Group', viewId: '', x: 20, y: 20, w: 800, h: 350, z: 10 }]);
    setIsRoomToolOpen(false);
  };

  const [isSyncing, setIsSyncing] = useState(false);
  const [isRoomToolOpen, setIsRoomToolOpen] = useState(false);

  // Undo/redo stacks — stored in refs so keyboard handler always sees current value
  const undoStackRef = useRef<ScheduleEntry[][]>([]);
  const redoStackRef = useRef<ScheduleEntry[][]>([]);
  const [canUndo, setCanUndo] = useState(false);
  const [canRedo, setCanRedo] = useState(false);

  const syncHistoryState = () => {
    setCanUndo(undoStackRef.current.length > 0);
    setCanRedo(redoStackRef.current.length > 0);
  };

  const pushHistory = () => {
    undoStackRef.current = [...undoStackRef.current.slice(-29), [...scheduleRef.current]];
    redoStackRef.current = [];
    syncHistoryState();
  };
  const [isSupabaseConfigured, setIsSupabaseConfigured] = useState(() => {
    const isSkipped = localStorage.getItem('unitime_skip_supabase') === 'true';
    return !!supabase || isSkipped;
  });

  // The term THIS person is working in. Everyone picks their own (top bar), so
  // part of the team can build next semester while others keep editing the
  // current one. Remembered per browser; falls back to the default term.
  const [viewingTermId, setViewingTermId] = useState<string | null>(() => {
    try { return localStorage.getItem('unitime_working_term') || null; } catch { return null; }
  });
  const switchTerm = (id: string) => {
    try { localStorage.setItem('unitime_working_term', id); } catch { /* private mode */ }
    setViewingTermId(id);
  };

  // Initialise users from localStorage so we don't fall back to MOCK_USERS
  // when Supabase is temporarily unavailable — avoids username constraint conflicts.
  // Users are NOT cached in localStorage — Supabase is the single source of truth.
  // Caching caused ghost users to appear after Supabase deletes, breaking login.
  const [users, setUsers] = useState<UserAccount[]>(MOCK_USERS);
  // Initialise terms from the last real list cached from Supabase. There is
  // deliberately NO made-up fallback term any more: a placeholder term once made
  // edits get saved under a term that didn't exist ('t1'). If no real term is
  // known yet, the app simply shows nothing and blocks edits until terms load.
  const [terms, setTerms] = useState<Term[]>(() => {
    try {
      const saved = localStorage.getItem('unitime_terms');
      if (saved) {
        const parsed = JSON.parse(saved);
        if (Array.isArray(parsed) && parsed.length > 0) return parsed;
      }
    } catch {}
    return [];
  });
  const [courses, setCourses] = useState<Course[]>([]);
  const [faculties, setFaculties] = useState<Faculty[]>([]);
  const [rooms, setRooms] = useState<Room[]>([]);
  const [groups, setGroups] = useState<StudentGroup[]>([]);
  const [schedule, setSchedule] = useState<ScheduleEntry[]>([]);
  const [clashes, setClashes] = useState<Clash[]>([]);
  const [maximizedPanelId, setMaximizedPanelId] = useState<string | null>(null);

  // Clipboard for copy-paste
  const [clipboard, setClipboard] = useState<Partial<ScheduleEntry> | null>(null);

  // ✅ FIX: A ref that mirrors isSyncing for use inside realtime callbacks.
  // Regular state can't be read inside closures reliably; refs can.
  const isSyncingRef = useRef(false);

  // Tracks the current active termId — always up-to-date even inside stale closures
  // (realtime callbacks are set up once and would otherwise close over the mount-time value).
  const activeTermIdRef = useRef<string | undefined>(undefined);

  // Tracks which termId data was last fully loaded for — used to detect real term switches
  // and trigger a full data reload (courses, faculties, rooms, groups, schedule).
  const loadedTermIdRef = useRef<string | undefined>(undefined);

  // ✅ FIX: Mirror of `schedule` state as a ref.
  // Handlers like handleSaveSession close over the React state value at render time.
  // When two saves fire before React re-renders, the second sees the old `schedule = []`
  // and setSchedule([entryB]) silently drops entryA. Using the ref gives always-current value.
  const scheduleRef = useRef<ScheduleEntry[]>([]);
  const glowRef = useRef<HTMLDivElement>(null);

  // Update both state and ref in one call — use this everywhere instead of bare setSchedule.
  const setScheduleAndRef = (s: ScheduleEntry[]) => {
    scheduleRef.current = s;
    setSchedule(s);
  };

  // ✅ FIX: effectiveActiveTerm moved here, BEFORE the useEffect that references it.
  // Previously it was declared after the hooks (line 543), causing a
  // "Cannot access before initialization" crash in the bundled output.
  // (If the remembered term no longer exists, use the default term.)
  const effectiveActiveTerm =
    (viewingTermId ? terms.find(t => t.id === viewingTermId) : undefined) ?? terms.find(t => t.isActive);

  // ── Term safety ─────────────────────────────────────────────────────────────
  // Every term is editable, and every edit goes ONLY into the term chosen in the
  // top bar: data is loaded, saved and synced per term, so terms never mix. The
  // only time saving is blocked is when no term is loaded at all. canWrite()
  // reads a ref because some panels hold older copies of these handlers (they
  // skip re-rendering when only callbacks change).
  const writeBlockReason: string | null = !effectiveActiveTerm
    ? 'No academic term is loaded yet, so nothing can be saved. Please refresh the page.'
    : null;
  const writeBlockReasonRef = useRef<string | null>(writeBlockReason);
  writeBlockReasonRef.current = writeBlockReason;
  const canWrite = (): boolean => {
    if (writeBlockReasonRef.current) {
      alert(writeBlockReasonRef.current);
      return false;
    }
    return true;
  };

  useEffect(() => {
    // Always clear stale user cache on startup — Supabase is the single source of truth for users.
    localStorage.removeItem('unitime_users');

    const loadData = async () => {
      setIsSyncing(true);
      try {
        // Step 1: Load terms first so we know the REAL active termId.
        // Loading everything in parallel with the mock termId (from initial state) was
        // causing all term-scoped data to load empty because the mock term id ('t1')
        // never matched the real data stored in Supabase / localStorage.
        const [u, t] = await Promise.all([
          DataService.loadEntity<UserAccount>('users', 'unitime_users', MOCK_USERS),
          DataService.loadEntity<Term>('terms', 'unitime_terms', []),
        ]);
        setUsers(u);
        setTerms(t);

        // Step 2: Derive the real active termId from the freshly loaded terms.
        const realActiveTermId =
          (viewingTermId ? t.find(term => term.id === viewingTermId)?.id : undefined)
          ?? t.find(term => term.isActive)?.id;
        // Pin this session to that term. If an admin later changes the default
        // term, people already working are NOT moved to it mid-edit — they stay
        // where they are until they switch themselves (or open the app afresh).
        if (realActiveTermId && realActiveTermId !== viewingTermId) setViewingTermId(realActiveTermId);

        // Keep the ref current so realtime callbacks always use the correct id.
        activeTermIdRef.current = realActiveTermId;
        loadedTermIdRef.current = realActiveTermId;

        // Step 3: Load all term-scoped entities with the correct termId.
        const [c, f, r, g, s] = await Promise.all([
          DataService.loadEntity<Course>('courses', 'unitime_courses', [], realActiveTermId),
          DataService.loadEntity<Faculty>('faculties', 'unitime_faculties', [], realActiveTermId),
          DataService.loadEntity<Room>('rooms', 'unitime_rooms', [], realActiveTermId),
          DataService.loadEntity<StudentGroup>('groups', 'unitime_groups', [], realActiveTermId),
          DataService.loadAllEntries(realActiveTermId),
        ]);
        // The term on screen changed while this was loading — don't show another term's data.
        if (activeTermIdRef.current !== realActiveTermId) return;
        setCourses(c);
        setFaculties(f);
        setRooms(r);
        setGroups(g);
        setScheduleAndRef(s);
      } catch (err) {
        console.error('Initial data loading failed:', err);
      } finally {
        setIsSyncing(false);
      }
    };
    loadData();

    // ── Real-time multi-user sync ───────────────────────────────────────────────
    // Supabase pushes a message the moment any row changes. For the schedule (the
    // busy table) the changed row is applied straight from that message — nothing
    // is re-downloaded. Tables that change rarely still refetch, debounced.
    // All callbacks read refs (activeTermIdRef, scheduleRef) at the moment they
    // fire, never values captured when this effect first ran.
    if (supabase) {
      const debounceTimers: Record<string, any> = {};
      // Debounced refetch of one table. If this tab is mid-write, retry shortly
      // instead of skipping: with no 30-second poll any more, a skipped refresh
      // would otherwise go unnoticed until the 15-minute safety net.
      const debouncedRefresh = (tableName: string, refreshFn: () => Promise<void>, delay = 5000) => {
        if (debounceTimers[tableName]) clearTimeout(debounceTimers[tableName]);
        debounceTimers[tableName] = setTimeout(async () => {
          if (isSyncingRef.current || DataService.isWithinWriteGuard()) {
            debouncedRefresh(tableName, refreshFn, 10000);
            return;
          }
          await refreshFn();
        }, delay);
      };

      // Refetch one term-scoped table, ignoring the result if the term on screen
      // changed while the request was in flight.
      const refetchForTerm = <T,>(table: string, apply: (rows: T[]) => void) => async () => {
        const termId = activeTermIdRef.current;
        const rows = await DataService.fetchTable<T>(table, termId);
        if (rows !== null && activeTermIdRef.current === termId) apply(rows);
      };

      const refetchSchedule = () => debouncedRefresh('schedule',
        refetchForTerm<ScheduleEntry>('schedule', s => setScheduleAndRef(s)));

      // Realtime can deliver Postgres arrays either as JSON arrays or as "{a,b}" text.
      const toList = (v: any): string[] => {
        if (Array.isArray(v)) return v.map(String);
        if (typeof v === 'string') {
          const inner = v.replace(/^\{|\}$/g, '');
          return inner ? inner.split(',').map(s => s.replace(/^"|"$/g, '').trim()) : [];
        }
        return [];
      };

      // Schedule changes are held for a moment and applied together in one state
      // update, so a burst of edits causes one redraw rather than one per row.
      // A very large burst (bulk import / restore / clear) is cheaper to refetch
      // once than to replay row by row — and also covers any messages Supabase
      // drops under that kind of load.
      const SCHEDULE_BURST_LIMIT = 200;
      let pendingSchedule: { id: string; row: ScheduleEntry | null }[] = [];
      let scheduleFlushTimer: any = null;

      const flushSchedule = () => {
        scheduleFlushTimer = null;
        const batch = pendingSchedule;
        pendingSchedule = [];
        if (batch.length === 0) return;
        if (batch.length > SCHEDULE_BURST_LIMIT) { refetchSchedule(); return; }
        const termId = activeTermIdRef.current;
        const byId = new Map<string, ScheduleEntry>(scheduleRef.current.map(e => [e.id, e] as [string, ScheduleEntry]));
        for (const { id, row } of batch) {
          // Deleted, or now belongs to a term other than the one on screen.
          if (!row || (termId && row.termId !== termId)) byId.delete(id);
          else byId.set(id, row);
        }
        setScheduleAndRef(Array.from(byId.values()));
      };

      const onScheduleChange = (payload: any) => {
        const isDelete = payload.eventType === 'DELETE';
        const rec = isDelete ? payload.old : payload.new;
        const id: string | undefined = rec?.id;
        // Ignore the echo of this tab's own write — it already has that data.
        if (!id || DataService.isRecentLocalWrite('schedule', id)) return;
        const row: ScheduleEntry | null = isDelete ? null : {
          ...rec,
          groupIds: toList(rec.groupIds),
          weeks: toList(rec.weeks).map(Number).filter(n => !isNaN(n)),
        };
        pendingSchedule.push({ id, row });
        if (!scheduleFlushTimer) scheduleFlushTimer = setTimeout(flushSchedule, 300);
      };

      // Users, terms and the course/faculty/room/cohort registries change rarely
      // (uploads, admin edits), so a debounced refetch of that one table is fine.
      // Echoes of this tab's own writes don't trigger a refetch.
      const onTableChange = (tableName: string, refreshFn: () => Promise<void>) => (payload: any) => {
        const id = payload.new?.id ?? payload.old?.id;
        if (DataService.isRecentLocalWrite(tableName, id)) return;
        debouncedRefresh(tableName, refreshFn);
      };

      // If the connection drops (laptop sleep, Wi-Fi blip), changes made meanwhile
      // are never pushed to us — so after reconnecting, catch up with one full refresh.
      let hasSubscribed = false;
      let connectionLost = false;

      const channel = supabase.channel('realtime_sync')
        .on('postgres_changes', { event: '*', schema: 'public', table: 'schedule' }, onScheduleChange)
        .on('postgres_changes', { event: '*', schema: 'public', table: 'users' }, onTableChange('users', async () => {
          const u = await DataService.fetchTable<UserAccount>('users');
          if (u !== null && u.length > 0) setUsers(u);
        }))
        .on('postgres_changes', { event: '*', schema: 'public', table: 'terms' }, onTableChange('terms', async () => {
          const t = await DataService.fetchTable<Term>('terms');
          if (t !== null && t.length > 0) setTerms(t);
        }))
        .on('postgres_changes', { event: '*', schema: 'public', table: 'courses' },
          onTableChange('courses', refetchForTerm<Course>('courses', c => setCourses(c))))
        .on('postgres_changes', { event: '*', schema: 'public', table: 'faculties' },
          onTableChange('faculties', refetchForTerm<Faculty>('faculties', f => setFaculties(f))))
        .on('postgres_changes', { event: '*', schema: 'public', table: 'rooms' },
          onTableChange('rooms', refetchForTerm<Room>('rooms', r => setRooms(r))))
        .on('postgres_changes', { event: '*', schema: 'public', table: 'groups' },
          onTableChange('groups', refetchForTerm<StudentGroup>('groups', g => setGroups(g))))
        .subscribe((rawStatus) => {
          const status = String(rawStatus);
          if (status === 'SUBSCRIBED') {
            if (hasSubscribed && connectionLost) {
              console.log('[RT] Reconnected — catching up with a full refresh');
              requestFullRefresh();
            }
            hasSubscribed = true;
            connectionLost = false;
          } else if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT' || status === 'CLOSED') {
            connectionLost = true;
          }
        });

      return () => {
        Object.values(debounceTimers).forEach(t => clearTimeout(t));
        if (scheduleFlushTimer) clearTimeout(scheduleFlushTimer);
        supabase.removeChannel(channel);
      };
    }
  }, []);

  // Keep activeTermIdRef current AND reload all term-scoped data when the active term changes.
  useEffect(() => {
    const termId = effectiveActiveTerm?.id;
    activeTermIdRef.current = termId;

    // Skip if this is the same term that was already loaded (initial load or no real change).
    if (!termId || termId === loadedTermIdRef.current) return;
    loadedTermIdRef.current = termId;

    // Undo/redo history belongs to the term it was recorded in. Undoing after a
    // term switch would replay the other term's timetable into this one.
    undoStackRef.current = [];
    redoStackRef.current = [];
    syncHistoryState();
    // Rooms/faculty/cohorts are separate records in each term, so whatever was
    // picked in the timetable windows doesn't exist in the new term.
    setPanels(prev => prev.map(p => ({ ...p, viewId: '' })));

    const reloadForTerm = async () => {
      setIsSyncing(true);
      isSyncingRef.current = true;
      try {
        const [c, f, r, g, s] = await Promise.all([
          DataService.loadEntity<Course>('courses', 'unitime_courses', [], termId),
          DataService.loadEntity<Faculty>('faculties', 'unitime_faculties', [], termId),
          DataService.loadEntity<Room>('rooms', 'unitime_rooms', [], termId),
          DataService.loadEntity<StudentGroup>('groups', 'unitime_groups', [], termId),
          DataService.loadAllEntries(termId),
        ]);
        // Switched to yet another term while this was loading — discard this result.
        if (activeTermIdRef.current !== termId) return;
        setCourses(c);
        setFaculties(f);
        setRooms(r);
        setGroups(g);
        setScheduleAndRef(s);
      } catch (err) {
        console.error('[Term Switch] Failed to reload data:', err);
      } finally {
        setIsSyncing(false);
        isSyncingRef.current = false;
      }
    };
    reloadForTerm();
  }, [effectiveActiveTerm?.id]);

  // Canvas cursor-glow: translate a pre-rendered radial gradient div to follow the cursor.
  // Uses transform (GPU compositor) not background repaint — zero layout/paint cost.
  useEffect(() => {
    if (activeTab !== 'builder') return;
    let rafId = 0;
    const handler = (e: MouseEvent) => {
      cancelAnimationFrame(rafId);
      rafId = requestAnimationFrame(() => {
        if (glowRef.current) {
          glowRef.current.style.transform = `translate(${e.clientX - 450}px, ${e.clientY - 450}px)`;
        }
      });
    };
    window.addEventListener('mousemove', handler);
    return () => { window.removeEventListener('mousemove', handler); cancelAnimationFrame(rafId); };
  }, [activeTab]);

  // Full reload of every table. This used to run every 30 seconds and on every
  // window focus, in every open tab — the main cause of the Supabase egress limit.
  // Live edits now arrive through realtime instead, so this only runs when it's
  // genuinely needed (see the effect below). Skips — and returns false — if this
  // tab just wrote data, since a read right now could miss a write that's still
  // committing and wipe it from the screen.
  const refreshAllData = async (): Promise<boolean> => {
    if (!supabase) return false;
    if (isSyncingRef.current || DataService.isWithinWriteGuard()) {
      console.log('[App] refreshAllData skipped — write guard active');
      return false;
    }
    const termId = activeTermIdRef.current;
    try {
      const [t, u, c, f, r, g, s] = await Promise.all([
        DataService.fetchTable<Term>('terms'),
        DataService.fetchTable<UserAccount>('users'),
        DataService.fetchTable<Course>('courses', termId),
        DataService.fetchTable<Faculty>('faculties', termId),
        DataService.fetchTable<Room>('rooms', termId),
        DataService.fetchTable<StudentGroup>('groups', termId),
        DataService.fetchTable<ScheduleEntry>('schedule', termId),
      ]);
      // Only update state if fetch succeeded (non-null) and not empty
      // (empty result during normal operation likely means stale read)
      if (t !== null && t.length > 0) setTerms(t);
      if (u !== null && u.length > 0) setUsers(u);
      // Term-scoped data: only apply it if the term on screen is still the one fetched.
      if (activeTermIdRef.current !== termId) return true;
      if (c !== null) setCourses(c);
      if (f !== null) setFaculties(f);
      if (r !== null) setRooms(r);
      if (g !== null) setGroups(g);
      if (s !== null) setScheduleAndRef(s);
    } catch (err) {
      console.error('[App] refreshAllData failed:', err);
    }
    return true;
  };

  // For moments when we know changes may have been missed (reconnect, returning
  // to the tab): if this tab is mid-write, try again shortly instead of giving up.
  const fullRefreshRetryRef = useRef<any>(null);
  const requestFullRefresh = async () => {
    if (fullRefreshRetryRef.current) {
      clearTimeout(fullRefreshRetryRef.current);
      fullRefreshRetryRef.current = null;
    }
    const ran = await refreshAllData();
    if (!ran && supabase) fullRefreshRetryRef.current = setTimeout(requestFullRefresh, 10000);
  };

  // When a full refresh happens now (instead of every 30 seconds):
  //  • Coming back to the tab after 3+ minutes away. Shorter absences don't need
  //    it — realtime keeps delivering changes to background tabs. Longer ones do,
  //    because browsers throttle background tabs and the connection can lapse.
  //  • After the realtime connection drops and reconnects (handled above).
  //  • A slow 15-minute safety net while the tab is on screen, in case a single
  //    realtime message was ever missed. Hidden tabs skip it entirely.
  useEffect(() => {
    if (!supabase) return;
    const AWAY_REFRESH_MS = 3 * 60 * 1000;
    const SAFETY_NET_MS = 15 * 60 * 1000;
    let hiddenSince: number | null = document.visibilityState === 'hidden' ? Date.now() : null;

    const onVisibilityChange = () => {
      if (document.visibilityState === 'hidden') {
        hiddenSince = Date.now();
      } else {
        if (hiddenSince !== null && Date.now() - hiddenSince >= AWAY_REFRESH_MS) requestFullRefresh();
        hiddenSince = null;
      }
    };
    const safetyNet = setInterval(() => {
      if (document.visibilityState === 'visible') refreshAllData();
    }, SAFETY_NET_MS);

    document.addEventListener('visibilitychange', onVisibilityChange);
    return () => {
      clearInterval(safetyNet);
      document.removeEventListener('visibilitychange', onVisibilityChange);
      if (fullRefreshRetryRef.current) clearTimeout(fullRefreshRetryRef.current);
    };
  }, []);

  // Helper: wraps any write operation so isSyncingRef blocks realtime re-fetches
  // for the full debounce window (2s) + a safety buffer (1s extra = 3s total).
  const withSync = async (fn: () => Promise<void>): Promise<void> => {
    isSyncingRef.current = true;
    setIsSyncing(true);
    try {
      await fn();
    } catch (err: any) {
      console.error('[Sync Error]', err);
      alert(err.message || 'Unknown synchronization error occurred.');
      await refreshAllData(); // Recover local state from Supabase
    } finally {
      setIsSyncing(false);
      isSyncingRef.current = false;
    }
  };

  useEffect(() => {
    if (currentUser) {
      localStorage.setItem('unitime_session', JSON.stringify(currentUser));
    } else {
      localStorage.removeItem('unitime_session');
    }
  }, [currentUser]);

  // Clash detection waits a moment for a burst of changes to settle (dragging,
  // pasting, a batch of realtime updates from colleagues) and then runs once,
  // instead of re-running after every single change.
  useEffect(() => {
    if (schedule.length === 0) {
      setClashes([]);
      return;
    }
    const timer = setTimeout(() => {
      setClashes(DataService.detectConflicts(schedule, faculties, rooms, groups));
    }, 250);
    return () => clearTimeout(timer);
  }, [schedule, faculties, rooms, groups]);

  const [isModalOpen, setIsModalOpen] = useState(false);
  const [modalInitialData, setModalInitialData] = useState<Partial<ScheduleEntry>>({});
  const [isDetailModalOpen, setIsDetailModalOpen] = useState(false);
  const [selectedEntry, setSelectedEntry] = useState<ScheduleEntry | null>(null);
  const [selectedCellEntries, setSelectedCellEntries] = useState<ScheduleEntry[]>([]);

  const maxZRef = useRef(12);

  const handleSaveSession = async (newEntries: Omit<ScheduleEntry, 'id' | 'departmentId'>[]) => {
    if (!canWrite()) return;
    const termId = activeTermIdRef.current || effectiveActiveTerm?.id;
    if (!termId) { alert('No active term — nothing was saved.'); return; }
    pushHistory();
    const now = new Date().toISOString();
    const entries: ScheduleEntry[] = newEntries.map((ne, index) => ({
      ...ne,
      id: `s-${Date.now()}-${index}`,
      // Always the term on screen — never a value carried in from a form or file.
      termId,
      departmentId: currentUser?.departmentScope === 'All' ? 'CS' : (currentUser?.departmentScope || 'General'),
      createdBy: currentUser?.name || currentUser?.username || 'Unknown',
      createdAt: now,
      updatedBy: undefined,
      updatedAt: undefined,
    }));
    await withSync(async () => {
      // Use scheduleRef.current (not schedule state) — avoids stale closure when two
      // saves fire before React re-renders and the second would overwrite the first.
      const updatedSchedule = [...scheduleRef.current, ...entries];
      setScheduleAndRef(updatedSchedule);
      await DataService.addEntries(entries, updatedSchedule);
      // Note: no Supabase confirm-read here — that caused a read-before-write race that
      // wiped the new entry immediately (Supabase replica returned stale data). Local
      // state + localStorage are the source of truth; the 30s safety-net handles sync.
    });
  };

  const handleDeleteSession = async (id: string) => {
    if (!canWrite()) return;
    pushHistory();
    await withSync(async () => {
      const updatedSchedule = scheduleRef.current.filter(s => s.id !== id);
      setScheduleAndRef(updatedSchedule);
      await DataService.deleteEntry(id, updatedSchedule);
    });
  };

  const handleUpdateSession = async (updatedEntry: ScheduleEntry) => {
    if (!canWrite()) return;
    pushHistory();
    const auditedEntry: ScheduleEntry = {
      ...updatedEntry,
      updatedBy: currentUser?.name || currentUser?.username || 'Unknown',
      updatedAt: new Date().toISOString(),
    };
    await withSync(async () => {
      const updatedSchedule = scheduleRef.current.map(s => s.id === auditedEntry.id ? auditedEntry : s);
      setScheduleAndRef(updatedSchedule);
      await DataService.updateEntry(auditedEntry, updatedSchedule);
    });
  };

  const handleMoveSession = async (entryId: string, newDay: any, newStartTime: string) => {
    if (!canWrite()) return;
    pushHistory();
    await withSync(async () => {
      const entry = scheduleRef.current.find(s => s.id === entryId);
      if (entry) {
        const [sh, sm] = entry.startTime.split(':').map(Number);
        const [eh, em] = entry.endTime.split(':').map(Number);
        const durationMinutes = (eh * 60 + em) - (sh * 60 + sm);

        const [nsh, nsm] = newStartTime.split(':').map(Number);
        const totalNewEndMinutes = (nsh * 60 + nsm) + durationMinutes;
        const neh = Math.floor(totalNewEndMinutes / 60);
        const nem = totalNewEndMinutes % 60;
        const newEndTime = `${String(neh).padStart(2, '0')}:${String(nem).padStart(2, '0')}`;

        const updatedEntry = {
          ...entry, day: newDay, startTime: newStartTime, endTime: newEndTime,
          updatedBy: currentUser?.name || currentUser?.username || 'Unknown',
          updatedAt: new Date().toISOString(),
        };
        const updatedSchedule = scheduleRef.current.map(s => s.id === entryId ? updatedEntry : s);
        setScheduleAndRef(updatedSchedule);
        await DataService.updateEntry(updatedEntry, updatedSchedule);
      }
    });
  };

  const handleDuplicateSession = async (entry: ScheduleEntry) => {
    if (!canWrite()) return;
    pushHistory();
    await withSync(async () => {
      const duplicatedEntry: ScheduleEntry = { ...entry, id: `s-${Date.now()}-dup` };
      const updatedSchedule = [...scheduleRef.current, duplicatedEntry];
      setScheduleAndRef(updatedSchedule);
      await DataService.addEntries([duplicatedEntry], updatedSchedule);
    });
  };

  const handleDeleteMultipleSessions = async (ids: string[]) => {
    if (ids.length === 0) return;
    if (!canWrite()) return;
    pushHistory();
    await withSync(async () => {
      const updatedSchedule = scheduleRef.current.filter(s => !ids.includes(s.id));
      setScheduleAndRef(updatedSchedule);
      await DataService.deleteEntries(ids, updatedSchedule);
    });
  };

  const handleCopyToPanel = async (entryId: string, destViewType: ViewType, destViewId: string, newDay: DayOfWeek, newStartTime: string) => {
    const entry = scheduleRef.current.find(s => s.id === entryId);
    if (!entry) return;
    const [sh, sm] = entry.startTime.split(':').map(Number);
    const [eh, em] = entry.endTime.split(':').map(Number);
    const durationMinutes = (eh * 60 + em) - (sh * 60 + sm);
    const [nsh, nsm] = newStartTime.split(':').map(Number);
    const newEndMinutes = nsh * 60 + nsm + durationMinutes;
    const newEndTime = `${String(Math.floor(newEndMinutes / 60)).padStart(2, '0')}:${String(newEndMinutes % 60).padStart(2, '0')}`;
    const newEntry: Omit<ScheduleEntry, 'id' | 'departmentId'> = {
      ...entry,
      day: newDay,
      startTime: newStartTime,
      endTime: newEndTime,
      groupIds: destViewType === 'Group' && destViewId ? [destViewId] : entry.groupIds,
      roomId: destViewType === 'Room' && destViewId ? destViewId : entry.roomId,
      facultyId: destViewType === 'Faculty' && destViewId ? destViewId : entry.facultyId,
    };
    await handleSaveSession([newEntry]);
  };

  const handleCtrlDragCopy = async (entryId: string, newDay: DayOfWeek, newStartTime: string) => {
    const entry = scheduleRef.current.find(s => s.id === entryId);
    if (!entry) return;
    const [sh, sm] = entry.startTime.split(':').map(Number);
    const [eh, em] = entry.endTime.split(':').map(Number);
    const durationMinutes = (eh * 60 + em) - (sh * 60 + sm);
    const [nsh, nsm] = newStartTime.split(':').map(Number);
    const newEndMinutes = nsh * 60 + nsm + durationMinutes;
    const newEndTime = `${String(Math.floor(newEndMinutes / 60)).padStart(2, '0')}:${String(newEndMinutes % 60).padStart(2, '0')}`;
    await handleSaveSession([{ ...entry, day: newDay, startTime: newStartTime, endTime: newEndTime }]);
  };

  const handleUndo = async () => {
    if (undoStackRef.current.length === 0) return;
    if (!canWrite()) return;
    const target = undoStackRef.current.pop()!;
    redoStackRef.current = [...redoStackRef.current, [...scheduleRef.current]];
    const current = [...scheduleRef.current];
    setScheduleAndRef(target);
    isSyncingRef.current = true;
    setIsSyncing(true);
    try {
      const toDelete = current.filter(c => !target.some(t => t.id === c.id));
      const toAdd = target.filter(t => !current.some(c => c.id === t.id));
      const toUpdate = target.filter(t => {
        const curr = current.find(c => c.id === t.id);
        return curr && JSON.stringify(curr) !== JSON.stringify(t);
      });
      for (const e of toDelete) await DataService.deleteEntry(e.id, target);
      if (toAdd.length > 0) await DataService.addEntries(toAdd, target);
      for (const e of toUpdate) await DataService.updateEntry(e, target);
    } catch (err: any) {
      console.error('[Undo Error]', err);
    } finally {
      setIsSyncing(false);
      setTimeout(() => { isSyncingRef.current = false; }, 500);
      syncHistoryState();
    }
  };

  const handleRedo = async () => {
    if (redoStackRef.current.length === 0) return;
    if (!canWrite()) return;
    const target = redoStackRef.current.pop()!;
    undoStackRef.current = [...undoStackRef.current, [...scheduleRef.current]];
    const current = [...scheduleRef.current];
    setScheduleAndRef(target);
    isSyncingRef.current = true;
    setIsSyncing(true);
    try {
      const toDelete = current.filter(c => !target.some(t => t.id === c.id));
      const toAdd = target.filter(t => !current.some(c => c.id === t.id));
      const toUpdate = target.filter(t => {
        const curr = current.find(c => c.id === t.id);
        return curr && JSON.stringify(curr) !== JSON.stringify(t);
      });
      for (const e of toDelete) await DataService.deleteEntry(e.id, target);
      if (toAdd.length > 0) await DataService.addEntries(toAdd, target);
      for (const e of toUpdate) await DataService.updateEntry(e, target);
    } catch (err: any) {
      console.error('[Redo Error]', err);
    } finally {
      setIsSyncing(false);
      setTimeout(() => { isSyncingRef.current = false; }, 500);
      syncHistoryState();
    }
  };

  // Keyboard listener for Ctrl+Z / Ctrl+Y — uses refs to avoid stale closure
  const handleUndoRef = useRef(handleUndo);
  const handleRedoRef = useRef(handleRedo);
  handleUndoRef.current = handleUndo;
  handleRedoRef.current = handleRedo;

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      const active = document.activeElement;
      const isInput = active?.tagName === 'INPUT' || active?.tagName === 'TEXTAREA' || (active as HTMLElement)?.isContentEditable;
      if (isInput) return;
      if ((e.ctrlKey || e.metaKey) && e.key === 'z' && !e.shiftKey) {
        e.preventDefault();
        handleUndoRef.current();
      }
      if ((e.ctrlKey || e.metaKey) && (e.key === 'y' || (e.key === 'z' && e.shiftKey))) {
        e.preventDefault();
        handleRedoRef.current();
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, []);

  const handleUpdateUsers = async (updatedUsers: UserAccount[]) => {
    const deletedIds = users.filter(old => !updatedUsers.some(newIt => newIt.id === old.id)).map(c => c.id);
    await withSync(async () => {
      setUsers(updatedUsers);
      await DataService.saveEntity('users', 'unitime_users', updatedUsers);
      for (const id of deletedIds) await DataService.deleteRecord('users', id);
    });
  };

  const handleUpdateTerms = async (updatedTerms: Term[]) => {
    const deletedIds = terms.filter(old => !updatedTerms.some(newIt => newIt.id === old.id)).map(c => c.id);
    await withSync(async () => {
      setTerms(updatedTerms);
      await DataService.saveEntity('terms', 'unitime_terms', updatedTerms);
      for (const id of deletedIds) await DataService.deleteRecord('terms', id);
    });
  };

  type ProgressFn = (pct: number, synced: number, total: number) => void;

  const handleUpdateCourses = async (updatedCourses: Course[], onProgress?: ProgressFn) => {
    if (!canWrite()) return;
    await withSync(async () => {
      const deletedIds = courses.filter(old => !updatedCourses.some(n => n.id === old.id)).map(c => c.id);
      if (deletedIds.length > 0) {
        // Cascade: remove schedule entries for deleted courses before deleting courses (FK constraint)
        const remaining = await DataService.deleteScheduleCascade('courseId', deletedIds, scheduleRef.current);
        setScheduleAndRef(remaining);
      }
      setCourses(updatedCourses);
      await DataService.saveEntity('courses', 'unitime_courses', updatedCourses, effectiveActiveTerm?.id, onProgress);
      await DataService.deleteRecords('courses', deletedIds);
    });
  };

  const handleUpdateFaculties = async (updatedFaculties: Faculty[], onProgress?: ProgressFn) => {
    if (!canWrite()) return;
    await withSync(async () => {
      const deletedIds = faculties.filter(old => !updatedFaculties.some(n => n.id === old.id)).map(f => f.id);
      if (deletedIds.length > 0) {
        // Cascade: remove schedule entries for deleted faculties before deleting faculties (FK constraint)
        const remaining = await DataService.deleteScheduleCascade('facultyId', deletedIds, scheduleRef.current);
        setScheduleAndRef(remaining);
      }
      setFaculties(updatedFaculties);
      await DataService.saveEntity('faculties', 'unitime_faculties', updatedFaculties, effectiveActiveTerm?.id, onProgress);
      await DataService.deleteRecords('faculties', deletedIds);
    });
  };

  const handleUpdateRooms = async (updatedRooms: Room[], onProgress?: ProgressFn) => {
    if (!canWrite()) return;
    await withSync(async () => {
      const deletedIds = rooms.filter(old => !updatedRooms.some(n => n.id === old.id)).map(r => r.id);
      if (deletedIds.length > 0) {
        // Cascade: remove schedule entries for deleted rooms (FK constraint)
        const remaining = await DataService.deleteScheduleCascade('roomId', deletedIds, scheduleRef.current);
        setScheduleAndRef(remaining);
      }
      setRooms(updatedRooms);
      await DataService.saveEntity('rooms', 'unitime_rooms', updatedRooms, effectiveActiveTerm?.id, onProgress);
      await DataService.deleteRecords('rooms', deletedIds);
    });
  };

  const handleUpdateGroups = async (updatedGroups: StudentGroup[], onProgress?: ProgressFn) => {
    if (!canWrite()) return;
    await withSync(async () => {
      const deletedIds = groups.filter(old => !updatedGroups.some(n => n.id === old.id)).map(g => g.id);
      setGroups(updatedGroups);
      await DataService.saveEntity('groups', 'unitime_groups', updatedGroups, effectiveActiveTerm?.id, onProgress);
      await DataService.deleteRecords('groups', deletedIds);
    });
  };



  // (A "wipe everything" function used to live here. It was never connected to
  // any button, and it deleted every term's data at once — removed so it can't be.)

  type RegistryTable = 'courses' | 'faculties' | 'rooms' | 'groups';
  const registrySetters: Record<RegistryTable, (fn: (prev: any[]) => any[]) => void> = {
    courses: fn => setCourses(prev => fn(prev)),
    faculties: fn => setFaculties(prev => fn(prev)),
    rooms: fn => setRooms(prev => fn(prev)),
    groups: fn => setGroups(prev => fn(prev)),
  };

  // Edit one course / faculty / room / cohort in place. Sessions point at these
  // records by their internal id (which never changes here), so every existing
  // session automatically shows the corrected details — nothing else is rewritten.
  const handleUpdateRecord = async (table: RegistryTable, item: any) => {
    if (!canWrite()) return;
    const termId = activeTermIdRef.current;
    // Drop import-time helper fields (_name, _unique_name, …): they aren't saved
    // to the database and would otherwise keep showing the old value until reload.
    const clean: any = {};
    Object.keys(item).forEach(k => { if (!k.startsWith('_')) clean[k] = item[k]; });
    await withSync(async () => {
      registrySetters[table](prev => prev.map(r => r.id === clean.id ? clean : r));
      await DataService.upsertRecords(table, [clean], termId);
    });
  };

  // Hand every session of one faculty (in the active term) over to another —
  // e.g. when a faculty member leaves. Undo-able like any other timetable edit.
  const handleTransferFacultyLoad = async (fromId: string, toId: string): Promise<number> => {
    if (!canWrite() || !fromId || !toId || fromId === toId) return 0;
    const termId = activeTermIdRef.current;
    const now = new Date().toISOString();
    const who = currentUser?.name || currentUser?.username || 'Unknown';
    const moved = scheduleRef.current
      .filter(s => s.facultyId === fromId && (!termId || s.termId === termId))
      .map(s => ({ ...s, facultyId: toId, updatedBy: who, updatedAt: now }));
    if (moved.length === 0) return 0;
    pushHistory();
    let ok = true;
    await withSync(async () => {
      const movedById = new Map(moved.map(m => [m.id, m] as [string, ScheduleEntry]));
      const updatedSchedule = scheduleRef.current.map(s => movedById.get(s.id) || s);
      setScheduleAndRef(updatedSchedule);
      try {
        await DataService.addEntries(moved, updatedSchedule); // upsert, in batches
      } catch (err) {
        ok = false;
        throw err;
      }
    });
    return ok ? moved.length : 0;
  };

  // Copy courses / faculty / rooms / cohorts from another term INTO the active
  // term, so a new term can start from last term's setup. Copies get new ids
  // belonging to the active term; the source term is only read, never changed.
  const handleCopyRegistryFromTerm = async (sourceTermId: string, tables: RegistryTable[]): Promise<string> => {
    if (!canWrite()) return '';
    const targetTermId = activeTermIdRef.current;
    if (!targetTermId || !sourceTermId || sourceTermId === targetTermId) return '';
    const stripTermPrefix = (id: string) => {
      const i = id.indexOf('__');
      return i >= 0 ? id.slice(i + 2) : id;
    };
    const current: Record<RegistryTable, any[]> = { courses, faculties, rooms, groups };
    const summary: string[] = [];
    await withSync(async () => {
      for (const table of tables) {
        const source = await DataService.fetchTable<any>(table, sourceTermId);
        if (source === null) throw new Error(`Could not read ${table} from the source term — nothing was copied for it.`);
        const existingIds = new Set(current[table].map(r => r.id));
        const copies = source
          .map(r => ({ ...r, id: `${targetTermId}__${stripTermPrefix(r.id)}`, termId: targetTermId }))
          .filter(r => !existingIds.has(r.id));
        if (copies.length > 0) {
          await DataService.upsertRecords(table, copies, targetTermId);
          registrySetters[table](prev => [...prev, ...copies]);
        }
        summary.push(`${table}: ${copies.length} copied${source.length - copies.length > 0 ? `, ${source.length - copies.length} already present` : ''}`);
      }
    });
    return summary.join('\n');
  };

  // Admin: wipe a single entity table for the active term.
  // Uses DataService.clearEntity (direct DELETE only, no saveEntity pipeline)
  // so a silent Supabase failure can't restore old data via confirm-after-save.
  const handleWipeEntity = async (
    tab: 'Modules' | 'Faculties' | 'Rooms' | 'Cohorts'
  ) => {
    if (!canWrite()) return;
    const termId = effectiveActiveTerm?.id;
    const termName = effectiveActiveTerm?.name || termId || 'active term';
    if (!termId) { alert('No active term selected.'); return; }
    if (!confirm(`Delete ALL ${tab} for term "${termName}"? Other terms are not affected. \n\nNOTE: Scheduled sessions for this term will also be cleared to satisfy database requirements.`)) return;

    isSyncingRef.current = true;
    setIsSyncing(true);
    try {
      if (tab === 'Modules') {
        await DataService.clearEntity('courses', 'unitime_courses', termId);
        setCourses(prev => prev.filter((c: any) => c.termId !== termId));
      } else if (tab === 'Faculties') {
        await DataService.clearEntity('faculties', 'unitime_faculties', termId);
        setFaculties(prev => prev.filter((f: any) => f.termId !== termId));
      } else if (tab === 'Rooms') {
        await DataService.clearEntity('rooms', 'unitime_rooms', termId);
        setRooms(prev => prev.filter((r: any) => r.termId !== termId));
      } else if (tab === 'Cohorts') {
        await DataService.clearEntity('groups', 'unitime_groups', termId);
        setGroups(prev => prev.filter((g: any) => g.termId !== termId));
      }
      
      // ✅ SYNC UI: Since DataService.clearEntity also wipes the schedule for this term
      // to satisfy DB foreign keys, we MUST clear our local schedule state as well.
      const remainingSchedule = scheduleRef.current.filter((s: any) => s.termId !== termId);
      setScheduleAndRef(remainingSchedule);

    } catch (err: any) {
      alert(`Wipe failed: ${err.message || 'Unknown error'}`);
    } finally {
      setIsSyncing(false);
      setTimeout(() => { isSyncingRef.current = false; }, 2000);
    }
  };

  // Admin: delete the timetable of the ACTIVE term only. This used to delete every
  // term's sessions at once — with more than one term, that would wipe past terms.
  const handleClearSchedule = async () => {
    if (!canWrite()) return;
    const termId = activeTermIdRef.current;
    const termName = effectiveActiveTerm?.name || termId;
    if (!termId) { alert('No active term selected.'); return; }
    const totalEntries = scheduleRef.current.filter(s => s.termId === termId).length;
    if (!confirm(`Delete all ${totalEntries} timetable entries in term "${termName}"?\n\nOther terms are not affected. This cannot be undone.`)) return;
    isSyncingRef.current = true;
    setIsSyncing(true);
    try {
      await DataService.clearSchedule(termId);
      setScheduleAndRef(scheduleRef.current.filter(s => s.termId !== termId));
      undoStackRef.current = [];
      redoStackRef.current = [];
      syncHistoryState();
    } catch (err: any) {
      alert('Failed to clear schedule: ' + (err.message || 'Unknown error'));
    } finally {
      setIsSyncing(false);
      setTimeout(() => { isSyncingRef.current = false; }, 2000);
    }
  };

  // (A "re-link ALL data to the active term" function used to live here. It MOVED
  // every course/faculty/room/cohort from every term into the active one, which
  // would break a past term's timetable. It was never connected to a button and
  // has been removed; use "Copy from another term" in Data Import instead.)



  const handleExportPDF = async () => {
    setIsSyncing(true);
    try {
      const pdf = new jsPDF({
        orientation: 'landscape',
        unit: 'mm',
        format: 'a4'
      });

      const activeTerm = effectiveActiveTerm; // the term on screen, not the default one
      const dateStr = new Date().toLocaleDateString();

      // Title Page
      pdf.setFontSize(24);
      pdf.setTextColor(15, 23, 42); // slate-900
      pdf.text('University Timetable Report', 148, 60, { align: 'center' });
      
      pdf.setFontSize(14);
      pdf.setTextColor(100, 116, 139); // slate-500
      pdf.text(`Term: ${activeTerm?.name || 'All Terms'}`, 148, 75, { align: 'center' });
      pdf.text(`Generated on: ${dateStr}`, 148, 85, { align: 'center' });

      // Summary Stats
      pdf.setFontSize(18);
      pdf.setTextColor(15, 23, 42);
      pdf.text('Summary Statistics', 20, 110);
      
      const stats = [
        ['Total Courses', courses.length.toString()],
        ['Total Faculty', faculties.length.toString()],
        ['Total Rooms', rooms.length.toString()],
        ['Total Student Groups', groups.length.toString()],
        ['Scheduled Sessions', schedule.length.toString()]
      ];

      autoTable(pdf, {
        startY: 120,
        head: [['Metric', 'Count']],
        body: stats,
        theme: 'striped',
        headStyles: { fillColor: [37, 99, 235] }, // blue-600
        margin: { left: 20, right: 20 }
      });

      // Grouped Schedules by Student Group
      groups.forEach((group) => {
        const groupSchedule = schedule.filter(s => s.groupIds?.includes(group.id));
        if (groupSchedule.length === 0) return;

        pdf.addPage();
        pdf.setFontSize(16);
        pdf.setTextColor(15, 23, 42);
        pdf.text(`Timetable: ${group.name} (${group.program})`, 20, 20);
        pdf.setFontSize(10);
        pdf.text(`Semester: ${group.semester}`, 20, 28);

        const tableData = groupSchedule
          .sort((a, b) => {
            const days = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];
            if (a.day !== b.day) return days.indexOf(a.day) - days.indexOf(b.day);
            return a.startTime.localeCompare(b.startTime);
          })
          .map(s => {
            const course = courses.find(c => c.id === s.courseId);
            const room = rooms.find(r => r.id === s.roomId);
            const faculty = faculties.find(f => f.id === s.facultyId);
            return [
              s.day,
              `${s.startTime} - ${s.endTime}`,
              course ? `${course.code}: ${course.name}` : 'Unknown',
              s.category || 'Theory',
              room?.name || 'Unknown',
              faculty?.name || 'Unknown'
            ];
          });

        autoTable(pdf, {
          startY: 35,
          head: [['Day', 'Time', 'Course', 'Category', 'Room', 'Faculty']],
          body: tableData,
          theme: 'grid',
          headStyles: { fillColor: [15, 23, 42] }, // slate-900
          styles: { fontSize: 8 },
          columnStyles: {
            0: { cellWidth: 25 },
            1: { cellWidth: 35 },
            2: { cellWidth: 80 },
            3: { cellWidth: 25 },
            4: { cellWidth: 30 },
            5: { cellWidth: 40 }
          }
        });
      });

      pdf.save(`university-timetable-report-${new Date().toISOString().split('T')[0]}.pdf`);
    } catch (error) {
      console.error('PDF Report Generation failed:', error);
    } finally {
      setIsSyncing(false);
    }
  };

  const handleAutoTile = () => {
    // Create 4 panels with different view types, sized to fit the grid perfectly
    const newPanels = [
      { id: 'p1', type: 'Group' as ViewType, viewId: '', x: 10, y: 10, w: 800, h: 350, z: 1 },
      { id: 'p2', type: 'Room' as ViewType, viewId: '', x: 820, y: 10, w: 800, h: 350, z: 2 },
      { id: 'p3', type: 'Faculty' as ViewType, viewId: '', x: 10, y: 370, w: 800, h: 350, z: 3 },
      { id: 'p4', type: 'Course' as ViewType, viewId: '', x: 820, y: 370, w: 800, h: 350, z: 4 },
    ];
    setPanels(newPanels);
    maxZRef.current = 4;
    setActiveTab('builder');
  };

  const handleExportExcel = () => {
    try {
      const termSchedule = effectiveActiveTerm
        ? schedule.filter(s => s.termId === effectiveActiveTerm.id)
        : schedule;

      if (termSchedule.length === 0) {
        alert('No schedule data available to export for the active term.');
        return;
      }

      // Sort by day then start time — same order as Full Institutional Timetable in Reports
      const DAY_ORDER = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];
      const sorted = [...termSchedule].sort((a, b) => {
        const d = DAY_ORDER.indexOf(a.day) - DAY_ORDER.indexOf(b.day);
        return d !== 0 ? d : a.startTime.localeCompare(b.startTime);
      });

      const rows: any[] = [];
      sorted.forEach((s, index) => {
        const course = courses.find(c => c.id === s.courseId);
        const faculty = faculties.find(f => f.id === s.facultyId);
        const room = rooms.find(r => r.id === s.roomId);
        const sessionGroups = groups.filter(g => s.groupIds?.includes(g.id));

        const baseRow = {
          '_event_id': index + 1,
          '_day_of_week': s.day,
          '_start_time': s.startTime,
          '_end_time': s.endTime,
          '_weeks': s.weeks.join(','),
          '_event_type': s.category || 'Theory',
          'Module Unique ID': (course as any)?._unique_name || course?.code || '',
          'Module': (course as any)?._name || course?.name || '',
          'Room': (room as any)?._unique_name || room?.name || '',
          'Faculty_ID': (faculty as any)?._Faculty_ID || faculty?.id || '',
          'Faculty_Name': (faculty as any)?._Faculty_name || faculty?.name || '',
        };

        if (sessionGroups.length === 0) {
          rows.push({ ...baseRow, Cohort: '' });
        } else {
          sessionGroups.forEach(g => {
            rows.push({ ...baseRow, Cohort: (g as any)._unique_name || g.name });
          });
        }
      });

      const ws = XLSX.utils.json_to_sheet(rows);
      const wb = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(wb, ws, 'Full Timetable');
      XLSX.writeFile(wb, `Full_University_Timetable_${new Date().toISOString().split('T')[0]}.xlsx`);
    } catch (error) {
      console.error('Excel Export failed:', error);
      alert('Failed to generate export file.');
    }
  };

  const addPanel = (type: ViewType = 'Room', viewId?: string) => {
    if (panels.length < 12) {
      const newId = Date.now().toString();
      let defaultViewId = viewId;
      
      if (!defaultViewId) {
        defaultViewId = '';
      }

      setPanels([...panels, { 
        id: newId, 
        type, 
        viewId: defaultViewId || '', 
        x: 50 + (panels.length * 40), 
        y: 50 + (panels.length * 40), 
        w: 800, 
        h: 350, 
        z: ++maxZRef.current
      }]);
      setActiveTab('builder');
    }
  };

  const updatePanel = (id: string, updates: any) => {
    setPanels(prev => prev.map(p => p.id === id ? { ...p, ...updates } : p));
  };

  // Guard: If activeTab is restricted but user isn't authorized, redirect to dashboard
  useEffect(() => {
    if (!currentUser) return;
    const restrictedTabs = ['admin', 'data', 'terms'];
    if (restrictedTabs.includes(activeTab)) {
      if (activeTab === 'admin' && currentUser.role !== Role.SUPER_ADMIN) setActiveTab('dashboard');
      if (activeTab === 'data' && currentUser.role === Role.VIEWER) setActiveTab('dashboard');
      if (activeTab === 'terms' && currentUser.role === Role.VIEWER) setActiveTab('dashboard');
    }
  }, [activeTab, currentUser]);

  if (!currentUser) return <Login onLogin={(user) => { setCurrentUser(user); resetUIState(); }} users={users} />;
  
  if (!isSupabaseConfigured) {
    return <SupabaseSetup onConfigured={() => {
      setIsSupabaseConfigured(true);
      window.location.reload();
    }} />;
  }

  return (
    <div className="flex flex-col h-screen overflow-hidden relative">
      <TopNav 
        activeTab={activeTab} 
        setActiveTab={setActiveTab} 
        currentUser={currentUser}
        onLogout={() => { setCurrentUser(null); resetUIState(); }}
        isSupabaseConnected={isSupabaseConfigured}
        activeTermName={effectiveActiveTerm?.name}
        terms={terms}
        currentTermId={effectiveActiveTerm?.id}
        onSwitchTerm={switchTerm}
        onAddPanel={addPanel}
        onAutoTile={handleAutoTile}
        onRoomFinder={() => setIsRoomToolOpen(true)}
        onExportPDF={handleExportPDF}
        onExportExcel={handleExportExcel}
      />

      <main className="flex-1 relative overflow-hidden bg-[#f0f6ff]">
        <div className="h-full w-full overflow-auto custom-scrollbar">
          {activeTab === 'dashboard' && <Dashboard courses={courses} rooms={rooms} groups={groups} schedule={schedule} clashes={clashes} activeTerm={effectiveActiveTerm} faculties={faculties} />}
          {activeTab === 'builder' && (
            <div className="flex flex-col h-full">
              <div className="flex-1 relative overflow-auto custom-scrollbar">
                <div className="min-w-[2500px] min-h-[1500px] relative canvas-workspace">
                  <AnimatePresence>
                    {panels.map((panel) => (
                      <TimetablePanel 
                        key={panel.id} 
                        id={panel.id} 
                        viewType={panel.type} 
                        viewId={panel.viewId} 
                        activeTermId={effectiveActiveTerm?.id}
                        entries={schedule} 
                        rooms={rooms} 
                        faculties={faculties} 
                        groups={groups} 
                        courses={courses} 
                        x={panel.x} 
                        y={panel.y} 
                        w={panel.w} 
                        h={panel.h} 
                        z={panel.z} 
                        onRemove={() => setPanels(prev => prev.filter(p => p.id !== panel.id))}
                        onUpdateView={(type, viewId) => updatePanel(panel.id, { type, viewId })} 
                        onUpdateGeometry={(geom) => updatePanel(panel.id, geom)} 
                        onFocus={() => {
                          const newZ = ++maxZRef.current;
                          updatePanel(panel.id, { z: newZ });
                        }} 
                        onCellClick={(day, time, viewType, viewId) => {
                          const initial: Partial<ScheduleEntry> = { day, startTime: time };
                          if (viewType === 'Room') initial.roomId = viewId;
                          if (viewType === 'Faculty') initial.facultyId = viewId;
                          if (viewType === 'Group') initial.groupIds = [viewId];
                          if (viewType === 'Course') initial.courseId = viewId;
                          setModalInitialData(initial);
                          setIsModalOpen(true);
                        }} 
                        onEntryClick={(entry, cellEntries) => { 
                          setSelectedEntry(entry); 
                          setSelectedCellEntries(cellEntries || [entry]);
                          setIsDetailModalOpen(true); 
                        }}
                        onMoveEntry={handleMoveSession}
                        onDuplicateEntry={handleDuplicateSession}
                        onDeleteEntry={handleDeleteSession}
                        onPasteEntry={(entry) => handleSaveSession([entry])}
                        onCopyToPanel={handleCopyToPanel}
                        onCtrlDragCopy={handleCtrlDragCopy}
                        onUndo={handleUndo}
                        onRedo={handleRedo}
                        canUndo={canUndo}
                        canRedo={canRedo}
                        isMaximized={maximizedPanelId === panel.id}
                        onMaximize={() => setMaximizedPanelId(maximizedPanelId === panel.id ? null : panel.id)}
                        clipboard={clipboard}
                        setClipboard={setClipboard}
                      />
                    ))}
                  </AnimatePresence>
                </div>
              </div>
            </div>
          )}
          {activeTab === 'reports' && <ReportsPanel schedule={schedule} courses={courses} faculties={faculties} rooms={rooms} groups={groups} terms={terms} clashes={clashes} currentUser={currentUser} activeTermId={effectiveActiveTerm?.id} onDeleteEntry={handleDeleteSession} onDeleteMultiple={handleDeleteMultipleSessions} />}
          {activeTab === 'terms' && (currentUser.role !== Role.VIEWER) && <TermManagement terms={terms} onUpdateTerms={handleUpdateTerms} currentUser={currentUser} onViewTerm={(id) => { switchTerm(id); setActiveTab('dashboard'); }} viewingTermId={effectiveActiveTerm?.id ?? null} />}
          {activeTab === 'data' && (currentUser.role === Role.SUPER_ADMIN || currentUser.role === Role.ADMIN) && <DataImportPanel courses={courses} faculties={faculties} rooms={rooms} cohorts={groups} schedule={schedule} onUploadCourses={handleUpdateCourses} onUploadFaculties={handleUpdateFaculties} onUploadRooms={handleUpdateRooms} onUploadCohorts={handleUpdateGroups} onRestoreSchedule={handleSaveSession} onWipeData={handleWipeEntity} activeTermId={effectiveActiveTerm?.id} activeTermName={effectiveActiveTerm?.name} terms={terms} onUpdateRecord={handleUpdateRecord} onTransferFacultyLoad={handleTransferFacultyLoad} onCopyFromTerm={handleCopyRegistryFromTerm} readOnlyReason={writeBlockReason} />}
          {/* Keep AutoSchedulePanel always mounted (never unmounts on tab switch) so that
              uploaded files, generated results, and progress state are never lost. */}
          {(currentUser.role !== Role.VIEWER) && (
            <div className={`h-full ${activeTab !== 'autoschedule' ? 'hidden' : ''}`}>
              <AutoSchedulePanel courses={courses} faculties={faculties} rooms={rooms} groups={groups} terms={terms} activeTermId={effectiveActiveTerm?.id} onApplySchedule={handleSaveSession} currentUser={currentUser} schedule={schedule} />
            </div>
          )}
          {activeTab === 'admin' && currentUser.role === Role.SUPER_ADMIN && <AdminPanel users={users} onUpdateUsers={handleUpdateUsers} currentUser={currentUser} schedule={schedule} courses={courses} faculties={faculties} rooms={rooms} groups={groups} activeTermId={effectiveActiveTerm?.id} activeTermName={effectiveActiveTerm?.name} onClearSchedule={handleClearSchedule} />}
          {activeTab === 'backlog' && (currentUser.role !== Role.VIEWER) && <BacklogPanel />}
        </div>
      </main>

      <footer className="h-10 bg-white border-t border-slate-100 px-8 flex items-center justify-between z-[900]">
        <div className="flex items-center gap-6">
          <div className="flex items-center gap-2">
            <div className="w-2 h-2 rounded-full bg-green-500 animate-pulse" />
            <span className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">System Operational</span>
          </div>
          <div className="flex items-center gap-2">
            <Calendar className="w-3.5 h-3.5 text-slate-400" />
            <span className="text-[10px] font-bold text-slate-700 uppercase tracking-widest">{terms.find(t => t.isActive)?.name || 'No Active Term'}</span>
          </div>
        </div>
        
        <div className="flex items-center gap-4">
          <div className="flex items-center gap-2 text-slate-400">
            <LayoutGrid className="w-3.5 h-3.5" />
            <span className="text-[10px] font-bold uppercase tracking-widest">{panels.length} Active Panels</span>
          </div>
          <div className="w-px h-4 bg-slate-100" />
          <div className="text-[10px] font-bold text-slate-800 uppercase tracking-widest flex items-center gap-2">
            <Clock className="w-3.5 h-3.5 text-blue-600" />
            {new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
          </div>
        </div>
      </footer>

      <ClashIndicator clashes={clashes} />
      <SessionModal isOpen={isModalOpen} onClose={() => setIsModalOpen(false)} onSave={handleSaveSession} initialData={modalInitialData} courses={courses} faculties={faculties} rooms={rooms} groups={groups} existingSchedule={schedule} />
      <SessionDetailModal 
        isOpen={isDetailModalOpen} 
        onClose={() => { setIsDetailModalOpen(false); setSelectedEntry(null); setSelectedCellEntries([]); }} 
        onDelete={handleDeleteSession} 
        onUpdate={handleUpdateSession}
        entry={selectedEntry} 
        cellEntries={selectedCellEntries}
        courses={courses} 
        faculties={faculties} 
        rooms={rooms} 
        groups={groups} 
      />
      <RoomAvailabilityTool
        isOpen={isRoomToolOpen}
        onClose={() => setIsRoomToolOpen(false)}
        rooms={rooms}
        faculties={faculties}
        schedule={schedule}
        groups={groups}
        onCellDoubleClick={(resourceType, resourceId, day, time) => {
          // Open the session creation modal pre-filled with the resource + time
          const initial: Partial<ScheduleEntry> = { day, startTime: time };
          if (resourceType === 'Room') initial.roomId = resourceId;
          if (resourceType === 'Faculty') initial.facultyId = resourceId;
          if (resourceType === 'Group') initial.groupIds = [resourceId];
          setModalInitialData(initial);
          setIsModalOpen(true);
          // Also open / focus a timetable panel for that resource
          addPanel(resourceType, resourceId);
        }}
      />
    </div>
  );
};

export default App;
