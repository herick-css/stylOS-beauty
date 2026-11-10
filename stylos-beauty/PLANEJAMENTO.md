# StylOS Beauty — Planejamento, decisões e pontos de atenção

Documento para o professor/responsável. Explica **por que** o sistema foi
montado assim, o que do pedido original **não era possível ou não fazia
sentido**, as **alternativas** e o que ainda **precisa ser decidido**.

---

## 1. Como o sistema ficou (visão geral)

```
 Cliente (celular)                          Computador do salão / Senac (servidor)
 ─────────────────                          ──────────────────────────────────────
 Site do Canva (vitrine) ──link──┐          ┌──────────────────────────────────┐
                                 ▼          │  Node.js (sem dependências)      │
 https://salao.xxx.ts.net/p/studio-ana ◄────┤  ├─ telas (HTML/CSS/JS)          │
         ▲                       túnel      │  ├─ API /api/... (segura)        │
         │                    (Tailscale    │  └─ SQLite: dados/stylos.sqlite  │
         │                    ou Cloudflare)│     + fotos + backups diários    │
         │                                  └──────────────┬───────────────────┘
         │                                                 │ só "livre/ocupado"
         │                                                 ▼
         │                                   Google Agenda de cada ADM
         │
         └── ao pedir horário ──► abre o WhatsApp DO ADM com a mensagem pronta
```

**Papéis**

| Papel | Quem | O que faz |
|---|---|---|
| Dono | Você (só um) | Cadastra/desativa ADMs, configura Google e endereço público, modera páginas, vê o registro de atividades. Também pode montar páginas. |
| ADM | Profissionais/alunas | Monta e publica as próprias páginas, configura WhatsApp, expediente, serviços e Google Agenda, confirma pedidos. **Só o dono cria ADM.** |
| Usuário | Clientes | Cadastram-se sozinhas (opcional), veem e cancelam os próprios horários. |

**Fluxo da página:** rascunho (salvo sozinho) → **Publicar** (passa pelas
boas práticas) → link fixo `/p/<nome-do-salao>-xxxx`. Editar depois não muda
o que o público vê até clicar em **Atualizar**.

**Fluxo do agendamento:** serviço → dia → horário livre → nome/telefone
(+ concordância LGPD) → o pedido é salvo como **pendente** (o horário fica
bloqueado) → botão **Enviar pelo WhatsApp** abre o WhatsApp do ADM daquela
página com tudo escrito → o ADM confirma no painel e avisa a cliente com um
toque. Nenhum pagamento acontece no sistema.

---

## 2. Pontos ilógicos ou inviáveis no pedido (e o que foi feito)

### 2.1 "Hospedar no Canva" com back-end e banco de dados — **não dá**
O Canva hospeda apenas páginas estáticas: não roda servidor, não guarda banco
de dados, não processa login. Além disso, o Canva Code roda o HTML dentro de
uma área isolada, e **não consegui confirmar na documentação** se ele deixa
a página chamar um servidor externo. Antes de contar com isso, teste.

**O que foi feito:** o StylOS é um sistema completo e independente (ele
mesmo serve as telas, a API e o banco). O site do Canva vira a **vitrine**,
com um botão "Agende seu horário" que leva ao link da página publicada.
As páginas públicas também já **permitem ser embutidas** (iframe) em
`*.canva.site` e `*.my.canva.site` (configurável em `PERMITIR_EMBUTIR_EM`),
caso o Canva aceite incorporar o link. O painel do ADM **nunca** pode ser
embutido (proteção contra clickjacking).

### 2.2 "Cada usuário deixa o próprio computador rodando como servidor" — **ilógico**
- Se cada ADM tivesse o próprio servidor, **você não conseguiria cadastrar
  ADMs de um lugar só** (cada servidor teria o próprio banco), e as clientes
  teriam uma conta diferente em cada um.
- A página de um ADM sairia do ar sempre que o computador **daquele** ADM
  desligasse, dormisse ou ficasse sem internet.
- Cliente (usuário) obviamente não pode ser servidor.

**O que foi feito:** **um único servidor** para todos (multi-ADM). Ele pode
ficar no computador do salão-escola, num PC do laboratório do Senac ou no
de uma aluna responsável. Você não precisa usar a sua máquina.

### 2.3 Computador de casa como servidor — **possível, com riscos**
Problemas reais e como foram tratados:

