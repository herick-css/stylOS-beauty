# Migrar o StylOS para um domínio próprio (Cloudflare)

> **Quando fazer:** só se o projeto for para frente. Hoje o StylOS funciona
> pelo Tailscale (`https://<notebook>.<rede>.ts.net`) e não precisa de nada disto.

## Por que migrar
| | Tailscale Funnel (hoje) | Cloudflare Tunnel + domínio |
|---|---|---|
| Endereço | `https://notebook.tail1234.ts.net` | `https://agenda.seusalao.com.br` |
| Muda se trocar de computador/rede? | **Sim**: os links divulgados quebram | **Não**: o domínio é seu |
| Proteção contra DDoS grande | Limitada | A Cloudflare filtra ataques grandes antes de chegarem ao notebook (plano gratuito) |
| Uso comercial no plano grátis | Não (plano Personal) | Sim |
| Custo | R$ 0 | Domínio, cerca de R$ 40/ano (confira no registro.br). Cloudflare: R$ 0 |

**O código do StylOS não muda.** Ele já reconhece o IP real enviado pela
Cloudflare e já redireciona sozinho os links antigos do Tailscale para o
domínio novo.

---

## Passo a passo (cerca de 1 hora, a maior parte esperando o DNS)

### 1. Comprar o domínio
1. Em **registro.br**, procure um nome livre (ex.: `studiosenacmanacapuru.com.br`) e registre com o CPF/CNPJ responsável.
2. Guarde bem a senha do registro.br: quem controla o domínio controla o site.

### 2. Colocar o domínio na Cloudflare (grátis)
1. Crie uma conta em **dash.cloudflare.com** (use o `stylosbeauty26@gmail.com`).
2. Clique em **Adicionar um domínio**, digite o domínio e escolha o plano **Free**.
3. A Cloudflare mostra **dois servidores DNS** (ex.: `ana.ns.cloudflare.com`).
4. No **registro.br** → seu domínio → **DNS** → "Alterar servidores DNS" → cole os dois.
5. Espere o e-mail "domínio ativo" da Cloudflare (minutos ou até algumas horas).

### 3. Criar o túnel
1. Na Cloudflare: **Zero Trust** → **Networks** → **Tunnels** → **Create a tunnel** → tipo **Cloudflared**.
2. Nome: `stylos-notebook`. Na tela seguinte, escolha **Windows** e **copie o token**
   (o texto longo que começa com `eyJ`). **Não mostre esse token a ninguém.**
3. No notebook, clique com o botão direito em **`CONFIGURAR-CLOUDFLARE.bat`** →
   **Executar como administrador** → cole o token. O túnel vira um serviço do Windows.
4. De volta à Cloudflare, em **Public Hostname**:
   - Subdomain: `agenda` · Domain: o seu domínio
   - Service: **HTTP** · URL: `localhost:3000`
   - Salve. O endereço `https://agenda.seudominio.com.br` passa a abrir o StylOS.

### 4. Avisar o StylOS
1. Entre no painel como **dono** → **Sistema e segurança** → **Endereço público manual**.
2. Digite `https://agenda.seudominio.com.br` → **Salvar endereço**.
3. A partir daí, **todos os links novos** (páginas, e-mails, login Google) usam o domínio, e
   **os links antigos `.ts.net` redirecionam sozinhos** enquanto o Tailscale Funnel estiver ligado.

### 5. Atualizar o login com Google
1. Google Cloud → **Credenciais** → seu "ID do cliente OAuth".
2. Em **URIs de redirecionamento autorizados**, ADICIONE `https://agenda.seudominio.com.br/auth/google/retorno`
   (o painel do StylOS mostra o endereço exato em *Integração Google*).
3. Pode manter o endereço antigo por algumas semanas e depois apagar.

A integração da **Google Agenda** (conta de serviço) **não muda**.

### 6. Proteções extras da Cloudflare (recomendadas, grátis)
No painel da Cloudflare, no seu domínio:
- **Security → Bots → Bot Fight Mode**: ligar.
- **Security → Settings → Security Level**: "Medium". Durante um ataque, use o
  modo **"I'm Under Attack"** (mostra uma verificação antes de abrir o site).
- **Security → WAF → Rate limiting rules** (o plano grátis permite 1 regra): limite,
  por exemplo, 20 pedidos em 10 segundos para o caminho `/api/`.

### 7. Depois de algumas semanas
- Atualize a bio do Instagram, o site do Canva e as mensagens fixas do WhatsApp com o link novo.
- Quando ninguém mais usar os links antigos, você pode desligar o Funnel: `tailscale funnel reset`.

---

## Se algo der errado
| Sintoma | O que fazer |
|---|---|
| Página da Cloudflare com "Error 1033" | O túnel não está ligado. Abra *Serviços* do Windows e inicie o "Cloudflared agent" |
| "Error 502 Bad Gateway" | O StylOS não está rodando (a janela do INICIAR-STYLOS.bat está aberta?) ou a URL no Public Hostname não é `localhost:3000` |
| Login com Google dá "redirect_uri_mismatch" | Faltou o passo 5 |
| Quer voltar para o Tailscale | Apague o "Endereço público manual" no painel e salve: o StylOS volta a usar o endereço `.ts.net` detectado |
