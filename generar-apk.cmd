@echo off
REM ============================================================
REM  PAPERCRASH - Generador del APK para Android
REM
REM  Doble clic y listo. No hace falta administrador ni instalar
REM  nada aparte: el toolchain (JDK + Android SDK) se baja solo
REM  la primera vez, dentro de .android-build\.
REM
REM  El APK queda en native\build\PaperCrash-1.0.0.apk
REM ============================================================
setlocal
cd /d "%~dp0"

REM Buscar Node: primero el del sistema, después el que trae DSH.
set "NODE_EXE="
where node >nul 2>&1
if %ERRORLEVEL%==0 set "NODE_EXE=node"

if not defined NODE_EXE (
  for /d %%D in ("%USERPROFILE%\.dsh\dsh-runtimes\*\dependencies\node") do (
    if exist "%%D\bin\node.exe" set "NODE_EXE=%%D\bin\node.exe"
  )
)

if not defined NODE_EXE (
  echo.
  echo   No encontre Node.js.
  echo   Instalalo desde https://nodejs.org y volve a ejecutar este archivo.
  echo.
  pause
  exit /b 1
)

echo.
echo   PAPERCRASH - generando el APK...
echo   Node: %NODE_EXE%
echo.

"%NODE_EXE%" tools\build-apk-todo.mjs
set "CODIGO=%ERRORLEVEL%"

echo.
if "%CODIGO%"=="0" (
  echo   Listo. El APK esta en:
  echo     native\build\PaperCrash-1.0.0.apk
  echo.
  echo   Para instalarlo, copialo al telefono y abrilo.
) else (
  echo   Fallo la compilacion. El detalle esta arriba.
)
echo.
pause
