@echo off
REM ============================================================
REM Overlay Studio 启动器(Windows)
REM 双击即可:启动本地服务器并自动打开浏览器
REM 关闭方法:关掉这个命令行窗口即停止服务器
REM ============================================================
chcp 65001 >nul
cd /d "%~dp0"

echo 🎬 Overlay Studio 启动中...

where npm >nul 2>nul
if errorlevel 1 (
  echo ❌ 找不到 Node.js/npm。请先安装 Node.js: https://nodejs.org
  pause
  exit /b 1
)

if not exist "node_modules" (
  echo 📦 首次运行,安装依赖...
  call npm install
)

echo 🚀 启动本地服务器: http://localhost:5177/
call npm run dev
