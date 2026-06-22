import React, { useRef, useState, useMemo } from 'react';
import * as XLSX from 'xlsx';
import { BookOpen, User, Users, MapPin, Download, Upload, CheckCircle2, RefreshCcw, FileText, Database, Plus, Trash2, AlertTriangle, RotateCcw, Shield, Search, X } from 'lucide-react';
import { Course, Faculty, Room, StudentGroup, ScheduleEntry } from '../types';
import { motion, AnimatePresence } from 'motion/react';

type ProgressFn = (pct: number, synced: number, total: number) => void;

interface DataImportPanelProps {
  courses: Course[];
  faculties: Faculty[];
  rooms: Room[];
  cohorts: StudentGroup[];
  schedule: ScheduleEntry[];
  onUploadCourses: (data: Course[], onProgress: ProgressFn) => void;
  onUploadFaculties: (data: Faculty[], onProgress: ProgressFn) => void;
  onUploadRooms: (data: Room[], onProgress: ProgressFn) => void;
  onUploadCohorts: (data: StudentGroup[], onProgress: ProgressFn) => void;
  onRestoreSchedule: (entries: Omit<ScheduleEntry, 'id' | 'departmentId'>[]) => Promise<void>;
  onWipeData: (tab: 'Modules' | 'Faculties' | 'Rooms' | 'Cohorts') => Promise<void>;
  activeTermId?: string;
  activeTermName?: string;
}

type ImportType = 'Modules' | 'Faculties' | 'Rooms' | 'Cohorts';
type AllTabType = ImportType | 'Schedule';

