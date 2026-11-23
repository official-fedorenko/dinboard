@echo off
rem Dinboard: local start by double click (Windows). Needs Node.js 22+.
rem Starts tools\serve.js in its own window and opens the site in the default browser.
rem To stop the server, close its window (or press Ctrl+C in it).
cd /d "%~dp0"
where node >nul 2>nul || (echo Node.js not found. Install it from https://nodejs.org and run this file again. & pause & exit /b 1)
if not defined PORT set PORT=8080
start "Dinboard server" cmd /k node tools\serve.js
rem Give the server a moment to start before opening the browser
timeout /t 2 /nobreak >nul
start "" http://localhost:%PORT%/
