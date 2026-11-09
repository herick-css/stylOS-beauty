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
- **56 testes automáticos** (`npm run testar`): 7 do cálculo de horários
  (fuso, horário de verão, almoço, antecedência) e 49 de API/segurança
  (papéis, CSRF, limite de login, isolamento entre ADMs, boas práticas,
  pedidos simultâneos, fotos disfarçadas, path traversal, integração com um
  Google simulado, desativação de ADM, registro de atividades).
- **Teste no navegador** (Chrome automatizado) do fluxo inteiro, em computador
  e celular: configuração inicial, tutorial, cadastro de ADM, troca de senha
  obrigatória, editor (prévia ao vivo, destaque com asteriscos, tentativa de
  XSS bloqueada, regras de publicação), página pública nos 5 temas,
  agendamento até o link do WhatsApp e confirmação no painel.
  Zero erros de JavaScript e zero bloqueios da política de segurança.

**Não deu para testar daqui** (sem internet no ambiente): o Google de
verdade (só o simulado), o túnel real, o site do Canva, um Windows real
rodando os `.bat`, e as fontes do Google Fonts (nos testes apareceram as
fontes reservas). Faça um teste completo num PC do Senac antes de apresentar.

---

## 7. Perguntas para você decidir
1. **Onde fica o servidor?** Num PC do laboratório do Senac (precisa de
   autorização da TI e de ficar ligado) ou no computador de alguém da turma?
2. **Tailscale (grátis, não comercial) ou Cloudflare (grátis, exige domínio
   próprio)?** Se o salão-escola for atender o público, prefira Cloudflare.
3. **Agendamento exige conta de cliente?** Hoje é opcional por ADM (padrão:
   não exige, para não afastar clientes).
4. **Quantos ADMs** imagina? (Limite atual: 20 páginas e 300 fotos por ADM;
   dá para mudar.)
5. A **TI do Senac** permite instalar o Tailscale/cloudflared nas máquinas?
6. Quer que eu adicione **recuperação de senha por e-mail**? (Exige uma conta
   de envio de e-mail; hoje o dono gera uma senha temporária.)
7. Quer **fotos/vídeos enviados direto** no vídeo (arquivo), além de link do
   YouTube/Vimeo? Ocupa bastante espaço no PC-servidor.
