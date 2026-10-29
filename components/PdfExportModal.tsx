import React, { useMemo, useState } from 'react';
import { X, FileText, Download } from 'lucide-react';
import type { Course, Faculty, Room, ScheduleEntry, StudentGroup } from '../types';
import { cohortSchoolMap, sessionSchool, NO_SCHOOL } from '../utils/sessionSchool';
import { downloadTimetablePdf, PdfKind, PdfLayout, PdfPage } from '../utils/timetablePdf';

// Export PDF: cohort or faculty timetables, for one school, every school, or
// one cohort / one faculty. School = the school from the course-assignment sheet.

interface Props {
  onClose: () => void;
  schedule: ScheduleEntry[];   // the active term's sessions
  termName: string;
  courses: Course[];
  faculties: Faculty[];
  rooms: Room[];
  groups: StudentGroup[];
}

const ALL = '__all__';
const safe = (s: string) => s.replace(/[^A-Za-z0-9-]+/g, '_').replace(/^_|_$/g, '');

const PdfExportModal: React.FC<Props> = ({ onClose, schedule, termName, courses, faculties, rooms, groups }) => {
  const [kind, setKind] = useState<PdfKind>('cohort');
  const [scope, setScope] = useState<'school' | 'one'>('school');
  const [school, setSchool] = useState(ALL);
  const [oneId, setOneId] = useState('');
  const [search, setSearch] = useState('');
  const [layout, setLayout] = useState<PdfLayout>('grid');
  const [busy, setBusy] = useState(false);

  const data = useMemo(() => {
    const map = cohortSchoolMap(schedule);
    const groupName = new Map<string, string>(groups.map(g => [g.id, g.name] as [string, string]));
    const fac = new Map<string, Faculty>(faculties.map(f => [f.id, f] as [string, Faculty]));

    // cohort -> its sessions and school
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
    const cohortSchool = (g: string) => map.get(g) || (byCohort.get(g)?.[0] ? sessionSchool(byCohort.get(g)![0], map) : NO_SCHOOL);
    const cohorts = [...byCohort.keys()]
      .map(id => ({ id, name: groupName.get(id) || id, schools: [cohortSchool(id)] }))
      .sort((a, b) => a.name.localeCompare(b.name));
    const facs = [...byFaculty.keys()]
      .map(id => {
        const f = fac.get(id);
        const name = f ? `${f.name}${f.facultyId ? ` (${f.facultyId})` : ''}` : id;
        return { id, name, schools: [...(facultySchools.get(id) ?? [])].sort() };
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
    if (scope === 'one') return people.filter(p => p.id === oneId);
    return school === ALL ? people : people.filter(p => p.schools.includes(school));
  }, [scope, oneId, school, people]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return q ? people.filter(p => p.name.toLowerCase().includes(q)) : people;
  }, [people, search]);

  const switchKind = (k: PdfKind) => { setKind(k); setSchool(ALL); setOneId(''); setSearch(''); };

  const download = async () => {
    if (chosen.length === 0) return;
    setBusy(true);
    try {
      await new Promise(r => setTimeout(r, 30)); // show "Preparing…" first
      const label = kind === 'cohort' ? 'Cohort' : 'Faculty';
      const pages: PdfPage[] = chosen.map(p => ({
        title: `${label}: ${p.name}`,
        subtitle: `${kind === 'cohort' ? 'School' : 'Teaches in'}: ${p.schools.join(', ') || NO_SCHOOL}   ·   Term: ${termName}`,
        entries: (kind === 'cohort' ? data.byCohort.get(p.id) : data.byFaculty.get(p.id)) ?? [],
      }));
      const what = scope === 'one' ? chosen[0].name : school === ALL ? 'All_schools' : school;
      await downloadTimetablePdf({
        kind, layout, pages, courses, faculties, rooms, groups,
        fileName: `${label}_Timetable_${safe(what)}_${safe(termName)}.pdf`,
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
    `flex-1 px-3 py-2 text-[11px] font-bold border ${active ? 'bg-[#185baf] text-white border-[#185baf]' : 'bg-white text-[#333] border-[#cbd5e1] hover:border-[#185baf]'}`;
  const label = 'block text-[10px] font-black uppercase tracking-widest text-slate-500 mb-1.5';

  return (
    <div className="fixed inset-0 z-[200] bg-black/40 flex items-center justify-center p-4" onClick={() => !busy && onClose()}>
      <div className="bg-white w-full max-w-[460px] shadow-2xl border border-[#ccc]" onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between px-4 py-2.5 bg-[#185baf] text-white">
          <div className="flex items-center gap-2 text-[13px] font-bold"><FileText className="w-4 h-4" /> Export PDF</div>
          <button onClick={onClose} disabled={busy} className="hover:opacity-80" aria-label="Close"><X className="w-4 h-4" /></button>
        </div>

        <div className="p-4 space-y-4">
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
              <button className={tab(scope === 'one')} onClick={() => setScope('one')}>One {kind === 'cohort' ? 'cohort' : 'faculty'}</button>
            </div>
            {scope === 'school' ? (
              <>
                <select value={school} onChange={e => setSchool(e.target.value)}
                  className="w-full text-[12px] border border-[#cbd5e1] bg-white px-2 py-2 outline-none focus:border-[#185baf]">
                  <option value={ALL}>All schools ({people.length})</option>
                  {schools.map(([s, n]) => <option key={s} value={s}>{s} ({n})</option>)}
                </select>
                {kind === 'faculty' && (
                  <p className="text-[10px] text-slate-500 mt-1.5">Faculty who teach in this school. Each page shows all of that faculty's classes.</p>
                )}
              </>
            ) : (
              <>
                <input value={search} onChange={e => setSearch(e.target.value)} placeholder={`Search ${kind === 'cohort' ? 'cohort' : 'faculty name or ID'}…`}
                  className="w-full text-[12px] border border-[#cbd5e1] px-2 py-2 mb-1.5 outline-none focus:border-[#185baf]" />
                <select value={oneId} onChange={e => setOneId(e.target.value)} size={6}
                  className="w-full text-[12px] border border-[#cbd5e1] bg-white px-1 py-1 outline-none focus:border-[#185baf]">
                  {filtered.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
                </select>
                {filtered.length === 0 && <p className="text-[10px] text-slate-500 mt-1">No match.</p>}
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
            {chosen.length === 0 ? (scope === 'one' ? 'Pick one from the list' : 'Nothing to export') : `${chosen.length} page${chosen.length === 1 ? '' : 's'} · ${termName}`}
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
