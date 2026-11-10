@echo off
REM ==================================================================
REM  StylOS Beauty - INSTALADOR para Windows 10/11
REM  De dois cliques. Ele (tambem instala o FFmpeg, para videos):
REM   1. confere/instala o Node.js (motor do sistema);
REM   2. (opcional) instala o tunel seguro (Tailscale) - o mesmo que CONFIGURAR-TAILSCALE.bat;
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
  echo  [1/6] O Node.js nao esta instalado. Instalando a versao LTS...
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
echo  [1/6] Node.js encontrado: %NODE_VERSAO%
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
echo  [2/6] Para as clientes acessarem pela internet, usamos um TUNEL seguro
echo        (nao precisa abrir portas no roteador e o seu IP fica escondido).
choice /c SN /m "        Instalar e configurar o Tailscale agora"
if errorlevel 2 goto depois_tailscale
call "%~dp0CONFIGURAR-TAILSCALE.bat" instalador
echo.
echo        Se o Tailscale nao terminou, rode depois so o CONFIGURAR-TAILSCALE.bat
:depois_tailscale

REM ---------- 3. FFmpeg (otimizacao de videos) ----------
echo.
echo  [3/6] Para otimizar os VIDEOS enviados (deixar leves sem perder qualidade),
echo        o StylOS usa o programa gratuito FFmpeg.
where ffmpeg >nul 2>nul
if %errorlevel%==0 (
  echo        FFmpeg ja instalado.
  goto depois_ffmpeg
)
choice /c SN /m "        Instalar o FFmpeg agora"
if %errorlevel%==1 (
  winget install --id Gyan.FFmpeg -e --accept-source-agreements --accept-package-agreements
  echo        Pronto. Ele passa a valer na proxima vez que abrir o INICIAR-STYLOS.bat.
)
:depois_ffmpeg

REM ---------- 3b. Ligar junto com o Windows ----------
echo.
choice /c SN /m "  [4/6] Ligar o StylOS sozinho sempre que voce entrar no Windows"
if %errorlevel%==1 (
  schtasks /create /f /sc onlogon /rl limited /tn "StylOS Beauty" /tr "\"%~dp0INICIAR-STYLOS.bat\"" >nul
  if errorlevel 1 (echo        Nao consegui criar a tarefa.) else (echo        Pronto: tarefa "StylOS Beauty" criada.)
)

REM ---------- 4. Nao dormir ----------
echo.
choice /c SN /m "  [5/6] Impedir o computador de dormir quando estiver na tomada"
if %errorlevel%==1 (
  powercfg /change standby-timeout-ac 0
  powercfg /change hibernate-timeout-ac 0
  echo        Pronto. A tela ainda pode desligar, o computador nao.
)

REM ---------- 5. Notebook: tampa fechada ----------
echo.
choice /c SN /m "  [6/6] E um NOTEBOOK? Continuar ligado com a tampa fechada (na tomada)"
if %errorlevel%==1 (
  powercfg /setacvalueindex SCHEME_CURRENT SUB_BUTTONS LIDACTION 0
  powercfg /setactive SCHEME_CURRENT
  echo        Pronto. Na tomada, fechar a tampa nao desliga o StylOS.
  echo        Dica: deixe o notebook num lugar ventilado.
)

echo.
echo  ============================================
echo   Instalacao concluida!
echo   Para ligar agora: dois cliques em INICIAR-STYLOS.bat
echo  ============================================
pause
