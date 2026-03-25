import React, { useState, useEffect, useRef } from 'react';
import { motion, AnimatePresence, useDragControls } from 'motion/react';
import { Course, Faculty, Room, StudentGroup, DayOfWeek, ScheduleEntry } from '../types';
import { DAYS, TIME_SLOTS, TOTAL_WEEKS } from '../constants';
import { SearchableDropdown, MultiSearchableDropdown } from './ui/Dropdowns';
import { 
  X, Calendar, Clock, MapPin, User, Users, BookOpen, Search, ChevronDown, Zap, RefreshCw, Check, AlertCircle 
} from 'lucide-react';
import { DataService } from '../services/dataService';

interface SessionModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSave: (entries: Omit<ScheduleEntry, 'id' | 'departmentId'>[]) => void;
  initialData?: Partial<ScheduleEntry>;
  courses: Course[];
  faculties: Faculty[];
  rooms: Room[];
  groups: StudentGroup[];
  existingSchedule: ScheduleEntry[];
}

const SessionModal: React.FC<SessionModalProps> = ({
  isOpen, onClose, onSave, initialData, courses, faculties, rooms, groups, existingSchedule
}) => {
  const [formData, setFormData] = useState<Partial<ScheduleEntry>>({
    day: 'Monday',
    startTime: '09:00',
    endTime: '10:00',
    weeks: [1],
    category: 'Theory',
    groupIds: [],
    ...initialData
  });

  const [recurringDays, setRecurringDays] = useState<DayOfWeek[]>([]);
  const [isRecurring, setIsRecurring] = useState(false);

  const lastAutoCalc = useRef<string>('');
  const isFirstRender = useRef(true);

  useEffect(() => {
    if (isFirstRender.current) {
      if (initialData?.endTime) lastAutoCalc.current = initialData.endTime;
      isFirstRender.current = false;
      return;
    }

    if (formData.startTime && formData.courseId) {
      const course = courses.find(c => c.id === formData.courseId);
      if (course) {
        const [hours, minutes] = formData.startTime.split(':').map(Number);
        const totalMinutes = hours * 60 + minutes + (course.duration * 60);
        const endH = Math.floor(totalMinutes / 60);
        const endM = totalMinutes % 60;
        const calculatedEndTime = `${String(endH).padStart(2, '0')}:${String(endM).padStart(2, '0')}`;
        
        if (calculatedEndTime !== lastAutoCalc.current) {
          lastAutoCalc.current = calculatedEndTime;
          setFormData(prev => ({ ...prev, endTime: calculatedEndTime }));
        }
      }
    }
  }, [formData.startTime, formData.courseId, courses, initialData?.endTime]);

  useEffect(() => {
    if (initialData) setFormData(prev => ({ ...prev, ...initialData }));
  }, [initialData]);

  const dragControls = useDragControls();

  if (!isOpen) return null;

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (formData.courseId && formData.facultyId && formData.roomId && formData.groupIds && formData.groupIds.length > 0 && formData.day && formData.startTime && formData.endTime) {
      const baseEntry: Omit<ScheduleEntry, 'id' | 'departmentId'> = {
        termId: formData.termId || 't1',
        courseId: formData.courseId,
        facultyId: formData.facultyId,
        roomId: formData.roomId,
        groupIds: formData.groupIds,
        day: formData.day as DayOfWeek,
        startTime: formData.startTime,
        endTime: formData.endTime,
        weeks: formData.weeks || [1],
        category: formData.category || 'Theory'
      };

      const entries: Omit<ScheduleEntry, 'id' | 'departmentId'>[] = [baseEntry];
      
      if (isRecurring) {
        recurringDays.forEach(d => {
          if (d !== formData.day) entries.push({ ...baseEntry, day: d });
        });
      }

      onSave(entries);
      onClose();
    }
  };

  const toggleWeek = (week: number) => {
    const currentWeeks = formData.weeks || [];
    if (currentWeeks.includes(week)) {
      setFormData({ ...formData, weeks: currentWeeks.filter(w => w !== week) });
    } else {
      setFormData({ ...formData, weeks: [...currentWeeks, week].sort((a, b) => a - b) });
    }
  };

  const getFacultyLoad = (facultyId: string) => {
    const selectedWeeks = formData.weeks || [];
    if (selectedWeeks.length === 0) return 0;
    
    let maxLoad = 0;
    selectedWeeks.forEach(w => {
      const load = existingSchedule
        .filter(s => s.facultyId === facultyId && s.weeks.includes(w))
        .reduce((sum, s) => sum + DataService.getDuration(s.startTime, s.endTime), 0);
      if (load > maxLoad) maxLoad = load;
    });
    return maxLoad;
  };

  const selectedFaculty = faculties.find(f => f.id === formData.facultyId);
  const currentFacultyLoad = selectedFaculty ? getFacultyLoad(selectedFaculty.id) : 0;
  const loadPercentage = selectedFaculty ? (currentFacultyLoad / selectedFaculty.maxHoursPerWeek) * 100 : 0;

  const getInlineConflicts = () => {
    if (!formData.day || !formData.startTime || !formData.endTime || !formData.weeks?.length) return [];
    
    const formatTime = (t: string) => {
      const [h,m] = t.split(':').map(Number);
      return h * 60 + m;
    };
    const sStart = formatTime(formData.startTime);
    const sEnd = formatTime(formData.endTime);

    const conflicts: string[] = [];

    existingSchedule.forEach(entry => {
      if (entry.day !== formData.day) return;
      if (!entry.weeks.some(w => formData.weeks!.includes(w))) return;
      if (initialData?.id && entry.id === initialData.id) return; // Don't conflict with self when editing
      
      const eStart = formatTime(entry.startTime);
      const eEnd = formatTime(entry.endTime);
      
      if (sStart < eEnd && sEnd > eStart) {
        if (formData.roomId && entry.roomId === formData.roomId) {
          const r = rooms.find(room => room.id === formData.roomId);
          if (r && !conflicts.includes(`Room ${r.name} is double-booked`)) conflicts.push(`Room ${r.name} is double-booked`);
        }
        if (formData.facultyId && entry.facultyId === formData.facultyId) {
          const f = faculties.find(fac => fac.id === formData.facultyId);
          if (f && !conflicts.includes(`${f.name} is already teaching`)) conflicts.push(`${f.name} is already teaching`);
        }
        if (formData.groupIds && formData.groupIds.some(g => entry.groupIds.includes(g))) {
          const sharedGroups = groups.filter(g => formData.groupIds!.includes(g.id) && entry.groupIds.includes(g.id));
          sharedGroups.forEach(g => {
             if (!conflicts.includes(`Cohort ${g.name} has a conflict`)) conflicts.push(`Cohort ${g.name} has a conflict`);
          });
        }
      }
    });
    return conflicts;
  };

  const inlineConflicts = getInlineConflicts();

  return (
    <AnimatePresence>
      <div className="fixed inset-0 z-[9999] flex items-center justify-center p-4 pointer-events-none">
        <div className="absolute inset-0 pointer-events-none" />
        
        <motion.div 
          initial={{ opacity: 0, scale: 0.95 }}
          animate={{ opacity: 1, scale: 1 }}
          exit={{ opacity: 0, scale: 0.95 }}
          drag
          dragMomentum={false}
          dragListener={false}
          dragControls={dragControls}
          className="bg-[#f0f0f0] shadow-2xl w-full max-w-[550px] border-2 border-[#185baf] relative pointer-events-auto"
        >
          {/* Title Bar */}
          <div 
            className="bg-[#185baf] text-white px-3 py-1.5 flex justify-between items-center cursor-move"
            onPointerDown={(e) => dragControls.start(e)}
            style={{ touchAction: 'none' }}
          >
            <div className="flex items-center gap-2">
              <Calendar className="w-4 h-4" />
              <span className="text-[12px] font-bold tracking-wide">
                Schedule Session Properties
              </span>
            </div>
            <button 
              onClick={onClose} 
              className="bg-[#d9534f] text-white px-2 py-0.5 hover:bg-[#c9302c] border border-white/20 font-bold leading-none text-xs"
              title="Close"
              type="button"
            >
              ✕
            </button>
          </div>

          <form onSubmit={handleSubmit} className="p-4 space-y-4 max-h-[75vh] overflow-y-auto custom-scrollbar">
            <div className="bg-white border border-[#ccc] p-3 space-y-3">
              <SearchableDropdown 
                label="Course / Module"
                icon={<BookOpen className="w-3.5 h-3.5" />}
                options={courses.map(c => ({ id: c.id, name: `${c.code} - ${c.name}`, sub: `${c.credits} Credits · ${c.department}` }))}
                value={formData.courseId || ''}
                onChange={id => setFormData({ ...formData, courseId: id })}
                placeholder="Select Module"
                required
              />

              <div className="grid grid-cols-2 gap-4">
                <SearchableDropdown
                  label="Category"
                  icon={<Zap className="w-3.5 h-3.5" />}
                  options={[
                    { id: 'Theory', name: 'Theory' },
                    { id: 'Lab', name: 'Lab' },
                    { id: 'Seminar', name: 'Seminar' },
                    { id: 'Workshop', name: 'Workshop' },
                  ]}
                  value={formData.category || 'Theory'}
                  onChange={val => setFormData({ ...formData, category: val as any })}
                />
                <SearchableDropdown
                  label="Day"
                  icon={<Calendar className="w-3.5 h-3.5" />}
                  options={DAYS.map(d => ({ id: d, name: d }))}
                  value={formData.day || 'Monday'}
                  onChange={val => setFormData({ ...formData, day: val as DayOfWeek })}
                />
              </div>

              <div className="grid grid-cols-2 gap-4">
                <SearchableDropdown
                  label="Start Time"
                  icon={<Clock className="w-3.5 h-3.5" />}
                  options={TIME_SLOTS.map(t => ({ id: t, name: t }))}
                  value={formData.startTime || '09:00'}
                  onChange={val => setFormData({ ...formData, startTime: val })}
                />
                <SearchableDropdown
                  label="End Time"
                  icon={<Clock className="w-3.5 h-3.5" />}
                  options={TIME_SLOTS.map(t => ({ id: t, name: t, extra: formData.startTime && t <= formData.startTime ? <span className="text-[8px] text-red-600 font-bold border border-red-600 px-1 ml-1 bg-red-50">ERR</span> : null }))}
                  value={formData.endTime || '10:00'}
                  onChange={val => setFormData({ ...formData, endTime: val })}
                />
              </div>
            </div>

            {/* Recurring Settings */}
            <div className="bg-white border border-[#ccc] p-3 space-y-3">
              <div className="flex items-center justify-between pb-2 border-b border-[#eee]">
                <div className="flex items-center gap-2">
                  <RefreshCw className="w-3.5 h-3.5 text-[#555]" />
                  <span className="text-[11px] font-bold text-[#333] tracking-wide uppercase">Recurring Setup</span>
                </div>
                <div className="flex items-center gap-2">
                  <span className="text-[10px] text-[#666]">Enable multiple days</span>
                  <input 
                    type="checkbox" 
                    checked={isRecurring} 
                    onChange={() => setIsRecurring(!isRecurring)} 
                    className="w-3 h-3 cursor-pointer"
                  />
                </div>
              </div>

              {isRecurring && (
                <div className="flex flex-wrap gap-1.5 pt-1">
                  {DAYS.map(day => (
                    <button
                      key={day}
                      type="button"
                      disabled={day === formData.day}
                      onClick={() => {
                        if (recurringDays.includes(day as DayOfWeek)) {
                          setRecurringDays(recurringDays.filter(d => d !== day));
                        } else {
                          setRecurringDays([...recurringDays, day as DayOfWeek]);
                        }
                      }}
                      className={`px-2 py-1 border text-[10px] font-bold transition-none ${
                        day === formData.day 
                        ? 'bg-[#e0e0e0] text-[#999] border-[#ccc] cursor-not-allowed'
                        : recurringDays.includes(day as DayOfWeek)
                        ? 'bg-[#185baf] text-white border-[#0d3b76]'
                        : 'bg-white text-[#333] border-[#ccc] hover:bg-[#e6e6e6]'
                      }`}
                    >
                      {day.substring(0, 3)}
                    </button>
                  ))}
                </div>
              )}

              <div className="flex justify-between items-center pt-2 mt-2 border-t border-[#eee]">
                <span className="text-[10px] font-bold text-[#666] uppercase tracking-wide">Active Weeks</span>
                <button 
                  type="button"
                  onClick={() => {
                    const allWeeks = Array.from({ length: TOTAL_WEEKS }, (_, i) => i + 1);
                    if ((formData.weeks || []).length === TOTAL_WEEKS) setFormData({ ...formData, weeks: [] });
                    else setFormData({ ...formData, weeks: allWeeks });
                  }}
                  className="text-[10px] font-bold text-[#185baf] hover:underline uppercase"
                >
                  {(formData.weeks || []).length === TOTAL_WEEKS ? 'Clear All' : 'Select All'}
                </button>
              </div>
              <div className="grid grid-cols-10 gap-1 bg-[#f8f9fa] border border-[#ccc] p-1.5">
                {Array.from({ length: TOTAL_WEEKS }, (_, i) => i + 1).map(week => (
                  <button
                    key={week}
                    type="button"
                    onClick={() => toggleWeek(week)}
                    className={`py-1 border text-[9px] font-bold text-center ${
                      (formData.weeks || []).includes(week)
                      ? 'bg-[#185baf] text-white border-[#0d3b76]'
                      : 'bg-white text-[#333] border-[#ccc] hover:bg-[#e6e6e6]'
                    }`}
                  >
                    {week}
                  </button>
                ))}
              </div>
            </div>

            {/* Assignments */}
            <div className="bg-white border border-[#ccc] p-3 space-y-3">
              <SearchableDropdown 
                label="Staff / Faculty"
                icon={<User className="w-3.5 h-3.5" />}
                options={faculties.map(f => {
                   const load = getFacultyLoad(f.id);
                   const isCritical = load >= f.maxHoursPerWeek;
                   return { 
                     id: f.id, 
                     name: f.name, 
                     sub: `${f.department} · Limit: ${f.maxHoursPerWeek}h`,
                     extra: <span className={`text-[9px] font-bold px-1 border ${isCritical ? 'bg-red-50 text-red-600 border-red-300' : 'bg-green-50 text-green-600 border-green-300'}`}>{load.toFixed(1)}h</span>
                   };
                })}
                value={formData.facultyId || ''}
                onChange={id => setFormData({ ...formData, facultyId: id })}
                placeholder="Select Faculty"
                required
              />
              
              {selectedFaculty && (
                <div className="bg-[#f8f9fa] border border-[#ccc] p-2">
                  <div className="flex justify-between items-center mb-1">
                    <span className="text-[9px] font-bold text-[#666] uppercase">Load Utilization</span>
                    <span className={`text-[9px] font-bold ${loadPercentage >= 100 ? 'text-[#d9534f]' : 'text-[#185baf]'}`}>
                      {currentFacultyLoad.toFixed(1)} / {selectedFaculty.maxHoursPerWeek} Hours
                    </span>
                  </div>
                  <div className="h-1.5 w-full bg-[#ccc] border border-[#b3b3b3]">
                    <div 
                      className={`h-full ${loadPercentage >= 100 ? 'bg-[#d9534f]' : loadPercentage > 80 ? 'bg-[#f0ad4e]' : 'bg-[#185baf]'}`} 
                      style={{ width: `${Math.min(100, loadPercentage)}%` }} 
                    />
                  </div>
                </div>
              )}

              <SearchableDropdown 
                label="Room / Venue"
                icon={<MapPin className="w-3.5 h-3.5" />}
                options={rooms.map(r => ({ id: r.id, name: r.name, sub: `${r.type} · Cap: ${r.capacity}` }))}
                value={formData.roomId || ''}
                onChange={id => setFormData({ ...formData, roomId: id })}
                placeholder="Select Room"
                required
              />

              <MultiSearchableDropdown 
                label="Cohorts / Student Groups"
                icon={<Users className="w-3.5 h-3.5" />}
                options={groups.map(g => ({ id: g.id, name: g.name, sub: `${g.program} · Sem ${g.semester}` }))}
                values={formData.groupIds || []}
                onChange={ids => setFormData({ ...formData, groupIds: ids })}
                placeholder="Select Groups"
                required
              />
            </div>
          </form>
          {inlineConflicts.length > 0 && (
            <div className="mx-4 mb-2 p-2 bg-[#fdedec] border-2 border-[#a94442]">
              <div className="text-[10px] font-black text-[#a94442] uppercase tracking-widest mb-1 border-b border-[#a94442]/30 pb-1">
                Scheduling Conflicts Detected
              </div>
              <div className="flex flex-col gap-1 mt-1">
                {inlineConflicts.map((c, i) => (
                  <div key={i} className="flex items-start gap-1.5 text-[11px] font-bold text-[#a94442] leading-tight">
                    <AlertCircle className="w-3.5 h-3.5 shrink-0 mt-[1px]" />
                    <span>{c}</span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Bottom Actions */}
          <div className="p-3 bg-[#e0e0e0] border-t border-[#ccc] flex gap-2 justify-end mt-2">
            <button 
              type="button" 
              onClick={onClose} 
              className="btn-secondary min-w-[80px]"
            >
              Cancel
            </button>
            <button 
              type="button"
              onClick={handleSubmit} 
              className="btn-primary min-w-[80px]"
            >
              Save Schedule
            </button>
          </div>
          
          <div className="absolute bottom-1 right-1 flex flex-col items-end gap-[1px] opacity-30 pointer-events-none">
            <div className="text-[8px] leading-[3px]">///</div>
            <div className="text-[8px] leading-[3px] pr-[3px]">//</div>
            <div className="text-[8px] leading-[3px] pr-[6px]">/</div>
          </div>
        </motion.div>
      </div>
    </AnimatePresence>
  );
};

export default SessionModal;
