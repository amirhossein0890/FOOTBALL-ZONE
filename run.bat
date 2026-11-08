@echo off
chcp 65001 >nul
cd /d "%~dp0"
where node >nul 2>nul
if errorlevel 1 (
  echo Node.js نصب نیست. نسخه 18 یا جدیدتر را نصب کن: https://nodejs.org/
  pause
  exit /b 1
)
if not exist ".env" (
  echo فایل .env پیدا نشد.
  echo ابتدا از .env.example یک کپی با نام .env بساز و کلید API-Football جدیدت را در آن وارد کن.
  pause
  exit /b 1
)
echo FOOTBALL ZONE در حال اجراست...
echo دریافت مسابقات از API-Football انجام می‌شود.
start "" http://localhost:3000
node server.js
pause
