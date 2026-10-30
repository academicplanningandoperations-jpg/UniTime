import jsPDF from 'jspdf';
import autoTable from 'jspdf-autotable';
import type { Course, Faculty, Room, ScheduleEntry, StudentGroup } from '../types';

// Builds a timetable PDF: one page per cohort or per faculty, as a weekly grid
// (days across, hours down) or as a list. With more than one timetable, a cover
// page with an index comes first.

export type PdfKind = 'cohort' | 'faculty';
export type PdfLayout = 'grid' | 'list';

export interface PdfPage {
  name: string;           // "BCA-II-B1" / "Name (ID)"
  schools: string[];      // school(s) shown under the name
  entries: ScheduleEntry[];
}

interface Lookups {
  courses: Map<string, Course>;
  faculties: Map<string, Faculty>;
  rooms: Map<string, Room>;
  groups: Map<string, StudentGroup>;
}

type RGB = [number, number, number];
const W = 297, H = 210, M = 10;                 // A4 landscape, margin (mm)
const BRAND: RGB = [24, 91, 175], NAVY: RGB = [15, 41, 87], INK: RGB = [15, 23, 42], MUTED: RGB = [100, 116, 139];
const LINE: RGB = [214, 222, 233];
const DAYS = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];
const SHORT: Record<string, string> = { Monday: 'Mon', Tuesday: 'Tue', Wednesday: 'Wed', Thursday: 'Thu', Friday: 'Fri', Saturday: 'Sat', Sunday: 'Sun' };

// Colour per kind of class: light card fill + strong left stripe.
const KINDS: { label: string; test: (c: string) => boolean; fill: RGB; bar: RGB }[] = [
  { label: 'Elective', test: c => /^pe\s*\d|elective|basket/i.test(c), fill: [243, 232, 255], bar: [147, 51, 234] },
  { label: 'Lab', test: c => /lab|practical/i.test(c), fill: [220, 252, 231], bar: [22, 163, 74] },
  { label: 'Tutorial', test: c => /tutorial/i.test(c), fill: [254, 243, 199], bar: [217, 119, 6] },
  { label: 'Theory', test: c => /theory|^$/i.test(c), fill: [226, 236, 254], bar: [37, 99, 235] },
  { label: 'Other', test: () => true, fill: [241, 245, 249], bar: [100, 116, 139] },
];
const kindOf = (e: ScheduleEntry) => KINDS.find(k => k.test((e.category || '').trim()))!;

const toMin = (t: string) => { const [h, m] = (t || '0:0').split(':').map(Number); return (h || 0) * 60 + (m || 0); };
const hh = (h: number) => `${String(h).padStart(2, '0')}:00`;
const sortEntries = (a: ScheduleEntry, b: ScheduleEntry) =>
  DAYS.indexOf(a.day) - DAYS.indexOf(b.day) || a.startTime.localeCompare(b.startTime);

function lookups(courses: Course[], faculties: Faculty[], rooms: Room[], groups: StudentGroup[]): Lookups {
  return {
    courses: new Map<string, Course>(courses.map(c => [c.id, c] as [string, Course])),
    faculties: new Map<string, Faculty>(faculties.map(f => [f.id, f] as [string, Faculty])),
    rooms: new Map<string, Room>(rooms.map(r => [r.id, r] as [string, Room])),
    groups: new Map<string, StudentGroup>(groups.map(g => [g.id, g] as [string, StudentGroup])),
  };
}

