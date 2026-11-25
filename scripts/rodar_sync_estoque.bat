@echo off
setlocal
cd /d "%~dp0.."
if exist ".venv\Scripts\activate.bat" call ".venv\Scripts\activate.bat"
python "scripts\sincronizar_estoque_uniplus.py" %*
set ERR=%ERRORLEVEL%
echo.
echo Codigo de saida: %ERR%
exit /b %ERR%
