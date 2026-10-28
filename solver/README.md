# UniTime Solver

A small program that runs on your own computer and builds the auto-schedule
with Google OR-Tools (free, open-source). It places all classes together
instead of one at a time, so it usually leaves far fewer conflicts than the
Standard method, and it follows the same rules.

## Use it

1. Double-click **Start UniTime Solver** (desktop shortcut, or
   `Start UniTime Solver.bat` in this folder). A window opens saying it is
   running. The first time, it installs OR-Tools automatically (needs internet).
2. In UniTime, go to Auto-Schedule, upload the sheet, choose **Method: Solver**
   and a time limit, then click **Generate**.
3. Check the preview and the Excel conflict report, then click **Apply** as usual.
4. Close the solver window when you are done.

If the solver isn't running, UniTime says so and offers the Standard method.
The Standard method is always available and unchanged.

## Requirements

- Windows with Python 3 (python.org). Nothing to configure.
- Chrome or Edge. The first time, the browser may ask to allow the site to
  reach devices on your local network: click **Allow**.

## Safety

It listens only on this computer (`127.0.0.1:8765`), keeps no data and has no
database access. UniTime saves the timetable when you click Apply.

## Testing (for developers)

```
python unitime_solver.py --file problem.json --time 120 --out result.json
python check_result.py problem.json result.json
```
