@echo off
setlocal

echo ===================================================
echo   Orches Setup - Windows Installation
echo ===================================================

echo [1/4] Checking Node.js version...
for /f "tokens=1,2,3 delims=.v " %%a in ('node -v 2^>nul') do (
    set NODE_MAJOR=%%a
    set NODE_MINOR=%%b
)

if "%NODE_MAJOR%"=="" (
    echo [ERROR] Node.js is not installed or not in PATH. Please install Node.js >= 22.5.0.
    exit /b 1
)

if %NODE_MAJOR% LSS 22 (
    echo [ERROR] Node.js version is v%NODE_MAJOR%.%NODE_MINOR%. Orches requires Node.js >= 22.5.0.
    exit /b 1
)

echo Node.js version OK.

echo [2/4] Installing project dependencies...
call npm install
if errorlevel 1 (
    echo [ERROR] npm install failed.
    exit /b 1
)

echo [3/4] Ensuring Playwright browser binaries are installed...
call npx playwright install chromium
if errorlevel 1 (
    echo [WARN] Playwright browser installation encountered a warning. Continuing...
)

echo [4/4] Building packages and applications...
call npm run build
if errorlevel 1 (
    echo [ERROR] Build failed.
    exit /b 1
)

echo.
echo Running diagnostic self-check...
call npm run diagnose

echo.
echo ===================================================
echo Setup complete! To start Orches, run:
echo   scripts\start.bat
echo ===================================================

endlocal
