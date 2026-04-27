@echo off
setlocal
echo ============================================================
echo  Lacus V2 — Setup Script (Windows)
echo ============================================================
echo.

REM Check Python
python --version >nul 2>&1
if errorlevel 1 (
    echo [ERROR] Python not found. Install Python 3.10+ from https://python.org
    pause
    exit /b 1
)
echo [OK] Python found.

REM Create virtual environment
if not exist "venv" (
    echo [INFO] Creating virtual environment...
    python -m venv venv
)
echo [OK] Virtual environment ready.

REM Activate and install
call venv\Scripts\activate.bat
echo [INFO] Installing Python packages (this may take a few minutes)...
python -m pip install --upgrade pip --quiet
pip install -r backend\requirements.txt --quiet

REM Download spaCy model
echo [INFO] Downloading spaCy language model...
python -m spacy download en_core_web_sm --quiet

echo.
echo ============================================================
echo  Setup complete!
echo  Run:  start.bat   to launch Lacus
echo ============================================================
pause
