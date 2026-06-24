import React, { useState, useEffect } from 'react';
import { motion, AnimatePresence, useDragControls } from 'motion/react';
import { ScheduleEntry, Course, Faculty, Room, StudentGroup, DayOfWeek } from '../types';
import { SearchableDropdown, MultiSearchableDropdown } from './ui/Dropdowns';
import { 
  X, Calendar, Clock, MapPin, User, Users, BookOpen, Trash2, Edit2, Save, RotateCcw, Zap
} from 'lucide-react';
import { DAYS, TIME_SLOTS } from '../constants';

interface SessionDetailModalProps {
  isOpen: boolean;
  onClose: () => void;
  onDelete: (id: string) => void;
  onUpdate: (entry: ScheduleEntry) => void;
  entry: ScheduleEntry | null;
  cellEntries?: ScheduleEntry[];
  courses: Course[];
  faculties: Faculty[];
  rooms: Room[];
  groups: StudentGroup[];
}

const SessionDetailModal: React.FC<SessionDetailModalProps> = ({
  isOpen,
  onClose,
  onDelete,
  onUpdate,
  entry,
  cellEntries,
  courses,
  faculties,
  rooms,
  groups
}) => {
  const [isEditing, setIsEditing] = useState(false);
  const [editData, setEditData] = useState<ScheduleEntry | null>(null);
  const [activeTabId, setActiveTabId] = useState<string | null>(null);

  const effectiveEntries = cellEntries && cellEntries.length > 0 ? cellEntries : (entry ? [entry] : []);
  const activeEntry = effectiveEntries.find(e => e.id === activeTabId) || entry;

  useEffect(() => {
    if (entry) {
      setActiveTabId(entry.id);
      setEditData(entry);
      setIsEditing(false);
    }
  }, [entry]);

  const handleTabSwitch = (e: ScheduleEntry) => {
    setActiveTabId(e.id);
    setEditData(e);
    setIsEditing(false);
  };

  const dragControls = useDragControls();

  if (!isOpen || !activeEntry || !editData) return null;

  // When in edit mode, reflect the currently edited courseId so the header updates live.
  const displayCourseId = isEditing && editData ? editData.courseId : activeEntry.courseId;
  const course = courses.find(c => c.id === displayCourseId);
  const faculty = faculties.find(f => f.id === activeEntry.facultyId);
  const room = rooms.find(r => r.id === activeEntry.roomId);
  const selectedGroups = groups.filter(g => activeEntry.groupIds.includes(g.id));

  const handleSave = () => {
    if (editData) {
      onUpdate(editData);
      setIsEditing(false);
    }
  };

  return (
    <AnimatePresence>
      <div className="fixed inset-0 z-[9999] flex items-center justify-center p-4 pointer-events-none">
        {/* Backdrop for modality, strictly no blur to match classic UI */}
        <div className="absolute inset-0 pointer-events-none" />
        
        <motion.div 
          drag
          dragMomentum={false}
          dragListener={false}
          dragControls={dragControls}
          initial={{ scale: 0.95, opacity: 0 }}
          animate={{ scale: 1, opacity: 1 }}
          exit={{ scale: 0.95, opacity: 0 }}
          className="bg-[#f0f0f0] shadow-2xl w-full max-w-[500px] border-2 border-[#185baf] relative pointer-events-auto"
        >
          {/* Classic Title Bar */}
          <div 
            className="bg-[#185baf] text-white px-3 py-1.5 flex justify-between items-center cursor-move"
            onPointerDown={(e) => dragControls.start(e)}
            style={{ touchAction: 'none' }}
          >
            <div className="flex items-center gap-2">
              <BookOpen className="w-4 h-4" />
              <span className="text-[12px] font-bold tracking-wide">
                {isEditing ? 'Edit Session Properties' : 'Session Properties'}
              </span>
            </div>
            <button 
              onClick={onClose} 
              className="bg-[#d9534f] text-white px-2 py-0.5 hover:bg-[#c9302c] border border-white/20 font-bold leading-none text-xs"
              title="Close"
            >
              ✕
            </button>
          </div>

          {/* Dropdown for Split Cohorts / Conflicts */}
          {effectiveEntries.length > 1 && (
            <div className="bg-[#f8f9fa] border-b border-[#ccc] p-3 text-xs">
              <SearchableDropdown
                label="SELECT ACTIVE SESSION"
                icon={<BookOpen className="w-3.5 h-3.5" />}
                options={effectiveEntries.map((e, index) => {
                  const c = courses.find(crs => crs.id === e.courseId);
                  const f = faculties.find(fac => fac.id === e.facultyId);
                  const r = rooms.find(rm => rm.id === e.roomId);
                  return { 
                    id: e.id, 
                    name: `Session ${index + 1}: ${c?.code || 'Draft'}`,
                    sub: `${f?.name || 'Staff'} · ${r?.name || 'Room'}` 
                  };
                })}
                value={activeEntry?.id || ''}
                onChange={id => {
                  const selected = effectiveEntries.find(e => e.id === id);
                  if (selected) handleTabSwitch(selected);
                }}
                placeholder="Switch to another session..."
              />
            </div>
          )}

          <div className="p-4 space-y-4 max-h-[70vh] overflow-y-auto custom-scrollbar">
            {/* Header Info Banner */}
            <div className="bg-white border border-[#ccc] p-3 flex items-center gap-3">
              <div className="w-12 h-12 bg-[#185baf]/10 border border-[#185baf]/20 flex items-center justify-center text-[#185baf]">
                <BookOpen className="w-6 h-6" />
              </div>
              <div>
                <h3 className="text-sm font-bold text-[#333]">{course?.name}</h3>
                <p className="text-[11px] font-bold text-[#666] uppercase">{course?.code}</p>
              </div>
            </div>

            {isEditing ? (
              <div className="space-y-3 bg-white border border-[#ccc] p-3">
                <SearchableDropdown
                  label="MODULE"
                  icon={<BookOpen className="w-3.5 h-3.5" />}
                  options={courses.map(c => ({ id: c.id, name: `${c.code} — ${c.name}` }))}
                  value={editData.courseId}
                  onChange={id => setEditData({ ...editData, courseId: id })}
                />

                <div className="grid grid-cols-2 gap-4">
                  <SearchableDropdown
                    label="CATEGORY"
                    icon={<Zap className="w-3.5 h-3.5" />}
                    options={[
                      { id: 'Explo', name: 'Explo' },
                      { id: 'meeting', name: 'meeting' },
                      { id: 'Theory', name: 'Theory' },
                      { id: 'LAB', name: 'LAB' },
                      { id: 'Online Class', name: 'Online Class' },
                      { id: 'Tut', name: 'Tut' },
                      { id: 'Minor', name: 'Minor' },
                      { id: 'Elective', name: 'Elective' },
                      { id: 'Hons', name: 'Hons' },
                      { id: 'PE1', name: 'PE1' },
                      { id: 'PE2', name: 'PE2' },
                      { id: 'PE3', name: 'PE3' },
                      { id: 'Mid Sem Sub', name: 'Mid Sem Sub' },
                      { id: 'Seminar', name: 'Seminar' },
                      { id: 'Workshop', name: 'Workshop' },
                    ]}
                    value={editData.category || 'Theory'}
                    onChange={val => setEditData({ ...editData, category: val as any })}
                  />
                  <SearchableDropdown
                    label="DAY"
                    icon={<Calendar className="w-3.5 h-3.5" />}
                    options={DAYS.map(d => ({ id: d, name: d }))}
                    value={editData.day}
                    onChange={val => setEditData({ ...editData, day: val as DayOfWeek })}
                  />
                </div>

                <div className="grid grid-cols-2 gap-4">
                  <SearchableDropdown
                    label="START TIME"
                    icon={<Clock className="w-3.5 h-3.5" />}
                    options={TIME_SLOTS.map(t => ({ id: t, name: t }))}
                    value={editData.startTime}
                    onChange={val => setEditData({ ...editData, startTime: val })}
                  />
                  <SearchableDropdown
                    label="END TIME"
                    icon={<Clock className="w-3.5 h-3.5" />}
                    options={TIME_SLOTS.map(t => ({ id: t, name: t, extra: t <= editData.startTime ? <span className="text-[8px] text-red-600 font-bold border border-red-600 px-1 ml-1 bg-red-50">ERR</span> : null }))}
                    value={editData.endTime}
                    onChange={val => setEditData({ ...editData, endTime: val })}
                  />
                </div>

                <div className="space-y-3 pt-2 border-t border-[#eee]">
                  <SearchableDropdown
                    label="FACULTY"
                    icon={<User className="w-3.5 h-3.5" />}
                    options={faculties.map(f => ({ id: f.id, name: f.name }))}
                    value={editData.facultyId}
                    onChange={id => setEditData({ ...editData, facultyId: id })}
                  />
                  
                  <SearchableDropdown
                    label="ROOM"
                    icon={<MapPin className="w-3.5 h-3.5" />}
                    options={rooms.map(r => ({ id: r.id, name: r.name }))}
                    value={editData.roomId}
                    onChange={id => setEditData({ ...editData, roomId: id })}
                  />

                  <MultiSearchableDropdown
                    label="COHORTS"
                    icon={<Users className="w-3.5 h-3.5" />}
                    options={groups.map(g => ({ id: g.id, name: (g as any)._unique_name || g.name }))}
                    values={editData.groupIds}
                    onChange={ids => setEditData({ ...editData, groupIds: ids })}
                    allowSelectAll={true}
                  />
                </div>
              </div>
            ) : (
              <div className="bg-white border border-[#ccc] p-3 text-xs text-[#333]">
                <table className="w-full text-left border-collapse">
                  <tbody>
                    <tr className="border-b border-[#eee]">
                      <td className="py-2 pr-4 font-bold text-[#666] uppercase w-[30%]"><Zap className="inline w-3.5 h-3.5 mr-1"/> Category</td>
                      <td className="py-2">{activeEntry.category || 'Theory'}</td>
                    </tr>
                    <tr className="border-b border-[#eee]">
                      <td className="py-2 pr-4 font-bold text-[#666] uppercase"><Calendar className="inline w-3.5 h-3.5 mr-1"/> Day</td>
                      <td className="py-2">{activeEntry.day}</td>
                    </tr>
                    <tr className="border-b border-[#eee]">
                      <td className="py-2 pr-4 font-bold text-[#666] uppercase"><Clock className="inline w-3.5 h-3.5 mr-1"/> Time Window</td>
                      <td className="py-2 font-bold">{activeEntry.startTime} — {activeEntry.endTime}</td>
                    </tr>
                    <tr className="border-b border-[#eee]">
                      <td className="py-2 pr-4 font-bold text-[#666] uppercase"><User className="inline w-3.5 h-3.5 mr-1"/> Lecturer</td>
                      <td className="py-2">{faculty?.name || 'Unassigned'}</td>
                    </tr>
                    <tr className="border-b border-[#eee]">
                      <td className="py-2 pr-4 font-bold text-[#666] uppercase"><MapPin className="inline w-3.5 h-3.5 mr-1"/> Location</td>
                      <td className="py-2">{room?.name || 'TBD'}</td>
                    </tr>
                    <tr>
                      <td className="py-2 pr-4 font-bold text-[#666] uppercase align-top"><Users className="inline w-3.5 h-3.5 mr-1"/> Cohorts</td>
                      <td className="py-2">
                        {selectedGroups.length > 0 ? (
                          <div className="flex flex-wrap gap-1">
                            {selectedGroups.map(g => (
                              <span key={g.id} className="border border-[#ccc] bg-[#f8f9fa] px-1.5 py-0.5 text-[10px]">
                                {(g as any)._unique_name || g.name}
                              </span>
                            ))}
                          </div>
                        ) : (
                          'All Students'
                        )}
                      </td>
                    </tr>
                    {(activeEntry.createdBy || activeEntry.updatedBy) && (
                      <tr className="border-t border-[#eee]">
                        <td colSpan={2} className="pt-2">
                          <div className="text-[9px] font-bold text-[#999] uppercase tracking-widest mb-1">Change Log</div>
                          {activeEntry.createdBy && (
                            <div className="text-[10px] text-[#555]">
                              <span className="font-bold">Created by:</span> {activeEntry.createdBy}
                              {activeEntry.createdAt && <span className="text-[#999] ml-1">· {new Date(activeEntry.createdAt).toLocaleString()}</span>}
                            </div>
                          )}
                          {activeEntry.updatedBy && (
                            <div className="text-[10px] text-[#555] mt-0.5">
                              <span className="font-bold">Last edited by:</span> {activeEntry.updatedBy}
                              {activeEntry.updatedAt && <span className="text-[#999] ml-1">· {new Date(activeEntry.updatedAt).toLocaleString()}</span>}
                            </div>
                          )}
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
            )}
          </div>

          <div className="p-3 bg-[#e0e0e0] border-t border-[#ccc] flex gap-2 justify-end">
            {isEditing ? (
              <>
                <button 
                  onClick={handleSave}
                  className="btn-primary min-w-[80px]"
                >
                  <Save className="w-3.5 h-3.5" /> OK
                </button>
                <button 
                  onClick={() => { setIsEditing(false); setEditData(activeEntry); }}
                  className="btn-secondary min-w-[80px]"
                >
                  <RotateCcw className="w-3.5 h-3.5" /> Cancel
                </button>
              </>
            ) : (
              <>
                <button 
                  onClick={() => setIsEditing(true)}
                  className="btn-secondary min-w-[80px]"
                >
                  <Edit2 className="w-3.5 h-3.5" /> Edit
                </button>
                <button 
                  onClick={() => { onDelete(activeEntry.id); onClose(); }}
                  className="btn-secondary text-[#ac2925] min-w-[80px]"
                >
                  <Trash2 className="w-3.5 h-3.5" /> Delete
                </button>
                <div className="flex-1"></div>
                <button 
                  onClick={onClose}
                  className="btn-primary min-w-[80px]"
                >
                  Close
                </button>
              </>
            )}
          </div>
          
          {/* Classic Resize Handle Corner (Visual Only) */}
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

export default SessionDetailModal;
