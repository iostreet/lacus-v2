#!/usr/bin/env bash
set -e
echo "============================================================"
echo " Lacus V2 — Setup Script (Linux / macOS)"
echo "============================================================"

# Check Python
if ! command -v python3 &>/dev/null; then
    echo "[ERROR] Python 3 not found. Install Python 3.10+."
    exit 1
fi
echo "[OK] Python3 found: $(python3 --version)"

# Virtual environment
if [ ! -d "venv" ]; then
    echo "[INFO] Creating virtual environment..."
    python3 -m venv venv
fi

source venv/bin/activate
echo "[INFO] Installing Python packages..."
pip install --upgrade pip -q
pip install -r backend/requirements.txt -q

echo "[INFO] Downloading spaCy model..."
python -m spacy download en_core_web_sm -q

echo ""
echo "============================================================"
echo " Setup complete! Run:  ./start.sh  to launch Lacus"
echo "============================================================"
