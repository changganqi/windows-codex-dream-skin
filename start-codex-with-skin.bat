@echo off
setlocal
powershell.exe -NoLogo -NoProfile -ExecutionPolicy RemoteSigned -File "%~dp0start-codex-with-skin.ps1"
exit /b %errorlevel%
