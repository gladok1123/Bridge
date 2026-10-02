@echo off
cd /d "%~dp0"
title Bridge - relay
echo.
echo   Own signaling relay on ws://0.0.0.0:8080/ws
echo   Put this address into .env.local as NEXT_PUBLIC_WS_RELAY
echo.
node relay\server.js
pause
