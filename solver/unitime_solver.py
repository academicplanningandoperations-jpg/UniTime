"""UniTime Solver - runs on this PC and builds the auto-schedule with Google
OR-Tools CP-SAT, an exact solver, instead of placing classes one by one.

UniTime (Auto-Schedule screen, method "Solver") sends it the problem worked
out by utils/autoScheduler.ts - every class's allowed slots and rooms, and all
blocked hours - so both methods follow the same rules. It answers on
http://127.0.0.1:8765 only (this computer), keeps nothing, and never touches
the database: UniTime saves the result when you click Apply.

  Start:  double-click "Start UniTime Solver.bat"   (or: python unitime_solver.py)
  Test:   python unitime_solver.py --file problem.json --time 120 --out result.json

Rules (hard - never broken), same as the Standard method:
  - only the row's allowed days/hours (faculty days and hours, cohort window,
    Course-Day/Time-Block, labs on even hours), only its allowed rooms
  - no faculty, cohort or room double-booking; Explo and block hours stay free
  - elective basket: courses of the same basket may share a cohort's slot
  - a course meets at most once a day
  - at least one lunch hour stays free
  - a cohort never waits more than 2 hours between two classes
  - a faculty never teaches more than 2 theory hours in a row
Goals, in this order:
  1. place as many classes as possible
  2. then: no one-class days, no free day in the middle of the week, at most
     the allowed number of free days, and a 5-day week where possible
"""
import argparse
import json
import sys
import threading
import time
import traceback
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

from ortools.sat.python import cp_model

VERSION = "1.0.0"
HOST, PORT = "127.0.0.1", 8765

# Weights for the goals after "place as many classes as possible".
W_ONE_CLASS_DAY = 40
W_MIDDLE_FREE = 30
W_EXTRA_FREE = 30
W_SIXTH_DAY = 8

PROGRESS = {"state": "idle"}
LOCK = threading.Lock()


def log(*a):
    print(time.strftime("%H:%M:%S"), *a, flush=True)


class _Watch(cp_model.CpSolverSolutionCallback):
    """Reports the best result so far to /progress while the solver runs."""

    def __init__(self, phase, value_fn):
        super().__init__()
        self.phase, self.value_fn, self.t0 = phase, value_fn, time.time()

    def on_solution_callback(self):
        PROGRESS.update(phase=self.phase, best=self.value_fn(self),
                        bound=self.BestObjectiveBound(), elapsed=round(time.time() - self.t0))


