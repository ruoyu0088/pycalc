@echo off
chcp 65001 >nul
setlocal
cd /d "%~dp0"

rem Global convention: use the pixi Python environment when available.
set "PYTHONUTF8=1"
set "MKL_THREADING_LAYER=TBB"
set "PY=C:\pixi_env\.pixi\envs\default\python.exe"
if not exist "%PY%" set "PY=python"

"%PY%" gui.py
if errorlevel 1 (
  echo.
  echo PyCalc GUI exited with an error.
  pause
)
