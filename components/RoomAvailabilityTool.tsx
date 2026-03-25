import React, { useState, useMemo } from 'react';
import { Room, ScheduleEntry, DayOfWeek } from '../types';
import { DAYS, TIME_SLOTS, TOTAL_WEEKS } from '../constants';
import { Search, MapPin, X, CheckCircle, AlertCircle } from 'lucide-react';
import { motion, AnimatePresence, useDragControls } from 'motion/react';

interface RoomAvailabilityToolProps {
  rooms: Room[];
  schedule: ScheduleEntry[];
  isOpen: boolean;
  onClose: () => void;
}

const RoomAvailabilityTool: React.FC<RoomAvailabilityToolProps> = ({ rooms, schedule, isOpen, onClose }) => {
  const [day, setDay] = useState<DayOfWeek>('Monday');
  const [time, setTime] = useState('09:00');
  const [week, setWeek] = useState(1);
  const dragControls = useDragControls();

  const availability = useMemo(() => {
    const occupiedRoomIds = schedule
      .filter(s => s.day === day && s.startTime === time && s.weeks.includes(week))
      .map(s => s.roomId);

    return rooms.map(room => ({
      ...room,
      isAvailable: !occupiedRoomIds.includes(room.id)
    }));
  }, [rooms, schedule, day, time, week]);

  if (!isOpen) return null;

  return (
    <AnimatePresence>
      <div className="fixed inset-0 z-[9999] flex items-center justify-center p-4">
        {/* Backdrop for modality, strictly no blur to match classic UI */}
        <div className="absolute inset-0 bg-black/20 pointer-events-auto" onClick={onClose} />
        
        <motion.div 
          drag
          dragMomentum={false}
          dragListener={false}
          dragControls={dragControls}
          initial={{ scale: 0.95, opacity: 0 }}
          animate={{ scale: 1, opacity: 1 }}
          exit={{ scale: 0.95, opacity: 0 }}
          className="bg-[#f0f0f0] shadow-2xl w-full max-w-[650px] border-2 border-[#185baf] relative pointer-events-auto"
        >
          {/* Classic Title Bar */}
          <div 
            className="bg-[#185baf] text-white px-3 py-1.5 flex justify-between items-center cursor-move"
            onPointerDown={(e) => dragControls.start(e)}
            style={{ touchAction: 'none' }}
          >
            <div className="flex items-center gap-2">
               <MapPin className="w-4 h-4" />
               <span className="text-[12px] font-bold tracking-wide">Room Availability Finder</span>
            </div>
            <button 
              onClick={onClose} 
              className="bg-[#d9534f] text-white px-2 py-0.5 hover:bg-[#c9302c] border border-white/20 font-bold leading-none text-xs"
              title="Close"
            >
              ✕
            </button>
          </div>

          <div className="p-4 space-y-4">
            <div className="bg-white border border-[#ccc] p-3 grid grid-cols-3 gap-4">
              <div>
                <label className="text-[10px] font-bold text-[#666] uppercase tracking-wide block mb-1">Target Day</label>
                <select 
                  value={day} 
                  onChange={e => setDay(e.target.value as DayOfWeek)} 
                  className="w-full bg-white border border-[#ccc] px-2 py-1 text-[11px] font-bold outline-none uppercase tracking-wide cursor-pointer hover:bg-[#e6e6e6]"
                >
                  {DAYS.map(d => <option key={d} value={d}>{d}</option>)}
                </select>
              </div>
              <div>
                <label className="text-[10px] font-bold text-[#666] uppercase tracking-wide block mb-1">Time Slot</label>
                <select 
                  value={time} 
                  onChange={e => setTime(e.target.value)} 
                  className="w-full bg-white border border-[#ccc] px-2 py-1 text-[11px] font-bold outline-none uppercase tracking-wide cursor-pointer hover:bg-[#e6e6e6]"
                >
                  {TIME_SLOTS.map(t => <option key={t} value={t}>{t}</option>)}
                </select>
              </div>
              <div>
                <label className="text-[10px] font-bold text-[#666] uppercase tracking-wide block mb-1">Target Week</label>
                <select 
                  value={week} 
                  onChange={e => setWeek(Number(e.target.value))} 
                  className="w-full bg-white border border-[#ccc] px-2 py-1 text-[11px] font-bold outline-none uppercase tracking-wide cursor-pointer hover:bg-[#e6e6e6]"
                >
                  {Array.from({ length: TOTAL_WEEKS }, (_, i) => i + 1).map(w => <option key={w} value={w}>Week {w}</option>)}
                </select>
              </div>
            </div>

            <div className="bg-white border border-[#ccc] p-1 h-[300px] overflow-y-auto custom-scrollbar">
              <table className="w-full text-left border-collapse">
                <tbody>
                  {availability.map(room => (
                    <tr key={room.id} className="border-b border-[#eee] hover:bg-[#f5f5f5]">
                      <td className="p-2 w-8">
                        <div className={`w-6 h-6 border flex items-center justify-center font-bold text-[10px] ${room.isAvailable ? 'bg-green-50 text-green-700 border-green-300' : 'bg-[#e0e0e0] text-[#666] border-[#ccc]'}`}>
                          R
                        </div>
                      </td>
                      <td className="p-2">
                        <div className="font-bold text-[11px] text-[#333] uppercase">{room.name}</div>
                        <div className="text-[9px] text-[#666] uppercase tracking-wide font-bold">{room.type} · Cap: {room.capacity}</div>
                      </td>
                      <td className="p-2 text-right">
                        {room.isAvailable ? (
                          <div className="inline-flex items-center gap-1 bg-green-50 border border-green-300 text-green-700 px-2 py-0.5 text-[9px] font-bold uppercase tracking-widest">
                            <CheckCircle className="w-3 h-3" /> Available
                          </div>
                        ) : (
                          <div className="inline-flex items-center gap-1 bg-[#f8f9fa] border border-[#ccc] text-[#666] px-2 py-0.5 text-[9px] font-bold uppercase tracking-widest">
                            <AlertCircle className="w-3 h-3" /> Occupied
                          </div>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
          
          <div className="px-4 py-2 bg-[#e0e0e0] border-t border-[#ccc] text-[9px] font-bold text-[#333] uppercase tracking-wide">
             Displaying results for {day} @ {time} on Week {week}
          </div>
        </motion.div>
      </div>
    </AnimatePresence>
  );
};

export default RoomAvailabilityTool;
