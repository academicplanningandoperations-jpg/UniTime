import React, { useState } from 'react';
import { Clash } from '../types';
import { AlertCircle, ShieldAlert, Users, DoorOpen, Zap, X, Trash2, AlertTriangle } from 'lucide-react';

interface ClashIndicatorProps {
  clashes: Clash[];
}

const ClashIndicator: React.FC<ClashIndicatorProps> = ({ clashes }) => {
  const [dismissed, setDismissed] = useState<Set<string>>(new Set());
  const [isOpen, setIsOpen] = useState(false);

  const visibleClashes = clashes.filter(c => !dismissed.has(c.message));

  if (clashes.length === 0) return null;

  const getIcon = (type: string) => {
    switch (type) {
      case 'Room': return <DoorOpen className="w-4 h-4" />;
      case 'Faculty': return <ShieldAlert className="w-4 h-4" />;
      case 'Cohort': return <Users className="w-4 h-4" />;
      case 'LoadViolation': return <Zap className="w-4 h-4" />;
      default: return <AlertCircle className="w-4 h-4" />;
    }
  };

  const dismissAll = () => {
    setDismissed(new Set(clashes.map(c => c.message)));
  };

  return (
    <div className="fixed bottom-6 right-6 z-[100] flex flex-col gap-2 w-80 max-h-[70vh] pointer-events-none items-end">
      {!isOpen ? (
        <button 
          onClick={() => setIsOpen(true)}
          className="pointer-events-auto bg-white border-2 border-[#d9534f] text-[#d9534f] p-3 shadow-[4px_4px_0_rgba(217,83,79,0.3)] hover:bg-[#fdedec] transition-colors relative"
        >
          <AlertTriangle className="w-6 h-6" />
          <div className="absolute -top-2 -right-2 bg-[#d9534f] text-white text-[10px] font-black min-w-[20px] h-5 px-1 flex items-center justify-center border-2 border-white shadow-sm">
            {clashes.length}
          </div>
        </button>
      ) : (
        <div className="flex flex-col gap-2 w-full max-h-[70vh]">
          <div className="flex justify-between items-center pointer-events-auto bg-white border-2 border-[#d9534f] p-2 shadow-[4px_4px_0_rgba(217,83,79,0.3)] shrink-0">
            <div className="text-[12px] font-black text-[#d9534f] flex items-center gap-2">
              <AlertTriangle className="w-4 h-4" />
              {clashes.length} SYSTEM WARNING{clashes.length !== 1 ? 'S' : ''}
              {dismissed.size > 0 && (
                <span className="text-[9px] text-[#666] font-normal italic">
                  ({dismissed.size} hidden)
                </span>
              )}
            </div>
            <button 
              onClick={() => setIsOpen(false)}
              className="text-[#999] hover:text-[#333] p-0.5"
            >
              <X className="w-4 h-4" />
            </button>
          </div>

          <div className="flex flex-col gap-2 overflow-y-auto custom-scrollbar pr-2 pb-2" style={{ pointerEvents: 'auto' }}>
            {visibleClashes.length > 1 && (
              <div className="flex justify-end pointer-events-auto">
                <button 
                  onClick={dismissAll}
                  className="bg-[#d9534f] text-white text-[10px] font-bold uppercase tracking-wider px-3 py-1.5 flex items-center gap-1 hover:bg-[#c9302c] shadow-[2px_2px_0_rgba(169,68,66,0.3)] border border-[#a94442] transition-colors"
                >
                  <Trash2 className="w-3 h-3" />
                  Dismiss All
                </button>
              </div>
            )}
            
            {visibleClashes.length === 0 && dismissed.size > 0 && (
               <div className="bg-white border-2 border-[#ccc] p-4 text-center">
                 <p className="text-[10px] font-bold text-[#666] uppercase">All warnings have been dismissed.</p>
                 <button 
                   onClick={() => setDismissed(new Set())}
                   className="mt-2 text-[10px] font-bold text-[#185baf] underline uppercase"
                 >
                   Restore Dismissed Warnings
                 </button>
               </div>
            )}
            
            {visibleClashes.map((clash, idx) => (
              <div 
                key={idx} 
                className="bg-[#d9534f] border-2 border-[#a94442] shadow-[4px_4px_0_rgba(169,68,66,0.3)] shrink-0"
              >
                <div className="bg-[#c9302c] px-3 py-1.5 flex items-center justify-between border-b border-[#a94442]">
                  <div className="flex items-center gap-2">
                    <div className="text-white bg-[#a94442] p-1 rounded-sm">
                      {getIcon(clash.type)}
                    </div>
                    <span className="text-[12px] font-bold text-white uppercase tracking-wider">
                      {clash.type.replace(/([A-Z])/g, ' $1').trim()} Conflict
                    </span>
                  </div>
                  <button 
                    onClick={() => setDismissed(new Set(dismissed).add(clash.message))}
                    className="text-white hover:text-[#fdedec] bg-[#a94442] hover:bg-[#800000] p-0.5 rounded transition-colors"
                  >
                    <X className="w-3.5 h-3.5" />
                  </button>
                </div>
                <div className="p-3 bg-[#fdedec]">
                  <p className="text-[11px] text-[#a94442] font-bold leading-relaxed">{clash.message}</p>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
};

export default ClashIndicator;
