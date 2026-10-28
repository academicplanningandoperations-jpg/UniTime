@echo off
title UniTime Solver
cd /d "%~dp0"
where python >nul 2>nul || (echo Python is not installed on this computer. Install it from python.org, then try again. & pause & exit /b 1)
python -c "import ortools" 2>nul || (echo Installing Google OR-Tools - one time only, needs internet... & python -m pip install --user ortools)
python unitime_solver.py
pause