const courseCode = (L: Lookups, e: ScheduleEntry) => L.courses.get(e.courseId ?? '')?.code || 'Course';
const courseName = (L: Lookups, e: ScheduleEntry) => {
  const c = L.courses.get(e.courseId ?? '');
  return c && c.name && c.name !== c.code ? c.name : '';
};
const roomLabel = (L: Lookups, e: ScheduleEntry) => L.rooms.get(e.roomId ?? '')?.name || 'No room';
const facultyLabel = (L: Lookups, e: ScheduleEntry) => L.faculties.get(e.facultyId ?? '')?.name || 'Unknown faculty';
const cohortsLabel = (L: Lookups, e: ScheduleEntry) => (e.groupIds || []).map(g => L.groups.get(g)?.name || g).join(', ');
// The "with" line: the faculty on a cohort page, the cohorts on a faculty page.
const withLabel = (kind: PdfKind, L: Lookups, e: ScheduleEntry) => kind === 'cohort' ? facultyLabel(L, e) : cohortsLabel(L, e);

const hoursOf = (entries: ScheduleEntry[]) =>
  Math.round(entries.reduce((s, e) => s + Math.max(0, toMin(e.endTime) - toMin(e.startTime)), 0) / 6) / 10;

// ── Page furniture ─────────────────────────────────────────────────────────
function band(pdf: jsPDF, eyebrow: string, title: string, right: string) {
  pdf.setFillColor(...NAVY); pdf.rect(0, 0, W, 19, 'F');
  pdf.setFillColor(...BRAND); pdf.rect(0, 19, W, 1.2, 'F');
  pdf.setTextColor(170, 196, 235); pdf.setFont('helvetica', 'bold'); pdf.setFontSize(7);
  pdf.text(eyebrow.toUpperCase(), M, 7);
  pdf.setTextColor(255, 255, 255); pdf.setFontSize(15);
  pdf.text(pdf.splitTextToSize(title, 200)[0], M, 14.5);
  pdf.setFont('helvetica', 'normal'); pdf.setFontSize(9); pdf.setTextColor(214, 228, 248);
  pdf.text(right, W - M, 12, { align: 'right' });
}

// "School  X   |   Term  Y   |   Classes  N" — label grey, value dark.
function infoLine(pdf: jsPDF, items: [string, string][], y = 26.5) {
  let x = M;
  pdf.setFontSize(8);
  items.forEach(([k, v], i) => {
    if (i > 0) { pdf.setDrawColor(...LINE); pdf.line(x - 3, y - 3, x - 3, y + 1); }
    pdf.setFont('helvetica', 'normal'); pdf.setTextColor(...MUTED); pdf.text(k, x, y);
    x += pdf.getTextWidth(k) + 1.5;
    pdf.setFont('helvetica', 'bold'); pdf.setTextColor(...INK);
    const val = pdf.splitTextToSize(v, 120)[0];
    pdf.text(val, x, y);
    x += pdf.getTextWidth(val) + 7;
  });
  pdf.setFont('helvetica', 'normal');
}

function legend(pdf: jsPDF, y = H - 6.5) {
  let x = M;
  pdf.setFontSize(7);
  KINDS.forEach(k => {
    pdf.setFillColor(...k.fill); pdf.rect(x, y - 2.6, 5, 3.2, 'F');
    pdf.setFillColor(...k.bar); pdf.rect(x, y - 2.6, 1, 3.2, 'F');
    pdf.setTextColor(...MUTED); pdf.text(k.label, x + 6.5, y);
    x += 6.5 + pdf.getTextWidth(k.label) + 6;
  });
}

// ── Weekly grid ────────────────────────────────────────────────────────────
interface Card { e: ScheduleEntry; lines: string[] }

