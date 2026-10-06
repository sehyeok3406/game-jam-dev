@echo off
setlocal
chcp 65001 >nul
title Game Canvas - Collaboration
if not exist "%~dp0tools\internet-host\connect.ps1" (
  echo [GC-HOST-001] Launcher files are missing. Keep this CMD in the original project folder.
  pause
  exit /b 1
)
if not exist "%~dp0tools\internet-host\diagnostics.ps1" (
  echo [GC-HOST-001] Diagnostic helper is missing. Keep the original project folder intact.
  pause
  exit /b 1
)
if not exist "%~dp0tools\internet-host\host.ps1" (
  echo [GC-HOST-001] Host helper is missing. Keep the original project folder intact.
  pause
  exit /b 1
)
where powershell.exe >nul 2>nul
if errorlevel 1 (
  echo [GC-HOST-001] Windows PowerShell was not found.
  pause
  exit /b 1
)
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0tools\internet-host\connect.ps1" %*
set "taskExitCode=%errorlevel%"
if not "%taskExitCode%"=="0" pause
exit /b %taskExitCode%
