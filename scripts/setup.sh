#!/usr/bin/env bash
set -euo pipefail

echo "==================================================="
echo "  Orches Setup - Linux (Ubuntu) Installation"
echo "==================================================="

echo "[1/4] Checking Node.js version..."
if ! command -v node >/dev/null 2>&1; then
    echo "[ERROR] Node.js is not installed. Please install Node.js >= 22.5.0."
    exit 1
fi

NODE_VERSION=$(node -v | sed 's/^v//')
NODE_MAJOR=$(echo "$NODE_VERSION" | cut -d. -f1)
NODE_MINOR=$(echo "$NODE_VERSION" | cut -d. -f2)

if [ "$NODE_MAJOR" -lt 22 ] || ([ "$NODE_MAJOR" -eq 22 ] && [ "$NODE_MINOR" -lt 5 ]); then
    echo "[ERROR] Node.js version is v$NODE_VERSION. Orches requires Node.js >= 22.5.0."
    exit 1
fi
echo "Node.js version OK (v$NODE_VERSION)."

echo "[2/4] Installing project dependencies..."
npm install

echo "[3/4] Ensuring Playwright browser binaries are installed..."
npx playwright install chromium || echo "[WARN] Playwright browser download reported a problem; see the message above."
# A fresh Ubuntu install lacks some libraries Chromium needs (libnss3, libgbm1, libasound2t64, ...).
if [ "$(id -u)" -eq 0 ]; then
    npx playwright install-deps chromium || echo "[WARN] Could not install Chromium's system libraries automatically."
elif command -v sudo >/dev/null 2>&1; then
    echo "Installing Chromium's system libraries (sudo may ask for your password)..."
    sudo env "PATH=$PATH" npx playwright install-deps chromium || echo "[WARN] Could not install Chromium's system libraries. Run: sudo npx playwright install-deps chromium"
else
    echo "[WARN] Run as root to install Chromium's system libraries: npx playwright install-deps chromium"
fi

echo "[4/4] Building packages and applications..."
npm run build

echo ""
echo "Running diagnostic self-check..."
npm run diagnose

echo ""
echo "==================================================="
echo "Setup complete! To start Orches, run:"
echo "  ./scripts/start.sh"
echo "==================================================="