function gridPage(pdf: jsPDF, page: PdfPage, kind: PdfKind, L: Lookups, firstHour: number, lastHour: number, days: string[]) {
  const nRows = lastHour - firstHour;
  const cells: (any | null | undefined)[][] = Array.from({ length: nRows }, () => Array(days.length).fill(undefined));
  // Per day, sessions that overlap in time share one cell spanning their hours
  // (an elective basket, or a 2-hour lab beside 1-hour classes).
  days.forEach((day, di) => {
    const list = page.entries.filter(e => e.day === day).sort((a, b) => toMin(a.startTime) - toMin(b.startTime));
    let i = 0;
    while (i < list.length) {
      const start = toMin(list[i].startTime); let end = toMin(list[i].endTime);
      const group = [list[i]]; i++;
      while (i < list.length && toMin(list[i].startTime) < end) { end = Math.max(end, toMin(list[i].endTime)); group.push(list[i]); i++; }
      const r0 = Math.max(0, Math.floor(start / 60) - firstHour);
      const r1 = Math.min(nRows, Math.ceil(end / 60) - firstHour);
      if (r1 <= r0) continue;
      const cards: Card[] = group.map(e => {
        const offGrid = toMin(e.startTime) % 60 !== 0 || toMin(e.endTime) % 60 !== 0 || group.length > 1;
        return { e, lines: [
          courseCode(L, e) + (offGrid ? `   ${e.startTime}-${e.endTime}` : ''),
          courseName(L, e),
          `${roomLabel(L, e)}  ·  ${e.category || 'Theory'}`,
          withLabel(kind, L, e),
        ].filter(Boolean) };
      });
      // The text is drawn by hand (see didDrawCell); it is passed here only so
      // the table makes the row tall enough for it.
      cells[r0][di] = { content: cards.map(c => c.lines.join('\n')).join('\n\n'), rowSpan: r1 - r0, cards };
      for (let r = r0 + 1; r < r1; r++) cells[r][di] = null; // covered by the span
    }
  });
  const body = cells.map((row, r) => [
    { content: `${hh(firstHour + r)}\n${hh(firstHour + r + 1)}`, time: true },
    ...row.filter(c => c !== null).map(c => c ?? ''),
  ]);
  const dayWidth = (W - 2 * M - 15) / days.length;

  autoTable(pdf, {
    startY: 31,
    head: [['', ...days]],
    body,
    theme: 'grid',
    margin: { left: M, right: M, top: 24, bottom: 12 },
    headStyles: { fillColor: [235, 241, 250], textColor: NAVY, halign: 'center', valign: 'middle', fontStyle: 'bold', fontSize: 8.5, minCellHeight: 7 },
    styles: {
      font: 'helvetica', fontSize: 6.6, cellPadding: { top: 1.6, bottom: 1.6, left: 2.6, right: 1.4 }, valign: 'top',
      overflow: 'linebreak', lineColor: LINE, lineWidth: 0.15, textColor: INK,
      minCellHeight: Math.max(8, Math.min(14.5, 138 / Math.max(1, nRows))),
    },
    columnStyles: { 0: { cellWidth: 15 }, ...Object.fromEntries(days.map((_, i) => [i + 1, { cellWidth: dayWidth }])) },
    rowPageBreak: 'avoid',
    didParseCell: d => {
      if (d.section !== 'body') return;
      if (d.column.index === 0) { d.cell.styles.fillColor = [248, 250, 252]; d.cell.styles.halign = 'center'; d.cell.styles.fontStyle = 'bold'; d.cell.styles.textColor = MUTED; d.cell.styles.fontSize = 7; }
      else if (d.row.index % 2 === 1) d.cell.styles.fillColor = [252, 253, 255];
    },
    willDrawCell: d => { if (d.section === 'body' && (d.cell.raw as any)?.cards) d.cell.text = []; },
    didDrawCell: d => {
      const cards: Card[] | undefined = d.section === 'body' ? (d.cell.raw as any)?.cards : undefined;
      if (!cards) return;
      const pad = 0.7, gap = 0.8;
      const h = (d.cell.height - 2 * pad - gap * (cards.length - 1)) / cards.length;
      cards.forEach((c, i) => {
        const x = d.cell.x + pad, y = d.cell.y + pad + i * (h + gap), w = d.cell.width - 2 * pad;
        const k = kindOf(c.e);
        pdf.setFillColor(...k.fill); pdf.roundedRect(x, y, w, h, 0.8, 0.8, 'F');
        pdf.setFillColor(...k.bar); pdf.rect(x, y, 1.1, h, 'F');
        let ty = y + 3;
        const tw = w - 3.2;
        c.lines.forEach((ln, li) => {
          if (ty > y + h - 0.6) return;
          if (li === 0) { pdf.setFont('helvetica', 'bold'); pdf.setFontSize(7); pdf.setTextColor(...INK); }
          else if (li === 1 && courseName(L, c.e)) { pdf.setFont('helvetica', 'normal'); pdf.setFontSize(6.4); pdf.setTextColor(30, 41, 59); }
          else { pdf.setFont('helvetica', 'normal'); pdf.setFontSize(6.1); pdf.setTextColor(...MUTED); }
          // The last line (cohorts on a faculty page) may wrap; others stay one line.
          const isLast = li === c.lines.length - 1;
          const parts: string[] = pdf.splitTextToSize(ln, tw);
          const room = Math.max(1, Math.floor((y + h - ty) / 2.5));
          const show = isLast ? parts.slice(0, room) : parts.slice(0, 1);
          if (parts.length > show.length) show[show.length - 1] = show[show.length - 1].replace(/.{0,2}$/, '…');
          show.forEach(p => { if (ty <= y + h - 0.6) { pdf.text(p, x + 2.2, ty); ty += 2.5; } });
        });
      });
      pdf.setFont('helvetica', 'normal');
    },
  });
}

