@echo off
cd /d "%~dp0"

echo ========================================================
echo   Orb Translations: Saving changes to GitHub
echo ========================================================
echo.

echo [1/3] Adding files to git...
git add .

echo.
echo [2/3] Committing changes...
git commit -m "feat: update feedback system, bot integration and RLS (v3.4.2)"

echo.
echo [3/3] Pushing to GitHub (main)...
git push origin main

echo.
if %errorlevel% equ 0 (
    echo ========================================================
    echo   SUCCESS! All changes pushed to GitHub.
    echo ========================================================
) else (
    echo ========================================================
    echo   ERROR occurred while pushing to GitHub.
    echo ========================================================
)

echo.
pause
