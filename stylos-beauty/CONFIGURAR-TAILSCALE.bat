@echo off
REM ==================================================================
REM  StylOS Beauty - CONFIGURAR O TUNEL TAILSCALE (link publico)
REM  De dois cliques. Pode rodar quantas vezes quiser: ele confere o que
REM  ja esta pronto e so faz o que falta.
REM    1. instala o Tailscale (se faltar);
REM    2. faz login na sua conta Tailscale;
REM    3. liga o Funnel (publica o StylOS na internet com https).
REM  Obs.: este arquivo NAO usa blocos "if ( ... )" de proposito. Dentro
REM  deles, um ")" num texto fecha o bloco e quebra o script.
REM ==================================================================
setlocal
chcp 65001 >nul
title Configurar Tailscale - StylOS Beauty
cd /d "%~dp0"
set "TS=%ProgramFiles%\Tailscale\tailscale.exe"

REM Porta do StylOS: 3000, ou a que estiver no .env
set "PORTA=3000"
if not exist .env goto porta_ok
for /f "usebackq tokens=1,* delims==" %%a in (".env") do if /i "%%a"=="PORTA" set "PORTA=%%b"
:porta_ok

echo.
echo  ============================================
echo     TUNEL TAILSCALE - StylOS Beauty
echo  ============================================

REM ---------- 1. Programa ----------
echo.
echo  [1/3] Programa Tailscale
if exist "%TS%" goto instalado
where winget >nul 2>nul
if errorlevel 1 goto sem_winget
echo        Instalando... Se o Windows pedir permissao, clique em SIM.
winget install --id tailscale.tailscale -e --accept-source-agreements --accept-package-agreements
if exist "%TS%" goto instalado
echo.
echo        Nao consegui instalar pelo winget.
:sem_winget
echo        Instale pelo site que vai abrir agora: https://tailscale.com/download/windows
echo        Depois de instalar, rode este arquivo de novo.
start "" "https://tailscale.com/download/windows"
goto falhou

:instalado
echo        OK - Tailscale instalado.

REM Espera o servico do Tailscale responder - logo depois de instalar demora um pouco
set /a ESPERA=0
:esperar_servico
"%TS%" status --json >nul 2>nul
if not errorlevel 1 goto servico_ok
set /a ESPERA+=1
if %ESPERA% geq 20 goto servico_parado
if %ESPERA%==1 echo        Esperando o servico do Tailscale iniciar...
timeout /t 3 /nobreak >nul
goto esperar_servico
:servico_parado
echo.
echo        O servico do Tailscale nao respondeu.
echo        Abra o Tailscale pelo menu Iniciar, espere o icone aparecer perto
echo        do relogio e rode este arquivo de novo. Se nao resolver, reinicie o PC.
goto falhou
:servico_ok

REM ---------- 2. Login ----------
echo.
echo  [2/3] Login na conta Tailscale
call :conectado
if not errorlevel 1 goto logado
echo        Aparece abaixo um link "https://login.tailscale.com/...".
echo        Abra o link no navegador - segure CTRL e clique nele - e entre
echo        com a sua conta - pode ser o Gmail do sistema: stylosbeauty26@gmail.com.
echo        Depois de entrar, volte para esta janela.
echo.
"%TS%" up --timeout=10m
call :conectado
if not errorlevel 1 goto logado
echo.
echo        O login nao terminou. Outra forma: clique no icone do Tailscale
echo        perto do relogio, escolha "Log in" e depois rode este arquivo de novo.
goto falhou
:logado
echo        OK - conectado ao Tailscale.

REM ---------- 3. Funnel ----------
echo.
echo  [3/3] Ligando o Funnel - publicacao na internet - para a porta %PORTA%
echo        Na PRIMEIRA vez o Tailscale mostra um link para HABILITAR o Funnel.
echo        Abra o link, clique em "Enable" e volte: ele continua sozinho.
echo.
"%TS%" funnel --bg %PORTA%
if errorlevel 1 goto funnel_falhou
echo.
echo        Endereco publico:
"%TS%" funnel status

REM Faz o INICIAR-STYLOS.bat religar o tunel sempre
if not exist .env goto gravar_tunel
findstr /b /i /c:"TUNEL=" .env >nul 2>nul
if not errorlevel 1 goto tunel_gravado
:gravar_tunel
>> .env echo TUNEL=tailscale
:tunel_gravado

echo.
echo  ============================================
echo   PRONTO! O link publico e o endereco https://....ts.net acima.
echo   Agora abra o INICIAR-STYLOS.bat. No painel do dono, em
echo   "Sistema e seguranca", clique em "Verificar de novo".
echo  ============================================
if /i not "%~1"=="instalador" pause
exit /b 0

:funnel_falhou
echo.
echo        O Funnel nao ligou. O que costuma resolver:
echo         - abrir o link de habilitar que apareceu acima e clicar em "Enable";
echo         - em https://login.tailscale.com/admin/dns ativar "HTTPS Certificates";
echo         - atualizar o Tailscale - icone perto do relogio, "Update";
echo         - em rede de escola ou empresa, a rede pode bloquear: teste no 4G do celular.
echo        Depois rode este arquivo de novo.

:falhou
echo.
echo  ============================================
echo   NAO TERMINOU. Leia a mensagem acima. Se precisar de ajuda,
echo   tire um print desta janela.
echo  ============================================
pause
exit /b 1

REM ---------- Rotina: o Tailscale esta conectado? ----------
REM Devolve errorlevel 0 se sim, 1 se nao.
:conectado
"%TS%" status --json 2>nul | findstr /r /c:"BackendState.*Running" >nul
exit /b %errorlevel%
