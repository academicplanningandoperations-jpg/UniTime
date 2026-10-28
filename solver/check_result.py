"""Independent rule check of a solver result (or of the Standard method's
timetable, from the problem's hint). Used for testing only.

  python check_result.py problem.json result.json
"""
import collections
import json
import sys


def check(P, placed):
    days = P["days"]
    D = {d: i for i, d in enumerate(days)}

    def key(k):
        d, h = k.split("~")
        return D[d], int(h[:2])

    def ks(m):
        return {g: {key(k) for k in v} for g, v in m.items()}

    fb, fnl, cb, cc, ce, rb = (ks(P[x]) for x in
                               ("facultyBusy", "facultyNonLabBusy", "cohortBusy", "cohortClass", "cohortExplo", "roomBusy"))
    es = {}
    for k, b in P["electiveSlot"].items():
        g, sk = k.split("|", 1)
        es[(g, key(sk))] = b
    rows = P["rows"]
    errs = collections.Counter()
    ex = {}

    def bad(kind, msg):
        errs[kind] += 1
        ex.setdefault(kind, msg)

    fac = collections.defaultdict(list)
    coh = collections.defaultdict(list)     # (g,d,h) -> [(basket or None, row)]
    room = collections.defaultdict(list)
    per_row = collections.Counter()
    daykey = collections.Counter()
    cohort_day_rows = collections.defaultdict(set)
    for (r, day, st, et, rm) in placed:
        row = rows[r]
        cand = next((c for c in row["cands"] if c[0] == day and c[1] == st and c[2] == et), None)
        if not cand:
            bad("slot not allowed for the row", (r, day, st))
            continue
        d = D[day]
        hrs = [(d, h) for h in cand[3]]
        per_row[r] += 1
        daykey[(row["dayKey"], d)] += 1
        if rm not in row["rooms"] and rm not in row["rooms2"]:
            bad("room not allowed", (r, rm))
        for x in hrs:
            if row["facultyId"]:
                fac[(row["facultyId"],) + x].append(row["isLab"])
                if x in fb.get(row["facultyId"], ()):
                    bad("faculty blocked/busy hour", (r, x))
            for g in row["groupIds"]:
                coh[(g,) + x].append(row["elective"])
                if x in cb.get(g, ()) and not (row["elective"] and es.get((g, x)) == row["elective"]):
                    bad("cohort blocked/busy hour", (r, g, x))
            room[(rm,) + x].append(r)
            if x in rb.get(rm, ()):
                bad("room busy", (r, rm, x))
        for g in row["groupIds"]:
            cohort_day_rows[(g, d)].add(r)
    for r, n in per_row.items():
        if n > rows[r]["sessions"]:
            bad("too many sessions for a row", r)
    for k, n in daykey.items():
        if n > 1:
            bad("course twice on a day", k)
    for k, v in fac.items():
        if len(v) > 1:
            bad("faculty double-booked", k)
    for k, v in room.items():
        if len(v) > 1:
            bad("room double-booked", k)
    for k, v in coh.items():
        kinds = set(v)
        if len(v) > 1 and (None in kinds or len(kinds) > 1):
            bad("cohort double-booked", k)

    def class_hours(g, d):
        hs = {h for (dd, h) in cc.get(g, ()) if dd == d}
        hs |= {h for (gg, dd, h) in coh if gg == g and dd == d}
        return hs

    cls_cache = {}
    for (g, d), rs in cohort_day_rows.items():
        hs = cls_cache.setdefault((g, d), class_hours(g, d))
        exp = {h for (dd, h) in ce.get(g, ()) if dd == d}
        for r in rs:
            L = rows[r]["lunch"]
            if L and all(h in hs or h in exp for h in L):
                bad("no lunch hour free", (g, days[d], L))
        old = sorted(h for (dd, h) in cc.get(g, ()) if dd == d)
        s = sorted(hs)
        exc = lambda arr: sum(max(0, b - a - 1 - P["maxGapHours"]) for a, b in zip(arr, arr[1:]))
        if exc(s) > exc(old):
            bad("gap over 2 hours", (g, days[d], s))
    fday = collections.defaultdict(set)
    for (f, d, h), v in fac.items():
        if not all(v):
            fday[(f, d)].add(h)
    for (f, d), hs in fday.items():
        hs = hs | {h for (dd, h) in fnl.get(f, ()) if dd == d}
        if any(h + 1 in hs and h + 2 in hs for h in hs):
            bad("faculty 3 theory hours in a row", (f, days[d], sorted(hs)))

    # day goals
    cnt = collections.Counter()
    for (r, day, st, et, rm) in placed:
        row = rows[r]
        for g in row["groupIds"]:
            cnt[(g, D[day], row["elective"] or f"#{r}")] += 0
    per_day = collections.Counter()
    seen = set()
    for (r, day, st, et, rm) in placed:
        row = rows[r]
        for g in row["groupIds"]:
            tag = (g, day, row["elective"], st) if row["elective"] else (g, day, r, st)
            if tag in seen:
                continue
            seen.add(tag)
            per_day[(g, day)] += 1
    for k, v in P["existingDayClasses"].items():
        g, day = k.split("~")
        per_day[(g, day)] += v
    one = sum(1 for v in per_day.values() if v == 1)
    edge = P["edgeFreeDays"]
    mid_free = six = fit5 = more_free = 0
    for g, week in P["cohortWeek"].items():
        used = [d for d in week if per_day.get((g, d), 0) > 0]
        if len(week) == 6:
            six += 1
            fit5 += len(used) <= 5
        if any(d not in edge and d not in used for d in week) and any(d in edge and d in used for d in week):
            mid_free += 1
        need = P["requiredDays"].get(g, 0)
        if len(week) - len(used) > max(1, len(week) - need):
            more_free += 1
    goals = {"oneClassDays": one, "middleDayFreeWhileSatMonUsed": mid_free,
             "sixDayCohortsFitIn5": f"{fit5}/{six}", "tooManyFreeDays": more_free}
    return dict(errs), ex, goals


def hint_as_placed(P):
    out = []
    for (r, day, st, rm) in P["hint"]:
        c = next((c for c in P["rows"][r]["cands"] if c[0] == day and c[1] == st), None)
        out.append([r, day, st, c[2] if c else st, rm])
    return out


if __name__ == "__main__":
    P = json.load(open(sys.argv[1], encoding="utf-8"))
    R = json.load(open(sys.argv[2], encoding="utf-8"))
    for name, placed in (("Standard", hint_as_placed(P)), ("Solver", R["placed"])):
        errs, ex, goals = check(P, placed)
        print(f"{name}: placed {len(placed)} of {sum(r['sessions'] for r in P['rows'])}")
        print("   rule breaks:", errs or "none")
        for k, v in ex.items():
            print("     e.g.", k, v)
        print("   day goals:", goals)