// ── List ───────────────────────────────────────────────────────────────────
function listPage(pdf: jsPDF, page: PdfPage, kind: PdfKind, L: Lookups) {
  const sorted = [...page.entries].sort(sortEntries);
  const body: any[] = [];
  sorted.forEach((e, i) => {
    const first = i === 0 || sorted[i - 1].day !== e.day;
    const span = sorted.filter(x => x.day === e.day).length;
    body.push([
      ...(first ? [{ content: e.day, rowSpan: span, styles: { fontStyle: 'bold', textColor: NAVY, fillColor: [244, 247, 252] } }] : []),
      `${e.startTime} - ${e.endTime}`,
      { content: courseCode(L, e), entry: e },
      courseName(L, e),
      e.category || 'Theory',
      roomLabel(L, e),
      withLabel(kind, L, e),
    ]);
  });
  autoTable(pdf, {
    startY: 31,
    head: [['Day', 'Time', 'Code', 'Course', 'Type', 'Room', kind === 'cohort' ? 'Faculty' : 'Cohorts']],
    body,
    theme: 'grid',
    margin: { left: M, right: M, top: 24, bottom: 12 },
    headStyles: { fillColor: NAVY, textColor: [255, 255, 255], fontStyle: 'bold', fontSize: 8 },
    styles: { fontSize: 7.6, cellPadding: 1.8, lineColor: LINE, lineWidth: 0.15, textColor: INK, valign: 'middle' },
    alternateRowStyles: { fillColor: [250, 251, 253] },
    columnStyles: { 0: { cellWidth: 24 }, 1: { cellWidth: 24 }, 2: { cellWidth: 28, fontStyle: 'bold', cellPadding: { left: 4, top: 1.8, bottom: 1.8, right: 1.8 } }, 3: { cellWidth: 70 }, 4: { cellWidth: 22 }, 5: { cellWidth: 26 } },
    didDrawCell: d => {
      const e: ScheduleEntry | undefined = d.section === 'body' ? (d.cell.raw as any)?.entry : undefined;
      if (!e) return;
      pdf.setFillColor(...kindOf(e).bar);
      pdf.rect(d.cell.x + 0.6, d.cell.y + 0.6, 1.2, d.cell.height - 1.2, 'F');
    },
  });
}

