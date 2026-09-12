@echo off
setlocal

cd /d "%~dp0"

where node >nul 2>&1
if errorlevel 1 (
    echo Error: Node.js is required but was not found in PATH.
    exit /b 1
)

where npm >nul 2>&1
if errorlevel 1 (
    echo Error: npm is required but was not found in PATH.
    exit /b 1
)

echo Installing dependencies from package-lock.json...
call npm ci
if errorlevel 1 exit /b %errorlevel%

echo Testing, compiling, and packaging the Xenon VS Code extension...
call npm run package
if errorlevel 1 exit /b %errorlevel%

echo.
echo Build completed. The VSIX package is in:
for %%F in ("%CD%\xenon-*.vsix") do echo   %%~fF

endlocal
