@echo off
setlocal
title Lacus V2

set "PYTHON="

if exist "C:\ProgramData\Miniconda3\python.exe"    set "PYTHON=C:\ProgramData\Miniconda3\python.exe"
if exist "C:\ProgramData\Anaconda3\python.exe"     set "PYTHON=C:\ProgramData\Anaconda3\python.exe"
if exist "%USERPROFILE%\Miniconda3\python.exe"     set "PYTHON=%USERPROFILE%\Miniconda3\python.exe"
if exist "%USERPROFILE%\Anaconda3\python.exe"      set "PYTHON=%USERPROFILE%\Anaconda3\python.exe"

if "%PYTHON%"=="" for %%P in (
    "%LOCALAPPDATA%\Programs\Python\Python313\python.exe"
    "%LOCALAPPDATA%\Programs\Python\Python312\python.exe"
    "%LOCALAPPDATA%\Programs\Python\Python311\python.exe"
    "%LOCALAPPDATA%\Programs\Python\Python310\python.exe"
) do if exist %%P if "%PYTHON%"=="" set "PYTHON=%%~P"

if "%PYTHON%"=="" set "PYTHON=python"

echo ============================================================
echo   Lacus V2  ^|  http://localhost:8000
echo   Python: %PYTHON%
echo   Press Ctrl+C to stop.
echo ============================================================
echo.

echo [INFO] Checking port 8000...
for /f "tokens=5" %%a in ('netstat -aon 2^>nul ^| findstr /L ":8000"') do taskkill /F /PID %%a >nul 2>&1

REM Skip dependency checks after first successful install
if exist "%~dp0.deps_ok" goto :startsvr

echo [INFO] Checking dependencies (first run only)...

"%PYTHON%" -c "import fastapi" 2>nul || (
    echo [INFO] Installing core packages...
    "%PYTHON%" -m pip install fastapi uvicorn python-multipart pdfminer.six requests aiofiles --quiet
)

"%PYTHON%" -c "import dotenv" 2>nul || (
    echo [INFO] Installing python-dotenv...
    "%PYTHON%" -m pip install python-dotenv --quiet
)

"%PYTHON%" -c "import supabase" 2>nul || (
    echo [INFO] Installing supabase client...
    "%PYTHON%" -m pip install "supabase>=2.3.0" httpx --quiet
)

"%PYTHON%" -c "import sklearn" 2>nul || (
    echo [INFO] Installing scikit-learn...
    "%PYTHON%" -m pip install scikit-learn --quiet
)

"%PYTHON%" -c "import keybert" 2>nul || (
    echo [INFO] Installing NLP packages - first run may take a few minutes...
    "%PYTHON%" -m pip install "torch==2.2.2" --index-url https://download.pytorch.org/whl/cpu --quiet
    "%PYTHON%" -m pip install "numpy<2" --quiet
    "%PYTHON%" -m pip install "sentence-transformers==3.3.1" "transformers==4.46.3" keybert --quiet
)

"%PYTHON%" -c "import spacy" 2>nul || (
    echo [INFO] Installing spaCy...
    "%PYTHON%" -m pip install spacy --quiet
)

"%PYTHON%" -m spacy info en_core_web_sm 2>nul || (
    echo [INFO] Downloading spaCy English model...
    "%PYTHON%" -m spacy download en_core_web_sm --quiet
)

"%PYTHON%" -c "import scispacy" 2>nul || (
    echo [INFO] Installing scispaCy...
    "%PYTHON%" -m pip install scispacy --quiet
)

"%PYTHON%" -m spacy info en_core_sci_sm 2>nul || (
    echo [INFO] Downloading scispaCy model - first run only, ~100 MB...
    "%PYTHON%" -m pip install "https://s3-us-west-2.amazonaws.com/ai2-s2-scispacy/releases/v0.5.4/en_core_sci_sm-0.5.4.tar.gz" --quiet
)

echo 1>"%~dp0.deps_ok"

:startsvr
echo.
echo [INFO] Starting server...
start /b "" cmd /c "ping -n 4 127.0.0.1 >nul & start http://localhost:8000"

cd /d "%~dp0backend"
"%PYTHON%" -m uvicorn main:app --host 0.0.0.0 --port 8000

echo.
echo Server stopped.
pause