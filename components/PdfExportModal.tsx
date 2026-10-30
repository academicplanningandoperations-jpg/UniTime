import React, { useMemo, useState } from 'react';
import { X, FileText, Download, Search, CheckSquare, Square } from 'lucide-react';
import type { Course, Faculty, Room, ScheduleEntry, StudentGroup } from '../types';
import { cohortSchoolMap, sessionSchool, NO_SCHOOL } from '../utils/sessionSchool';
import { downloadTimetablePdf, PdfKind, PdfLayout, PdfPage } from '../utils/timetablePdf';

// Export PDF: cohort or faculty timetables, for one or more schools, or for
// cohorts / faculty picked from a list. School = the school from the
// course-assignment sheet, else the School saved on the cohort.

interface Props {
  onClose: () => void;
  schedule: ScheduleEntry[];   // the active term's sessions
  termName: string;
  courses: Course[];
  faculties: Faculty[];
  rooms: Room[];
  groups: StudentGroup[];      // the active term's cohorts
}

interface Person { id: string; name: string; schools: string[] }

const safe = (s: string) => s.replace(/[^A-Za-z0-9-]+/g, '_').replace(/^_|_$/g, '').slice(0, 60);

const PdfExportModal: React.FC<Props> = ({ onClose, schedule, termName, courses, faculties, rooms, groups }) => {
  const [kind, setKind] = useState<PdfKind>('cohort');
  const [scope, setScope] = useState<'school' | 'pick'>('school');
  const [schoolSel, setSchoolSel] = useState<Set<string>>(new Set());   // empty = all schools
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [search, setSearch] = useState('');
  const [layout, setLayout] = useState<PdfLayout>('grid');
  const [busy, setBusy] = useState(false);

  const data = useMemo(() => {
    const map = cohortSchoolMap(schedule, groups);
    const groupName = new Map<string, string>(groups.map(g => [g.id, g.name] as [string, string]));
    const fac = new Map<string, Faculty>(faculties.map(f => [f.id, f] as [string, Faculty]));
    const byCohort = new Map<string, ScheduleEntry[]>();
    const byFaculty = new Map<string, ScheduleEntry[]>();
    const facultySchools = new Map<string, Set<string>>();
    for (const e of schedule) {
      for (const g of e.groupIds || []) { const l = byCohort.get(g) ?? []; l.push(e); byCohort.set(g, l); }
      if (e.facultyId) {
        const l = byFaculty.get(e.facultyId) ?? []; l.push(e); byFaculty.set(e.facultyId, l);
        const s = facultySchools.get(e.facultyId) ?? new Set<string>(); s.add(sessionSchool(e, map)); facultySchools.set(e.facultyId, s);
      }
    }
    const cohorts: Person[] = [...byCohort.keys()]
      .map(id => ({ id, name: groupName.get(id) || id, schools: [map.get(id) || NO_SCHOOL] }))
      .sort((a, b) => a.name.localeCompare(b.name));
    const facs: Person[] = [...byFaculty.keys()]
      .map(id => {
        const f = fac.get(id);
        return { id, name: f ? `${f.name}${f.facultyId ? ` (${f.facultyId})` : ''}` : id, schools: [...(facultySchools.get(id) ?? [])].sort() };
      })
      .sort((a, b) => a.name.localeCompare(b.name));
    return { cohorts, facs, byCohort, byFaculty };
  }, [schedule, groups, faculties]);

  const people = kind === 'cohort' ? data.cohorts : data.facs;
  const schools = useMemo(() => {
    const c = new Map<string, number>();
    people.forEach(p => p.schools.forEach(s => c.set(s, (c.get(s) ?? 0) + 1)));
    return [...c.entries()].sort((a, b) => a[0].localeCompare(b[0]));
  }, [people]);

  const chosen = useMemo(() => {
    if (scope === 'pick') return people.filter(p => picked.has(p.id));
    return schoolSel.size === 0 ? people : people.filter(p => p.schools.some(s => schoolSel.has(s)));
  }, [scope, picked, schoolSel, people]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return q ? people.filter(p => p.name.toLowerCase().includes(q) || p.schools.some(s => s.toLowerCase().includes(q))) : people;
  }, [people, search]);

  const switchKind = (k: PdfKind) => { setKind(k); setSchoolSel(new Set()); setPicked(new Set()); setSearch(''); };
  const toggle = (set: Set<string>, id: string, update: (s: Set<string>) => void) => {
    const n = new Set(set); n.has(id) ? n.delete(id) : n.add(id); update(n);
  };
  const allShownPicked = filtered.length > 0 && filtered.every(p => picked.has(p.id));
  const togglePickShown = () => {
    const n = new Set(picked);
    filtered.forEach(p => allShownPicked ? n.delete(p.id) : n.add(p.id));
    setPicked(n);
  };

  const download = async () => {
    if (chosen.length === 0) return;
    setBusy(true);
    try {
      await new Promise(r => setTimeout(r, 30)); // show "Preparing…" first
      const label = kind === 'cohort' ? 'Cohort' : 'Faculty';
      const pages: PdfPage[] = chosen.map(p => ({
        name: p.name,
        schools: p.schools,
        entries: (kind === 'cohort' ? data.byCohort.get(p.id) : data.byFaculty.get(p.id)) ?? [],
      }));
      const scopeText = scope === 'pick'
        ? (chosen.length === 1 ? chosen[0].name : `${chosen.length} selected ${kind === 'cohort' ? 'cohorts' : 'faculty'}`)
        : schoolSel.size === 0 ? 'All schools' : [...schoolSel].sort().join(', ');
      const fileWhat = scope === 'pick'
        ? (chosen.length === 1 ? chosen[0].name : `${chosen.length}_selected`)
        : schoolSel.size === 0 ? 'All_schools' : schoolSel.size === 1 ? [...schoolSel][0] : `${schoolSel.size}_schools`;
      await downloadTimetablePdf({
        kind, layout, pages, termName, scope: scopeText, courses, faculties, rooms, groups,
        fileName: `${label}_Timetable_${safe(fileWhat)}_${safe(termName)}.pdf`,
      });
      onClose();
    } catch (err: any) {
      console.error('PDF export failed:', err);
      alert('Could not create the PDF: ' + (err?.message || 'unknown error'));
    } finally {
      setBusy(false);
    }
  };

  const tab = (active: boolean) =>
    `flex-1 px-3 py-2 text-[11px] font-bold border transition-colors ${active ? 'bg-[#185baf] text-white border-[#185baf]' : 'bg-white text-[#333] border-[#cbd5e1] hover:border-[#185baf]'}`;
  const label = 'block text-[10px] font-black uppercase tracking-widest text-slate-500 mb-1.5';
  const box = (on: boolean) => on ? <CheckSquare className="w-3.5 h-3.5 text-[#185baf] shrink-0" /> : <Square className="w-3.5 h-3.5 text-slate-400 shrink-0" />;
  const row = 'w-full flex items-center gap-2 px-2 py-1.5 text-left text-[12px] hover:bg-[#f0f6ff]';
  const noun = kind === 'cohort' ? 'cohorts' : 'faculty';

  return (
    <div className="fixed inset-0 z-[200] bg-black/40 flex items-center justify-center p-4" onClick={() => !busy && onClose()}>
      <div className="bg-white w-full max-w-[500px] max-h-[92vh] flex flex-col shadow-2xl border border-[#ccc]" onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between px-4 py-2.5 bg-[#185baf] text-white">
          <div className="flex items-center gap-2 text-[13px] font-bold"><FileText className="w-4 h-4" /> Export PDF · {termName}</div>
          <button onClick={onClose} disabled={busy} className="hover:opacity-80" aria-label="Close"><X className="w-4 h-4" /></button>
        </div>

        <div className="p-4 space-y-4 overflow-y-auto">
          <div>
            <span className={label}>Timetable of</span>
            <div className="flex gap-2">
              <button className={tab(kind === 'cohort')} onClick={() => switchKind('cohort')}>Cohorts</button>
              <button className={tab(kind === 'faculty')} onClick={() => switchKind('faculty')}>Faculty</button>
            </div>
          </div>

          <div>
            <span className={label}>Which</span>
            <div className="flex gap-2 mb-2">
              <button className={tab(scope === 'school')} onClick={() => setScope('school')}>By school</button>
              <button className={tab(scope === 'pick')} onClick={() => setScope('pick')}>Pick {noun}</button>
            </div>

            {scope === 'school' ? (
              <>
                <div className="border border-[#cbd5e1] max-h-[220px] overflow-y-auto">
                  <button className={`${row} border-b border-[#eef2f7] font-bold`} onClick={() => setSchoolSel(new Set())}>
                    {box(schoolSel.size === 0)} All schools <span className="ml-auto text-slate-500 font-normal">{people.length}</span>
                  </button>
                  {schools.map(([s, n]) => (
                    <button key={s} className={row} onClick={() => toggle(schoolSel, s, setSchoolSel)}>
                      {box(schoolSel.has(s))} <span className="truncate">{s}</span> <span className="ml-auto text-slate-500">{n}</span>
                    </button>
                  ))}
                </div>
                <p className="text-[10px] text-slate-500 mt-1.5">
                  Tick one or more schools.{kind === 'faculty' ? " Faculty who teach in a ticked school are included; each page shows all of that faculty's classes." : ''}
                </p>
              </>
            ) : (
              <>
                <div className="relative mb-1.5">
                  <Search className="w-3.5 h-3.5 text-slate-400 absolute left-2 top-1/2 -translate-y-1/2" />
                  <input value={search} onChange={e => setSearch(e.target.value)} placeholder={kind === 'cohort' ? 'Search cohort or school…' : 'Search name, ID or school…'}
                    className="w-full text-[12px] border border-[#cbd5e1] pl-7 pr-2 py-2 outline-none focus:border-[#185baf]" />
                </div>
                <div className="flex items-center justify-between text-[11px] mb-1">
                  <button onClick={togglePickShown} disabled={filtered.length === 0} className="font-bold text-[#185baf] hover:underline disabled:opacity-40">
                    {allShownPicked ? 'Unselect' : 'Select'} {search.trim() ? `all ${filtered.length} shown` : `all ${filtered.length}`}
                  </button>
                  <span className="text-slate-500">
                    {picked.size} selected{picked.size > 0 && <> · <button onClick={() => setPicked(new Set())} className="text-[#185baf] hover:underline">clear</button></>}
                  </span>
                </div>
                <div className="border border-[#cbd5e1] h-[240px] overflow-y-auto">
                  {filtered.map(p => (
                    <button key={p.id} className={row} onClick={() => toggle(picked, p.id, setPicked)}>
                      {box(picked.has(p.id))}
                      <span className="truncate">{p.name}</span>
                      <span className="ml-auto pl-2 text-[10px] text-slate-400 truncate max-w-[45%]">{p.schools.join(', ')}</span>
                    </button>
                  ))}
                  {filtered.length === 0 && <p className="text-[11px] text-slate-500 p-2">No match.</p>}
                </div>
              </>
            )}
          </div>

          <div>
            <span className={label}>Layout</span>
            <div className="flex gap-2">
              <button className={tab(layout === 'grid')} onClick={() => setLayout('grid')}>Weekly grid</button>
              <button className={tab(layout === 'list')} onClick={() => setLayout('list')}>List</button>
            </div>
          </div>
        </div>

        <div className="flex items-center justify-between px-4 py-3 border-t border-[#e2e8f0] bg-[#f8fafc]">
          <span className="text-[11px] text-slate-600">
            {chosen.length === 0 ? (scope === 'pick' ? `Tick the ${noun} you want` : 'Nothing to export')
              : `${chosen.length} timetable${chosen.length === 1 ? '' : 's'}${chosen.length > 1 ? ' + contents page' : ''}`}
          </span>
          <button onClick={download} disabled={busy || chosen.length === 0}
            className="flex items-center gap-1.5 px-4 py-2 bg-[#185baf] text-white text-[11px] font-black uppercase tracking-widest disabled:opacity-40 disabled:cursor-not-allowed hover:bg-[#124584]">
            <Download className="w-3.5 h-3.5" /> {busy ? 'Preparing…' : 'Download PDF'}
          </button>
        </div>
      </div>
    </div>
  );
};

export default PdfExportModal;
