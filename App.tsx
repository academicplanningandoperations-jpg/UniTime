
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
import RoomAvailabilityTool from './components/RoomAvailabilityTool';
import {
  Term, Course, Faculty, Room, StudentGroup, ScheduleEntry, Clash, Role, ViewType, UserAccount, DayOfWeek
} from './types';
import { 
  MOCK_TERMS, MOCK_COURSES, MOCK_FACULTY, MOCK_ROOMS, MOCK_GROUPS 
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
  const [panels, setPanels] = useState<any[]>([
    { id: 'p1', type: 'Group', viewId: 'g1', x: 20, y: 20, w: 800, h: 350, z: 10 },
  ]);

  const resetUIState = () => {
    setActiveTab('dashboard');
    setPanels([{ id: 'p1', type: 'Group', viewId: 'g1', x: 20, y: 20, w: 800, h: 350, z: 10 }]);
    setIsRoomToolOpen(false);
  };

  const [isSyncing, setIsSyncing] = useState(false);
  const [isRoomToolOpen, setIsRoomToolOpen] = useState(false);

  // Undo/redo stacks — stored in refs so keyboard handler always sees current value
  const undoStackRef = useRef<ScheduleEntry[][]>([]);
  const redoStackRef = useRef<ScheduleEntry[][]>([]);

  const pushHistory = () => {
    undoStackRef.current = [...undoStackRef.current.slice(-29), [...scheduleRef.current]];
    redoStackRef.current = [];
  };
  const [isSupabaseConfigured, setIsSupabaseConfigured] = useState(() => {
    const isSkipped = localStorage.getItem('unitime_skip_supabase') === 'true';
    return !!supabase || isSkipped;
  });

  const [viewingTermId, setViewingTermId] = useState<string | null>(null);

  // Initialise users from localStorage so we don't fall back to MOCK_USERS
  // when Supabase is temporarily unavailable — avoids username constraint conflicts.
  // Users are NOT cached in localStorage — Supabase is the single source of truth.
  // Caching caused ghost users to appear after Supabase deletes, breaking login.
  const [users, setUsers] = useState<UserAccount[]>(MOCK_USERS);
  // Initialise terms from localStorage so effectiveActiveTerm is the REAL term at mount,
  // not the mock one — prevents loading term-scoped data with the wrong termId.
  const [terms, setTerms] = useState<Term[]>(() => {
    try {
      const saved = localStorage.getItem('unitime_terms');
      if (saved) {
        const parsed = JSON.parse(saved);
        if (Array.isArray(parsed) && parsed.length > 0) return parsed;
      }
    } catch {}
    return MOCK_TERMS;
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

  // ✅ FIX: Mirror of `schedule` state as a ref.
  // Handlers like handleSaveSession close over the React state value at render time.
  // When two saves fire before React re-renders, the second sees the old `schedule = []`
  // and setSchedule([entryB]) silently drops entryA. Using the ref gives always-current value.
  const scheduleRef = useRef<ScheduleEntry[]>([]);

  // Update both state and ref in one call — use this everywhere instead of bare setSchedule.
  const setScheduleAndRef = (s: ScheduleEntry[]) => {
    scheduleRef.current = s;
    setSchedule(s);
  };

  // ✅ FIX: effectiveActiveTerm moved here, BEFORE the useEffect that references it.
  // Previously it was declared after the hooks (line 543), causing a
  // "Cannot access before initialization" crash in the bundled output.
  const effectiveActiveTerm = viewingTermId
    ? terms.find(t => t.id === viewingTermId)
    : terms.find(t => t.isActive);

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
          DataService.loadEntity<Term>('terms', 'unitime_terms', MOCK_TERMS),
        ]);
        setUsers(u);
        setTerms(t);

        // Step 2: Derive the real active termId from the freshly loaded terms.
        const realActiveTermId = viewingTermId
          ? t.find(term => term.id === viewingTermId)?.id
          : t.find(term => term.isActive)?.id;

        // Keep the ref current so realtime callbacks always use the correct id.
        activeTermIdRef.current = realActiveTermId;

        // Step 3: Load all term-scoped entities with the correct termId.
        const [c, f, r, g, s] = await Promise.all([
          DataService.loadEntity<Course>('courses', 'unitime_courses', [], realActiveTermId),
          DataService.loadEntity<Faculty>('faculties', 'unitime_faculties', [], realActiveTermId),
          DataService.loadEntity<Room>('rooms', 'unitime_rooms', [], realActiveTermId),
          DataService.loadEntity<StudentGroup>('groups', 'unitime_groups', [], realActiveTermId),
          DataService.loadAllEntries(realActiveTermId),
        ]);
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

    // Real-time Multi-user Synchronization — Debounced to avoid "vanishing" data race conditions.
    if (supabase) {
      // ✅ FIX: All callbacks read activeTermIdRef.current at the time they fire,
      // NOT the stale value captured when the effect first ran (which was the mock termId).
      // Per-table debounce timers — a change to 'schedule' won't delay a refresh of 'courses'.
      const debounceTimers: Record<string, any> = {};
      const debouncedRefresh = (tableName: string, refreshFn: () => Promise<void>) => {
        if (debounceTimers[tableName]) clearTimeout(debounceTimers[tableName]);
        // 5s debounce — gives bulk writes time to finish before re-reading.
        // Also skips entirely if we're actively writing (isSyncingRef) or
        // within the 10s post-write guard window.
        debounceTimers[tableName] = setTimeout(async () => {
          if (isSyncingRef.current || DataService.isWithinWriteGuard()) {
            console.log(`[RT] Skipping ${tableName} refresh — write guard active`);
            return;
          }
          await refreshFn();
        }, 5000);
      };

      // ── Realtime callbacks use Supabase-only reads (no localStorage fallback). ──
      // If Supabase is temporarily unavailable the method returns null and we skip
      // the state update — current state stays intact.
      const channel = supabase.channel('realtime_sync')
        .on('postgres_changes', { event: '*', schema: 'public', table: 'schedule' }, async () => {
          debouncedRefresh('schedule', async () => {
            const s = await DataService.fetchTable<ScheduleEntry>('schedule', activeTermIdRef.current);
            if (s !== null) setScheduleAndRef(s);
          });
        })
        .on('postgres_changes', { event: '*', schema: 'public', table: 'users' }, async () => {
          debouncedRefresh('users', async () => {
            const u = await DataService.fetchTable<UserAccount>('users');
            if (u !== null && u.length > 0) setUsers(u);
          });
        })
        .on('postgres_changes', { event: '*', schema: 'public', table: 'terms' }, async () => {
          debouncedRefresh('terms', async () => {
            const t = await DataService.fetchTable<Term>('terms');
            if (t !== null && t.length > 0) setTerms(t);
          });
        })
        .on('postgres_changes', { event: '*', schema: 'public', table: 'courses' }, async () => {
          debouncedRefresh('courses', async () => {
            const c = await DataService.fetchTable<Course>('courses', activeTermIdRef.current);
            if (c !== null) setCourses(c);
          });
        })
        .on('postgres_changes', { event: '*', schema: 'public', table: 'faculties' }, async () => {
          debouncedRefresh('faculties', async () => {
            const f = await DataService.fetchTable<Faculty>('faculties', activeTermIdRef.current);
            if (f !== null) setFaculties(f);
          });
        })
        .on('postgres_changes', { event: '*', schema: 'public', table: 'rooms' }, async () => {
          debouncedRefresh('rooms', async () => {
            const r = await DataService.fetchTable<Room>('rooms', activeTermIdRef.current);
            if (r !== null) setRooms(r);
          });
        })
        .on('postgres_changes', { event: '*', schema: 'public', table: 'groups' }, async () => {
          debouncedRefresh('groups', async () => {
            const g = await DataService.fetchTable<StudentGroup>('groups', activeTermIdRef.current);
            if (g !== null) setGroups(g);
          });
        })
        .subscribe();

      return () => {
        supabase.removeChannel(channel);
      };
    }
  }, []);

  // Keep activeTermIdRef current whenever the viewed/active term changes.
  useEffect(() => {
    activeTermIdRef.current = effectiveActiveTerm?.id;
  }, [effectiveActiveTerm?.id]);

  // Safety-net: reload all data every 30 seconds and on window focus.
  // CRITICAL: Skips refresh if a write just happened (write guard) to prevent
  // a read-before-commit from wiping freshly uploaded data.
  const refreshAllData = async () => {
    if (!supabase) return;
    if (isSyncingRef.current || DataService.isWithinWriteGuard()) {
      console.log('[App] refreshAllData skipped — write guard active');
      return;
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
      if (c !== null) setCourses(c);
      if (f !== null) setFaculties(f);
      if (r !== null) setRooms(r);
      if (g !== null) setGroups(g);
      if (s !== null) setScheduleAndRef(s);
    } catch (err) {
      console.error('[App] refreshAllData failed:', err);
    }
  };

  useEffect(() => {
    if (!supabase) return;
    const interval = setInterval(refreshAllData, 30000);
    window.addEventListener('focus', refreshAllData);
    return () => {
      clearInterval(interval);
      window.removeEventListener('focus', refreshAllData);
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

  useEffect(() => {
    if (schedule.length > 0) {
      const newClashes = DataService.detectConflicts(schedule, faculties, rooms, groups);
      setClashes(newClashes);
    } else {
      setClashes([]);
    }
  }, [schedule, faculties, rooms, groups]);

  const [isModalOpen, setIsModalOpen] = useState(false);
  const [modalInitialData, setModalInitialData] = useState<Partial<ScheduleEntry>>({});
  const [isDetailModalOpen, setIsDetailModalOpen] = useState(false);
  const [selectedEntry, setSelectedEntry] = useState<ScheduleEntry | null>(null);
  const [selectedCellEntries, setSelectedCellEntries] = useState<ScheduleEntry[]>([]);

  const [maxZ, setMaxZ] = useState(12);

  const handleSaveSession = async (newEntries: Omit<ScheduleEntry, 'id' | 'departmentId'>[]) => {
    pushHistory();
    const now = new Date().toISOString();
    const entries: ScheduleEntry[] = newEntries.map((ne, index) => ({
      ...ne,
      id: `s-${Date.now()}-${index}`,
      termId: effectiveActiveTerm?.id || ne.termId || '',
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
      // Confirm from Supabase — ensures entries are really persisted and catches
      // silent upsert failures (e.g. Supabase free-tier connection limits).
      const confirmed = await DataService.loadAllEntriesFromSupabase(effectiveActiveTerm?.id);
      if (confirmed !== null) setScheduleAndRef(confirmed);
    });
  };

  const handleDeleteSession = async (id: string) => {
    pushHistory();
    await withSync(async () => {
      const updatedSchedule = scheduleRef.current.filter(s => s.id !== id);
      setScheduleAndRef(updatedSchedule);
      await DataService.deleteEntry(id, updatedSchedule);
    });
  };

  const handleUpdateSession = async (updatedEntry: ScheduleEntry) => {
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
    pushHistory();
    await withSync(async () => {
      const duplicatedEntry: ScheduleEntry = { ...entry, id: `s-${Date.now()}-dup` };
      const updatedSchedule = [...scheduleRef.current, duplicatedEntry];
      setScheduleAndRef(updatedSchedule);
      await DataService.addEntries([duplicatedEntry], updatedSchedule);
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
      groupIds: destViewType === 'Group' && destViewId && destViewId !== '__ALL__' ? [destViewId] : entry.groupIds,
      roomId: destViewType === 'Room' && destViewId && destViewId !== '__ALL__' ? destViewId : entry.roomId,
      facultyId: destViewType === 'Faculty' && destViewId && destViewId !== '__ALL__' ? destViewId : entry.facultyId,
    };
    await handleSaveSession([newEntry]);
  };

  const handleUndo = async () => {
    if (undoStackRef.current.length === 0) return;
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
    }
  };

  const handleRedo = async () => {
    if (redoStackRef.current.length === 0) return;
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
    await withSync(async () => {
      const deletedIds = courses.filter(old => !updatedCourses.some(n => n.id === old.id)).map(c => c.id);
      setCourses(updatedCourses);
      await DataService.saveEntity('courses', 'unitime_courses', updatedCourses, effectiveActiveTerm?.id, onProgress);
      for (const id of deletedIds) await DataService.deleteRecord('courses', id);
    });
  };

  const handleUpdateFaculties = async (updatedFaculties: Faculty[], onProgress?: ProgressFn) => {
    await withSync(async () => {
      const deletedIds = faculties.filter(old => !updatedFaculties.some(n => n.id === old.id)).map(f => f.id);
      setFaculties(updatedFaculties);
      await DataService.saveEntity('faculties', 'unitime_faculties', updatedFaculties, effectiveActiveTerm?.id, onProgress);
      for (const id of deletedIds) await DataService.deleteRecord('faculties', id);
    });
  };

  const handleUpdateRooms = async (updatedRooms: Room[], onProgress?: ProgressFn) => {
    await withSync(async () => {
      const deletedIds = rooms.filter(old => !updatedRooms.some(n => n.id === old.id)).map(r => r.id);
      setRooms(updatedRooms);
      await DataService.saveEntity('rooms', 'unitime_rooms', updatedRooms, effectiveActiveTerm?.id, onProgress);
      for (const id of deletedIds) await DataService.deleteRecord('rooms', id);
    });
  };

  const handleUpdateGroups = async (updatedGroups: StudentGroup[], onProgress?: ProgressFn) => {
    await withSync(async () => {
      const deletedIds = groups.filter(old => !updatedGroups.some(n => n.id === old.id)).map(g => g.id);
      setGroups(updatedGroups);
      await DataService.saveEntity('groups', 'unitime_groups', updatedGroups, effectiveActiveTerm?.id, onProgress);
      for (const id of deletedIds) await DataService.deleteRecord('groups', id);
    });
  };



  const handleWipeAllData = async () => {
    if (!confirm('CRITICAL ACTION: This will delete ALL modules, faculty, rooms, cohorts and scheduled sessions from BOTH local storage and Supabase. Only user accounts and terms will be preserved. Proceed?')) {
      return;
    }

    isSyncingRef.current = true;
    setIsSyncing(true);
    try {
      if (supabase) {
        const tables = ['schedule', 'courses', 'faculties', 'rooms', 'groups'];
        for (const table of tables) {
          await supabase.from(table).delete().neq('id', '0');
        }
      }
      
      // Clear local state
      setScheduleAndRef([]);
      setCourses([]);
      setFaculties([]);
      setRooms([]);
      setGroups([]);
      
      // Clear local storage keys
      localStorage.removeItem('unitime_full_dataset');
      localStorage.removeItem('unitime_courses');
      localStorage.removeItem('unitime_faculties');
      localStorage.removeItem('unitime_rooms');
      localStorage.removeItem('unitime_groups');
      
      alert('System successfully reset. All demo data has been purged.');
      
      // ✅ CRITICAL RECOVERY: After a full wipe, force browser to clear the SW and Cache
      // to prevent deleted data from "reappearing" via old cached API responses.
      if ('serviceWorker' in navigator) {
        const regs = await navigator.serviceWorker.getRegistrations();
        for(let r of regs) await r.unregister();
      }
      const keys = await caches.keys();
      for(let k of keys) await caches.delete(k);
      
      window.location.replace(window.location.origin + '?wipe_complete=' + Date.now());
    } catch (err: any) {
      alert('Reset Failed: ' + (err.message || 'Unknown error.'));
    }
    setIsSyncing(false);
    setTimeout(() => { isSyncingRef.current = false; }, 4000);
  };

  // Admin: wipe a single entity table for the active term.
  // Uses DataService.clearEntity (direct DELETE only, no saveEntity pipeline)
  // so a silent Supabase failure can't restore old data via confirm-after-save.
  const handleWipeEntity = async (
    tab: 'Modules' | 'Faculties' | 'Rooms' | 'Cohorts'
  ) => {
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

  // Admin: delete ALL schedule entries across all terms.
  // No termId filter — catches old/orphaned entries (e.g. termId='t1' from mock data)
  // that would be missed if we only filtered by effectiveActiveTerm?.id.
  const handleClearSchedule = async () => {
    const totalEntries = scheduleRef.current.length;
    if (!confirm(`Delete ALL ${totalEntries} timetable entries? This cannot be undone.`)) return;
    isSyncingRef.current = true;
    setIsSyncing(true);
    try {
      await DataService.clearSchedule(); // no termId = deletes every row in schedule table
      setScheduleAndRef([]);
    } catch (err: any) {
      alert('Failed to clear schedule: ' + (err.message || 'Unknown error'));
    } finally {
      setIsSyncing(false);
      setTimeout(() => { isSyncingRef.current = false; }, 2000);
    }
  };

  // Re-tag all existing data with the active term's ID.
  // Fixes the case where data was uploaded under the mock term (id='t1') but the
  // real active term has a different ID — data exists in Supabase but nothing shows.
  const handleMigrateData = async () => {
    const termId = effectiveActiveTerm?.id;
    const termName = effectiveActiveTerm?.name || termId || 'active term';
    if (!termId) { alert('No active term selected.'); return; }
    if (!confirm(`Re-link ALL existing data to term "${termName}"?\n\nThis fixes the "data exists in Supabase but nothing shows" problem. It does not delete or re-upload anything.`)) return;
    isSyncingRef.current = true;
    setIsSyncing(true);
    try {
      const counts = await DataService.migrateDataToTerm(termId);
      const summary = Object.entries(counts).map(([t, n]) => `${t}: ${n} rows`).join(', ');
      // Reload all data so UI reflects the migration immediately
      const [c, f, r, g] = await Promise.all([
        DataService.fetchTable<Course>('courses', termId),
        DataService.fetchTable<Faculty>('faculties', termId),
        DataService.fetchTable<Room>('rooms', termId),
        DataService.fetchTable<StudentGroup>('groups', termId),
      ]);
      if (c !== null) setCourses(c);
      if (f !== null) setFaculties(f);
      if (r !== null) setRooms(r);
      if (g !== null) setGroups(g);
      alert(`Data re-linked successfully!\n${summary}`);
    } catch (err: any) {
      alert('Migration failed: ' + (err.message || 'Unknown error'));
    } finally {
      setIsSyncing(false);
      setTimeout(() => { isSyncingRef.current = false; }, 2000);
    }
  };



  const handleExportPDF = async () => {
    setIsSyncing(true);
    try {
      const pdf = new jsPDF({
        orientation: 'landscape',
        unit: 'mm',
        format: 'a4'
      });

      const activeTerm = terms.find(t => t.isActive);
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
    setMaxZ(4);
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

      const rows: any[] = [];
      termSchedule.forEach(s => {
        const course = courses.find(c => c.id === s.courseId);
        const faculty = faculties.find(f => f.id === s.facultyId);
        const room = rooms.find(r => r.id === s.roomId);
        const sessionGroups = groups.filter(g => s.groupIds?.includes(g.id));

        const baseRow = {
          '_event_id': s.id,
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
      XLSX.utils.book_append_sheet(wb, ws, 'Timetable');
      XLSX.writeFile(wb, `unitime-schedule-${new Date().toISOString().split('T')[0]}.xlsx`);
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
        z: maxZ + 1 
      }]);
      setMaxZ(maxZ + 1);
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
        onAddPanel={addPanel}
        onAutoTile={handleAutoTile}
        onRoomFinder={() => setIsRoomToolOpen(true)}
        onExportPDF={handleExportPDF}
        onExportExcel={handleExportExcel}
      />

      <main className="flex-1 relative overflow-hidden bg-slate-50">
        <div className="h-full w-full overflow-auto custom-scrollbar">
          {activeTab === 'dashboard' && <Dashboard courses={courses} rooms={rooms} groups={groups} schedule={schedule} clashes={clashes} activeTerm={effectiveActiveTerm} faculties={faculties} />}
          {activeTab === 'builder' && (
            <div className="flex flex-col h-full bg-slate-200/30">
              <div className="flex-1 relative overflow-auto shadow-inner custom-scrollbar">
                <div className="min-w-[2500px] min-h-[1500px] relative">
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
                        onRemove={() => setPanels(panels.filter(p => p.id !== panel.id))} 
                        onUpdateView={(type, viewId) => updatePanel(panel.id, { type, viewId })} 
                        onUpdateGeometry={(geom) => updatePanel(panel.id, geom)} 
                        onFocus={() => {
                          const newZ = maxZ + 1;
                          setMaxZ(newZ);
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
          {activeTab === 'reports' && <ReportsPanel schedule={schedule} courses={courses} faculties={faculties} rooms={rooms} groups={groups} terms={terms} clashes={clashes} currentUser={currentUser} activeTermId={effectiveActiveTerm?.id} onDeleteEntry={handleDeleteSession} />}
          {activeTab === 'terms' && (currentUser.role !== Role.VIEWER) && <TermManagement terms={terms} onUpdateTerms={handleUpdateTerms} currentUser={currentUser} onViewTerm={(id) => { setViewingTermId(id); setActiveTab('dashboard'); }} viewingTermId={viewingTermId} />}
          {activeTab === 'data' && (currentUser.role === Role.SUPER_ADMIN || currentUser.role === Role.ADMIN) && <DataImportPanel courses={courses} faculties={faculties} rooms={rooms} cohorts={groups} schedule={schedule} onUploadCourses={handleUpdateCourses} onUploadFaculties={handleUpdateFaculties} onUploadRooms={handleUpdateRooms} onUploadCohorts={handleUpdateGroups} onRestoreSchedule={handleSaveSession} onWipeData={handleWipeEntity} activeTermId={effectiveActiveTerm?.id} activeTermName={effectiveActiveTerm?.name} />}
          {activeTab === 'admin' && currentUser.role === Role.SUPER_ADMIN && <AdminPanel users={users} onUpdateUsers={handleUpdateUsers} currentUser={currentUser} schedule={schedule} courses={courses} faculties={faculties} rooms={rooms} groups={groups} activeTermId={effectiveActiveTerm?.id} activeTermName={effectiveActiveTerm?.name} onClearSchedule={handleClearSchedule} />}
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
