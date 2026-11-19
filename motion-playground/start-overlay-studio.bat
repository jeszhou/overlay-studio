@echo off
setlocal
chcp 65001 >nul
cd /d "%~dp0" || exit /b 1
where npm.cmd >nul 2>nul
if errorlevel 1 (
  echo Please install Node.js 22.12 or later, then restart this launcher.
  pause
  exit /b 1
)
node -e "const [a,b]=process.versions.node.split('.').map(Number); process.exit(a>22 || (a===22 && b>=12) ? 0 : 1)"
if errorlevel 1 (
  echo Node.js 22.12 or later is required.
  pause
  exit /b 1
)
if not exist "node_modules\vite\bin\vite.js" (
  echo Installing locked Overlay Studio dependencies...
  call npm.cmd ci --no-audit --no-fund
  if errorlevel 1 (
    echo Installation failed. Check the message above and retry.
    pause
    exit /b 1
  )
)
echo Starting Overlay Studio at http://localhost:5177/
call npm.cmd run dev
exit /b %errorlevel%