| Problema | Tratamento |
|---|---|
| Muitas operadoras no Brasil usam CGNAT: não há como abrir porta no roteador | **Túnel** (Tailscale Funnel ou Cloudflare Tunnel): o computador "liga para fora", sem abrir porta nenhuma, e o IP de casa fica escondido |
| IP muda | O endereço do túnel é fixo |
| PC desliga, dorme, Windows Update reinicia, falta luz | Instalador cria tarefa para **ligar com o Windows**, desativa a suspensão na tomada e o iniciador **reinicia sozinho** se cair. Recomendo um nobreak. Mesmo assim: PC desligado = página fora do ar |
| HD queimar / PC roubado | **Backup diário automático** em `dados/backups` (últimos 14 dias). Sincronize essa pasta com o Google Drive para Computador |
| Expor o computador na internet | O servidor só escuta em `127.0.0.1` (ninguém da rede chega nele, só o túnel), sem dependências de terceiros, com política de segurança rígida (seção 4) |
| Quem não programa | `INSTALAR-WINDOWS.bat` (instala Node e túnel, cria inicialização) e `INICIAR-STYLOS.bat` (dois cliques) |

**Atenção sobre o túnel gratuito:**
- **Tailscale Funnel**: endereço fixo `https://<pc>.<rede>.ts.net`, HTTPS
  automático, sem domínio. O plano gratuito Personal é para **uso não
  comercial**. Serve para o projeto do curso, mas um salão de verdade
  cobrando clientes precisaria de plano pago.
- **Cloudflare Tunnel** (gratuito, uso comercial ok): precisa de um **domínio
  próprio** (um `.com.br` custa cerca de R$ 40/ano). O modo rápido sem
  domínio (`trycloudflare.com`) **muda de endereço a cada reinício**. Isso
  quebraria todos os links já divulgados, por isso **não** foi usado.

### 2.4 "Mandar mensagem no WhatsApp" automaticamente — **não existe forma oficial gratuita**
| Opção | Situação |
|---|---|
| Link `wa.me` com a mensagem pronta (a cliente toca em Enviar) | ✅ **Implementado** (padrão). Gratuito, oficial, sem risco de bloqueio. O pedido também fica salvo no painel, mesmo que a cliente não envie |
| CallMeBot (aviso automático para o número do próprio ADM) | ✅ **Implementado como opcional**. Gratuito, de terceiros, sem garantia. Os dados da cliente passam pelo servidor deles |
| WhatsApp Business Platform (API oficial da Meta) | ❌ Pago por conversa, exige verificação da empresa e modelos aprovados |
| Bibliotecas não oficiais (whatsapp-web.js, Baileys) | ❌ **Não usei**: violam os termos do WhatsApp e o número pode ser banido |

### 2.5 "Cada ADM cadastra o próprio Google Calendar" — **simplificado**
Para cada ADM "fazer login com o Google" (OAuth), seria preciso um app no
Google Cloud **verificado pelo Google** (as permissões de agenda são
sensíveis). Sem verificação, o app fica em "modo de teste": no máximo 100
usuários e o acesso **expira a cada 7 dias**.

**O que foi feito (mesma técnica do projeto da Fernanda):** o **dono**
cria **uma** conta de serviço no Google Cloud e cola a chave no painel. A
chave fica criptografada no banco. Cada ADM só **compartilha a própria
agenda** com o e-mail dessa conta, com a permissão "**ver apenas
livre/ocupado**". O sistema nunca vê títulos nem nomes dos compromissos.
Há um botão "Testar conexão" e um guia passo a passo na tela.

Limitações:
- O sistema **lê** a agenda, mas não **escreve** nela. Cada pedido tem um
  botão "Agenda" que cria o evento no Google Agenda com um clique.
- No Google, eventos de **dia inteiro** vêm como "Disponível" por padrão.
  O painel avisa disso e oferece "Dias bloqueados".
- Se o Google estiver configurado e falhar, a página **não mostra horários**
  (avisa e sugere o WhatsApp), em vez de oferecer horário errado.

### 2.6 "Cada seção ocupa 100vh e 100vw" — **ajustado**
- `100vw` cria uma barra de rolagem lateral no computador (a medida inclui a
  barra de rolagem). Usei `width: 100%`, que dá o mesmo efeito sem o defeito.
