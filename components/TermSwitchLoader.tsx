import React from 'react';

// Full-screen "switching term" overlay: the page behind is blurred and the
// UniTime logo builds itself cell by cell — like a timetable filling up —
// inside a turning ring. Shown only while a different term's data loads.

// Logo cells in the order they light up (clockwise round the edge, centre last).
const CELLS: [number, number][] = [
  [3, 3], [9.5, 3], [16, 3], [16, 9.5], [16, 16], [9.5, 16], [3, 16], [3, 9.5], [9.5, 9.5],
];
const STEP = 0.12; // seconds between cells

const TermSwitchLoader: React.FC<{ termName: string }> = ({ termName }) => (
  <div
    className="fixed inset-0 z-[500] flex items-center justify-center bg-white/40 backdrop-blur-md"
    role="status"
    aria-live="polite"
  >
    <style>{`
      @keyframes ut-cell { 0%, 12% { opacity: .18; transform: scale(.7); } 30%, 80% { opacity: 1; transform: scale(1); } 100% { opacity: .18; transform: scale(.7); } }
      @keyframes ut-ring { to { transform: rotate(360deg); } }
      .ut-cell { transform-box: fill-box; transform-origin: center; animation: ut-cell ${CELLS.length * STEP + 0.9}s ease-in-out infinite; }
      .ut-ring { animation: ut-ring 1.1s linear infinite; }
      @media (prefers-reduced-motion: reduce) { .ut-cell, .ut-ring { animation: none; } .ut-cell { opacity: 1; } }
    `}</style>
    <div className="flex flex-col items-center gap-4 px-8 py-7 bg-white/85 border border-[#c8ddf8] shadow-2xl">
      <div className="relative w-24 h-24">
        <svg viewBox="0 0 48 48" className="absolute inset-0 w-full h-full ut-ring" aria-hidden="true">
          <circle cx="24" cy="24" r="21" fill="none" stroke="#dbe7f7" strokeWidth="2.5" />
          <circle cx="24" cy="24" r="21" fill="none" stroke="#185baf" strokeWidth="2.5" strokeLinecap="round" strokeDasharray="34 98" />
        </svg>
        <svg viewBox="0 0 24 24" className="absolute inset-[22%] w-[56%] h-[56%]" aria-hidden="true">
          {CELLS.map(([x, y], i) => (
            <rect key={i} x={x} y={y} width="5" height="5" rx="1.5" className="ut-cell"
              fill={i === CELLS.length - 1 ? '#0f3d8c' : '#185baf'}
              style={{ animationDelay: `${i * STEP}s` }} />
          ))}
        </svg>
      </div>
      <div className="text-center">
        <div className="text-[10px] font-black uppercase tracking-[0.2em] text-[#64748b]">Switching term</div>
        <div className="text-[16px] font-black text-[#0f172a] mt-0.5">Loading {termName}…</div>
      </div>
    </div>
  </div>
);

export default TermSwitchLoader;
