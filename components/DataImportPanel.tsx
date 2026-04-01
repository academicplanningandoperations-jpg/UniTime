import React, { useRef, useState } from 'react';
import { BookOpen, User, Users, MapPin, Download, Upload, CheckCircle2, RefreshCcw, FileText, Database, Plus, Trash2, AlertTriangle } from 'lucide-react';
import { Course, Faculty, Room, StudentGroup } from '../types';
import { motion, AnimatePresence } from 'motion/react';

type ProgressFn = (pct: number, synced: number, total: number) => void;

interface DataImportPanelProps {
  courses: Course[];
  faculties: Faculty[];
  rooms: Room[];
  groups: StudentGroup[];
  onUploadCourses: (data: Course[], onProgress: ProgressFn) => void;
  onUploadFaculties: (data: Faculty[], onProgress: ProgressFn) => void;
  onUploadRooms: (data: Room[], onProgress: ProgressFn) => void;
  onUploadGroups: (data: StudentGroup[], onProgress: ProgressFn) => void;
  onWipeData: (tab: 'Modules' | 'Faculties' | 'Rooms' | 'Groups') => Promise<void>;
  activeTermId?: string;
  activeTermName?: string;
}

type ImportType = 'Modules' | 'Faculties' | 'Rooms' | 'Groups';