- Altura fixa de `100vh` **corta o conteúdo** no celular (ex.: 6 serviços
  não cabem numa tela). Usei `min-height: 100svh`: cada seção ocupa **no
  mínimo** uma tela inteira e cresce se precisar. `svh` desconta a barra do
  navegador do celular.

### 2.7 Stack "igual à da Fernanda" — **mesma lógica, sem Next.js**
Mantive: agenda por Google (conta de serviço + freeBusy), o cálculo de
horários livres (`lib/slots.ts` virou `servidor/servicos/horarios.js`,
agora com qualquer fuso e horário de verão), o WhatsApp por link e
JavaScript em todo o projeto.

Troquei o **Next.js/React/Tailwind** por **Node.js puro + SQLite embutido no
Node**, porque:
1. Next.js exige `npm install` (centenas de MB) e `build` em **cada
   computador-servidor**. Isso quebra fácil nas mãos de quem não programa.
   Aqui o salão só instala o Node e dá dois cliques.
2. **Zero dependências de terceiros** = nenhum pacote para atualizar e
   nenhuma brecha vinda de biblioteca.
3. Consegui **testar tudo** aqui (no projeto da Fernanda não foi possível
   rodar `npm install`).

Se quiser migrar para Next.js no futuro, a API e as regras já estão separadas
e dá para portar.

### 2.8 Visual "masculino × feminino"
São 5 temas inspirados nas suas imagens, agrupados no seletor:
- **Estilo masculino:** Noir Barbearia (imagem 5) e Fígaro Clássico (imagem 2).
- **Estilo feminino:** Lavanda Suave (imagem 3) e Rosé Noir (imagem 4).
- **Neutro:** Areia Neutro (imagem 1, o modelo modular).

Qualquer ADM pode escolher qualquer tema, e trocar não perde textos nem fotos.

---

## 3. Boas práticas obrigatórias (editor + servidor)
- A página **começa com o Cabeçalho e termina com o Rodapé**. Os dois ficam
  travados no lugar e não podem ser excluídos.
- Tem que haver pelo menos uma seção entre eles.
- Seções únicas (Cabeçalho, Rodapé, Agendamento) não se repetem.
- Campos obrigatórios (títulos, foto do Destaque, link do vídeo, itens das
  listas) precisam estar preenchidos. O botão "Corrigir" leva direto ao campo.
- Link do menu precisa de nome.
- Uma página com Agendamento só publica se o ADM tiver WhatsApp cadastrado.
- Avisos (não bloqueiam): sem foto no cabeçalho, sem seção de agendamento,
  menu vazio.

As mesmas regras rodam no navegador e no servidor (um único arquivo:
`publico/js/esquemas-secoes.js`). Por isso não dá para burlar.

---

## 4. Segurança implementada
- **Senhas** com scrypt (sal aleatório, ~100 ms por tentativa). Senhas fracas
  são recusadas. ADM recebe senha temporária e é **obrigado a trocar** no
  1º acesso.
- **Dono criado por código** que só aparece na tela do servidor. Ninguém da
  internet consegue "virar dono" antes de você.
- **Sessão** por cookie `HttpOnly` + `SameSite=Lax` + `Secure` (em HTTPS).
  O banco guarda só o *hash* do token. Expira após 7 dias sem uso. Trocar a
  senha derruba as outras sessões.
- **CSRF:** todo pedido que altera dados exige o cabeçalho `X-StylOS` e a
  mesma origem.
- **Controle de acesso no servidor** por papel. Cada ADM só enxerga os
  próprios dados (testado).
- **Limite de tentativas**: login, cadastro, pedidos de horário, consultas e
  envios de foto.
- **Anti-robô** no agendamento e no cadastro: campo-armadilha, máximo de 3
  pedidos abertos por telefone e concordância LGPD obrigatória.
- **XSS:** todo texto entra na página como texto (nunca HTML), com
  **Content-Security-Policy** rígida (nenhum script de fora, nenhum script
  embutido).
- **Fotos:** tipo conferido pelos bytes do arquivo (JPG/PNG/WEBP). SVG e HTML
  são proibidos, o nome no disco é aleatório, há limite de tamanho e
  quantidade, e as fotos são servidas em "sandbox".
- **SQL injection:** só consultas com parâmetros.
- **Dois pedidos no mesmo horário:** gravação em transação; só um passa (testado).
- **Segredos** (chave do Google, chave do CallMeBot) criptografados com
  AES-256-GCM.
