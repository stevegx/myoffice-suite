@echo off
setlocal EnableExtensions DisableDelayedExpansion
cd /d "%~dp0" || exit /b 1

if /i "%~1"=="backend" goto backend
if /i "%~1"=="frontend" goto frontend

if not exist ".venv\Scripts\python.exe" if not exist "backend\.venv\Scripts\python.exe" (
    where python.exe >nul 2>&1
    if errorlevel 1 (
        echo Python was not found. Install Python 3.15 and add it to PATH.
        pause
        exit /b 1
    )
)
where npm.cmd >nul 2>&1
if errorlevel 1 (
    echo npm was not found. Install Node.js 24 or newer.
    pause
    exit /b 1
)

start "MyOffice Suite - Backend" "%ComSpec%" /d /k call "%~f0" backend
start "MyOffice Suite - Frontend" "%ComSpec%" /d /k call "%~f0" frontend
echo Open http://127.0.0.1:5173 once both servers are ready.
exit /b 0

:backend
set "PYTHON_EXE=.venv\Scripts\python.exe"
if not exist "%PYTHON_EXE%" if exist "backend\.venv\Scripts\python.exe" set "PYTHON_EXE=backend\.venv\Scripts\python.exe"
if not exist "%PYTHON_EXE%" (
    echo Creating the Python environment...
    python -m venv .venv || exit /b 1
)
"%PYTHON_EXE%" -c "import fastapi, uvicorn, xlrd, xlwt, openpyxl, defusedxml" >nul 2>&1
if errorlevel 1 (
    echo Installing backend dependencies...
    "%PYTHON_EXE%" -m pip install -r backend\requirements.txt || exit /b 1
)
echo Starting the backend on http://127.0.0.1:5072
"%PYTHON_EXE%" -m uvicorn backend.main:app --host 127.0.0.1 --port 5072 --reload --reload-dir backend
exit /b %errorlevel%

:frontend
cd frontend || exit /b 1
if not exist "node_modules\.bin\vite.cmd" (
    echo Installing frontend dependencies...
    call npm.cmd ci || exit /b 1
)
echo Open http://127.0.0.1:5173 in your browser.
call npm.cmd run dev
exit /b %errorlevel%
