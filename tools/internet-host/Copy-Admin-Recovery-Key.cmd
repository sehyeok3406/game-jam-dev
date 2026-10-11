@echo off
setlocal
chcp 65001 >nul
title Game Jam! - Admin Recovery Key
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0copy-admin-recovery-key.ps1" %*
exit /b %errorlevel%
