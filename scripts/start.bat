@echo off
setlocal

echo ===================================================
echo   Starting Orches Autonomous Dev Orchestrator
echo ===================================================

call npm run start
if errorlevel 1 (
    echo [ERROR] Orches exited with error code %errorlevel%.
    exit /b %errorlevel%
)

endlocal
