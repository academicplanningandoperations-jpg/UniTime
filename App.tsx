
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
  Term, Course, Faculty, Room, StudentGroup, ScheduleEntry, Clash, Role, ViewType, UserAccount 
} from './types';
import { 
  MOCK_TERMS, MOCK_COURSES, MOCK_FACULTY, MOCK_ROOMS, MOCK_GROUPS 
} from './constants';
import { 
  Plus, MapPin, Download, ChevronUp, ChevronDown, Calendar, LayoutGrid, Clock
} from 'lucide-react';
import jsPDF from 'jspdf';
import autoTable from 'jspdf-autotable';
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
  const [isSupabaseConfigured, setIsSupabaseConfigured] = useState(() => {
    const isSkipped = localStorage.getItem('unitime_skip_supabase') === 'true';
    return !!supabase || isSkipped;
  });

  const [viewingTermId, setViewingTermId] = useState<string | null>(null);

  // Initialise users from localStorage so we don't fall back to MOCK_USERS
  // when Supabase is temporarily unavailable — avoids username constraint conflicts.
  const [users, setUsers] = useState<UserAccount[]>(() => {
    try {
      const saved = localStorage.getItem('unitime_users');
      if (saved) {
        const parsed = JSON.parse(saved);
        if (Array.isArray(parsed) && parsed.length > 0) return parsed;
      }
    } catch {}
    return MOCK_USERS;
  });
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
        
        // 2s debounce — gives Supabase time to finish batch commits before re-fetch.
        debounceTimers[tableName] = setTimeout(async () => {
          // ✅ FIX: Explicitly ignore incoming Supabase changes if we are currently
          // performing a local write (isSyncingRef.current === true). 
          // This prevents the "vanishing data" race condition where a DELETE 
          // event from our own wipe-then-upsert cycle overwrites our local state 
          // before the UPSERT part has finished and been committed.
          if (isSyncingRef.current) {
            console.log(`Ignoring realtime ${tableName} refresh: local sync in progress.`);
            return;
          }
          await refreshFn();
        }, 2000);
      };

      // ── Realtime callbacks use Supabase-only reads (no localStorage fallback). ──
      // If Supabase is temporarily unavailable the method returns null and we skip
      // the state update — current state stays intact rather than being overwritten
      // with stale localStorage data or MOCK data (which would set activeTermIdRef
      // to 't1' and cause every subsequent query to return empty results).
      const channel = supabase.channel('realtime_sync')
        .on('postgres_changes', { event: '*', schema: 'public', table: 'schedule' }, async () => {
          debouncedRefresh('schedule', async () => {
            const s = await DataService.loadAllEntriesFromSupabase(activeTermIdRef.current);
            if (s !== null) setScheduleAndRef(s);
          });
        })
        .on('postgres_changes', { event: '*', schema: 'public', table: 'users' }, async () => {
          debouncedRefresh('users', async () => {
            const u = await DataService.loadFromSupabaseOnly<UserAccount>('users');
            if (u !== null && u.length > 0) setUsers(u);
          });
        })
        .on('postgres_changes', { event: '*', schema: 'public', table: 'terms' }, async () => {
          debouncedRefresh('terms', async () => {
            const t = await DataService.loadFromSupabaseOnly<Term>('terms');
            // Guard: only update if Supabase returned real terms — never let a
            // Supabase failure revert terms to MOCK_TERMS (which would break
            // activeTermIdRef and cause all data to appear empty).
            if (t !== null && t.length > 0) setTerms(t);
          });
        })
        .on('postgres_changes', { event: '*', schema: 'public', table: 'courses' }, async () => {
          debouncedRefresh('courses', async () => {
            const c = await DataService.loadFromSupabaseOnly<Course>('courses', activeTermIdRef.current);
            if (c !== null) setCourses(c);
          });
        })
        .on('postgres_changes', { event: '*', schema: 'public', table: 'faculties' }, async () => {
          debouncedRefresh('faculties', async () => {
            const f = await DataService.loadFromSupabaseOnly<Faculty>('faculties', activeTermIdRef.current);
            if (f !== null) setFaculties(f);
          });
        })
        .on('postgres_changes', { event: '*', schema: 'public', table: 'rooms' }, async () => {
          debouncedRefresh('rooms', async () => {
            const r = await DataService.loadFromSupabaseOnly<Room>('rooms', activeTermIdRef.current);
            if (r !== null) setRooms(r);
          });
        })
        .on('postgres_changes', { event: '*', schema: 'public', table: 'groups' }, async () => {
          debouncedRefresh('groups', async () => {
            const g = await DataService.loadFromSupabaseOnly<StudentGroup>('groups', activeTermIdRef.current);
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
  // This catches any missed realtime events (network blips, Supabase free-tier limits)
  // so data that appears to "vanish" will be recovered within 30 seconds at most.
  const refreshAllData = async () => {
    if (!supabase) return;
    const termId = activeTermIdRef.current;
    const [t, u, c, f, r, g, s] = await Promise.all([
      DataService.loadFromSupabaseOnly<Term>('terms'),
      DataService.loadFromSupabaseOnly<UserAccount>('users'),
      DataService.loadFromSupabaseOnly<Course>('courses', termId),
      DataService.loadFromSupabaseOnly<Faculty>('faculties', termId),
      DataService.loadFromSupabaseOnly<Room>('rooms', termId),
      DataService.loadFromSupabaseOnly<StudentGroup>('groups', termId),
      DataService.loadAllEntriesFromSupabase(termId),
    ]);
    if (t !== null && t.length > 0) setTerms(t);
    if (u !== null && u.length > 0) setUsers(u);
    if (c !== null) setCourses(c);
    if (f !== null) setFaculties(f);
    if (r !== null) setRooms(r);
    if (g !== null) setGroups(g);
    if (s !== null) setScheduleAndRef(s);
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
    isSyncingRef.current = true;   // set immediately, not via React state
    setIsSyncing(true);
    try {
      await fn();
    } finally {
      setIsSyncing(false);
      // ✅ FIX: Increased safety buffer to 4s (from 2s).
      // This ensures that even for large bulk uploads, the "Ignore realtime" guard
      // stays active long enough for Supabase to finish its internal indexing
      // and for all own-triggered Postgres events to be processed.
      setTimeout(() => { isSyncingRef.current = false; }, 4000);
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
      const newClashes = DataService.detectConflicts(schedule, faculties);
      setClashes(newClashes);
    } else {
      setClashes([]);
    }
  }, [schedule, faculties]);

  const [isModalOpen, setIsModalOpen] = useState(false);
  const [modalInitialData, setModalInitialData] = useState<Partial<ScheduleEntry>>({});
  const [isDetailModalOpen, setIsDetailModalOpen] = useState(false);
  const [selectedEntry, setSelectedEntry] = useState<ScheduleEntry | null>(null);
  const [selectedCellEntries, setSelectedCellEntries] = useState<ScheduleEntry[]>([]);

  const [maxZ, setMaxZ] = useState(12);

  const handleSaveSession = async (newEntries: Omit<ScheduleEntry, 'id' | 'departmentId'>[]) => {
    const entries: ScheduleEntry[] = newEntries.map((ne, index) => ({
      ...ne,
      id: `s-${Date.now()}-${index}`,
      termId: ne.termId || effectiveActiveTerm?.id || '',
      departmentId: currentUser?.departmentScope === 'All' ? 'CS' : (currentUser?.departmentScope || 'General')
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
    await withSync(async () => {
      const updatedSchedule = scheduleRef.current.filter(s => s.id !== id);
      setScheduleAndRef(updatedSchedule);
      await DataService.deleteEntry(id, updatedSchedule);
    });
  };

  const handleUpdateSession = async (updatedEntry: ScheduleEntry) => {
    await withSync(async () => {
      const updatedSchedule = scheduleRef.current.map(s => s.id === updatedEntry.id ? updatedEntry : s);
      setScheduleAndRef(updatedSchedule);
      await DataService.updateEntry(updatedEntry, updatedSchedule);
    });
  };

  const handleMoveSession = async (entryId: string, newDay: any, newStartTime: string) => {
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

        const updatedEntry = { ...entry, day: newDay, startTime: newStartTime, endTime: newEndTime };
        const updatedSchedule = scheduleRef.current.map(s => s.id === entryId ? updatedEntry : s);
        setScheduleAndRef(updatedSchedule);
        await DataService.updateEntry(updatedEntry, updatedSchedule);
      }
    });
  };

  const handleDuplicateSession = async (entry: ScheduleEntry) => {
    await withSync(async () => {
      const duplicatedEntry: ScheduleEntry = { ...entry, id: `s-${Date.now()}-dup` };
      const updatedSchedule = [...scheduleRef.current, duplicatedEntry];
      setScheduleAndRef(updatedSchedule);
      await DataService.addEntries([duplicatedEntry], updatedSchedule);
    });
  };

  const handleUpdateUsers = async (updatedUsers: UserAccount[]) => {
    await withSync(async () => {
      setUsers(updatedUsers);
      await DataService.saveEntity('users', 'unitime_users', updatedUsers);
    });
  };

  const handleUpdateTerms = async (updatedTerms: Term[]) => {
    await withSync(async () => {
      setTerms(updatedTerms);
      await DataService.saveEntity('terms', 'unitime_terms', updatedTerms);
    });
  };

  const handleUpdateCourses = async (updatedCourses: Course[]) => {
    await withSync(async () => {
      setCourses(updatedCourses);
      await DataService.saveEntity('courses', 'unitime_courses', updatedCourses, effectiveActiveTerm?.id);
      // Confirm: re-read from Supabase immediately so the UI reflects what was
      // actually committed, catching any silent batch failures.
      const confirmed = await DataService.loadFromSupabaseOnly<Course>('courses', effectiveActiveTerm?.id);
      if (confirmed !== null) setCourses(confirmed);
    });
  };

  const handleUpdateFaculties = async (updatedFaculties: Faculty[]) => {
    await withSync(async () => {
      setFaculties(updatedFaculties);
      await DataService.saveEntity('faculties', 'unitime_faculties', updatedFaculties, effectiveActiveTerm?.id);
      const confirmed = await DataService.loadFromSupabaseOnly<Faculty>('faculties', effectiveActiveTerm?.id);
      if (confirmed !== null) setFaculties(confirmed);
    });
  };

  const handleUpdateRooms = async (updatedRooms: Room[]) => {
    await withSync(async () => {
      setRooms(updatedRooms);
      await DataService.saveEntity('rooms', 'unitime_rooms', updatedRooms, effectiveActiveTerm?.id);
      const confirmed = await DataService.loadFromSupabaseOnly<Room>('rooms', effectiveActiveTerm?.id);
      if (confirmed !== null) setRooms(confirmed);
    });
  };

  const handleUpdateGroups = async (updatedGroups: StudentGroup[]) => {
    await withSync(async () => {
      setGroups(updatedGroups);
      await DataService.saveEntity('groups', 'unitime_groups', updatedGroups, effectiveActiveTerm?.id);
      const confirmed = await DataService.loadFromSupabaseOnly<StudentGroup>('groups', effectiveActiveTerm?.id);
      if (confirmed !== null) setGroups(confirmed);
    });
  };

  const handleWipeAllData = async () => {
    if (!confirm('CRITICAL ACTION: This will delete ALL courses, faculty, rooms, cohorts and scheduled sessions from BOTH local storage and Supabase. Only user accounts and terms will be preserved. Proceed?')) {
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
    tab: 'Modules' | 'Faculties' | 'Rooms' | 'Groups'
  ) => {
    const termId = effectiveActiveTerm?.id;
    const termName = effectiveActiveTerm?.name || termId || 'active term';
    if (!termId) { alert('No active term selected.'); return; }
    if (!confirm(`Delete ALL ${tab} for term "${termName}"? Other terms are not affected.`)) return;

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
      } else if (tab === 'Groups') {
        await DataService.clearEntity('groups', 'unitime_groups', termId);
        setGroups(prev => prev.filter((g: any) => g.termId !== termId));
      }
    } catch (err: any) {
      alert(`Wipe failed: ${err.message || 'Unknown error'}`);
    } finally {
      setIsSyncing(false);
      setTimeout(() => { isSyncingRef.current = false; }, 2000);
    }
  };

  // Admin: delete all schedule entries for the active term only.
  const handleClearSchedule = async () => {
    const termEntries = scheduleRef.current.filter((e: any) => e.termId === effectiveActiveTerm?.id);
    const termName = effectiveActiveTerm?.name || effectiveActiveTerm?.id || 'active term';
    if (!confirm(`Delete ALL ${termEntries.length} timetable entries for "${termName}"? This cannot be undone.`)) return;
    isSyncingRef.current = true;
    setIsSyncing(true);
    try {
      await DataService.clearSchedule(effectiveActiveTerm?.id);
      // Remove only this term's entries from local state, keep other terms intact
      const remaining = scheduleRef.current.filter((e: any) => e.termId !== effectiveActiveTerm?.id);
      setScheduleAndRef(remaining);
    } catch (err: any) {
      alert('Failed to clear schedule: ' + (err.message || 'Unknown error'));
    } finally {
      setIsSyncing(false);
      setTimeout(() => { isSyncingRef.current = false; }, 2000);
    }
  };

  const handleFullSync = async () => {
    isSyncingRef.current = true;
    setIsSyncing(true);
    try {
      // Sync in order to satisfy foreign keys
      await DataService.saveEntity('terms', 'unitime_terms', terms);
      await DataService.saveEntity('users', 'unitime_users', users);
      await DataService.saveEntity('courses', 'unitime_courses', courses);
      await DataService.saveEntity('faculties', 'unitime_faculties', faculties);
      await DataService.saveEntity('rooms', 'unitime_rooms', rooms);
      await DataService.saveEntity('groups', 'unitime_groups', groups);
      await DataService.saveEntries(schedule);
      alert('Full System Sync Successful! All local data is now mirror-synced to Supabase.');
    } catch (err: any) {
      alert('Full Sync Failed: ' + (err.message || 'Unknown error during sequential migration.'));
    }
    setIsSyncing(false);
    setTimeout(() => { isSyncingRef.current = false; }, 4000);
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
      if (!schedule || schedule.length === 0) {
        alert('No schedule data available to export.');
        return;
      }
      
      const activeTerm = terms.find(t => t.isActive);
      const headers = ['Term', 'Day', 'Start Time', 'End Time', 'Course Code', 'Course Name', 'Category', 'Room', 'Faculty', 'Student Groups', 'Weeks'];
      
      const rows = schedule.map(s => {
        const course = courses.find(c => c.id === s.courseId);
        const room = rooms.find(r => r.id === s.roomId);
        const faculty = faculties.find(f => f.id === s.facultyId);
        const selectedGroups = groups.filter(g => s.groupIds?.includes(g.id)).map(g => g.name).join('; ');
        
        return [
          activeTerm?.name || 'All',
          s.day,
          s.startTime,
          s.endTime,
          course?.code || '',
          course?.name || '',
          s.category || 'Theory',
          room?.name || '',
          faculty?.name || '',
          selectedGroups,
          s.weeks.join(', ')
        ].map(cell => `"${String(cell).replace(/"/g, '""')}"`).join(',');
      });
      
      const csvContent = [headers.join(','), ...rows].join('\n');
      const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
      const url = URL.createObjectURL(blob);
      
      const link = document.createElement('a');
      link.href = url;
      link.setAttribute('download', `unitime-schedule-${new Date().toISOString().split('T')[0]}.csv`);
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
    } catch (error) {
      console.error('CSV Export failed:', error);
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
          {activeTab === 'data' && (currentUser.role === Role.SUPER_ADMIN || currentUser.role === Role.ADMIN) && <DataImportPanel courses={courses} faculties={faculties} rooms={rooms} groups={groups} onUploadCourses={handleUpdateCourses} onUploadFaculties={handleUpdateFaculties} onUploadRooms={handleUpdateRooms} onUploadGroups={handleUpdateGroups} onWipeData={handleWipeEntity} activeTermId={effectiveActiveTerm?.id} activeTermName={effectiveActiveTerm?.name} />}
          {activeTab === 'admin' && currentUser.role === Role.SUPER_ADMIN && <AdminPanel users={users} onUpdateUsers={handleUpdateUsers} currentUser={currentUser} onFullSync={handleFullSync} onWipeAllData={handleWipeAllData} schedule={schedule} courses={courses} faculties={faculties} rooms={rooms} groups={groups} activeTermId={effectiveActiveTerm?.id} activeTermName={effectiveActiveTerm?.name} onClearSchedule={handleClearSchedule} />}
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
      <RoomAvailabilityTool isOpen={isRoomToolOpen} onClose={() => setIsRoomToolOpen(false)} rooms={rooms} schedule={schedule} groups={groups} />
    </div>
  );
};

export default App;
