@echo off
cd /d "%~dp0"
title Bridge - checks
echo.
echo   Bridge: build + logic + relay + site in a fake browser
echo.
node tools\check-all.mjs
echo.
pause
