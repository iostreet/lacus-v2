#!/usr/bin/env bash
set -e
echo "============================================================"
echo " Lacus V2 — Starting server"
echo "============================================================"

if [ -d "venv" ]; then
    source venv/bin/activate
fi

# Open browser in background
(sleep 2 && python3 -c "import webbrowser; webbrowser.open('http://localhost:8000')") &

echo "[INFO] Server running at http://localhost:8000"
echo "[INFO] Press Ctrl+C to stop."

cd backend
uvicorn main:app --host 0.0.0.0 --port 8000 --reload
