@echo off
REM ==================================================================
REM  StylOS Beauty - LIGAR O SERVIDOR (Windows)
REM  Deixe esta janela aberta (pode minimizar). Se o sistema parar por
REM  algum erro, ele reinicia sozinho em 5 segundos.
REM ==================================================================
chcp 65001 >nul
title StylOS Beauty - servidor (NAO FECHE)
cd /d "%~dp0"

where node >nul 2>nul
if %errorlevel% neq 0 (
  echo O Node.js nao esta instalado. Rode primeiro o INSTALAR-WINDOWS.bat
  pause
  exit /b 1
)

REM Liga o tunel configurado no arquivo .env (TUNEL=tailscale ou TUNEL=cloudflare)
set TUNEL=
set CLOUDFLARE_TOKEN=
if exist .env (
  for /f "usebackq tokens=1,* delims==" %%a in (".env") do (
    if /i "%%a"=="TUNEL" set TUNEL=%%b
    if /i "%%a"=="CLOUDFLARE_TOKEN" set CLOUDFLARE_TOKEN=%%b
  )
)
if /i "%TUNEL%"=="tailscale" (
  "C:\Program Files\Tailscale\tailscale.exe" funnel --bg 3000 >nul 2>nul
  echo Tunel Tailscale ativo:
  "C:\Program Files\Tailscale\tailscale.exe" funnel status
)
if /i "%TUNEL%"=="cloudflare" (
  start "StylOS - tunel Cloudflare" /min cloudflared tunnel run --token %CLOUDFLARE_TOKEN%
  echo Tunel Cloudflare iniciado em outra janela minimizada.
)

:ligar
node --disable-warning=ExperimentalWarning servidor\principal.js
echo.
echo O servidor parou. Reiniciando em 5 segundos... (feche esta janela para desligar de vez)
timeout /t 5 /nobreak >nul
goto ligar
