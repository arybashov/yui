@echo off
rem Starts the YUI dev server and opens the game in the default browser.
cd /d "%~dp0"
if not exist node_modules call npm install
start "" http://localhost:5173
call npm run dev
pause
