@echo off
setlocal
cd /d "%~dp0"
title PyCalc

set "PYEXE="
where python >nul 2>nul
if not errorlevel 1 (
  call python -c "import sys; raise SystemExit(0 if sys.version_info >= (3, 11) else 1)" >nul 2>nul
  if not errorlevel 1 set "PYEXE=python"
)
if not defined PYEXE (
  where py >nul 2>nul
  if not errorlevel 1 (
    call py -c "import sys; raise SystemExit(0 if sys.version_info >= (3, 11) else 1)" >nul 2>nul
    if not errorlevel 1 set "PYEXE=py"
  )
)
if not defined PYEXE (
  echo Python 3.11 or newer was not found on PATH.
  echo Install Python from https://www.python.org/downloads/ and enable "Add python.exe to PATH".
  pause
  exit /b 1
)

set "PYTHONUTF8=1"
set "PYTHONIOENCODING=utf-8"
set "MKL_THREADING_LAYER=TBB"
call %PYEXE% gui.py
if errorlevel 1 pause