const DataImportPanel: React.FC<DataImportPanelProps> = ({
  courses, faculties, rooms, cohorts, schedule,
  onUploadCourses, onUploadFaculties, onUploadRooms, onUploadCohorts,
  onRestoreSchedule, onWipeData, activeTermId, activeTermName
}) => {
  const [activeTab, setActiveTab] = useState<AllTabType>('Modules');
  const [lastUpload, setLastUpload] = useState<{ type: string; count: number } | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [activeImportType, setActiveImportType] = useState<ImportType | null>(null);
  const [newItem, setNewItem] = useState<any>({});
  const [uploadProgress, setUploadProgress] = useState<{
    active: boolean;
    type: string;
    pct: number;
    synced: number;
    total: number;
  } | null>(null);

  const scheduleFileRef = useRef<HTMLInputElement>(null);
  const [restorePreview, setRestorePreview] = useState<{
    events: Omit<ScheduleEntry, 'id' | 'departmentId'>[];
    unmatched: { modules: string[]; faculties: string[]; rooms: string[]; cohorts: string[] };
  } | null>(null);
  const [isRestoring, setIsRestoring] = useState(false);

  const templates = {
    Modules: "_module_id,_unique_name,_name,_academic_year,Semester\n1,CHCE2028_2,Chemical Technology,2025,SEM-3\n2,CS101,Intro to CS,2025,SEM-1",
    Faculties: "_staff_id,_Faculty_ID,_Faculty_name,_deptName,_email\n1,600001,SOCSVISITING 01,School of Business,SOCSVISITING01@mail.com\n2,600002,Alan Turing,Computer Science,alan@mail.com",
    Rooms: "_room_id,_unique_name,_name,_custom1,_custom2\n1,K1007,K1007,AYRQ18096,AYRQ18096\n2,L202,L202,LAB,LAB",
    Cohorts: "_cohort_id,_unique_name,_name\n1,BCOM-H-ECOM&BI-V-B1,BCOM-H-ECOM&BI-V-B1\n2,CS-Y1-A,CS-Y1-A"
  };

  // Filter displayed data to only this term
  const getTermData = (data: any[]) => {
    if (!activeTermId) return [];
    return data.filter((item: any) => item.termId === activeTermId);
  };

  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file || !activeImportType) return;
    const reader = new FileReader();
    reader.onload = (event) => {
      const text = event.target?.result as string;

      const lines = text.split(/\r?\n/).filter(line => line.trim());
      if (lines.length < 2) {
        alert("Invalid CSV format. Header row missing.");
        return;
      }

      const headers = lines[0].split(',').map(h => h.trim().replace(/^"|"$/g, ''));

      const parsedRows: any[] = [];
      for (let i = 1; i < lines.length; i++) {
        const row = lines[i];
        const regex = /(?:^|,)(?:"([^"]*(?:""[^"]*)*)"|([^",]*))/g;
        const values: string[] = [];
        let match;
        while ((match = regex.exec(row)) !== null) {
          let val = match[1] !== undefined ? match[1].replace(/""/g, '"') : match[2];
          values.push((val || "").trim());
        }

        if (values.length >= headers.length) {
          const obj: any = {};
          headers.forEach((header, index) => {
            obj[header] = values[index];
          });
          parsedRows.push(obj);
        }
      }

      const termTag = { termId: activeTermId || '' };

      const makeId = (prefix: string, raw: string | undefined, idx: number) => {
        const base = raw || `${prefix}-${Date.now()}-${idx}-${Math.random().toString(36).substr(2, 9)}`;
        return `${activeTermId || 'local'}__${base}`;
      };

      const mappedData = parsedRows.map((item, i) => {
        if (activeImportType === 'Modules') {
          // Accept both app format (_unique_name) and Supabase format (code, name)
          const uniqueName = item._unique_name || item._module_id || item.code || `M${i}`;
          const displayName = item._name || item.name || 'Unknown Module';
          return {
            ...termTag,
            id: makeId('m', uniqueName, i),
            code: uniqueName,
            name: displayName,
            academicYear: item._academic_year || item.academicYear || '2025',
            semester: Number((item.Semester || '').replace('SEM-', '')) || item.semester || 1,
            credits: item.credits || 3,
            department: item.department || 'General',
            duration: item.duration || 1,
            type: item.type || 'Theory',
            _module_id: item._module_id || item.id,
            _unique_name: item._unique_name || item.code,
            _name: item._name || item.name,
            _academic_year: item._academic_year || item.academicYear,
            Semester: item.Semester || (item.semester ? `SEM-${item.semester}` : undefined)
          };
        }
        if (activeImportType === 'Faculties') {
          // Accept both app format (_Faculty_ID) and Supabase format (facultyId, name, department)
          const facultyId = item._Faculty_ID || item._staff_id || item.facultyId || item.id;
          const displayName = item._Faculty_name || item.name || 'Unknown Faculty';
          return {
            ...termTag,
            id: makeId('f', facultyId, i),
            facultyId,
            name: displayName,
            department: item._deptName || item.department || 'General',
            email: item._email || item.email || '',
            maxHoursPerWeek: item.maxHoursPerWeek || 18,
            availability: item.availability || [],
            _staff_id: item._staff_id || item.id,
            _Faculty_ID: item._Faculty_ID || item.facultyId,
            _Faculty_name: item._Faculty_name || item.name,
            _deptName: item._deptName || item.department,
            _email: item._email || item.email
          };
        }
        if (activeImportType === 'Rooms') {
          // Accept both app format (_unique_name) and Supabase format (name, type, capacity)
          const uniqueName = item._unique_name || item._room_id || item.name || `R${i}`;
          const displayName = item._name || item._unique_name || item.name || 'Unknown Room';
          return {
            ...termTag,
            id: makeId('r', uniqueName, i),
            name: displayName,
            capacity: item.capacity || 0,
            type: item.type || item._custom1 || 'Classroom',
            _room_id: item._room_id || item.id,
            _unique_name: item._unique_name || item.name,
            _name: item._name || item.name,
            _custom1: item._custom1 || item.type,
            _custom2: item._custom2
          };
        }
        if (activeImportType === 'Cohorts') {
          // Accept both app format (_unique_name) and Supabase format (name, program, semester)
          const uniqueName = item._unique_name || item._cohort_id || item.name || `C${i}`;
          const displayName = item._name || item._unique_name || item.name || 'Unknown Cohort';
          return {
            ...termTag,
            id: makeId('g', uniqueName, i),
            name: displayName,
            program: item.program || 'General',
            semester: item.semester || 1,
            studentCount: item.studentCount || 0,
            _cohort_id: item._cohort_id || item.id,
            _unique_name: item._unique_name || item.name,
            _name: item._name || item.name
          };
        }
        return { ...termTag, ...item };
      });

      const mergeData = (existing: any[], newItems: any[]) => {
        const merged = [...existing];
        newItems.forEach(item => {
          const idx = merged.findIndex(e => e.id === item.id);
          if (idx !== -1) merged[idx] = item;
          else merged.push(item);
        });
        return merged;
      };

      const importType = activeImportType;
      const totalCount = mappedData.length;

      setUploadProgress({ active: true, type: importType, pct: 0, synced: 0, total: totalCount });

      const onProgress: ProgressFn = (pct, synced, total) => {
        setUploadProgress({ active: true, type: importType, pct, synced, total });
      };

      const onDone = () => {
        setUploadProgress(null);
        setLastUpload({ type: importType, count: totalCount });
        setTimeout(() => setLastUpload(null), 5000);
      };

      if (importType === 'Modules') {
        onUploadCourses(mergeData(courses, mappedData as any[]), onProgress);
        setTimeout(onDone, 500);
      }
      if (importType === 'Faculties') {
        onUploadFaculties(mergeData(faculties, mappedData as any[]), onProgress);
        setTimeout(onDone, 500);
      }
      if (importType === 'Rooms') {
        onUploadRooms(mergeData(rooms, mappedData as any[]), onProgress);
        setTimeout(onDone, 500);
      }
      if (importType === 'Cohorts') {
        onUploadCohorts(mergeData(cohorts, mappedData as any[]), onProgress);
        setTimeout(onDone, 500);
      }
    };
    reader.readAsText(file);
    if (fileInputRef.current) fileInputRef.current.value = '';
  };

  const deleteItem = (type: ImportType, id: string) => {
    if (type === 'Modules') onUploadCourses(courses.filter(c => c.id !== id));
    if (type === 'Faculties') onUploadFaculties(faculties.filter(f => f.id !== id));
    if (type === 'Rooms') onUploadRooms(rooms.filter(r => r.id !== id));
    if (type === 'Cohorts') onUploadCohorts(cohorts.filter(g => g.id !== id));
  };

  const clearAllData = () => {
    onWipeData(activeTab);
  };

  const makeManualId = (prefix: string, raw: string | undefined) => {
    const base = raw || `${prefix}-${Date.now()}`;
    return `${activeTermId || 'local'}__${base}`;
  };

  const addNewItem = () => {
    const termTag = { termId: activeTermId || '' };
    if (activeTab === 'Modules') {
      const uniqueName = newItem._unique_name || newItem._module_id || `M-${Date.now()}`;
      const item: any = {
        ...termTag,
        id: makeManualId('m', uniqueName),
        code: uniqueName,
        name: newItem._name || 'New Module',
        academicYear: newItem._academic_year || '2025',
        semester: Number(newItem.Semester?.replace('SEM-', '')) || 1,
        credits: 3, duration: 1, type: 'Theory',
        department: newItem.department || 'General',
        _module_id: newItem._module_id, _unique_name: newItem._unique_name,
        _name: newItem._name, _academic_year: newItem._academic_year, Semester: newItem.Semester
      };
      onUploadCourses([...courses.filter(c => c.id !== item.id), item as any]);
    } else if (activeTab === 'Faculties') {
      const item: any = {
        ...termTag,
        id: makeManualId('f', newItem._Faculty_ID || newItem._staff_id),
        facultyId: newItem._Faculty_ID || newItem._staff_id,
        name: newItem._Faculty_name || 'New Faculty',
        department: newItem._deptName || 'General',
        email: newItem._email,
        availability: [], maxHoursPerWeek: 18,
        _staff_id: newItem._staff_id, _Faculty_ID: newItem._Faculty_ID,
        _Faculty_name: newItem._Faculty_name, _deptName: newItem._deptName, _email: newItem._email
      };
      onUploadFaculties([...faculties.filter(f => f.id !== item.id), item]);
    } else if (activeTab === 'Rooms') {
      const uniqueName = newItem._unique_name || newItem._room_id || `R-${Date.now()}`;
      const item: any = {
        ...termTag,
        id: makeManualId('r', uniqueName),
        name: newItem._name || uniqueName,
        capacity: 60, type: 'Lecture',
        _room_id: newItem._room_id, _unique_name: newItem._unique_name,
        _name: newItem._name, _custom1: newItem._custom1, _custom2: newItem._custom2
      };
      onUploadRooms([...rooms.filter(r => r.id !== item.id), item]);
    } else if (activeTab === 'Cohorts') {
      const uniqueName = newItem._unique_name || newItem._cohort_id || `C-${Date.now()}`;
      const item: any = {
        ...termTag,
        id: makeManualId('g', uniqueName),
        name: newItem._name || uniqueName,
        program: 'General', semester: 1, studentCount: 30,
        _cohort_id: newItem._cohort_id, _unique_name: newItem._unique_name, _name: newItem._name
      };
      onUploadCohorts([...cohorts.filter(g => g.id !== item.id), item]);
    }
    setNewItem({});
  };

  const handleDownloadBackup = () => {
    const termSchedule = activeTermId
      ? schedule.filter(s => s.termId === activeTermId)
      : schedule;

    if (termSchedule.length === 0) {
      alert('No scheduled sessions found for the active term.');
      return;
    }

    const rows: any[] = [];
    termSchedule.forEach(s => {
      const course = courses.find(c => c.id === s.courseId);
      const faculty = faculties.find(f => f.id === s.facultyId);
      const room = rooms.find(r => r.id === s.roomId);
      const sessionGroups = cohorts.filter(g => s.groupIds?.includes(g.id));

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
        'Faculty_ID': (faculty as any)?._Faculty_ID || faculty?.facultyId || faculty?.id || '',
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
    XLSX.utils.book_append_sheet(wb, ws, 'Timetable Backup');
    const termLabel = activeTermName || activeTermId || 'term';
    XLSX.writeFile(wb, `timetable-backup-${termLabel}-${new Date().toISOString().split('T')[0]}.xlsx`);
  };

  const handleScheduleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = (event) => {
      try {
        const data = new Uint8Array(event.target?.result as ArrayBuffer);
        const wb = XLSX.read(data, { type: 'array' });
        const ws = wb.Sheets[wb.SheetNames[0]];
        const rows: any[] = XLSX.utils.sheet_to_json(ws, { defval: '' });

        const eventMap = new Map<string, any[]>();
        rows.forEach(row => {
          const eid = String(row['_event_id'] || '');
          if (!eventMap.has(eid)) eventMap.set(eid, []);
          eventMap.get(eid)!.push(row);
        });

        const unmatchedModules: string[] = [];
        const unmatchedFaculties: string[] = [];
        const unmatchedRooms: string[] = [];
        const unmatchedCohorts: string[] = [];

        const events: Omit<ScheduleEntry, 'id' | 'departmentId'>[] = [];

        eventMap.forEach((eventRows) => {
          const firstRow = eventRows[0];
          const moduleUniqueId = String(firstRow['Module Unique ID'] || '').trim();
          const facultyIdRaw = String(firstRow['Faculty_ID'] || '').trim();
          const facultyNameRaw = String(firstRow['Faculty_Name'] || '').trim();
          const roomUniqueName = String(firstRow['Room'] || '').trim();

          // ── Course lookup ──────────────────────────────────────────────
          // Try: _unique_name (CSV import field, lost after reload)
          //      code (schema-persisted, set to _unique_name during import)
          //      name match as last resort
          const course = courses.find(c =>
            (c as any)._unique_name === moduleUniqueId ||
            c.code === moduleUniqueId ||
            (moduleUniqueId && c.code?.toLowerCase() === moduleUniqueId.toLowerCase())
          );

          // ── Faculty lookup (CRITICAL FIX) ──────────────────────────────
          // Previously only checked _Faculty_ID (stripped by sanitize) and f.id (compound).
          // Now also checks f.facultyId (schema-persisted, set to _Faculty_ID during import).
          const faculty = faculties.find(f =>
            (f as any)._Faculty_ID === facultyIdRaw ||
            f.facultyId === facultyIdRaw ||
            f.id === facultyIdRaw ||
            (facultyIdRaw && f.facultyId?.toLowerCase() === facultyIdRaw.toLowerCase()) ||
            (facultyNameRaw && ((f as any)._Faculty_name === facultyNameRaw || f.name === facultyNameRaw))
          );

          // ── Room lookup ────────────────────────────────────────────────
          // _unique_name is lost after reload but r.name was set to _name || _unique_name
          const room = rooms.find(r =>
            (r as any)._unique_name === roomUniqueName ||
            r.name === roomUniqueName ||
            (roomUniqueName && r.name?.toLowerCase() === roomUniqueName.toLowerCase())
          );

          if (!course && moduleUniqueId && !unmatchedModules.includes(moduleUniqueId))
            unmatchedModules.push(moduleUniqueId);
          if (!faculty && facultyIdRaw && !unmatchedFaculties.includes(facultyIdRaw))
            unmatchedFaculties.push(facultyIdRaw);
          if (!room && roomUniqueName && !unmatchedRooms.includes(roomUniqueName))
            unmatchedRooms.push(roomUniqueName);

          // ── Cohort lookup ──────────────────────────────────────────────
          const groupIds: string[] = [];
          eventRows.forEach(row => {
            const cohortName = String(row['Cohort'] || '').trim();
            if (cohortName) {
              const group = cohorts.find(g =>
                (g as any)._unique_name === cohortName ||
                g.name === cohortName ||
                (cohortName && g.name?.toLowerCase() === cohortName.toLowerCase())
              );
              if (group) {
                if (!groupIds.includes(group.id)) groupIds.push(group.id);
              } else if (!unmatchedCohorts.includes(cohortName)) {
                unmatchedCohorts.push(cohortName);
              }
            }
          });

          const weeksStr = String(firstRow['_weeks'] || '').trim();
          const weeks = weeksStr
            ? weeksStr.split(',').map((w: string) => parseInt(w.trim())).filter((w: number) => !isNaN(w))
            : [1];

          events.push({
            termId: activeTermId || '',
            courseId: course?.id || '',
            facultyId: faculty?.id || '',
            roomId: room?.id || '',
            groupIds,
            day: firstRow['_day_of_week'] as any,
            startTime: firstRow['_start_time'],
            endTime: firstRow['_end_time'],
            weeks: weeks.length > 0 ? weeks : [1],
            category: firstRow['_event_type'] as any,
          });
        });

        // ── Validation: warn if most events have empty foreign keys ────
        const emptyCourseCt = events.filter(e => !e.courseId).length;
        const emptyFacultyCt = events.filter(e => !e.facultyId).length;
        const emptyRoomCt = events.filter(e => !e.roomId).length;
        const total = events.length;
        const hasBlankWarning = emptyCourseCt > total * 0.5 || emptyFacultyCt > total * 0.5 || emptyRoomCt > total * 0.5;

        setRestorePreview({
          events,
          unmatched: {
            modules: unmatchedModules,
            faculties: unmatchedFaculties,
            rooms: unmatchedRooms,
            cohorts: unmatchedCohorts,
          }
        });

        if (hasBlankWarning) {
          const parts: string[] = [];
          if (emptyCourseCt > 0) parts.push(`${emptyCourseCt}/${total} events have no matching module`);
          if (emptyFacultyCt > 0) parts.push(`${emptyFacultyCt}/${total} events have no matching faculty`);
          if (emptyRoomCt > 0) parts.push(`${emptyRoomCt}/${total} events have no matching room`);
          alert(`⚠️ Backup Match Warning:\n\n${parts.join('\n')}\n\nThis usually means the resource data was reloaded from Supabase and lost custom CSV fields. Check the unmatched list in the preview panel.`);
        }
      } catch {
        alert('Failed to parse file. Please upload a valid timetable backup Excel (.xlsx) file.');
      }
    };
    reader.readAsArrayBuffer(file);
    if (scheduleFileRef.current) scheduleFileRef.current.value = '';
  };

  const handleConfirmRestore = async () => {
    if (!restorePreview) return;
    setIsRestoring(true);
    try {
      await onRestoreSchedule(restorePreview.events);
      setRestorePreview(null);
      alert(`Successfully restored ${restorePreview.events.length} sessions.`);
    } catch {
      alert('Restore failed. Please try again.');
    } finally {
      setIsRestoring(false);
    }
  };

  const getIcon = (type: AllTabType) => {
    switch (type) {
      case 'Modules': return <BookOpen className="w-4 h-4" />;
      case 'Faculties': return <User className="w-4 h-4" />;
      case 'Rooms': return <MapPin className="w-4 h-4" />;
      case 'Cohorts': return <Users className="w-4 h-4" />;
      case 'Schedule': return <Shield className="w-4 h-4" />;
    }
  };

  const [searchQuery, setSearchQuery] = useState('');
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());

  const allData: any[] = activeTab === 'Modules' ? courses : activeTab === 'Faculties' ? faculties : activeTab === 'Rooms' ? rooms : activeTab === 'Cohorts' ? cohorts : [];
  const currentData = activeTab === 'Schedule' ? [] : getTermData(allData);

  const filteredData = useMemo(() => {
    if (!searchQuery.trim()) return currentData;
    const q = searchQuery.toLowerCase();
    return currentData.filter((item: any) => {
      if (activeTab === 'Modules') {
        return (item._unique_name || item.code || '').toLowerCase().includes(q)
          || (item._name || item.name || '').toLowerCase().includes(q)
          || (item._academic_year || item.academicYear || '').toString().includes(q)
          || (item.Semester || `SEM-${item.semester || 1}`).toLowerCase().includes(q)
          || (item.department || '').toLowerCase().includes(q);
      }
      if (activeTab === 'Faculties') {
        return (item._Faculty_ID || item.facultyId || '').toLowerCase().includes(q)
          || (item._Faculty_name || item.name || '').toLowerCase().includes(q)
          || (item._deptName || item.department || '').toLowerCase().includes(q)
          || (item._email || item.email || '').toLowerCase().includes(q);
      }
      if (activeTab === 'Rooms') {
        return (item._unique_name || item.name || '').toLowerCase().includes(q)
          || (item._name || item.name || '').toLowerCase().includes(q)
          || (item._custom1 || '').toLowerCase().includes(q)
          || (item._custom2 || '').toLowerCase().includes(q);
      }
      if (activeTab === 'Cohorts') {
        return (item._unique_name || item.name || '').toLowerCase().includes(q)
          || (item._name || item.name || '').toLowerCase().includes(q);
      }
      return true;
    });
  }, [currentData, searchQuery, activeTab]);

  const allFilteredSelected = filteredData.length > 0 && filteredData.every((item: any) => selectedIds.has(item.id));

  const toggleSelectAll = () => {
    if (allFilteredSelected) {
      const next = new Set(selectedIds);
      filteredData.forEach((item: any) => next.delete(item.id));
      setSelectedIds(next);
    } else {
      const next = new Set(selectedIds);
      filteredData.forEach((item: any) => next.add(item.id));
      setSelectedIds(next);
    }
  };

  const toggleSelect = (id: string) => {
    const next = new Set(selectedIds);
    if (next.has(id)) next.delete(id); else next.add(id);
    setSelectedIds(next);
  };

  const deleteSelected = () => {
    if (selectedIds.size === 0) return;
    if (!window.confirm(`Delete ${selectedIds.size} selected record(s)? This cannot be undone.`)) return;
    const ids = selectedIds;
    if (activeTab === 'Modules') onUploadCourses(courses.filter(c => !ids.has(c.id)));
    if (activeTab === 'Faculties') onUploadFaculties(faculties.filter(f => !ids.has(f.id)));
    if (activeTab === 'Rooms') onUploadRooms(rooms.filter(r => !ids.has(r.id)));
    if (activeTab === 'Cohorts') onUploadCohorts(cohorts.filter(g => !ids.has(g.id)));
    setSelectedIds(new Set());
  };

  const handleDownloadData = () => {
    if (currentData.length === 0) { alert(`No ${activeTab} data to export.`); return; }

    const esc = (v: any) => `"${String(v ?? '').replace(/"/g, '""')}"`;

    let headers: string[] = [];
    let rows: string[][] = [];

    if (activeTab === 'Modules') {
      headers = ['_module_id', '_unique_name', '_name', '_academic_year', 'Semester'];
      rows = currentData.map((item: any) => [
        item._module_id || item.code || '',
        item._unique_name || item.code || '',
        item._name || item.name || '',
        item._academic_year || item.academicYear || '2025',
        item.Semester || (item.semester ? `SEM-${item.semester}` : 'SEM-1'),
      ]);
    } else if (activeTab === 'Faculties') {
      headers = ['_staff_id', '_Faculty_ID', '_Faculty_name', '_deptName', '_email'];
      rows = currentData.map((item: any) => [
        item._staff_id || '',
        item._Faculty_ID || item.facultyId || '',
        item._Faculty_name || item.name || '',
        item._deptName || item.department || '',
        item._email || item.email || '',
      ]);
    } else if (activeTab === 'Rooms') {
      headers = ['_room_id', '_unique_name', '_name', '_custom1', '_custom2'];
      rows = currentData.map((item: any) => [
        item._room_id || '',
        item._unique_name || item.name || '',
        item._name || item.name || '',
        item._custom1 || '',
        item._custom2 || '',
      ]);
    } else if (activeTab === 'Cohorts') {
      headers = ['_cohort_id', '_unique_name', '_name'];
      rows = currentData.map((item: any) => [
        item._cohort_id || '',
        item._unique_name || item.name || '',
        item._name || item.name || '',
      ]);
    }

    const csv = [headers.map(esc).join(','), ...rows.map(r => r.map(esc).join(','))].join('\n');
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${activeTab.toLowerCase()}-export-${activeTermName || activeTermId || 'term'}-${new Date().toISOString().split('T')[0]}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const checkboxTh = (
    <th className="px-3 py-2 w-8">
      <input
        type="checkbox"
        checked={allFilteredSelected}
        onChange={toggleSelectAll}
        className="w-3.5 h-3.5 accent-[#185baf] cursor-pointer"
        title="Select all visible"
      />
    </th>
  );

  const renderTableHeaders = () => {
    if (activeTab === 'Modules') return (
      <tr>
        {checkboxTh}
        <th className="px-3 py-2 text-[11px] font-bold text-[#185baf] uppercase">Module ID (Unique)</th>
        <th className="px-3 py-2 text-[11px] font-bold text-[#333] uppercase">_name</th>
        <th className="px-3 py-2 text-[11px] font-bold text-[#333] uppercase">_academic_year</th>
        <th className="px-3 py-2 text-[11px] font-bold text-[#333] uppercase">Semester</th>
        <th className="px-3 py-2 text-[11px] font-bold text-[#333] uppercase text-right">Actions</th>
      </tr>
    );
    if (activeTab === 'Faculties') return (
      <tr>
        {checkboxTh}
        <th className="px-3 py-2 text-[11px] font-bold text-[#185baf] uppercase">Faculty ID</th>
        <th className="px-3 py-2 text-[11px] font-bold text-[#333] uppercase">_Faculty_name</th>
        <th className="px-3 py-2 text-[11px] font-bold text-[#333] uppercase">_deptName</th>
        <th className="px-3 py-2 text-[11px] font-bold text-[#333] uppercase">_email</th>
        <th className="px-3 py-2 text-[11px] font-bold text-[#333] uppercase text-right">Actions</th>
      </tr>
    );
    if (activeTab === 'Rooms') return (
      <tr>
        {checkboxTh}
        <th className="px-3 py-2 text-[11px] font-bold text-[#185baf] uppercase">Room ID (Unique)</th>
        <th className="px-3 py-2 text-[11px] font-bold text-[#333] uppercase">_name</th>
        <th className="px-3 py-2 text-[11px] font-bold text-[#333] uppercase">_custom1</th>
        <th className="px-3 py-2 text-[11px] font-bold text-[#333] uppercase">_custom2</th>
        <th className="px-3 py-2 text-[11px] font-bold text-[#333] uppercase text-right">Actions</th>
      </tr>
    );
    return (
      <tr>
        {checkboxTh}
        <th className="px-3 py-2 text-[11px] font-bold text-[#185baf] uppercase">Cohort ID (Unique)</th>
        <th className="px-3 py-2 text-[11px] font-bold text-[#333] uppercase">_name</th>
        <th className="px-3 py-2 text-[11px] font-bold text-[#333] uppercase text-right">Actions</th>
      </tr>
    );
  };

  const renderTableRows = () => {
    return filteredData.map((item: any) => (
      <tr key={item.id}
        className={`transition-colors divide-x divide-[#eee] text-xs text-[#333] ${selectedIds.has(item.id) ? 'bg-[#eaf2ff]' : 'hover:bg-[#f5f5f5]'}`}>
        <td className="px-3 py-2 w-8">
          <input
            type="checkbox"
            checked={selectedIds.has(item.id)}
            onChange={() => toggleSelect(item.id)}
            className="w-3.5 h-3.5 accent-[#185baf] cursor-pointer"
          />
        </td>
        {activeTab === 'Modules' && (<>
          <td className="px-3 py-2 font-bold text-[#185baf]">{item._unique_name || item.code || item.id}</td>
          <td className="px-3 py-2">{item._name || item.name}</td>
          <td className="px-3 py-2">{item._academic_year || item.academicYear || 2025}</td>
          <td className="px-3 py-2">{item.Semester || `SEM-${item.semester || 1}`}</td>
        </>)}
        {activeTab === 'Faculties' && (<>
          <td className="px-3 py-2 font-bold text-[#185baf]">{item._Faculty_ID || item.facultyId || item.id}</td>
          <td className="px-3 py-2">{item._Faculty_name || item.name}</td>
          <td className="px-3 py-2">{item._deptName || item.department}</td>
          <td className="px-3 py-2">{item._email || item.email || '-'}</td>
        </>)}
        {activeTab === 'Rooms' && (<>
          <td className="px-3 py-2 font-bold text-[#185baf]">{item._unique_name || item.name || item.id}</td>
          <td className="px-3 py-2">{item._name || item.name}</td>
          <td className="px-3 py-2">{item._custom1 || '-'}</td>
          <td className="px-3 py-2">{item._custom2 || '-'}</td>
        </>)}
        {activeTab === 'Cohorts' && (<>
          <td className="px-3 py-2 font-bold text-[#185baf]">{item._unique_name || item.name || item.id}</td>
          <td className="px-3 py-2">{item._name || item.name}</td>
        </>)}
        <td className="px-3 py-2 text-right">
          <button onClick={() => deleteItem(activeTab as ImportType, item.id)}
            className="p-1.5 text-[#ac2925] hover:bg-[#ebd5d5] border border-transparent hover:border-[#ac2925] transition-all"
            title="Delete Record">
            <Trash2 className="w-3.5 h-3.5" />
          </button>
        </td>
      </tr>
    ));
  };

  const renderManualEntryForm = () => {
    if (activeTab === 'Modules') return (
      <div className="space-y-3">
        <label className="text-[11px] font-bold text-[#185baf] uppercase">_unique_name (Module ID) *</label>
        <input type="text" value={newItem._unique_name || ''} onChange={e => setNewItem({...newItem, _unique_name: e.target.value})} className="w-full bg-white border border-[#ccc] px-2 py-1.5 focus:border-[#185baf] outline-none text-xs" placeholder="e.g. CHCE2028_2" />
        <label className="text-[11px] font-bold text-[#333] uppercase">_name</label>
        <input type="text" value={newItem._name || ''} onChange={e => setNewItem({...newItem, _name: e.target.value})} className="w-full bg-white border border-[#ccc] px-2 py-1.5 focus:border-[#185baf] outline-none text-xs" placeholder="e.g. Chemical Technology" />
        <label className="text-[11px] font-bold text-[#333] uppercase">_academic_year</label>
        <input type="text" value={newItem._academic_year || ''} onChange={e => setNewItem({...newItem, _academic_year: e.target.value})} className="w-full bg-white border border-[#ccc] px-2 py-1.5 focus:border-[#185baf] outline-none text-xs" placeholder="e.g. 2025" />
        <label className="text-[11px] font-bold text-[#333] uppercase">Department</label>
        <input type="text" value={newItem.department || ''} onChange={e => setNewItem({...newItem, department: e.target.value})} className="w-full bg-white border border-[#ccc] px-2 py-1.5 focus:border-[#185baf] outline-none text-xs" placeholder="e.g. Computer Science" />
        <label className="text-[11px] font-bold text-[#333] uppercase">Semester</label>
        <input type="text" value={newItem.Semester || ''} onChange={e => setNewItem({...newItem, Semester: e.target.value})} className="w-full bg-white border border-[#ccc] px-2 py-1.5 focus:border-[#185baf] outline-none text-xs" placeholder="e.g. SEM-1" />
      </div>
    );
    if (activeTab === 'Faculties') return (
      <div className="space-y-3">
        <label className="text-[11px] font-bold text-[#185baf] uppercase">_Faculty_ID (Faculty ID) *</label>
        <input type="text" value={newItem._Faculty_ID || ''} onChange={e => setNewItem({...newItem, _Faculty_ID: e.target.value})} className="w-full bg-white border border-[#ccc] px-2 py-1.5 focus:border-[#185baf] outline-none text-xs" placeholder="e.g. 600001" />
        <label className="text-[11px] font-bold text-[#333] uppercase">_staff_id (serial)</label>
        <input type="text" value={newItem._staff_id || ''} onChange={e => setNewItem({...newItem, _staff_id: e.target.value})} className="w-full bg-white border border-[#ccc] px-2 py-1.5 focus:border-[#185baf] outline-none text-xs" />
        <label className="text-[11px] font-bold text-[#333] uppercase">_Faculty_name</label>
        <input type="text" value={newItem._Faculty_name || ''} onChange={e => setNewItem({...newItem, _Faculty_name: e.target.value})} className="w-full bg-white border border-[#ccc] px-2 py-1.5 focus:border-[#185baf] outline-none text-xs" />
        <label className="text-[11px] font-bold text-[#333] uppercase">_deptName</label>
        <input type="text" value={newItem._deptName || ''} onChange={e => setNewItem({...newItem, _deptName: e.target.value})} className="w-full bg-white border border-[#ccc] px-2 py-1.5 focus:border-[#185baf] outline-none text-xs" />
        <label className="text-[11px] font-bold text-[#333] uppercase">_email</label>
        <input type="email" value={newItem._email || ''} onChange={e => setNewItem({...newItem, _email: e.target.value})} className="w-full bg-white border border-[#ccc] px-2 py-1.5 focus:border-[#185baf] outline-none text-xs" />
      </div>
    );
    if (activeTab === 'Rooms') return (
      <div className="space-y-3">
        <label className="text-[11px] font-bold text-[#185baf] uppercase">_unique_name (Room ID) *</label>
        <input type="text" value={newItem._unique_name || ''} onChange={e => setNewItem({...newItem, _unique_name: e.target.value})} className="w-full bg-white border border-[#ccc] px-2 py-1.5 focus:border-[#185baf] outline-none text-xs" placeholder="e.g. K1007" />
        <label className="text-[11px] font-bold text-[#333] uppercase">_name</label>
        <input type="text" value={newItem._name || ''} onChange={e => setNewItem({...newItem, _name: e.target.value})} className="w-full bg-white border border-[#ccc] px-2 py-1.5 focus:border-[#185baf] outline-none text-xs" placeholder="e.g. K1007" />
        <label className="text-[11px] font-bold text-[#333] uppercase">_custom1</label>
        <input type="text" value={newItem._custom1 || ''} onChange={e => setNewItem({...newItem, _custom1: e.target.value})} className="w-full bg-white border border-[#ccc] px-2 py-1.5 focus:border-[#185baf] outline-none text-xs" />
        <label className="text-[11px] font-bold text-[#333] uppercase">_custom2</label>
        <input type="text" value={newItem._custom2 || ''} onChange={e => setNewItem({...newItem, _custom2: e.target.value})} className="w-full bg-white border border-[#ccc] px-2 py-1.5 focus:border-[#185baf] outline-none text-xs" />
      </div>
    );
    return (
      <div className="space-y-3">
        <label className="text-[11px] font-bold text-[#185baf] uppercase">_unique_name (Cohort ID) *</label>
        <input type="text" value={newItem._unique_name || ''} onChange={e => setNewItem({...newItem, _unique_name: e.target.value})} className="w-full bg-white border border-[#ccc] px-2 py-1.5 focus:border-[#185baf] outline-none text-xs" placeholder="e.g. BCOM-H-ECOM&BI-V-B1" />
        <label className="text-[11px] font-bold text-[#333] uppercase">_name</label>
        <input type="text" value={newItem._name || ''} onChange={e => setNewItem({...newItem, _name: e.target.value})} className="w-full bg-white border border-[#ccc] px-2 py-1.5 focus:border-[#185baf] outline-none text-xs" placeholder="e.g. BCOM-H-ECOM&BI-V-B1" />
      </div>
    );
  };

  return (
    <div className="space-y-6 p-2 w-full">

      {/* Upload Progress Bar */}
      <AnimatePresence>
        {uploadProgress && (
          <motion.div
            initial={{ opacity: 0, y: -10 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -10 }}
            className="fixed top-4 left-1/2 -translate-x-1/2 z-[9999] w-full max-w-lg px-4"
          >
            <div className="bg-white border-2 border-[#185baf] shadow-2xl p-4 rounded">
              <div className="flex items-center justify-between mb-2">
                <span className="text-[11px] font-black uppercase tracking-widest text-[#185baf]">
                  Uploading {uploadProgress.type} to Supabase...
                </span>
                <span className="text-[11px] font-black text-[#185baf]">{uploadProgress.pct}%</span>
              </div>
              <div className="w-full bg-[#e0e0e0] h-3 rounded overflow-hidden">
                <motion.div
                  className="h-3 bg-[#185baf] rounded"
                  initial={{ width: 0 }}
                  animate={{ width: `${uploadProgress.pct}%` }}
                  transition={{ duration: 0.3 }}
                />
              </div>
              <div className="flex justify-between mt-1.5">
                <span className="text-[10px] text-[#666] font-bold">
                  {uploadProgress.synced} / {uploadProgress.total} rows synced
                </span>
                <span className="text-[10px] text-[#999] font-bold">
                  Please wait — do not close this tab
                </span>
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4 border-b-2 border-[#185baf] pb-2">
        <div>
          <h2 className="text-xl font-bold text-[#333] tracking-tight">Resource Management</h2>
          <p className="text-sm font-medium text-[#666]">Configure institutional data manually or via bulk CSV upload.</p>
          {activeTermId ? (
            <div className="mt-1.5 flex items-center gap-2 px-3 py-1.5 bg-blue-50 border border-blue-200 text-blue-800 text-[11px] font-bold uppercase tracking-wide w-fit">
              <Database className="w-3.5 h-3.5" />
              Editing data for: {activeTermName || activeTermId}
              <span className="text-blue-500 font-normal normal-case tracking-normal ml-1">— strictly isolated to this term</span>
            </div>
          ) : (
            <div className="mt-1.5 flex items-center gap-2 px-3 py-1.5 bg-yellow-50 border border-yellow-300 text-yellow-800 text-[11px] font-bold w-fit">
              <AlertTriangle className="w-3.5 h-3.5" />
              No active term. Go to Terms tab and set one as active first.
            </div>
          )}
        </div>
        <div className="flex items-center gap-3">
          <AnimatePresence>
            {lastUpload && (
              <motion.div
                initial={{ opacity: 0, x: 20 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: 20 }}
                className="flex items-center gap-2 bg-[#dff0d8] text-[#3c763d] px-3 py-1.5 border border-[#d6e9c6] text-sm font-bold shadow"
              >
                <CheckCircle2 className="w-4 h-4" />
                Imported {lastUpload.count} {lastUpload.type}
              </motion.div>
            )}
          </AnimatePresence>
          {activeTab !== 'Schedule' && (
            <button onClick={clearAllData} disabled={!activeTermId}
              className="flex items-center gap-2 px-3 py-1.5 text-[#ac2925] hover:bg-[#ebd5d5] font-bold text-sm transition-colors border border-transparent hover:border-[#ac2925] disabled:opacity-40 disabled:cursor-not-allowed">
              <RefreshCcw className="w-4 h-4" />
              Wipe {activeTab}
            </button>
          )}
        </div>
      </div>

      <div className="flex bg-[#f0f6ff] border-b-2 border-[#c8ddf8] w-full shadow-sm">
        {(['Modules', 'Faculties', 'Rooms', 'Cohorts', 'Schedule'] as AllTabType[]).map(t => (
          <button key={t} onClick={() => { setActiveTab(t); setRestorePreview(null); setSearchQuery(''); setSelectedIds(new Set()); }}
            className={`flex items-center gap-2 px-6 py-2.5 text-sm font-bold transition-all border-r border-[#c8ddf8] ${
              activeTab === t
                ? 'bg-white text-[#185baf] border-t-2 border-t-[#185baf]'
                : 'text-[#5a7ba8] hover:bg-[#e4effc] border-t-2 border-t-transparent'
            }`}>
            <span className={activeTab === t ? 'text-[#185baf]' : 'text-[#666]'}>{getIcon(t)}</span>
            {t}
          </button>
        ))}
      </div>

      {activeTab === 'Schedule' && (
        <div className="space-y-6 pb-12 mt-2">
          {/* Backup Download */}
          <div className="bg-white border border-[#c8ddf8] shadow-sm">
            <div className="text-white px-4 py-2.5 flex items-center gap-2" style={{ background: 'linear-gradient(135deg, #0f3d8c, #185baf)' }}>
              <Download className="w-4 h-4" />
              <h3 className="font-bold text-[13px] uppercase tracking-wide">Daily Schedule Backup</h3>
            </div>
            <div className="p-5 flex flex-col md:flex-row md:items-center gap-4">
              <div className="flex-1">
                <p className="text-sm text-[#555] leading-relaxed">
                  Download the complete schedule for the active term as a canonical Excel file.
                  Save this file daily — if timetable data is lost, upload it below to restore everything.
                </p>
                <p className="text-[11px] text-[#888] mt-1 font-bold uppercase tracking-wide">
                  {activeTermId
                    ? `${(schedule.filter(s => s.termId === activeTermId).length)} sessions in active term`
                    : 'No active term selected'}
                </p>
              </div>
              <button
                onClick={handleDownloadBackup}
                disabled={!activeTermId}
                className="btn-primary flex items-center gap-2 px-5 py-2.5 font-bold whitespace-nowrap disabled:opacity-40 disabled:cursor-not-allowed"
              >
                <Download className="w-4 h-4" />
                Download Backup (.xlsx)
              </button>
            </div>
          </div>

          {/* Restore from Backup */}
          <div className="bg-white border border-[#c8ddf8] shadow-sm">
            <div className="text-white px-4 py-2.5 flex items-center gap-2" style={{ background: 'linear-gradient(135deg, #2d5f8a, #3b82b8)' }}>
              <RotateCcw className="w-4 h-4" />
              <h3 className="font-bold text-[13px] uppercase tracking-wide">Restore from Backup</h3>
            </div>
            <div className="p-5 space-y-4">
              <p className="text-sm text-[#555] leading-relaxed">
                Upload a previously downloaded backup file to recreate the schedule.
                Existing sessions will <strong>not</strong> be deleted — only new entries are added.
                Resources (modules, rooms, faculty, cohorts) must already exist in this term's registry.
              </p>

              {!restorePreview ? (
                <button
                  onClick={() => scheduleFileRef.current?.click()}
                  disabled={!activeTermId}
                  className="flex items-center gap-2 px-5 py-2.5 bg-[#f0f0f0] border-2 border-dashed border-[#bbb] text-[#555] font-bold text-sm hover:bg-[#e8e8e8] hover:border-[#185baf] hover:text-[#185baf] transition-all disabled:opacity-40 disabled:cursor-not-allowed w-full justify-center"
                >
                  <Upload className="w-4 h-4" />
                  Select Backup Excel File (.xlsx) to Preview
                </button>
              ) : (
                <div className="space-y-4">
                  {/* Preview Summary */}
                  <div className="bg-[#f8f9fa] border border-[#ccc] p-4 space-y-3">
                    <div className="flex items-center gap-2">
                      <CheckCircle2 className="w-4 h-4 text-green-600" />
                      <span className="text-sm font-bold text-[#333]">
                        {restorePreview.events.length} events parsed from backup file
                      </span>
                    </div>

                    {(restorePreview.unmatched.modules.length > 0 ||
                      restorePreview.unmatched.faculties.length > 0 ||
                      restorePreview.unmatched.rooms.length > 0 ||
                      restorePreview.unmatched.cohorts.length > 0) && (
                      <div className="border border-[#f0ad4e] bg-[#fcf8e3] p-3 space-y-2">
                        <div className="flex items-center gap-2 text-[#8a6d3b] font-bold text-[11px] uppercase">
                          <AlertTriangle className="w-3.5 h-3.5" />
                          Unmatched resources — these sessions will have blank fields:
                        </div>
                        {restorePreview.unmatched.modules.length > 0 && (
                          <div className="text-[11px] text-[#8a6d3b]">
                            <span className="font-bold">Modules:</span> {restorePreview.unmatched.modules.join(', ')}
                          </div>
                        )}
                        {restorePreview.unmatched.faculties.length > 0 && (
                          <div className="text-[11px] text-[#8a6d3b]">
                            <span className="font-bold">Faculty IDs:</span> {restorePreview.unmatched.faculties.join(', ')}
                          </div>
                        )}
                        {restorePreview.unmatched.rooms.length > 0 && (
                          <div className="text-[11px] text-[#8a6d3b]">
                            <span className="font-bold">Rooms:</span> {restorePreview.unmatched.rooms.join(', ')}
                          </div>
                        )}
                        {restorePreview.unmatched.cohorts.length > 0 && (
                          <div className="text-[11px] text-[#8a6d3b]">
                            <span className="font-bold">Cohorts:</span> {restorePreview.unmatched.cohorts.join(', ')}
                          </div>
                        )}
                      </div>
                    )}
                  </div>

                  <div className="flex gap-3">
                    <button
                      onClick={handleConfirmRestore}
                      disabled={isRestoring || restorePreview.events.length === 0}
                      className="btn-primary flex items-center gap-2 px-5 py-2.5 font-bold disabled:opacity-40 disabled:cursor-not-allowed"
                    >
                      <CheckCircle2 className="w-4 h-4" />
                      {isRestoring ? 'Restoring...' : `Confirm — Add ${restorePreview.events.length} Sessions`}
                    </button>
                    <button
                      onClick={() => setRestorePreview(null)}
                      className="btn-secondary flex items-center gap-2 px-5 py-2.5 font-bold"
                    >
                      Cancel
                    </button>
                  </div>
                </div>
              )}
            </div>
          </div>

          <input
            type="file"
            ref={scheduleFileRef}
            onChange={handleScheduleFileSelect}
            className="hidden"
            accept=".xlsx"
          />
        </div>
      )}

      {activeTab !== 'Schedule' && (<>
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 pb-12 items-start mt-2">
        <div className="lg:col-span-8 space-y-4">
          <div className="bg-white border border-[#c8ddf8] shadow-sm">
            <div className="p-3 border-b border-[#c8ddf8] bg-[#f0f6ff] flex flex-col gap-2">
              <div className="flex justify-between items-center">
                <div className="flex items-center gap-2">
                  <Database className="w-4 h-4 text-[#185baf]" />
                  <h3 className="text-sm font-bold text-[#333] uppercase tracking-wide">
                    Active {activeTab} Registry
                    <span className="ml-2 text-[#666] font-medium text-xs">
                      ({filteredData.length}{filteredData.length !== currentData.length ? ` of ${currentData.length}` : ''})
                    </span>
                  </h3>
                </div>
                <div className="flex items-center gap-2">
                  {selectedIds.size > 0 && (
                    <button
                      onClick={deleteSelected}
                      className="flex items-center gap-1.5 px-3 py-1.5 bg-[#ac2925] text-white text-xs font-bold uppercase tracking-wide hover:bg-[#8a1f1c] transition-colors border border-[#8a1f1c]">
                      <Trash2 className="w-3.5 h-3.5" />
                      Delete {selectedIds.size} Selected
                    </button>
                  )}
                  <button
                    onClick={handleDownloadData}
                    disabled={!activeTermId || currentData.length === 0}
                    className="flex items-center gap-2 py-1.5 px-4 text-xs font-bold border border-[#185baf] text-[#185baf] hover:bg-[#eff6ff] transition-colors disabled:opacity-40 disabled:cursor-not-allowed">
                    <Download className="w-3.5 h-3.5" />
                    Export CSV
                  </button>
                  <button onClick={() => { setActiveImportType(activeTab as ImportType); fileInputRef.current?.click(); }}
                    disabled={!activeTermId}
                    className="btn-primary flex items-center gap-2 py-1.5 px-4 text-xs shadow-sm hover:shadow disabled:opacity-40 disabled:cursor-not-allowed">
                    <Upload className="w-3.5 h-3.5" />
                    Bulk Import
                  </button>
                </div>
              </div>
              <div className="relative">
                <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-[#888] pointer-events-none" />
                <input
                  type="text"
                  value={searchQuery}
                  onChange={e => { setSearchQuery(e.target.value); setSelectedIds(new Set()); }}
                  placeholder={`Search ${activeTab.toLowerCase()}…`}
                  className="w-full pl-8 pr-8 py-1.5 text-xs border border-[#c8ddf8] bg-white outline-none focus:border-[#185baf] text-[#333] placeholder-[#aaa]"
                />
                {searchQuery && (
                  <button
                    onClick={() => { setSearchQuery(''); setSelectedIds(new Set()); }}
                    className="absolute right-2 top-1/2 -translate-y-1/2 text-[#999] hover:text-[#333]">
                    <X className="w-3.5 h-3.5" />
                  </button>
                )}
              </div>
            </div>
            <div className="overflow-x-auto">
              <div className="max-h-[500px] overflow-y-auto">
                <table className="w-full text-left bg-white border-collapse">
                  <thead className="bg-[#f9f9f9] sticky top-0 z-10 border-b border-[#ccc] divide-x divide-[#eee]">
                    {renderTableHeaders()}
                  </thead>
                  <tbody className="divide-y divide-[#eee]">
                    {renderTableRows()}
                    {currentData.length === 0 && (
                      <tr>
                        <td colSpan={6} className="px-3 py-12 text-center bg-[#fcfcfc]">
                          <div className="flex flex-col items-center justify-center h-full opacity-50">
                            <Database className="w-8 h-8 text-[#999] mb-3" />
                            <p className="text-[#333] font-bold uppercase text-[11px] tracking-wide">No records for this term</p>
                            <p className="text-xs text-[#666] mt-1 text-center max-w-xs leading-tight">
                              {activeTermId
                                ? `Use Manual Entry or Bulk Import to add ${activeTab} for "${activeTermName || activeTermId}".`
                                : 'Select an active term first, then upload data.'}
                            </p>
                          </div>
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        </div>

        <div className="lg:col-span-4 space-y-6">
          <div className="bg-white border border-[#c8ddf8] shadow-sm">
            <div className="text-white px-3 py-2 flex items-center gap-2" style={{ background: 'linear-gradient(135deg, #0f3d8c, #185baf)' }}>
              <Plus className="w-4 h-4" />
              <h3 className="font-bold text-[13px] tracking-wide uppercase">Manual Entry</h3>
            </div>
            <div className="p-4 bg-white border-b border-[#ccc]">
              {renderManualEntryForm()}
              <button onClick={addNewItem} disabled={!activeTermId}
                className="w-full btn-primary py-2 mt-5 flex items-center justify-center gap-2 font-bold uppercase text-xs hover:shadow-md transition-shadow disabled:opacity-40 disabled:cursor-not-allowed">
                <Plus className="w-4 h-4" />
                Add to Registry
              </button>
            </div>
          </div>

          <div className="bg-white border border-[#c8ddf8] shadow-sm mt-4">
            <div className="text-white px-3 py-2 flex items-center gap-2" style={{ background: 'linear-gradient(135deg, #2d5f8a, #3b82b8)' }}>
              <Download className="w-4 h-4" />
              <h4 className="font-bold text-[13px] uppercase tracking-wide">Import Templates</h4>
            </div>
            <div className="p-4 bg-white flex flex-col items-center">
              <p className="text-[11px] text-[#555] mb-4 text-center leading-relaxed">
                Download strict CSV templates to ensure precise data mapping for bulk uploads.
              </p>
              <button onClick={() => {
                const csvContent = activeTab !== 'Schedule' ? templates[activeTab as ImportType] : '';
                if (!csvContent) return;
                const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
                const url = URL.createObjectURL(blob);
                const link = document.createElement('a');
                link.setAttribute('href', url);
                link.setAttribute('download', `${activeTab.toLowerCase()}_template.csv`);
                link.click();
              }} className="w-full btn-primary py-2.5 text-xs font-bold uppercase flex justify-center items-center gap-2 shadow-sm hover:shadow">
                <FileText className="w-4 h-4" />
                Get {activeTab} Template
              </button>
            </div>
          </div>
        </div>
      </div>
      <input type="file" ref={fileInputRef} onChange={handleFileSelect} className="hidden" accept=".csv" />
      </>)}
    </div>
  );
};

export default DataImportPanel;
