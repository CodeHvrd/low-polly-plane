@echo off
REM ============================================================
REM  PAPERCRASH — arrancar el servidor (doble clic)
REM ============================================================
REM  Levanta el servidor de desarrollo en modo LAN, asi que tambien
REM  se puede abrir desde el telefono con la direccion que imprime.
REM
REM  NO hace falta ejecutar como administrador: escucha en un puerto
REM  local y solo lee archivos de esta carpeta. Nada mas.
REM
REM  Al cerrar esta ventana (o Ctrl+C) el servidor se detiene.
REM ============================================================
setlocal
cd /d "%~dp0"

set "NODE="

REM 1) El Node instalado en el sistema, si lo hay: es el mas previsible
REM    y el que sigue estando si se desinstala el harness.
for /f "delims=" %%N in ('where node 2^>nul') do (
  if not defined NODE set "NODE=%%N"
)

REM 2) Si no, el Node que trae DeepSeek Harness. Se busca en las
REM    runtime que haya, sin fijar la version en el nombre.
if not defined NODE (
  for /d %%D in ("%USERPROFILE%\.dsh\dsh-runtimes\*") do (
    if not defined NODE (
      if exist "%%D\dependencies\node\bin\node.exe" set "NODE=%%D\dependencies\node\bin\node.exe"
    )
  )
)

if not defined NODE (
  echo.
  echo   No se encontro Node.js.
  echo.
  echo   Opciones:
  echo     1. Instalalo desde https://nodejs.org  ^(version LTS^)
  echo     2. O avisale al agente de DSH: el Node que usa sirve igual.
  echo.
  pause
  exit /b 1
)

echo.
echo   Node: %NODE%
echo.

"%NODE%" tools\serve.mjs 8765 --lan

REM Si el servidor se cierra por un error, no cerrar la ventana de golpe:
REM el mensaje es lo unico que explica que paso.
echo.
echo   El servidor se detuvo.
pause