const DataImportPanel: React.FC<DataImportPanelProps> = ({
  courses, faculties, rooms, groups,
  onUploadCourses, onUploadFaculties, onUploadRooms, onUploadGroups,
  onWipeData, activeTermId, activeTermName
}) => {
  const [activeTab, setActiveTab] = useState<ImportType>('Modules');
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

  const templates = {
    Modules: "_module_id,_unique_name,_name,_academic_year,Semester\n1,CHCE2028_2,Chemical Technology,2025,SEM-3\n2,CS101,Intro to CS,2025,SEM-1",
    Faculties: "_staff_id,_Faculty_ID,_Faculty_name,_deptName,_email\n1,600001,SOCSVISITING 01,School of Business,SOCSVISITING01@mail.com\n2,600002,Alan Turing,Computer Science,alan@mail.com",
    Rooms: "_room_id,_unique_name,_name,_custom1,_custom2\n1,K1007,K1007,AYRQ18096,AYRQ18096\n2,L202,L202,LAB,LAB",
    Groups: "_group_id,_unique_name,_name\n1,BCOM-H-ECOM&BI-V-B1,BCOM-H-ECOM&BI-V-B1\n2,CS-Y1-A,CS-Y1-A"
  };

  // ✅ Filter displayed data to only this term
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
      
      // ✅ Robust CSV Parser using Regex to handle commas inside quotes
      // and different line endings (\r\n, \n, \r)
      const lines = text.split(/\r?\n/).filter(line => line.trim());
      if (lines.length < 2) {
        alert("Invalid CSV format. Header row missing.");
        return;
      }

      const headers = lines[0].split(',').map(h => h.trim().replace(/^"|"$/g, ''));
      
      const parsedRows: any[] = [];
      for (let i = 1; i < lines.length; i++) {
        const row = lines[i];
        // Regex to match CSV fields (handles quoted strings with escaped quotes)
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

      // ✅ Every item gets stamped with activeTermId
      const termTag = { termId: activeTermId || '' };

      // ✅ FIX: IDs prefixed with termId so "1","2","3" from CSV never
      //         collides across terms in Supabase (e.g. "t1__K1007")
      const makeId = (prefix: string, raw: string | undefined, idx: number) => {
        const base = raw || `${prefix}-${Date.now()}-${idx}-${Math.random().toString(36).substr(2, 9)}`;
        return `${activeTermId || 'local'}__${base}`;
      };

      const mappedData = parsedRows.map((item, i) => {
        if (activeImportType === 'Modules') {
          return {
            ...termTag,
            id: makeId('m', item._unique_name || item._module_id, i),
            code: item._unique_name || `M${i}`,
            name: item._name || 'Unknown Module',
            academicYear: item._academic_year || '2025',
            semester: Number(item.Semester?.replace('SEM-', '')) || 1,
            credits: 3, department: 'General', duration: 1, type: 'Theory',
            _module_id: item._module_id, _unique_name: item._unique_name,
            _name: item._name, _academic_year: item._academic_year, Semester: item.Semester
          };
        }
        if (activeImportType === 'Faculties') {
          return {
            ...termTag,
            id: makeId('f', item._Faculty_ID || item._staff_id, i),
            facultyId: item._Faculty_ID || item._staff_id,
            name: item._Faculty_name || 'Unknown Faculty',
            department: item._deptName || 'General',
            email: item._email || '',
            maxHoursPerWeek: 18, availability: [],
            _staff_id: item._staff_id, _Faculty_ID: item._Faculty_ID,
            _Faculty_name: item._Faculty_name, _deptName: item._deptName, _email: item._email
          };
        }
        if (activeImportType === 'Rooms') {
          return {
            ...termTag,
            id: makeId('r', item._unique_name || item._room_id, i),
            name: item._name || item._unique_name || 'Unknown Room',
            capacity: 60, type: 'Lecture',
            _room_id: item._room_id, _unique_name: item._unique_name,
            _name: item._name, _custom1: item._custom1, _custom2: item._custom2
          };
        }
        if (activeImportType === 'Groups') {
          return {
            ...termTag,
            id: makeId('g', item._unique_name || item._group_id, i),
            name: item._name || item._unique_name || 'Unknown Group',
            program: 'General', semester: 1, studentCount: 30,
            _group_id: item._group_id, _unique_name: item._unique_name, _name: item._name
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
      if (importType === 'Groups') {
        onUploadGroups(mergeData(groups, mappedData as any[]), onProgress);
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
    if (type === 'Groups') onUploadGroups(groups.filter(g => g.id !== id));
  };

  const clearAllData = () => {
    // Delegate entirely to the dedicated wipe handler in App.tsx.
    // It uses DataService.clearEntity (direct DELETE only) rather than going through
    // saveEntity + confirm-after-save, which was causing deleted data to silently come back.
    onWipeData(activeTab);
  };

  const addNewItem = () => {
    const termTag = { termId: activeTermId || '' };
    if (activeTab === 'Modules') {
      const item: any = {
        ...termTag,
        id: newItem._module_id || `m-${Date.now()}`,
        code: newItem._unique_name || 'M-NEW',
        name: newItem._name || 'New Module',
        academicYear: newItem._academic_year || '2025',
        semester: Number(newItem.Semester?.replace('SEM-', '')) || 1,
        credits: 3, duration: 1, type: 'Theory',
        department: newItem.department || 'General',
        _module_id: newItem._module_id, _unique_name: newItem._unique_name,
        _name: newItem._name, _academic_year: newItem._academic_year, Semester: newItem.Semester
      };
      onUploadCourses([...courses, item as any]);
    } else if (activeTab === 'Faculties') {
      const item: any = {
        ...termTag,
        id: newItem._staff_id || `f-${Date.now()}`,
        facultyId: newItem._Faculty_ID || newItem._staff_id,
        name: newItem._Faculty_name || 'New Faculty',
        department: newItem._deptName || 'General',
        email: newItem._email,
        availability: [], maxHoursPerWeek: 18,
        _staff_id: newItem._staff_id, _Faculty_ID: newItem._Faculty_ID,
        _Faculty_name: newItem._Faculty_name, _deptName: newItem._deptName, _email: newItem._email
      };
      onUploadFaculties([...faculties, item]);
    } else if (activeTab === 'Rooms') {
      const item: any = {
        ...termTag,
        id: newItem._room_id || `r-${Date.now()}`,
        name: newItem._name || 'New Room',
        capacity: 60, type: 'Lecture',
        _room_id: newItem._room_id, _unique_name: newItem._unique_name,
        _name: newItem._name, _custom1: newItem._custom1, _custom2: newItem._custom2
      };
      onUploadRooms([...rooms, item]);
    } else if (activeTab === 'Groups') {
      const item: any = {
        ...termTag,
        id: newItem._group_id || `g-${Date.now()}`,
        name: newItem._name || 'New Cohort',
        program: 'General', semester: 1, studentCount: 30,
        _group_id: newItem._group_id, _unique_name: newItem._unique_name, _name: newItem._name
      };
      onUploadGroups([...groups, item]);
    }
    setNewItem({});
  };

  const getIcon = (type: ImportType) => {
    switch (type) {
      case 'Modules': return <BookOpen className="w-4 h-4" />;
      case 'Faculties': return <User className="w-4 h-4" />;
      case 'Rooms': return <MapPin className="w-4 h-4" />;
      case 'Groups': return <Users className="w-4 h-4" />;
    }
  };

  // ✅ Always show only current term's data in the table
  const allData: any[] = activeTab === 'Modules' ? courses : activeTab === 'Faculties' ? faculties : activeTab === 'Rooms' ? rooms : groups;
  const currentData = getTermData(allData);

  const renderTableHeaders = () => {
    if (activeTab === 'Modules') return (
      <tr>
        <th className="px-3 py-2 text-[11px] font-bold text-[#333] uppercase">_module_id</th>
        <th className="px-3 py-2 text-[11px] font-bold text-[#333] uppercase">_unique_name</th>
        <th className="px-3 py-2 text-[11px] font-bold text-[#333] uppercase">_name</th>
        <th className="px-3 py-2 text-[11px] font-bold text-[#333] uppercase">_academic_year</th>
        <th className="px-3 py-2 text-[11px] font-bold text-[#333] uppercase">Semester</th>
        <th className="px-3 py-2 text-[11px] font-bold text-[#333] uppercase text-right">Actions</th>
      </tr>
    );
    if (activeTab === 'Faculties') return (
      <tr>
        <th className="px-3 py-2 text-[11px] font-bold text-[#333] uppercase">_staff_id</th>
        <th className="px-3 py-2 text-[11px] font-bold text-[#333] uppercase">_Faculty_ID</th>
        <th className="px-3 py-2 text-[11px] font-bold text-[#333] uppercase">_Faculty_name</th>
        <th className="px-3 py-2 text-[11px] font-bold text-[#333] uppercase">_deptName</th>
        <th className="px-3 py-2 text-[11px] font-bold text-[#333] uppercase">_email</th>
        <th className="px-3 py-2 text-[11px] font-bold text-[#333] uppercase text-right">Actions</th>
      </tr>
    );
    if (activeTab === 'Rooms') return (
      <tr>
        <th className="px-3 py-2 text-[11px] font-bold text-[#333] uppercase">_room_id</th>
        <th className="px-3 py-2 text-[11px] font-bold text-[#333] uppercase">_unique_name</th>
        <th className="px-3 py-2 text-[11px] font-bold text-[#333] uppercase">_name</th>
        <th className="px-3 py-2 text-[11px] font-bold text-[#333] uppercase">_custom1</th>
        <th className="px-3 py-2 text-[11px] font-bold text-[#333] uppercase">_custom2</th>
        <th className="px-3 py-2 text-[11px] font-bold text-[#333] uppercase text-right">Actions</th>
      </tr>
    );
    return (
      <tr>
        <th className="px-3 py-2 text-[11px] font-bold text-[#333] uppercase">_group_id</th>
        <th className="px-3 py-2 text-[11px] font-bold text-[#333] uppercase">_unique_name</th>
        <th className="px-3 py-2 text-[11px] font-bold text-[#333] uppercase">_name</th>
        <th className="px-3 py-2 text-[11px] font-bold text-[#333] uppercase text-right">Actions</th>
      </tr>
    );
  };

  const renderTableRows = () => {
    return currentData.map((item: any) => (
      <tr key={item.id} className="hover:bg-[#f5f5f5] transition-colors divide-x divide-[#eee] text-xs text-[#333]">
        {activeTab === 'Modules' && (<>
          <td className="px-3 py-2 font-bold">{item._module_id || item.id}</td>
          <td className="px-3 py-2">{item._unique_name || item.code}</td>
          <td className="px-3 py-2">{item._name || item.name}</td>
          <td className="px-3 py-2">{item._academic_year || item.academicYear || 2025}</td>
          <td className="px-3 py-2">{item.Semester || `SEM-${item.semester || 1}`}</td>
        </>)}
        {activeTab === 'Faculties' && (<>
          <td className="px-3 py-2 font-bold">{item._staff_id || item.id}</td>
          <td className="px-3 py-2">{item._Faculty_ID}</td>
          <td className="px-3 py-2">{item._Faculty_name || item.name}</td>
          <td className="px-3 py-2">{item._deptName || item.department}</td>
          <td className="px-3 py-2">{item._email || item.email || '-'}</td>
        </>)}
        {activeTab === 'Rooms' && (<>
          <td className="px-3 py-2 font-bold">{item._room_id || item.id}</td>
          <td className="px-3 py-2">{item._unique_name || item.name}</td>
          <td className="px-3 py-2">{item._name || item.name}</td>
          <td className="px-3 py-2">{item._custom1 || '-'}</td>
          <td className="px-3 py-2">{item._custom2 || '-'}</td>
        </>)}
        {activeTab === 'Groups' && (<>
          <td className="px-3 py-2 font-bold">{item._group_id || item.id}</td>
          <td className="px-3 py-2">{item._unique_name || item.name}</td>
          <td className="px-3 py-2">{item._name || item.name}</td>
        </>)}
        <td className="px-3 py-2 text-right">
          <button onClick={() => deleteItem(activeTab, item.id)}
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
        <label className="text-[11px] font-bold text-[#333] uppercase">_module_id</label>
        <input type="text" value={newItem._module_id || ''} onChange={e => setNewItem({...newItem, _module_id: e.target.value})} className="w-full bg-white border border-[#ccc] px-2 py-1.5 focus:border-[#185baf] outline-none text-xs" />
        <label className="text-[11px] font-bold text-[#333] uppercase">_unique_name</label>
        <input type="text" value={newItem._unique_name || ''} onChange={e => setNewItem({...newItem, _unique_name: e.target.value})} className="w-full bg-white border border-[#ccc] px-2 py-1.5 focus:border-[#185baf] outline-none text-xs" />
        <label className="text-[11px] font-bold text-[#333] uppercase">_name</label>
        <input type="text" value={newItem._name || ''} onChange={e => setNewItem({...newItem, _name: e.target.value})} className="w-full bg-white border border-[#ccc] px-2 py-1.5 focus:border-[#185baf] outline-none text-xs" />
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
        <label className="text-[11px] font-bold text-[#333] uppercase">_staff_id</label>
        <input type="text" value={newItem._staff_id || ''} onChange={e => setNewItem({...newItem, _staff_id: e.target.value})} className="w-full bg-white border border-[#ccc] px-2 py-1.5 focus:border-[#185baf] outline-none text-xs" />
        <label className="text-[11px] font-bold text-[#333] uppercase">_Faculty_ID</label>
        <input type="text" value={newItem._Faculty_ID || ''} onChange={e => setNewItem({...newItem, _Faculty_ID: e.target.value})} className="w-full bg-white border border-[#ccc] px-2 py-1.5 focus:border-[#185baf] outline-none text-xs" />
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
        <label className="text-[11px] font-bold text-[#333] uppercase">_room_id</label>
        <input type="text" value={newItem._room_id || ''} onChange={e => setNewItem({...newItem, _room_id: e.target.value})} className="w-full bg-white border border-[#ccc] px-2 py-1.5 focus:border-[#185baf] outline-none text-xs" />
        <label className="text-[11px] font-bold text-[#333] uppercase">_unique_name</label>
        <input type="text" value={newItem._unique_name || ''} onChange={e => setNewItem({...newItem, _unique_name: e.target.value})} className="w-full bg-white border border-[#ccc] px-2 py-1.5 focus:border-[#185baf] outline-none text-xs" />
        <label className="text-[11px] font-bold text-[#333] uppercase">_name</label>
        <input type="text" value={newItem._name || ''} onChange={e => setNewItem({...newItem, _name: e.target.value})} className="w-full bg-white border border-[#ccc] px-2 py-1.5 focus:border-[#185baf] outline-none text-xs" />
        <label className="text-[11px] font-bold text-[#333] uppercase">_custom1</label>
        <input type="text" value={newItem._custom1 || ''} onChange={e => setNewItem({...newItem, _custom1: e.target.value})} className="w-full bg-white border border-[#ccc] px-2 py-1.5 focus:border-[#185baf] outline-none text-xs" />
        <label className="text-[11px] font-bold text-[#333] uppercase">_custom2</label>
        <input type="text" value={newItem._custom2 || ''} onChange={e => setNewItem({...newItem, _custom2: e.target.value})} className="w-full bg-white border border-[#ccc] px-2 py-1.5 focus:border-[#185baf] outline-none text-xs" />
      </div>
    );
    return (
      <div className="space-y-3">
        <label className="text-[11px] font-bold text-[#333] uppercase">_group_id</label>
        <input type="text" value={newItem._group_id || ''} onChange={e => setNewItem({...newItem, _group_id: e.target.value})} className="w-full bg-white border border-[#ccc] px-2 py-1.5 focus:border-[#185baf] outline-none text-xs" />
        <label className="text-[11px] font-bold text-[#333] uppercase">_unique_name</label>
        <input type="text" value={newItem._unique_name || ''} onChange={e => setNewItem({...newItem, _unique_name: e.target.value})} className="w-full bg-white border border-[#ccc] px-2 py-1.5 focus:border-[#185baf] outline-none text-xs" />
        <label className="text-[11px] font-bold text-[#333] uppercase">_name</label>
        <input type="text" value={newItem._name || ''} onChange={e => setNewItem({...newItem, _name: e.target.value})} className="w-full bg-white border border-[#ccc] px-2 py-1.5 focus:border-[#185baf] outline-none text-xs" />
      </div>
    );
  };

  return (
    <div className="space-y-6 p-2 w-full">

      {/* ── Upload Progress Bar ── */}
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
          {/* ✅ Term context banner */}
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
          <button onClick={clearAllData} disabled={!activeTermId}
            className="flex items-center gap-2 px-3 py-1.5 text-[#ac2925] hover:bg-[#ebd5d5] font-bold text-sm transition-colors border border-transparent hover:border-[#ac2925] disabled:opacity-40 disabled:cursor-not-allowed">
            <RefreshCcw className="w-4 h-4" />
            Wipe {activeTab}
          </button>
        </div>
      </div>

      <div className="flex bg-[#f0f0f0] border-b border-[#ccc] w-full shadow-sm">
        {(['Modules', 'Faculties', 'Rooms', 'Groups'] as ImportType[]).map(t => (
          <button key={t} onClick={() => setActiveTab(t)}
            className={`flex items-center gap-2 px-6 py-2.5 text-sm font-bold transition-all border-r border-[#ccc] ${
              activeTab === t ? 'bg-white text-[#185baf] border-t-2 border-t-[#185baf] shadow-inner' : 'text-[#666] hover:bg-[#e6e6e6] border-t-2 border-t-transparent'
            }`}>
            <span className={activeTab === t ? 'text-[#185baf]' : 'text-[#666]'}>{getIcon(t)}</span>
            {t}
          </button>
        ))}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 pb-12 items-start mt-2">
        <div className="lg:col-span-8 space-y-4">
          <div className="bg-white border border-[#ccc] shadow-sm">
            <div className="p-3 border-b border-[#ccc] bg-[#f0f0f0] flex justify-between items-center">
              <div className="flex items-center gap-2">
                <Database className="w-4 h-4 text-[#185baf]" />
                <h3 className="text-sm font-bold text-[#333] uppercase tracking-wide">
                  Active {activeTab} Registry
                  <span className="ml-2 text-[#666] font-medium text-xs">({currentData.length})</span>
                </h3>
              </div>
              <button onClick={() => { setActiveImportType(activeTab); fileInputRef.current?.click(); }}
                disabled={!activeTermId}
                className="btn-primary flex items-center gap-2 py-1.5 px-4 text-xs shadow-sm hover:shadow disabled:opacity-40 disabled:cursor-not-allowed">
                <Upload className="w-3.5 h-3.5" />
                Bulk Import
              </button>
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
          <div className="bg-[#f0f0f0] border border-[#ccc] shadow-sm">
            <div className="bg-[#185baf] text-white px-3 py-2 flex items-center gap-2">
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

          <div className="bg-[#f0f0f0] border border-[#ccc] shadow-sm mt-4">
            <div className="bg-[#555] text-white px-3 py-2 flex items-center gap-2">
              <Download className="w-4 h-4" />
              <h4 className="font-bold text-[13px] uppercase tracking-wide">Import Templates</h4>
            </div>
            <div className="p-4 bg-white flex flex-col items-center">
              <p className="text-[11px] text-[#555] mb-4 text-center leading-relaxed">
                Download strict CSV templates to ensure precise data mapping for bulk uploads.
              </p>
              <button onClick={() => {
                const csvContent = templates[activeTab];
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
    </div>
  );
};

export default DataImportPanel;
