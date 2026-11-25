@echo off
setlocal
cd /d "%~dp0.."
REM Origem padrao: C:\EstoqueProdutos (fallback: %USERPROFILE%\Documents\EstoqueProdutos)
REM Aceita Estoque *.xls / *.xlsx exportados do Uniplus
if exist ".venv\Scripts\activate.bat" call ".venv\Scripts\activate.bat"
python "scripts\sincronizar_estoque_uniplus.py" %*
set ERR=%ERRORLEVEL%
echo.
echo Codigo de saida: %ERR%
exit /b %ERR%
