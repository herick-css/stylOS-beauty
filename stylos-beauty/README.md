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

---

## 1. Instalar (Windows 10/11)

1. Copie a pasta `stylos-beauty` para o computador que vai ser o servidor
   (ex.: `C:\StylOS\`).
2. Dê dois cliques em **`INSTALAR-WINDOWS.bat`**. Ele:
   - instala o **Node.js LTS** se faltar (depois peça para rodar de novo);
   - oferece instalar o **Tailscale** (túnel para publicar na internet);
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
   - **Sistema e segurança → Endereço público**: cole o endereço do túnel
     (ex.: `https://salao-senac.tail1234.ts.net`);
   - **Integração Google**: siga o guia da tela (uns 10 minutos, uma vez só);
   - **Administradores → Cadastrar ADM**: o sistema gera uma senha temporária
     e uma mensagem pronta para enviar à pessoa.

## 3. Publicar na internet (túnel)

O servidor só aceita conexões do próprio computador (`127.0.0.1`). Quem
leva até ele é o túnel: sem abrir portas no roteador e sem mostrar o seu IP.

**Tailscale Funnel** (grátis para uso não comercial, sem domínio):
```
tailscale up                 (login uma vez)
tailscale funnel --bg 3000   (publica; se pedir, aprove o link que aparece)
tailscale funnel status      (mostra o endereço https://...ts.net)
```
No `.env`, coloque `TUNEL=tailscale` para o `INICIAR-STYLOS.bat` reativar sozinho.

**Cloudflare Tunnel** (grátis, uso comercial, precisa de domínio próprio):
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
3. **Publicar**: o sistema confere as boas práticas e gera o link.
4. **Agendamentos**: confirme, cancele, avise a cliente pelo WhatsApp ou
   crie o evento na sua Google Agenda com um clique.

## 6. Pastas

```
stylos-beauty/
├─ INSTALAR-WINDOWS.bat / INICIAR-STYLOS.bat   ← dois cliques
├─ .env.exemplo            ← configurações opcionais (copie para .env)
├─ servidor/
│  ├─ principal.js         ← ponto de entrada; rotas de telas; segurança por pedido
│  ├─ configuracao.js      ← lê .env e cria o segredo
│  ├─ banco.js             ← SQLite e migrações
│  ├─ seguranca.js         ← senhas, sessões, CSRF, limites, CSP, criptografia
│  ├─ utilitarios.js       ← JSON, arquivos estáticos, mini-roteador
│  ├─ rotas/               ← autenticacao, dono, paginas, agenda, arquivos
│  └─ servicos/            ← horarios, google-agenda, manutencao (backup/LGPD), dados-iniciais
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
└─ dados/                  ← CRIADA SOZINHA: banco, fotos, backups, segredo (NUNCA versionar)
```

## 7. Para quem for mexer no código
- **Rodar os testes:** `npm run testar` (56 testes, não precisa de internet).
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

## 8. Problemas comuns
| Sintoma | Solução |
|---|---|
| "precisa do Node.js 22.13 ou mais novo" | Rode o instalador ou instale a LTS em nodejs.org |
| `EADDRINUSE` | Já existe um StylOS aberto (feche a outra janela) ou mude `PORTA` no `.env` (e no túnel) |
| Página fora do ar | O PC está ligado? A janela preta está aberta? O túnel está ativo (`tailscale funnel status`)? |
| "Agenda não encontrada ou não compartilhada" | Refaça o compartilhamento com o e-mail da integração, permissão "ver apenas livre/ocupado" |
| Esqueci a senha do dono | No computador do servidor, abra um terminal na pasta e rode `node --disable-warning=ExperimentalWarning scripts/redefinir-senha-dono.js`. Ele mostra uma senha temporária |
| Restaurar backup | Pare o servidor, copie `dados/backups/stylos-AAAA-MM-DD.sqlite` por cima de `dados/stylos.sqlite` e ligue de novo |
