import jsPDF from 'jspdf';
import autoTable from 'jspdf-autotable';
import type { Course, Faculty, Room, ScheduleEntry, StudentGroup } from '../types';

// Builds a timetable PDF: one page per cohort or per faculty, as a weekly grid
// (days across, hours down) or as a list of sessions.

export type PdfKind = 'cohort' | 'faculty';
export type PdfLayout = 'grid' | 'list';

export interface PdfPage {
  title: string;          // "Cohort: BCA-II-B1" / "Faculty: Name (ID)"
  subtitle: string;       // school, term
  entries: ScheduleEntry[];
}

interface Lookups {
  courses: Map<string, Course>;
  faculties: Map<string, Faculty>;
  rooms: Map<string, Room>;
  groups: Map<string, StudentGroup>;
}

const DAYS = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];
const toMin = (t: string) => { const [h, m] = (t || '0:0').split(':').map(Number); return (h || 0) * 60 + (m || 0); };
const hh = (h: number) => `${String(h).padStart(2, '0')}:00`;

function lookups(courses: Course[], faculties: Faculty[], rooms: Room[], groups: StudentGroup[]): Lookups {
  return {
    courses: new Map<string, Course>(courses.map(c => [c.id, c] as [string, Course])),
    faculties: new Map<string, Faculty>(faculties.map(f => [f.id, f] as [string, Faculty])),
    rooms: new Map<string, Room>(rooms.map(r => [r.id, r] as [string, Room])),
    groups: new Map<string, StudentGroup>(groups.map(g => [g.id, g] as [string, StudentGroup])),
  };
}

const courseLabel = (L: Lookups, e: ScheduleEntry) => {
  const c = L.courses.get(e.courseId ?? '');
  return c ? `${c.code}${c.name && c.name !== c.code ? ' ' + c.name : ''}` : 'Unknown course';
};
const roomLabel = (L: Lookups, e: ScheduleEntry) => L.rooms.get(e.roomId ?? '')?.name || 'No room';
const facultyLabel = (L: Lookups, e: ScheduleEntry) => L.faculties.get(e.facultyId ?? '')?.name || 'Unknown faculty';
const cohortsLabel = (L: Lookups, e: ScheduleEntry) =>
  (e.groupIds || []).map(g => L.groups.get(g)?.name || g).join(', ');

// The "who" line in a cell: the faculty on a cohort page, the cohorts on a faculty page.
const otherLabel = (kind: PdfKind, L: Lookups, e: ScheduleEntry) =>
  kind === 'cohort' ? facultyLabel(L, e) : cohortsLabel(L, e);

const sortEntries = (a: ScheduleEntry, b: ScheduleEntry) =>
  DAYS.indexOf(a.day) - DAYS.indexOf(b.day) || a.startTime.localeCompare(b.startTime);

function header(pdf: jsPDF, page: PdfPage, generated: string) {
  pdf.setFontSize(14);
  pdf.setTextColor(15, 23, 42);
  pdf.text(page.title, 10, 12);
  pdf.setFontSize(9);
  pdf.setTextColor(100, 116, 139);
  pdf.text(page.subtitle, 10, 18);
  pdf.text(`Generated ${generated}`, 287, 12, { align: 'right' });
}