// ── Cover + index (only when the file has more than one timetable) ────────
function coverPages(pdf: jsPDF, o: { kind: PdfKind; layout: PdfLayout; termName: string; scope: string; pages: PdfPage[]; startPage: number[]; generated: string }) {
  const label = o.kind === 'cohort' ? 'Cohort timetables' : 'Faculty timetables';
  pdf.setFillColor(...NAVY); pdf.rect(0, 0, W, 62, 'F');
  pdf.setFillColor(...BRAND); pdf.rect(0, 62, W, 2, 'F');
  pdf.setTextColor(170, 196, 235); pdf.setFont('helvetica', 'bold'); pdf.setFontSize(9);
  pdf.text('UNITIME', M + 6, 20);
  pdf.setTextColor(255, 255, 255); pdf.setFontSize(26); pdf.text(label, M + 6, 36);
  pdf.setFont('helvetica', 'normal'); pdf.setFontSize(12); pdf.setTextColor(214, 228, 248);
  pdf.text(pdf.splitTextToSize(o.scope, 250)[0], M + 6, 47);
  pdf.text(`Term: ${o.termName}`, M + 6, 55);

  const classes = o.pages.reduce((s, p) => s + p.entries.length, 0);
  const stats: [string, string][] = [
    [o.kind === 'cohort' ? 'Cohorts' : 'Faculty', String(o.pages.length)],
    ['Classes', String(classes)],
    ['Layout', o.layout === 'grid' ? 'Weekly grid' : 'List'],
    ['Generated', o.generated],
  ];
  stats.forEach(([k, v], i) => {
    const x = M + 6 + i * 68;
    pdf.setDrawColor(...LINE); pdf.setFillColor(248, 250, 252); pdf.roundedRect(x, 74, 62, 20, 1.5, 1.5, 'FD');
    pdf.setFontSize(8); pdf.setTextColor(...MUTED); pdf.text(k.toUpperCase(), x + 4, 81);
    pdf.setFont('helvetica', 'bold'); pdf.setFontSize(12); pdf.setTextColor(...INK);
    pdf.text(pdf.splitTextToSize(v, 56)[0], x + 4, 89.5);
    pdf.setFont('helvetica', 'normal');
  });

  pdf.setFont('helvetica', 'bold'); pdf.setFontSize(11); pdf.setTextColor(...NAVY);
  pdf.text('Contents', M + 6, 106);
  pdf.setFont('helvetica', 'normal');
  // Three columns of "name ........ page".
  const per = Math.ceil(o.pages.length / 3);
  const rows: string[][] = [];
  for (let r = 0; r < per; r++) {
    const row: string[] = [];
    for (let c = 0; c < 3; c++) {
      const i = c * per + r;
      row.push(i < o.pages.length ? o.pages[i].name : '', i < o.pages.length ? String(o.startPage[i]) : '');
    }
    rows.push(row);
  }
  autoTable(pdf, {
    startY: 109,
    body: rows,
    theme: 'plain',
    tableWidth: 3 * (72 + 10),
    margin: { left: M + 6, right: M + 6, top: 16, bottom: 14 },
    styles: { fontSize: 7.4, cellPadding: { top: 0.9, bottom: 0.9, left: 1, right: 1 }, textColor: INK, overflow: 'linebreak' },
    columnStyles: {
      0: { cellWidth: 72 }, 1: { cellWidth: 10, halign: 'right', textColor: MUTED },
      2: { cellWidth: 72 }, 3: { cellWidth: 10, halign: 'right', textColor: MUTED },
      4: { cellWidth: 72 }, 5: { cellWidth: 10, halign: 'right', textColor: MUTED },
    },
    didParseCell: d => { if (d.row.index % 2 === 1) d.cell.styles.fillColor = [248, 250, 252]; },
  });
}

