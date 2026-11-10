@echo off
REM ==================================================================
REM  StylOS Beauty - LIGAR O TUNEL DA CLOUDFLARE (dominio proprio)
REM  Use SO depois de seguir o guia MIGRAR-PARA-CLOUDFLARE.md
REM  (precisa ter: dominio na Cloudflare + token do tunel).
REM  Clique com o botao direito > "Executar como administrador".
REM ==================================================================
chcp 65001 >nul
title Configurar Cloudflare - StylOS Beauty
cd /d "%~dp0"

net session >nul 2>&1
if errorlevel 1 (
  echo.
  echo  Este instalador precisa de permissao de ADMINISTRADOR.
  echo  Feche, clique com o botao direito neste arquivo e escolha
  echo  "Executar como administrador".
  pause
  exit /b 1
)

REM ---------- 1. Instalar o cloudflared ----------
set CF=cloudflared
if exist "%ProgramFiles(x86)%\cloudflared\cloudflared.exe" set CF="%ProgramFiles(x86)%\cloudflared\cloudflared.exe"
if exist "%ProgramFiles%\cloudflared\cloudflared.exe" set CF="%ProgramFiles%\cloudflared\cloudflared.exe"
%CF% --version >nul 2>nul
if errorlevel 1 (
  echo  [1/2] Instalando o cloudflared...
  winget install --id Cloudflare.cloudflared -e --accept-source-agreements --accept-package-agreements
  if exist "%ProgramFiles(x86)%\cloudflared\cloudflared.exe" set CF="%ProgramFiles(x86)%\cloudflared\cloudflared.exe"
  if exist "%ProgramFiles%\cloudflared\cloudflared.exe" set CF="%ProgramFiles%\cloudflared\cloudflared.exe"
)
%CF% --version >nul 2>nul
if errorlevel 1 (
  echo  Nao consegui instalar o cloudflared. Baixe em:
  echo      https://developers.cloudflare.com/cloudflare-one/connections/connect-networks/downloads/
  pause
  exit /b 1
)
echo  [1/2] cloudflared pronto.

REM ---------- 2. Instalar o tunel como servico do Windows ----------
echo.
echo  [2/2] Cole o TOKEN do tunel (texto longo que comeca com "eyJ")
echo        e aperte Enter. (Botao direito cola no terminal.)
set /p TOKEN=  Token: 
if "%TOKEN%"=="" (
  echo  Nenhum token informado. Nada foi alterado.
  pause
  exit /b 1
)
%CF% service install %TOKEN%
if errorlevel 1 (
  echo.
  echo  Nao deu certo. Se ja existia um servico antigo, rode:
  echo      cloudflared service uninstall
  echo  e depois este arquivo de novo.
  pause
  exit /b 1
)
set TOKEN=
echo.
echo  ============================================
echo   Tunel da Cloudflare instalado como SERVICO:
echo   ele liga sozinho junto com o Windows.
echo.
echo   Falta 1 passo no painel do StylOS (como dono):
echo   Sistema e seguranca ^> Endereco publico manual ^>
echo   https://agenda.SEUDOMINIO.com.br  ^> Salvar
echo.
echo   Mantenha o Tailscale Funnel ligado por algumas semanas:
echo   os links antigos (.ts.net) vao redirecionar sozinhos.
echo  ============================================
pause