function gridPage(pdf: jsPDF, page: PdfPage, kind: PdfKind, L: Lookups, firstHour: number, lastHour: number, days: string[]) {
  // Per day, sessions that overlap in time share one cell spanning their hours
  // (e.g. an elective basket, or a 2-hour lab next to two 1-hour classes).
  const nRows = lastHour - firstHour;
  const cells: (any | null | undefined)[][] = Array.from({ length: nRows }, () => Array(days.length).fill(undefined));
  days.forEach((day, di) => {
    const list = page.entries.filter(e => e.day === day).sort((a, b) => toMin(a.startTime) - toMin(b.startTime));
    let i = 0;
    while (i < list.length) {
      let start = toMin(list[i].startTime), end = toMin(list[i].endTime);
      const group = [list[i]]; i++;
      while (i < list.length && toMin(list[i].startTime) < end) { end = Math.max(end, toMin(list[i].endTime)); group.push(list[i]); i++; }
      const r0 = Math.max(0, Math.floor(start / 60) - firstHour);
      const r1 = Math.min(nRows, Math.ceil(end / 60) - firstHour);
      if (r1 <= r0) continue;
      const text = group.map(e => {
        const onGrid = toMin(e.startTime) % 60 === 0 && toMin(e.endTime) % 60 === 0 && group.length === 1;
        return [
          (onGrid ? '' : `${e.startTime}-${e.endTime}  `) + courseLabel(L, e),
          `${e.category || 'Theory'} · ${roomLabel(L, e)}`,
          otherLabel(kind, L, e),
        ].join('\n');
      }).join('\n- - -\n');
      cells[r0][di] = { content: text, rowSpan: r1 - r0, styles: { fillColor: group.some(e => /lab/i.test(e.category || '')) ? [236, 253, 245] : [239, 246, 255] } };
      for (let r = r0 + 1; r < r1; r++) cells[r][di] = null; // covered by the span
    }
  });
  const body = cells.map((row, r) => [
    { content: `${hh(firstHour + r)}\n${hh(firstHour + r + 1)}`, styles: { fontStyle: 'bold', halign: 'center', fillColor: [248, 250, 252] } },
    ...row.filter(c => c !== null).map(c => c ?? ''),
  ]);
  const dayWidth = (277 - 16) / days.length;
  autoTable(pdf, {
    startY: 22,
    head: [['Time', ...days]],
    body,
    theme: 'grid',
    margin: { left: 10, right: 10, top: 10, bottom: 10 },
    headStyles: { fillColor: [24, 91, 175], halign: 'center', valign: 'middle', fontSize: 8, minCellHeight: 7 },
    // Rows share the page height (A4 landscape) so a normal week fills one page.
    styles: { fontSize: 7, cellPadding: 1.2, valign: 'top', overflow: 'linebreak', lineColor: [203, 213, 225], lineWidth: 0.1,
      minCellHeight: Math.max(8, Math.min(15, 140 / Math.max(1, nRows))) },
    columnStyles: { 0: { cellWidth: 16 }, ...Object.fromEntries(days.map((_, i) => [i + 1, { cellWidth: dayWidth }])) },
    rowPageBreak: 'avoid',
  });
}

function listPage(pdf: jsPDF, page: PdfPage, kind: PdfKind, L: Lookups) {
  autoTable(pdf, {
    startY: 22,
    head: [['Day', 'Time', 'Course', 'Category', 'Room', kind === 'cohort' ? 'Faculty' : 'Cohorts']],
    body: [...page.entries].sort(sortEntries).map(e => [
      e.day, `${e.startTime} - ${e.endTime}`, courseLabel(L, e), e.category || 'Theory', roomLabel(L, e), otherLabel(kind, L, e),
    ]),
    theme: 'grid',
    margin: { left: 10, right: 10 },
    headStyles: { fillColor: [24, 91, 175] },
    styles: { fontSize: 8 },
    columnStyles: { 0: { cellWidth: 24 }, 1: { cellWidth: 26 }, 2: { cellWidth: 90 }, 3: { cellWidth: 22 }, 4: { cellWidth: 30 } },
  });
}

export async function downloadTimetablePdf(opts: {
  kind: PdfKind;
  layout: PdfLayout;
  pages: PdfPage[];
  courses: Course[]; faculties: Faculty[]; rooms: Room[]; groups: StudentGroup[];
  fileName: string;
}) {
  const { kind, layout, pages } = opts;
  const L = lookups(opts.courses, opts.faculties, opts.rooms, opts.groups);
  const all = pages.flatMap(p => p.entries);
  // Same hours and days on every page, so pages are easy to compare.
  const firstHour = Math.min(8, ...all.map(e => Math.floor(toMin(e.startTime) / 60)));
  const lastHour = Math.max(17, ...all.map(e => Math.ceil(toMin(e.endTime) / 60)));
  const days = DAYS.filter(d => d !== 'Sunday' || all.some(e => (e.day as string) === 'Sunday'));
  const generated = new Date().toLocaleString();

  const pdf = new jsPDF({ orientation: 'landscape', unit: 'mm', format: 'a4' });
  for (let i = 0; i < pages.length; i++) {
    if (i > 0) pdf.addPage();
    header(pdf, pages[i], generated);
    if (layout === 'grid') gridPage(pdf, pages[i], kind, L, firstHour, lastHour, days);
    else listPage(pdf, pages[i], kind, L);
    // Let the screen breathe on big exports (hundreds of pages).
    if (i % 25 === 24) await new Promise(r => setTimeout(r, 0));
  }
  const n = pdf.getNumberOfPages();
  for (let p = 1; p <= n; p++) {
    pdf.setPage(p);
    pdf.setFontSize(7);
    pdf.setTextColor(148, 163, 184);
    pdf.text(`UniTime · page ${p} of ${n}`, 287, 205, { align: 'right' });
  }
  pdf.save(opts.fileName);
}
