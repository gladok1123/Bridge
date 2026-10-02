@echo off
cd /d "%~dp0"
title Bridge - calls (local)
if not exist node_modules (
  echo   First run: installing dependencies, about a minute...
  call npm install
)
echo.
echo   Bridge will be at  http://localhost:3000
echo   Camera and microphone work on localhost.
echo   For friends over the internet - deploy to Vercel (see README.md and VERTSEL.md).
echo.
start "" http://localhost:3000
call npm run dev
