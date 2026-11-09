@echo off
REM ==================================================================
REM  StylOS Beauty - INSTALADOR para Windows 10/11
REM  De dois cliques. Ele:
REM   1. confere/instala o Node.js (motor do sistema);
REM   2. (opcional) instala o tunel seguro (Tailscale) para publicar na internet;
REM   3. (opcional) faz o StylOS ligar sozinho quando o computador ligar;
REM   4. (opcional) impede o computador de dormir na tomada.
REM ==================================================================
chcp 65001 >nul
title Instalador StylOS Beauty
cd /d "%~dp0"
echo.
echo  ============================================
echo     INSTALADOR - StylOS Beauty
echo  ============================================
echo.

REM ---------- 1. Node.js ----------
where node >nul 2>nul
if %errorlevel% neq 0 (
  echo  [1/4] O Node.js nao esta instalado. Instalando a versao LTS...
  winget install --id OpenJS.NodeJS.LTS -e --accept-source-agreements --accept-package-agreements
  if errorlevel 1 (
    echo.
    echo  Nao consegui instalar sozinho. Baixe e instale a versao LTS em:
    echo      https://nodejs.org
    echo  Depois rode este instalador de novo.
    pause
    exit /b 1
  )
  echo  Node.js instalado. FECHE esta janela e rode o instalador de novo.
  pause
  exit /b 0
)
for /f "tokens=1 delims=v." %%v in ('node -v') do set NODE_MAIOR=%%v
for /f "tokens=*" %%v in ('node -v') do set NODE_VERSAO=%%v
echo  [1/4] Node.js encontrado: %NODE_VERSAO%
node -e "const [a,b]=process.versions.node.split('.').map(Number);process.exit(a>22||(a===22&&b>=13)?0:1)"
if %errorlevel% neq 0 (
  echo  Sua versao do Node.js e antiga. Atualizando para a LTS...
  winget upgrade --id OpenJS.NodeJS.LTS -e --accept-source-agreements --accept-package-agreements
  echo  Feche esta janela e rode o instalador de novo.
  pause
  exit /b 0
)

REM ---------- 2. Tunel (Tailscale Funnel) ----------
echo.
echo  [2/4] Para as clientes acessarem pela internet, usamos um TUNEL seguro
echo        (nao precisa abrir portas no roteador e o seu IP fica escondido).
choice /c SN /m "        Instalar o Tailscale agora"
if %errorlevel%==1 (
  winget install --id tailscale.tailscale -e --accept-source-agreements --accept-package-agreements
  echo.
  echo  Agora faca login no Tailscale (vai abrir o navegador).
  "C:\Program Files\Tailscale\tailscale.exe" up
  echo.
  echo  Ativando o Funnel (publicacao na internet) para a porta 3000...
  "C:\Program Files\Tailscale\tailscale.exe" funnel --bg 3000
  echo.
  echo  Se apareceu um link pedindo para HABILITAR o Funnel, abra-o, aprove
  echo  e rode este instalador de novo. O endereco publico e:
  "C:\Program Files\Tailscale\tailscale.exe" funnel status
  findstr /b /c:"TUNEL=" .env >nul 2>nul || (>> .env echo TUNEL=tailscale)
)

REM ---------- 3. Ligar junto com o Windows ----------
echo.
choice /c SN /m "  [3/4] Ligar o StylOS sozinho sempre que voce entrar no Windows"
if %errorlevel%==1 (
  schtasks /create /f /sc onlogon /rl limited /tn "StylOS Beauty" /tr "\"%~dp0INICIAR-STYLOS.bat\"" >nul
  if errorlevel 1 (echo        Nao consegui criar a tarefa.) else (echo        Pronto: tarefa "StylOS Beauty" criada.)
)

REM ---------- 4. Nao dormir ----------
echo.
choice /c SN /m "  [4/4] Impedir o computador de dormir quando estiver na tomada"
if %errorlevel%==1 (
  powercfg /change standby-timeout-ac 0
  powercfg /change hibernate-timeout-ac 0
  echo        Pronto. A tela ainda pode desligar, o computador nao.
)

echo.
echo  ============================================
echo   Instalacao concluida!
echo   Para ligar agora: dois cliques em INICIAR-STYLOS.bat
echo  ============================================
pause