- **Registro de atividades** (logins, senhas erradas, publicações...) para o dono.
- **LGPD:** nome e telefone de agendamentos com mais de 180 dias são
  apagados sozinhos.

---

## 5. Alternativas de hospedagem

| Opção | Custo | Prós | Contras |
|---|---|---|---|
| **A. PC do salão + túnel** (implementado) | R$ 0 (+ domínio ~R$ 40/ano se usar Cloudflare) | Sem mensalidade, dados ficam com vocês | Fica fora do ar quando o PC desliga; manutenção local |
| **B. Mesmo código num servidor na nuvem** (VPS ou "Always Free" de algum provedor) | R$ 0 a ~R$ 30/mês | Fica no ar 24h, sem depender do PC | Alguém precisa configurar uma vez (HTTPS com Caddy/Nginx) |
| **C. Reescrever com um "back-end pronto"** (Supabase/Firebase) | R$ 0 no começo | Login e banco gerenciados | Reescrita grande; regras de segurança em outro lugar; planos grátis pausam ou limitam |

Recomendação: **A** para o projeto da turma. Se virar serviço de verdade,
**B** com o mesmo código.

---

## 6. O que foi testado
- **103 testes automáticos** (`npm run testar`): 7 do cálculo de horários, 49 de
  API/segurança, 33 das proteções da versão 2 (anti-robô, escudo, login com
  Google, recuperação de senha, detecção do Tailscale) e 14 de vídeos (com o
  FFmpeg de verdade).
- **Teste no navegador** (Chrome automatizado), em computador e celular, do
  fluxo inteiro, incluindo o "Não sou um robô" na dificuldade real.
  Zero erros de JavaScript e zero bloqueios da política de segurança.

**Não deu para testar daqui** (sem internet no ambiente): o Google de verdade
(agenda e login foram testados com um Google simulado, com assinatura RSA
real), o Gmail de verdade (testado com um servidor de e-mail simulado), o
Tailscale de verdade (testado com um programa simulado que responde igual),
o Canva e os `.bat` num Windows real. Faça um teste completo no notebook antes
de apresentar.

---

## 7. Decisões tomadas (resposta às perguntas da versão 1)
| Pergunta | Decisão |
|---|---|
| Onde fica o servidor? | **No notebook pessoal do professor** (por enquanto) |
| Tailscale ou Cloudflare? | **Tailscale Funnel** |
| Recuperação de senha por e-mail? | **Sim**: implementada (Gmail com senha de app) |

### Cuidados por ser um NOTEBOOK pessoal
- O instalador agora oferece **continuar ligado com a tampa fechada** (na tomada).
- O sistema só escuta em `127.0.0.1`. Pelo túnel sai **apenas** a porta do
  StylOS: seus arquivos pessoais não ficam expostos.
- Os dados ficam em `dados/`. Ative a **criptografia do disco** (BitLocker ou
  "Criptografia de dispositivo" no Windows), porque um notebook pode ser
  perdido ou roubado, e sincronize `dados/backups` com o Google Drive.
- Notebook desligado ou fora da internet = páginas fora do ar. Quando o
  sistema crescer, migre para um servidor (seção 5, opção B): é o mesmo código.

---

## 8. Novidades da versão 2

### 8.1 Por que "criar conta" parecia não funcionar
O cadastro em si funcionava, mas a tela **redirecionava sem avisar** em dois casos:
1. **quem já estava logado** (ex.: você, como dono) clicava em "Criar conta" e
   caía direto no painel;
2. **antes da configuração inicial**, ia para a tela que pede o código do servidor.

