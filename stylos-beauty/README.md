# StylOS Beauty

Sistema para salões de beleza (projeto da turma de Beleza do Senac):
**monte a página do salão por blocos, publique com um clique e receba
pedidos de horário no WhatsApp**, conferidos com a Google Agenda.

> Leia também o **[PLANEJAMENTO.md](PLANEJAMENTO.md)**: decisões, limitações,
> segurança e perguntas em aberto.

- Node.js puro + SQLite que já vem no Node → **nenhuma dependência para instalar**
- 3 papéis: **dono** (cadastra ADMs), **ADM** (monta páginas e cuida da agenda), **cliente**
- 9 modelos de seção, 5 temas (masculino, feminino e neutro), editor com prévia ao vivo
- Tutorial guiado e página de exemplo no primeiro acesso
- Agendamento: serviço → dia → horário livre → dados → WhatsApp do ADM
- Login com e-mail/senha **ou com Google**; "Esqueci minha senha" por e-mail
- "Não sou um robô" próprio (sem rastreamento) e **escudo contra abuso/DDoS**

---

## 1. Instalar (Windows 10/11)

1. Copie a pasta `stylos-beauty` para o computador que vai ser o servidor
   (ex.: `C:\StylOS\`).
2. Dê dois cliques em **`INSTALAR-WINDOWS.bat`**. Ele:
   - instala o **Node.js LTS** se faltar (depois peça para rodar de novo);
   - oferece instalar o **Tailscale** (túnel para publicar na internet);
   - oferece instalar o **FFmpeg** (necessário para os **vídeos**: é ele que
     otimiza cada vídeo enviado);
   - oferece **ligar o StylOS junto com o Windows**;
   - oferece **impedir o PC de dormir** na tomada.
3. Dê dois cliques em **`INICIAR-STYLOS.bat`**. Uma janela preta abre:
   **deixe-a aberta** (pode minimizar).

> Linux/macOS: `./scripts/iniciar.sh` (e `scripts/stylos.service` para ligar com o sistema).

## 2. Primeiro acesso (dono)

1. A janela preta mostra um **código** (ex.: `ABCD-2345`). Ele também fica
   em `dados/CODIGO-CONFIGURACAO-INICIAL.txt`.
2. No mesmo computador, abra `http://localhost:3000/configuracao-inicial`,
   digite o código e crie a conta do **dono**.
3. No painel, siga o tutorial. Depois:
   - **Sistema e segurança → Publicação na internet**: confira se aparece
     "No ar" com o endereço `https://<notebook>.<rede>.ts.net` (detectado sozinho);
   - **Sistema e segurança → E-mail**: o Gmail do sistema (`stylosbeauty26@gmail.com`)
     já vem preenchido; cole a **senha de app** e clique em "Enviar teste";
   - **Integração Google**: agenda dos ADMs e "Entrar com Google" (guias na tela);
   - **Administradores → Cadastrar ADM**: o sistema gera uma senha temporária
     e uma mensagem pronta para enviar à pessoa.

## 3. Publicar na internet (túnel)

O servidor só aceita conexões do próprio computador (`127.0.0.1`). Quem
leva até ele é o túnel: sem abrir portas no roteador e sem mostrar o seu IP.

> **Os links saem como `localhost`?** É sinal de que o Funnel não está ligado.
> O StylOS **detecta sozinho** o endereço do Tailscale (a cada 5 minutos, ou no
> botão "Verificar de novo" em *Sistema e segurança*) e passa a usá-lo em todos os links.

**Tailscale Funnel** (grátis para uso não comercial, sem domínio):
dê dois cliques em **`CONFIGURAR-TAILSCALE.bat`**. Ele instala o Tailscale,
faz o login, liga o Funnel e mostra o endereço. Pode rodar de novo quantas
vezes quiser: confere o que já está pronto e só faz o que falta. Se parar
no meio, a janela diz o que fazer.

Na primeira vez, o Tailscale mostra **dois links**: um de **login** e outro
para **habilitar o Funnel** (botão "Enable"). Abra os dois (CTRL + clique).

Pelo terminal, os comandos equivalentes são:
```
tailscale up                 (login uma vez)
tailscale funnel --bg 3000   (publica; se pedir, aprove o link que aparece)
tailscale funnel status      (mostra o endereço https://...ts.net)
```
O `CONFIGURAR-TAILSCALE.bat` já grava `TUNEL=tailscale` no `.env`, para o
`INICIAR-STYLOS.bat` religar o túnel sozinho (na mesma `PORTA` do `.env`).

**Cloudflare Tunnel** (grátis, uso comercial, precisa de domínio próprio).
Siga o guia **[MIGRAR-PARA-CLOUDFLARE.md](MIGRAR-PARA-CLOUDFLARE.md)** e use o
`CONFIGURAR-CLOUDFLARE.bat`. Os links antigos `.ts.net` redirecionam sozinhos.
Alternativa manual (sem instalar como serviço):
crie um túnel no painel Zero Trust da Cloudflare apontando para
`http://localhost:3000`, copie o token e coloque no `.env`:
```
TUNEL=cloudflare
CLOUDFLARE_TOKEN=cole-o-token-aqui
```

## 4. Usar com o site do Canva
O Canva não roda servidor nem banco (veja o PLANEJAMENTO, item 2.1).
Use o Canva como **vitrine** e coloque um botão "Agende seu horário" com o
link da página publicada (`https://seu-endereco/p/nome-do-salao-xxxx`).
As páginas públicas também permitem ser embutidas em `*.canva.site`.

## 5. Dia a dia do ADM
1. **Agenda e WhatsApp**: número, expediente (com intervalo de almoço),
   serviços com duração, Google Agenda, folgas.
2. **Minhas páginas → Editar**: clique numa seção, edite, veja a prévia
   em computador, tablet ou celular. Use `*palavra*` para destacar no título.
3. **Vídeos**: nos campos "Foto ou vídeo" (cabeçalho, sobre, destaque,
   serviços, galeria) e na seção Vídeo, toque em **Vídeo** e escolha o
   arquivo do celular/câmera (MP4, MOV do iPhone, WEBM, MKV...). O envio é
   em partes e mostra a porcentagem; depois o sistema **otimiza sozinho**
   (alguns segundos a poucos minutos) e mostra quanto ficou mais leve. Pode
   continuar editando enquanto isso. Para vídeo **no fundo do cabeçalho**,
   escolha "Foto/vídeo ocupando o fundo" em *Arrumação*. Vídeos já enviados
   ficam em **Minhas mídias** para reaproveitar.
4. **Publicar**: o sistema confere as boas práticas e gera o link.
5. **Agendamentos**: confirme, cancele, avise a cliente pelo WhatsApp ou
   crie o evento na sua Google Agenda com um clique.

## 6. Segurança no dia a dia
- **Não sou um robô**: aparece no cadastro, no pedido de horário, no "Esqueci
  minha senha" e no login depois de 2 senhas erradas. Ele começa sozinho
  quando a pessoa toca no formulário (cerca de 1 segundo).
- **Escudo**: em *Sistema e segurança* você vê pedidos por minuto, IPs
  bloqueados e o modo de defesa (automático, ou ligado/desligado na mão), e
  tem o botão "Desbloquear todos".
- **Notebook como servidor**: deixe na tomada, use a opção do instalador para
  não dormir com a tampa fechada e ative a criptografia do disco do Windows.

## 7. Pastas

```
stylos-beauty/
├─ INSTALAR-WINDOWS.bat / INICIAR-STYLOS.bat   ← dois cliques
├─ CONFIGURAR-TAILSCALE.bat ← liga o link público (pode rodar sozinho, de novo)
├─ CONFIGURAR-CLOUDFLARE.bat + MIGRAR-PARA-CLOUDFLARE.md  ← só quando tiver domínio
├─ marca/                  ← foto de perfil do Gmail (PNG e SVG editável)
├─ .env.exemplo            ← configurações opcionais (copie para .env)
├─ servidor/
│  ├─ principal.js         ← ponto de entrada; rotas de telas; segurança por pedido
│  ├─ configuracao.js      ← lê .env e cria o segredo
│  ├─ banco.js             ← SQLite e migrações
│  ├─ seguranca.js         ← senhas, sessões, CSRF, limites, CSP, criptografia
│  ├─ utilitarios.js       ← JSON, arquivos estáticos, mini-roteador
│  ├─ rotas/               ← autenticacao, dono, paginas, agenda, arquivos
│  ├─ rotas/protecao.js, google-login.js, recuperacao-senha.js   ← versão 2
│  └─ servicos/            ← horarios, google-agenda, manutencao (backup/LGPD), dados-iniciais,
│                             anti-robo, escudo (anti-DDoS), email (SMTP), tailscale,
│                             video (otimização com FFmpeg)  ← versão 4
│  └─ rotas/videos.js      ← envio em partes, situação, apagar  ← versão 4
├─ publico/                ← tudo que o navegador recebe
│  ├─ *.html               ← telas
│  ├─ css/site.css         ← páginas dos salões e os 5 temas
│  ├─ css/app.css          ← painel, editor, login
│  └─ js/
│     ├─ esquemas-secoes.js  ← MODELOS DE SEÇÃO + REGRAS (usado pelo navegador E pelo servidor)
│     ├─ renderizador.js     ← desenha a página (pública e prévia)
│     ├─ agendamento-widget.js
│     ├─ painel.js, editor.js, tour.js, comum.js, ...
├─ testes/                 ← npm run testar
└─ dados/                  ← CRIADA SOZINHA: banco, fotos, vídeos, backups, segredo (NUNCA versionar)
   └─ uploads/videos/<id>/ ← 1080.mp4 (computador), 720.mp4 (celular), poster.jpg (capa)
```

## 8. Para quem for mexer no código
- **Rodar os testes:** `npm run testar` (103 testes, não precisa de internet;
  os 14 de vídeo usam o FFmpeg de verdade e são pulados se ele não estiver
  instalado).
- **Nova seção:** crie o tipo em `TIPOS_SECAO` (`esquemas-secoes.js`) e a
  função `desenhar.<tipo>` em `renderizador.js`. O formulário do editor e a
  validação do servidor saem sozinhos do esquema.
- **Novo tema:** acrescente em `TEMAS` (`esquemas-secoes.js`), as variáveis
  em `site.css` (`:root[data-tema='...']`) e as fontes em `FONTES_POR_TEMA`
  (`renderizador.js`).
- **Nunca** use `innerHTML` com texto digitado por alguém: use as funções
  `el()`, que escrevem como texto.
- A política de segurança bloqueia `<script>` embutido e `style="..."` no
  HTML: coloque JS em `publico/js` e CSS em `publico/css`.
- Mudou o banco? Crie uma nova entrada em `MIGRACOES` (`banco.js`). Nunca
  edite uma migração antiga.

## 9. Problemas comuns
| Sintoma | Solução |
|---|---|
| Link da página sai como `http://localhost...` | O Funnel não está ligado. Rode o `CONFIGURAR-TAILSCALE.bat` e clique em "Verificar de novo" (*Sistema e segurança*) |
| Instalador fechou ou deu erro na parte do Tailscale | Era um erro do instalador antigo (corrigido). Rode só o `CONFIGURAR-TAILSCALE.bat` |
| `CONFIGURAR-TAILSCALE.bat` para em "[3/3] Funnel" | Abra o link de habilitar o Funnel e clique em "Enable"; confira "HTTPS Certificates" em login.tailscale.com/admin/dns. Rede de escola/empresa pode bloquear: teste no 4G |
| "Criar conta" leva a "Você já está conectado" | Você está logado (ex.: como dono). Saia ou use uma janela anônima para testar como cliente |
| "Muitos pedidos. Aguarde" | O escudo bloqueou o endereço. O dono pode clicar em "Desbloquear todos" |
| "Entrar com Google" dá erro de redirecionamento | O URI de redirecionamento no Google Cloud precisa ser EXATAMENTE o mostrado no painel (com `https://...ts.net`) |
| E-mail de teste falha | Use uma **senha de app** (verificação em duas etapas ligada), não a senha normal do Gmail |
| "precisa do Node.js 22.13 ou mais novo" | Rode o instalador ou instale a LTS em nodejs.org |
| `EADDRINUSE` | Já existe um StylOS aberto (feche a outra janela) ou mude `PORTA` no `.env` (e no túnel) |
| Página fora do ar | O PC está ligado? A janela preta está aberta? O túnel está ativo (`tailscale funnel status`)? |
| "Agenda não encontrada ou não compartilhada" | Refaça o compartilhamento com o e-mail da integração, permissão "ver apenas livre/ocupado" |
| Botão "Vídeo" apagado / "FFmpeg não encontrado" | Rode o `INSTALAR-WINDOWS.bat` e aceite o FFmpeg (ou `winget install Gyan.FFmpeg`). Feche e abra o `INICIAR-STYLOS.bat` e clique em "Verificar de novo" no cartão **Vídeos** (*Sistema e segurança*) |
| Vídeo fica "na fila" muito tempo | Ele é otimizado um de cada vez, em prioridade baixa. Vídeos longos em 4K num notebook simples podem levar alguns minutos; não feche a janela preta |
| "Vídeo muito longo" / "muito grande" | Limites padrão: 10 minutos e 500 MB. Para mudar, use `VIDEO_DURACAO_MAXIMA_SEG` e `VIDEO_TAMANHO_MAXIMO_MB` no `.env` |
| Esqueci a senha do dono | No computador do servidor, abra um terminal na pasta e rode `node --disable-warning=ExperimentalWarning scripts/redefinir-senha-dono.js`. Ele mostra uma senha temporária |
| Restaurar backup | Pare o servidor, copie `dados/backups/stylos-AAAA-MM-DD.sqlite` por cima de `dados/stylos.sqlite` e ligue de novo |
