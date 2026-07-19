@echo off
setlocal
powershell.exe -NoLogo -NoProfile -ExecutionPolicy Bypass -File "%~dp0install.ps1" %*
set "installExitCode=%errorlevel%"
if not "%installExitCode%"=="0" (
  echo.
  echo Installation failed. Review the error above, then press any key to close this window.
  pause >nul
)
exit /b %installExitCode%