Agora a tela explica o que está acontecendo ("Você já está conectado como…",
com os botões "Ir para o painel" e "Sair e criar outra conta"; ou "Sistema
ainda não configurado"). Para testar como cliente sem sair da conta de dono,
use uma **janela anônima**.

### 8.2 Link "localhost" → endereço público automático
O link saía como `http://localhost:3000/p/...` porque nenhum endereço público
estava configurado, e **esse link só abre no próprio notebook**. Agora o
servidor pergunta ao Tailscale, a cada 5 minutos, o nome do notebook na rede
(`https://<notebook>.<rede>.ts.net`) e se o Funnel está ligado **e apontando
para a porta do StylOS**. Se estiver tudo certo, todos os links (páginas,
e-mails, login com Google) passam a usar esse endereço sozinhos. O painel
mostra um aviso amarelo enquanto os links ainda forem locais, e o cartão
"Publicação na internet" em *Sistema e segurança* diz exatamente o que falta.

### 8.3 "Não sou um robô"
**Decisão:** em vez do reCAPTCHA do Google, usei uma **prova de trabalho**
própria (a mesma ideia de projetos como ALTCHA e mCaptcha):
- o navegador resolve um pequeno cálculo (cerca de 1 segundo, em segundo
  plano), que **começa sozinho** quando a pessoa toca no formulário. Na
  maioria das vezes, quando ela chega ao fim, já aparece "✓ Verificado";
- cada verificação é **assinada pelo servidor, vale uma vez só e expira em 5 minutos**;
- **sem terceiros, sem cookies de rastreamento e sem "clique nos semáforos"**:
  bom para a LGPD e funciona mesmo se o Google estiver fora do ar.

Onde vale: **cadastro, pedido de horário e "esqueci minha senha"** (sempre) e
**login** (só depois de 2 senhas erradas, ou sempre durante um ataque).

Limitação honesta: um robô com muito processamento ainda consegue passar.
Mas cada tentativa custa caro para ele, e somada aos limites por conexão, ao
campo-armadilha e ao máximo de pedidos por telefone, fazer milhares de
cadastros falsos deixa de valer a pena. Se um dia isso não bastar, dá para
trocar pelo Cloudflare Turnstile (gratuito) sem mexer no resto.

### 8.4 Proteção contra DDoS — o que dá e o que NÃO dá para fazer
**Verdade importante:** um DDoS de verdade (milhares de máquinas, gigabits por
segundo) **derruba qualquer internet doméstica antes de chegar ao programa**.
Nenhum código no notebook resolve isso. Quem barra esse tipo de ataque é uma
rede grande na frente (o Cloudflare faz isso de graça, mas exige domínio
próprio). O Tailscale Funnel também tem limites de banda nos servidores dele.

O que o **escudo** faz dentro do StylOS (antes de qualquer processamento caro):
- limite de pedidos por IP (por segundo, tolerando a rajada de abrir uma página);
- limite de pedidos **simultâneos** por IP e no total ("corte de carga": devolve
  "ocupado" em vez de travar);
- **bloqueio temporário** de quem insiste: 10 minutos, depois 20, 40… (até 24 h);
- **modo de defesa automático** quando o volume total dispara: limites pela
  metade e "Não sou um robô" mais difícil e obrigatório também no login;
- IPv6 agrupado por bloco /64 (o atacante não escapa trocando de endereço);
- memória limitada (o ataque não consegue encher a memória do notebook);
- tempos-limite contra conexões "penduradas" e teto de conexões abertas;
- painel do dono com números ao vivo, botão de modo de defesa e "Desbloquear todos".

O IP real de cada visitante é confiável: o Funnel **sobrescreve** o
cabeçalho `X-Forwarded-For` com o endereço de origem (conferido no código do
Tailscale), então o visitante não consegue forjá-lo.

### 8.5 Login com Google
- Botão **"Entrar com Google"** / **"Criar conta com Google"** no login e no
  cadastro, que só aparece depois que o dono configura (guia passo a passo em
  *Integração Google*).
- Padrão OpenID Connect com **PKCE + state + nonce**. A assinatura do token é
  conferida com as chaves públicas do Google, e a chave secreta fica
  criptografada no banco e nunca vai ao navegador.
- Só pede **nome e e-mail** (escopos básicos): o Google não exige verificação
  do aplicativo.
- **Cliente nova** → conta criada sozinha. **Cliente que já tinha conta com o
  mesmo e-mail** → vinculada. Nesse caso a senha antiga é **anulada** e as
  sessões são derrubadas, para impedir a "pré-tomada de conta": alguém que
  tivesse cadastrado o e-mail da vítima antes perde o acesso.
- **ADM e dono nunca são vinculados automaticamente**: entram com a senha e
  clicam em "Vincular conta Google" em *Minha conta*.
- Quem entrou só pelo Google pode criar uma senha depois.

### 8.6 Recuperação de senha por e-mail
- O dono configura um **Gmail com "senha de app"** (guia na tela), com botão
  "Enviar teste". A senha fica criptografada.
- "Esqueci minha senha" → link de **uso único que vale 30 minutos**. O banco
  guarda só o hash do link.
- A resposta é sempre a mesma, exista ou não a conta (ninguém descobre quais
  e-mails estão cadastrados).
- O link usa **sempre o endereço público**, nunca o endereço que veio no pedido
  (isso impede o ataque de "envenenar" o link para roubar o código).
- O código vai depois do `#` e some da barra de endereço ao abrir.
- Ao trocar a senha, **todas as sessões abertas são encerradas**.

### 8.7 Decisões da versão 2 (respondidas)
| Pergunta | Decisão |
|---|---|
| Gmail para enviar os e-mails | Gmail só do sistema: **stylosbeauty26@gmail.com** (já vem preenchido no painel; falta só a senha de app) |
| Botão "Entrar com Google" | **Para todos** (clientes, ADMs e dono). ADM e dono só entram se já tiverem vinculado |
| Migração para a Cloudflare | **Preparada, não ativada**: sem domínio por enquanto. Guia em `MIGRAR-PARA-CLOUDFLARE.md` e script `CONFIGURAR-CLOUDFLARE.bat` |

---

## 9. Versão 3

### 9.1 Correção de segurança: IP falsificável pelo Tailscale
O escudo confiava no cabeçalho `CF-Connecting-IP` (o IP real que a Cloudflare
informa). Mas, com o tráfego chegando pelo Tailscale, **ninguém apagava esse
cabeçalho**. Um atacante podia mandar um IP falso diferente a cada pedido e
escapar dos limites do escudo.

**Correção:** o Tailscale marca **todo** pedido do Funnel com o cabeçalho
`Tailscale-Funnel-Request` (ele apaga o que vier do visitante e recoloca).
Quando essa marca está presente, o StylOS usa só o IP informado pelo Tailscale
e ignora o `CF-Connecting-IP`. Há um teste que simula o ataque.

### 9.2 Migração futura para domínio próprio (já preparada)
- `MIGRAR-PARA-CLOUDFLARE.md`: passo a passo (registro.br → Cloudflare → túnel
  → painel do StylOS → Google), com as proteções grátis da Cloudflare.
- `CONFIGURAR-CLOUDFLARE.bat`: instala o `cloudflared` e o túnel como serviço
  do Windows (liga sozinho).
- **Links antigos não quebram:** quando o dono cadastrar o domínio novo, quem
  abrir um link antigo `.ts.net` é **redirecionado sozinho** para o domínio
  (enquanto o Funnel continuar ligado). Para voltar atrás, basta apagar o
  endereço manual.

### 9.3 Identidade visual
- `marca/foto-perfil-gmail.png` (1024×1024) e `marca/foto-perfil-gmail.svg`
  (editável): monograma "S" dourado no arco, com o nome StylOS Beauty. Foi
  desenhada para o recorte redondo do Gmail.

---

## 10. Versão 4 — vídeos

### 10.1 Onde dá para usar vídeo
- **Fundo do cabeçalho** (Arrumação → "Foto/vídeo ocupando o fundo").
- **Galeria**: misturado com fotos. Aparece a capa com um "play"; ao tocar,
  abre em tela cheia com som e controles (e para ao fechar).
- **Sobre**, **Destaque** e **Serviços**: no lugar da foto.
- **Seção Vídeo**: agora aceita um **arquivo próprio** (com controles e som)
  OU um link do YouTube/Vimeo, como antes.

Vídeos decorativos (fundo, sobre, destaque, serviços) tocam **sem som, em
repetição, só enquanto estão visíveis na tela** e têm botão de pausa.
Quem ativou "reduzir movimento" no celular/computador vê a capa parada
(acessibilidade). Com "economia de dados" ligada, também não tocam sozinhos.

### 10.2 Como o vídeo é otimizado (sem perder qualidade visível)
Cada vídeo enviado passa pelo **FFmpeg** dentro do próprio sistema e vira:

| Arquivo | Para quem | Como |
|---|---|---|
| `1080.mp4` | computador | H.264, lado maior até 1920 px, CRF 21 |
| `720.mp4` | celular (tela até 900 px) | H.264, lado maior até 1280 px, CRF 23 |
| `poster.jpg` | capa enquanto carrega | 1 quadro do começo do vídeo |

Por que assim:
- **CRF 21** é "qualidade constante": o FFmpeg gasta bits onde a imagem
  precisa, em vez de cortar tudo por igual. Nessa faixa a diferença para o
  original é invisível a olho nu (medimos SSIM 0,996 — 1,0 seria idêntico).
- **4K → 1080p**: nenhuma tela de site mostra mais que isso; é onde está a
  maior economia. Vídeos menores que 1080p **nunca são aumentados**.
- **Celular recebe o 720p** (escolha automática do navegador): carrega bem
  mais rápido no 4G e, numa tela de 6", não se vê diferença.
- **"faststart"**: o índice vai para o começo do arquivo, então o vídeo
  começa a tocar antes de baixar tudo.
- **HDR do iPhone** (cores "estouradas" em outros aparelhos) é convertido
  para cores normais (BT.709). Vídeo girado do celular sai em pé.
- Se a otimização ficasse **maior** que o original (vídeo que já veio leve),
  o sistema só reorganiza o arquivo, sem recomprimir.
- O **original é apagado** depois de otimizado (economiza disco).
- Os vídeos são otimizados **um de cada vez**, em prioridade baixa, para o
  notebook continuar respondendo às páginas e agendamentos.

Resultados medidos aqui:
- Vídeo 4K vertical de celular, 95 MB → **2,8 MB** (1080p) e 0,7 MB (720p),
  em 14 s, SSIM 0,996.
- Vídeo 1080p de 8 s, 5,7 MB → **1,1 MB** no computador e 0,5 MB no
  celular (82% mais leve).

> Honestidade: esses vídeos de teste foram gerados por computador e
> comprimem melhor que filmagem real. Em vídeos reais de celular, espere
> algo entre **60% e 90% menor**, dependendo de quanto movimento há na cena.

Ajustes possíveis no `.env` (veja `.env.exemplo`): `VIDEO_CRF` (menor =
mais qualidade e arquivo maior; 18–23 é a faixa boa), `VIDEO_PRESET`
(`slow` comprime um pouco mais e demora mais), `VIDEO_TAMANHO_MAXIMO_MB`
(500), `VIDEO_DURACAO_MAXIMA_SEG` (600), `VIDEO_MAXIMO_POR_ADM` (40),
`FFMPEG_CAMINHO`/`FFPROBE_CAMINHO` (se o FFmpeg estiver em outra pasta).

### 10.3 Envio de arquivos grandes
- O vídeo vai em **partes de 4 MB**. Se a internet piscar, a parte é
  reenviada sozinha (até 4 tentativas) e continua de onde parou.
- O editor mostra a porcentagem do envio e depois a da otimização. Dá para
  continuar editando; o sistema **não deixa publicar** enquanto algum vídeo
  da página ainda estiver sendo otimizado (e explica o porquê).
- Envios abandonados no meio são apagados sozinhos pela manutenção diária.

### 10.4 Segurança dos vídeos
- O arquivo é conferido pelos **primeiros bytes** (MP4/MOV, WEBM/MKV, AVI),
  não pelo nome. O FFmpeg é chamado com o formato **fixo** e com
  `-protocol_whitelist file`: um arquivo disfarçado (ex.: uma "playlist" que
  tentaria ler arquivos do computador) é recusado. Isso está testado.
- O FFmpeg roda sem shell (sem risco de comando injetado pelo nome do
  arquivo); o nome original só aparece como texto.
- Cada ADM só vê, usa e apaga **os próprios vídeos**; a publicação confere
  isso no servidor. Vídeo em uso numa página não pode ser apagado.
- Limites de tamanho, duração, quantidade por ADM e **espaço livre no
  disco** são conferidos antes de aceitar o envio.
- Os vídeos são servidos com suporte a "Range" (obrigatório no iPhone) e
  cache longo (o endereço muda se o vídeo mudar).

### 10.5 Cuidados
- **Backup**: o backup automático copia o **banco**; os vídeos ficam em
  `dados/uploads/videos`. Inclua a pasta `dados` inteira na sua cópia de
  segurança (pendrive, Google Drive).
- **Disco do notebook**: cada minuto de vídeo otimizado ocupa cerca de 30–60 MB
  (1080p + 720p). Com o limite de 40 vídeos por ADM de até 10 minutos, um
  ADM pode ocupar alguns GB. Ajuste `VIDEO_MAXIMO_POR_ADM` se o disco for
  pequeno.
- **Internet de quem visita**: vídeo de fundo é o item mais pesado da
  página. Prefira vídeos curtos (5–15 s) em repetição no cabeçalho.
- **Direito de imagem**: assim como nas fotos, peça autorização das
  clientes que aparecem nos vídeos.

