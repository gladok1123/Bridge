#!/usr/bin/env bash
# Bridge - local start (macOS / Linux)
set -e
cd "$(dirname "$0")"
if [ ! -d node_modules ]; then
  echo "First run: installing dependencies..."
  npm install
fi
echo
echo "Bridge will be at http://localhost:3000"
echo "Camera and microphone work on localhost. For friends - deploy to Vercel."
echo
npm run dev