export async function downloadTimetablePdf(opts: {
  kind: PdfKind;
  layout: PdfLayout;
  pages: PdfPage[];
  termName: string;
  scope: string;           // what was chosen, e.g. "School of Computer Science"
  courses: Course[]; faculties: Faculty[]; rooms: Room[]; groups: StudentGroup[];
  fileName: string;
}) {
  const { kind, layout, pages, termName } = opts;
  const L = lookups(opts.courses, opts.faculties, opts.rooms, opts.groups);
  const all = pages.flatMap(p => p.entries);
  // Same hours and days on every page, so pages are easy to compare.
  const firstHour = Math.min(8, ...all.map(e => Math.floor(toMin(e.startTime) / 60)));
  const lastHour = Math.max(17, ...all.map(e => Math.ceil(toMin(e.endTime) / 60)));
  const days = DAYS.filter(d => d !== 'Sunday' || all.some(e => (e.day as string) === 'Sunday'));
  const generated = new Date().toLocaleString(undefined, { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' });
  const label = kind === 'cohort' ? 'Cohort timetable' : 'Faculty timetable';

  const pdf = new jsPDF({ orientation: 'landscape', unit: 'mm', format: 'a4' });
  pdf.setProperties({ title: `${label}s - ${opts.scope} - ${termName}`, creator: 'UniTime' });
  const startPage: number[] = [];
  for (let i = 0; i < pages.length; i++) {
    if (i > 0) pdf.addPage();
    startPage.push(pdf.getNumberOfPages());
    const p = pages[i];
    const usedDays = DAYS.filter(d => p.entries.some(e => e.day === d)).map(d => SHORT[d]);
    band(pdf, `${label}  ·  ${termName}`, p.name, kind === 'cohort' ? 'Cohort' : 'Faculty');
    infoLine(pdf, [
      [kind === 'cohort' ? 'School' : 'Teaches in', p.schools.join(', ') || '-'],
      ['Classes', String(p.entries.length)],
      ['Hours / week', String(hoursOf(p.entries))],
      ['Days', usedDays.join(' ') || '-'],
    ]);
    if (p.entries.length === 0) {
      pdf.setFontSize(10); pdf.setTextColor(...MUTED); pdf.text('No classes in this term.', M, 40);
    } else if (layout === 'grid') gridPage(pdf, p, kind, L, firstHour, lastHour, days);
    else listPage(pdf, p, kind, L);
    // A timetable that runs onto a second page gets the band again.
    for (let q = startPage[i] + 1; q <= pdf.getNumberOfPages(); q++) {
      pdf.setPage(q); band(pdf, `${label}  ·  ${termName}  ·  continued`, p.name, kind === 'cohort' ? 'Cohort' : 'Faculty');
    }
    if (i % 25 === 24) await new Promise(r => setTimeout(r, 0)); // keep the screen responsive
  }

  // Cover + index first. Its length is measured on a scratch copy, so the page
  // numbers in the index are right once it is moved to the front.
  let coverCount = 0;
  if (pages.length > 1) {
    const scratch = new jsPDF({ orientation: 'landscape', unit: 'mm', format: 'a4' });
    coverPages(scratch, { kind, layout, termName, scope: opts.scope, pages, startPage, generated });
    const k = scratch.getNumberOfPages();
    const before = pdf.getNumberOfPages();
    pdf.addPage();
    coverPages(pdf, { kind, layout, termName, scope: opts.scope, pages, startPage: startPage.map(s => s + k), generated });
    coverCount = pdf.getNumberOfPages() - before;
    for (let j = 0; j < coverCount; j++) pdf.movePage(before + 1 + j, 1 + j);
  }

  const n = pdf.getNumberOfPages();
  for (let q = 1; q <= n; q++) {
    pdf.setPage(q);
    pdf.setDrawColor(...LINE); pdf.line(M, H - 10.5, W - M, H - 10.5);
    pdf.setFont('helvetica', 'normal'); pdf.setFontSize(7); pdf.setTextColor(...MUTED);
    pdf.text(`Generated by UniTime  ·  ${generated}`, W / 2, H - 6.5, { align: 'center' });
    pdf.text(`Page ${q} of ${n}`, W - M, H - 6.5, { align: 'right' });
    if (q > coverCount && layout === 'grid') legend(pdf);
  }
  pdf.save(opts.fileName);
}
