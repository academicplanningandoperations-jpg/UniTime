// Elective baskets.
//
// A category such as "PE1 Theory" or "OE2 Lab" means "this course is one of the
// choices in elective basket PE1". Students of a cohort pick ONE course from the
// basket, so the basket's courses can — and should — run at the same time for
// that cohort: different faculty, different rooms, same slot. That is not a
// cohort clash.
//
// The basket name is a short code ending in a number (PE1, OE2, DE-3, "PE 1"),
// followed by the normal session type. Plain categories ("Theory", "Lab") and
// free-text ones without a numbered code ("Guest Lecture") are not baskets.

const BASE_TYPES = ['theory', 'lab', 'tutorial', 'studio', 'mba', 'edge', 'seminar', 'practical'];

// The session type is optional: a bare "PE1" (as offered in the session form)
// is the same basket as "PE1 Theory".
const ELECTIVE_RE = new RegExp(
  `^([a-z]{1,8})[\\s\\-_]?(\\d{1,2})(?:[\\s\\-_/]+(${BASE_TYPES.join('|')}))?$`, 'i'
);

export interface ElectiveInfo {
  tag: string;   // "PE1"
  base: string;  // "theory" | "lab" | …  (lower-case; drives duration / room type)
  key: string;   // "PE1|theory" — two sessions with the same key may run in parallel
}

export function parseElective(category: string | undefined | null): ElectiveInfo | null {
  const m = String(category ?? '').trim().match(ELECTIVE_RE);
  if (!m) return null;
  const tag = `${m[1]}${m[2]}`.toUpperCase();
  const base = (m[3] || 'theory').toLowerCase();
  return { tag, base, key: `${tag}|${base}` };
}

// The plain session type behind a category: "PE1 Lab" → "lab", "Theory" → "theory".
export function baseCategory(category: string | undefined | null): string {
  return parseElective(category)?.base ?? String(category ?? '').trim().toLowerCase();
}

// True when two sessions belong to the same elective basket, so sharing a cohort
// at the same time is expected rather than a clash.
export function areParallelElectives(a: string | undefined | null, b: string | undefined | null): boolean {
  const ea = parseElective(a);
  if (!ea) return false;
  const eb = parseElective(b);
  return !!eb && ea.key === eb.key;
}