def solve(P, time_limit=300.0, workers=0):
    t_start = time.time()
    days = P["days"]
    D = {d: i for i, d in enumerate(days)}

    def key(k):
        d, h = k.split("~")
        return D[d], int(h[:2])

    def keyset(m):
        return {g: {key(k) for k in v} for g, v in m.items()}

    fac_busy = keyset(P["facultyBusy"])
    fac_nl_busy = keyset(P["facultyNonLabBusy"])
    coh_busy = keyset(P["cohortBusy"])
    coh_class = keyset(P["cohortClass"])
    coh_explo = keyset(P["cohortExplo"])
    room_busy = keyset(P["roomBusy"])
    elec_slot = {}
    for k, b in P["electiveSlot"].items():
        g, sk = k.split("|", 1)
        elec_slot[(g, key(sk))] = b
    max_gap = int(P.get("maxGapHours", 2))
    rows = P["rows"]

    m = cp_model.CpModel()
    X = {}                      # (row, cand) -> BoolVar
    cand_info = {}              # (row, cand) -> (day, hours list)
    why_out = {}                # row -> counts of refused slots
    row_vars = {}
    fac_cover, fac_nl_cover = {}, {}
    coh_ord, coh_elec = {}, {}  # (g,d,h) -> vars ; (g,B,d,h) -> vars
    coh_day_ord, coh_day_elec = {}, {}
    daykey_vars = {}
    room_sets = {}              # frozenset -> id
    row_set = {}

    def add(dct, k, v):
        dct.setdefault(k, []).append(v)

    for r, row in enumerate(rows):
        f = row["facultyId"]
        gs = row["groupIds"]
        B = row["elective"]
        allowed_rooms = list(dict.fromkeys(row["rooms"] + row["rooms2"]))
        S = frozenset(allowed_rooms)
        row_set[r] = room_sets.setdefault(S, len(room_sets))
        why = {"Faculty busy": 0, "Cohort busy": 0, "No free room": 0, "Faculty would teach 3 hours in a row": 0}
        for ci, (day, st, et, hours) in enumerate(row["cands"]):
            d = D[day]
            hrs = [(d, h) for h in hours]
            if f and any(x in fac_busy.get(f, ()) for x in hrs):
                why["Faculty busy"] += 1
                continue
            bad = False
            for g in gs:
                cb = coh_busy.get(g, ())
                for x in hrs:
                    if x in cb and not (B and elec_slot.get((g, x)) == B):
                        bad = True
                        break
                if bad:
                    break
            if bad:
                why["Cohort busy"] += 1
                continue
            if not any(all(x not in room_busy.get(rm, ()) for x in hrs) for rm in allowed_rooms):
                why["No free room"] += 1
                continue
            if f and not row["isLab"]:
                occ = {h for (dd, h) in fac_nl_busy.get(f, ()) if dd == d} | set(hours)
                if any(h in occ and h + 1 in occ and h + 2 in occ for h in occ):
                    why["Faculty would teach 3 hours in a row"] += 1
                    continue
            v = m.NewBoolVar(f"x{r}_{ci}")
            X[(r, ci)] = v
            cand_info[(r, ci)] = (d, hours, st, et)
            add(row_vars, r, v)
            add(daykey_vars, (row["dayKey"], d), v)
            for x in hrs:
                if f:
                    add(fac_cover, (f,) + x, v)
                    if not row["isLab"]:
                        add(fac_nl_cover, (f,) + x, v)
                for g in gs:
                    if B:
                        add(coh_elec, (g, B) + x, v)
                    else:
                        add(coh_ord, (g,) + x, v)
            for g in gs:
                if B:
                    add(coh_day_elec, (g, B, d), v)
                else:
                    add(coh_day_ord, (g, d), v)
        why_out[r] = why

    placed_terms = []
    for r, vs in row_vars.items():
        m.Add(sum(vs) <= rows[r]["sessions"])
        placed_terms += vs
    for vs in daykey_vars.values():
        if len(vs) > 1:
            m.AddAtMostOne(vs)
    for vs in fac_cover.values():
        if len(vs) > 1:
            m.AddAtMostOne(vs)

    # Cohort hours: ordinary classes plus one indicator per elective basket.
    basket_on = {}
    for k, vs in coh_elec.items():
        u = m.NewBoolVar("")
        m.AddMaxEquality(u, vs)
        basket_on[k] = u
    coh_hour_terms = {}
    for k, vs in coh_ord.items():
        coh_hour_terms.setdefault(k, []).extend(vs)
    for (g, B, d, h), u in basket_on.items():
        coh_hour_terms.setdefault((g, d, h), []).append(u)
    for vs in coh_hour_terms.values():
        if len(vs) > 1:
            m.AddAtMostOne(vs)

    def occ(g, d, h):
        """(constant, terms): is cohort g in class at hour h of day d."""
        if (d, h) in coh_class.get(g, ()):
            return 1, []
        return 0, coh_hour_terms.get((g, d, h), [])

    cohorts = set(g for row in rows for g in row["groupIds"])
    day_hours = {}
    for (g, d, h) in coh_hour_terms:
        day_hours.setdefault((g, d), set()).add(h)
    for g in cohorts:
        for (d, h) in coh_class.get(g, ()):
            day_hours.setdefault((g, d), set()).add(h)

    # Lunch: at least one lunch hour free of classes and Explo.
    lunch_sets = {}
    for row in rows:
        if row["lunch"]:
            for g in row["groupIds"]:
                lunch_sets.setdefault(g, set()).add(tuple(sorted(set(row["lunch"]))))
    for g, Ls in lunch_sets.items():
        for d in range(len(days)):
            if (g, d) not in day_hours:
                continue
            for L in Ls:
                terms, free_const = [], 0
                for h in L:
                    if (d, h) in coh_explo.get(g, ()):
                        continue
                    c, t = occ(g, d, h)
                    if c:
                        continue
                    if not t:
                        free_const += 1
                    else:
                        terms.append(t)
                if free_const > 0 or not terms:
                    continue
                # hours with possible classes: at least one of them stays free
                m.Add(sum(sum(t) for t in terms) <= len(terms) - 1)

    # Gap rule: between two classes a cohort waits at most max_gap hours.
    for (g, d), hs in day_hours.items():
        H = sorted(hs)
        info = {h: occ(g, d, h) for h in H}
        for i, h1 in enumerate(H):
            for h2 in H[i + 1:]:
                if h2 - h1 - 1 <= max_gap:
                    continue
                c1, t1 = info[h1]
                c2, t2 = info[h2]
                if c1 and c2:
                    continue   # already like this before - not made worse
                between = [h for h in H if h1 < h < h2]
                if any(info[h][0] for h in between):
                    continue   # an existing class sits between them
                expr = c1 + c2 + sum(t1) + sum(t2) - sum(sum(info[h][1]) for h in between)
                m.Add(expr <= 1)

    # Faculty: at most 2 theory hours in a row.
    fac_days = {}
    for (f, d, h) in fac_nl_cover:
        fac_days.setdefault((f, d), set()).add(h)
    for (f, d), hs in fac_days.items():
        const = {h for (dd, h) in fac_nl_busy.get(f, ()) if dd == d}
        for h in range(min(hs) - 2, max(hs) + 1):
            win = [h, h + 1, h + 2]
            vs = [v for x in win for v in fac_nl_cover.get((f, d, x), [])]
            if not vs:
                continue
            c = sum(1 for x in win if x in const)
            if c >= 3:
                continue
            m.Add(sum(vs) <= 2 - c)

    # Rooms: at every hour each class must get its own free room from its list.
    # Rooms that appear in exactly the same lists are grouped ("atoms"); per
    # hour, classes are spread over the atoms their list contains (a flow), so
    # the count is exact, not just "enough rooms in total". The exact room for
    # each class is picked afterwards.
    sets = list(room_sets.keys())
    sig = {}
    for j, S in enumerate(sets):
        for rm in S:
            sig.setdefault(rm, []).append(j)
    atoms = {}
    for rm, js in sig.items():
        atoms.setdefault(tuple(js), []).append(rm)
    atom_list = list(atoms.items())               # [(set ids, rooms)]
    atoms_of_set = {j: [a for a, (js, _) in enumerate(atom_list) if j in js] for j in range(len(sets))}
    cover_by_set_hour = {}
    for (r, ci), v in X.items():
        d, hours, _, _ = cand_info[(r, ci)]
        for h in hours:
            add(cover_by_set_hour, (row_set[r], d, h), v)
    by_hour = {}
    for (j, d, h), vs in cover_by_set_hour.items():
        by_hour.setdefault((d, h), {})[j] = vs
    for (d, h), per_set in by_hour.items():
        free = [sum(1 for rm in rms if (d, h) not in room_busy.get(rm, ())) for (_, rms) in atom_list]
        into_atom = {}
        for j, vs in per_set.items():
            flows = []
            for a in atoms_of_set[j]:
                if free[a] == 0:
                    continue
                fv = m.NewIntVar(0, min(len(vs), free[a]), "")
                flows.append(fv)
                into_atom.setdefault(a, []).append(fv)
            m.Add(sum(vs) == sum(flows)) if flows else m.Add(sum(vs) == 0)
        for a, fl in into_atom.items():
            if len(fl) > 1:
                m.Add(sum(fl) <= free[a])

    # Day goals per cohort.
    edge = P.get("edgeFreeDays", ["Saturday", "Monday"])
    min_day = int(P.get("minDayClasses", 2))
    penalties = []
    day_used = {}
    for g, week in P["cohortWeek"].items():
        if g not in cohorts:
            continue
        wk = [D[d] for d in week if d in D]
        used = {}
        for d in wk:
            existing = int(P["existingDayClasses"].get(f"{g}~{days[d]}", 0))
            ords = coh_day_ord.get((g, d), [])
            bas = []
            for (gg, B, dd), vs in coh_day_elec.items():
                if gg == g and dd == d:
                    bd = m.NewBoolVar("")
                    m.AddMaxEquality(bd, vs)
                    bas.append(bd)
            terms = ords + bas
            if existing > 0:
                u = 1
            elif terms:
                u = m.NewBoolVar("")
                m.AddMaxEquality(u, terms)
            else:
                u = 0
            used[d] = u
            if terms and min_day > 1:
                one = m.NewBoolVar("")
                # a used day with fewer than min_day classes costs a penalty
                m.Add(existing + sum(terms) + (min_day - 1) * one >= min_day * u)
                penalties.append(W_ONE_CLASS_DAY * one)
        day_used[g] = used
        U = sum(used.values())
        if not any(isinstance(u, cp_model.IntVar) for u in used.values()):
            continue
        if len(wk) > 5:
            ex5 = m.NewIntVar(0, len(wk), "")
            m.Add(ex5 >= U - 5)
            penalties.append(W_SIXTH_DAY * ex5)
        need = int(P["requiredDays"].get(g, 0))
        fa = max(1, len(wk) - need)
        exf = m.NewIntVar(0, len(wk), "")
        m.Add(exf >= (len(wk) - U) - fa)
        penalties.append(W_EXTRA_FREE * exf)
        for dm in wk:
            if days[dm] in edge:
                continue
            for de in wk:
                if days[de] not in edge:
                    continue
                if isinstance(used[de], int) and used[de] == 0:
                    continue
                pm = m.NewBoolVar("")
                m.Add(pm >= used[de] - used[dm])
                penalties.append(W_MIDDLE_FREE * pm)

    # Start from the Standard method's best timetable.
    hint_rows = {}
    for (r, day, st, room) in P.get("hint", []):
        hint_rows.setdefault(r, set()).add((D.get(day), st))
    for (r, ci), v in X.items():
        d, _, st, _ = cand_info[(r, ci)]
        m.AddHint(v, 1 if (d, st) in hint_rows.get(r, ()) else 0)

    build_s = round(time.time() - t_start, 1)
    total_needed = sum(row["sessions"] for row in rows)
    log(f"model: {len(rows)} rows, {len(X)} slot choices, built in {build_s}s; "
        f"standard method placed {len(P.get('hint', []))} of {total_needed}")

    def run(phase, seconds):
        s = cp_model.CpSolver()
        s.parameters.max_time_in_seconds = max(5.0, seconds)
        s.parameters.num_workers = workers or 0
        s.parameters.log_search_progress = False
        cb = _Watch(phase, lambda cb_: int(round(cb_.ObjectiveValue())))
        PROGRESS.update(state="solving", phase=phase, best=None, bound=None, elapsed=0)
        st = s.Solve(m, cb)
        return s, st

    # Phase 1: place as many classes as possible.
    m.Maximize(sum(placed_terms))
    t1 = max(10.0, (time_limit - (time.time() - t_start)) * 0.6)
    s1, st1 = run("placing", t1)
    if st1 not in (cp_model.OPTIMAL, cp_model.FEASIBLE):
        return {"ok": False, "error": f"Solver found no timetable ({s1.StatusName(st1)})."}
    best_placed = int(round(s1.ObjectiveValue()))
    upper = int(s1.BestObjectiveBound())
    proven = st1 == cp_model.OPTIMAL
    log(f"phase 1: placed {best_placed} (at most {upper} possible, {'proven' if proven else 'not proven'})")
    sol = {k: s1.Value(v) for k, v in X.items()}

    # Phase 2: keep that many classes, make the days better.
    remaining = time_limit - (time.time() - t_start)
    st2_name = "skipped"
    if penalties and remaining > 15:
        # Hint every variable with the phase-1 answer, so phase 2 starts from a
        # complete, valid timetable and can only improve on it.
        full = [s1.Value(m.GetIntVarFromProtoIndex(i)) for i in range(len(m.Proto().variables))]
        m.Add(sum(placed_terms) >= best_placed)
        m.Minimize(sum(penalties))
        m.ClearHints()
        for i, val in enumerate(full):
            m.AddHint(m.GetIntVarFromProtoIndex(i), val)
        s2, st2 = run("improving days", remaining - 10)
        st2_name = s2.StatusName(st2)
        if st2 in (cp_model.OPTIMAL, cp_model.FEASIBLE):
            sol = {k: s2.Value(v) for k, v in X.items()}
        log(f"phase 2: {st2_name}")

    # Rooms: give every placed class one of its allowed rooms.
    PROGRESS.update(state="solving", phase="choosing rooms")
    placed = [k for k, val in sol.items() if val]
    hint_room = {}
    for (r, day, st, room) in P.get("hint", []):
        hint_room[(r, D.get(day), st)] = room
    rm_model = cp_model.CpModel()
    Y = {}
    room_hour = {}
    obj = []
    for k in placed:
        r, ci = k
        d, hours, st, et = cand_info[k]
        row = rows[r]
        first = set(row["rooms"])
        for rm in dict.fromkeys(row["rooms"] + row["rooms2"]):
            if any((d, h) in room_busy.get(rm, ()) for h in hours):
                continue
            y = rm_model.NewBoolVar("")
            Y[(k, rm)] = y
            for h in hours:
                room_hour.setdefault((rm, d, h), []).append(y)
            obj.append((1000 + (2 if rm in first else 0) + (1 if hint_room.get((r, d, st)) == rm else 0)) * y)
    by_session = {}
    for (k, rm), y in Y.items():
        by_session.setdefault(k, []).append(y)
    for ys in by_session.values():
        rm_model.AddAtMostOne(ys)
    for ys in room_hour.values():
        if len(ys) > 1:
            rm_model.AddAtMostOne(ys)
    rm_model.Maximize(sum(obj))
    rs = cp_model.CpSolver()
    rs.parameters.max_time_in_seconds = 60.0
    rs.parameters.num_workers = workers or 0
    rst = rs.Solve(rm_model)
    out, no_room = [], []
    for k in placed:
        r, ci = k
        d, hours, st, et = cand_info[k]
        chosen = None
        if rst in (cp_model.OPTIMAL, cp_model.FEASIBLE):
            for (kk, rm), y in Y.items():
                if kk == k and rs.Value(y):
                    chosen = rm
                    break
        if chosen is None:
            no_room.append(r)
        else:
            out.append([r, days[d], st, et, chosen])

    placed_per_row = {}
    for r, *_ in out:
        placed_per_row[r] = placed_per_row.get(r, 0) + 1
    unplaced = []
    for r, row in enumerate(rows):
        got = placed_per_row.get(r, 0)
        if got >= row["sessions"]:
            continue
        w = why_out.get(r, {})
        free_slots = len(row_vars.get(r, []))
        if r in no_room:
            reason = "Placed in time, but no allowed room was left free at that time"
        elif free_slots == 0:
            top = max(w, key=w.get) if w and max(w.values()) > 0 else None
            reason = (f"None of its {len(row['cands'])} allowed slots is free ({top.lower()} on {w[top]})"
                      if top else "It has no allowed slot (check its days, hours and window)")
        else:
            reason = (f"Its {free_slots} free slots all clash with other classes of the same "
                      f"faculty, cohorts or rooms under the rules (lunch, 2-hour gap, once a day)")
        unplaced.append({"row": r, "placed": got, "reason": reason, "refused": w})

    stats = {
        "placed": len(out),
        "needed": total_needed,
        "standardPlaced": len(P.get("hint", [])),
        "upperBound": upper,
        "proven": proven,
        "phase2": st2_name,
        "seconds": round(time.time() - t_start),
    }
    log(f"done: placed {len(out)} of {total_needed} in {stats['seconds']}s")
    return {"ok": True, "version": VERSION, "placed": out, "unplaced": unplaced, "stats": stats}


