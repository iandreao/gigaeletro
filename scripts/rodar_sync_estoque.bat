@echo off
setlocal
cd /d "%~dp0.."
REM Origem (ordem): PASTA_ESTOQUE_UNIPLUS -> \\SERVIDOR\EstoqueProdutos -> \\192.168.1.254\EstoqueProdutos
REM                 -> C:\SiteGigaeletro\EstoqueProdutos -> C:\EstoqueProdutos -> Documents\EstoqueProdutos
REM Aceita Estoque *.xls / *.xlsx exportados do Uniplus
if exist ".venv\Scripts\activate.bat" call ".venv\Scripts\activate.bat"
python "scripts\sincronizar_estoque_uniplus.py" %*
set ERR=%ERRORLEVEL%
echo.
echo Codigo de saida: %ERR%
exit /b %ERR%