class Handler(BaseHTTPRequestHandler):
    def _cors(self):
        origin = self.headers.get("Origin") or "*"
        self.send_header("Access-Control-Allow-Origin", origin)
        self.send_header("Vary", "Origin")
        self.send_header("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
        self.send_header("Access-Control-Allow-Headers", "Content-Type")
        self.send_header("Access-Control-Allow-Private-Network", "true")

    def _json(self, code, obj):
        body = json.dumps(obj).encode()
        self.send_response(code)
        self._cors()
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def log_message(self, fmt, *args):
        pass

    def do_OPTIONS(self):
        self.send_response(204)
        self._cors()
        self.end_headers()

    def do_GET(self):
        if self.path.startswith("/health"):
            self._json(200, {"ok": True, "version": VERSION, "busy": LOCK.locked()})
        elif self.path.startswith("/progress"):
            self._json(200, PROGRESS)
        else:
            self._json(404, {"ok": False})

    def do_POST(self):
        if not self.path.startswith("/solve"):
            return self._json(404, {"ok": False})
        if not LOCK.acquire(blocking=False):
            return self._json(409, {"ok": False, "error": "The solver is already working on another timetable."})
        try:
            n = int(self.headers.get("Content-Length", 0))
            req = json.loads(self.rfile.read(n))
            limit = float(req.get("timeLimit", 300))
            log(f"request: {len(req['problem']['rows'])} rows, time limit {int(limit)}s")
            res = solve(req["problem"], limit)
            self._json(200, res)
        except Exception as e:
            traceback.print_exc()
            self._json(500, {"ok": False, "error": f"Solver error: {e}"})
        finally:
            PROGRESS.clear()
            PROGRESS["state"] = "idle"
            LOCK.release()


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--file", help="solve a saved problem.json instead of starting the server")
    ap.add_argument("--time", type=float, default=300)
    ap.add_argument("--out")
    a = ap.parse_args()
    if a.file:
        res = solve(json.load(open(a.file, encoding="utf-8")), a.time)
        txt = json.dumps(res)
        if a.out:
            open(a.out, "w", encoding="utf-8").write(txt)
        print(json.dumps(res.get("stats", res)))
        return
    try:
        srv = ThreadingHTTPServer((HOST, PORT), Handler)
    except OSError:
        print(f"Port {PORT} is in use - the UniTime Solver is probably already running.")
        input("Press Enter to close.")
        sys.exit(1)
    print("=" * 60)
    print(f" UniTime Solver {VERSION} is running")
    print(" Keep this window open while you generate timetables.")
    print(" In UniTime: Auto-Schedule -> Method: Solver -> Generate.")
    print(" Close this window when you are done.")
    print("=" * 60, flush=True)
    srv.serve_forever()


if __name__ == "__main__":
    main()
