/**
 * Testes das novidades: "Não sou um robô", escudo anti-DDoS, login com
 * Google (falso), recuperação de senha por e-mail (SMTP falso) e
 * detecção automática do endereço do Tailscale (programa falso).
 * Rode com: npm run testar
 */
'use strict';
const { describe, test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const net = require('node:net');
const http = require('node:http');
const crypto = require('node:crypto');
const {
  iniciarServidor, pararServidor, iniciarGoogleFalso, iniciarSmtpFalso, textoDoEmail, Cliente, assinarIdToken,
} = require('./apoio');

const CLIENT_ID = '123456-teste.apps.googleusercontent.com';
const CLIENT_SECRET = 'GOCSPX-segredo-de-teste';

/** Porta livre (para o Tailscale falso saber para onde o "Funnel" aponta). */
function portaLivre() {
  return new Promise((resolver) => {
    const s = net.createServer();
    s.listen(0, '127.0.0.1', () => { const { port } = s.address(); s.close(() => resolver(port)); });
  });
}

/** Cria um "tailscale" falso (script) que responde como o de verdade. */
function criarTailscaleFalso(porta, { funnelLigado = true } = {}) {
  const pasta = fs.mkdtempSync(path.join(os.tmpdir(), 'ts-falso-'));
  const arquivo = path.join(pasta, 'tailscale');
  const status = JSON.stringify({ BackendState: 'Running', Self: { DNSName: 'notebook.tail1234.ts.net.' } });
  const funil = JSON.stringify(funnelLigado
    ? { Web: { 'notebook.tail1234.ts.net:443': { Handlers: { '/': { Proxy: `http://127.0.0.1:${porta}` } } } }, AllowFunnel: { 'notebook.tail1234.ts.net:443': true } }
    : {});
  fs.writeFileSync(arquivo, `#!/bin/sh\nif [ "$1" = "status" ]; then echo '${status}'; else echo '${funil}'; fi\n`, { mode: 0o755 });
  return arquivo;
}

let servidor;
let google;
let smtp;
let cliDono;

before(async () => {
  google = await iniciarGoogleFalso();
  smtp = await iniciarSmtpFalso();
  const porta = await portaLivre();
  servidor = await iniciarServidor({
    PORTA: String(porta),
    TAILSCALE_CAMINHO: criarTailscaleFalso(porta),
    GOOGLE_URL_TOKEN: `http://127.0.0.1:${google.porta}/token`,
    GOOGLE_URL_CERTIFICADOS: `http://127.0.0.1:${google.porta}/certs`,
    GOOGLE_URL_AUTORIZACAO: `http://127.0.0.1:${google.porta}/autorizar`,
  });
  cliDono = new Cliente(servidor.base);
  const r = await cliDono.post('/api/configuracao-inicial', { codigo: servidor.codigoInicial, nome: 'Dono Teste', email: 'dono@stylos.test', senha: 'DonoForte2026' });
  assert.equal(r.status, 200);
});

after(() => {
  if (servidor) pararServidor(servidor);
  if (google) google.servidor.close();
  if (smtp) smtp.servidor.close();
});

// ------------------------------------------------------------------
describe('endereço público detectado pelo Tailscale', () => {
  test('links deixam de ser localhost: usam o endereço ts.net', async () => {
    const sessao = await new Cliente(servidor.base).get('/api/sessao');
    assert.equal(sessao.dados.urlPublica, 'https://notebook.tail1234.ts.net');
    assert.match(servidor.saida(), /Na internet:\s+https:\/\/notebook\.tail1234\.ts\.net/);
  });

  test('o dono vê a situação do túnel e pode verificar de novo', async () => {
    const sistema = await cliDono.get('/api/dono/sistema');
    assert.equal(sistema.dados.tailscale.funnelAtivo, true);
    assert.equal(sistema.dados.tailscale.apontaParaPorta, true);
    const verificar = await cliDono.post('/api/dono/tailscale/verificar', {});
    assert.equal(verificar.dados.urlPublica, 'https://notebook.tail1234.ts.net');
  });

  test('o endereço manual do dono tem prioridade; em branco volta ao automático', async () => {
    await cliDono.put('/api/dono/sistema', { urlPublica: 'https://meusalao.com.br' });
    assert.equal((await cliDono.get('/api/sessao')).dados.urlPublica, 'https://meusalao.com.br');
    const r = await cliDono.put('/api/dono/sistema', { urlPublica: '' });
    assert.equal(r.dados.urlPublica, 'https://notebook.tail1234.ts.net');
  });

  test('com o Funnel desligado, não inventa endereço', async () => {
    const { verificarTailscale, urlDetectada } = require('../servidor/servicos/tailscale');
    const { configuracao } = require('../servidor/configuracao');
    configuracao.tailscaleCaminho = criarTailscaleFalso(1234, { funnelLigado: false });
    const situacao = await verificarTailscale();
    assert.equal(situacao.funnelAtivo, false);
    assert.equal(urlDetectada(), '');
    assert.match(situacao.dica, /tailscale funnel --bg/);
    configuracao.tailscaleCaminho = path.join(os.tmpdir(), 'nao-existe');
    assert.equal((await verificarTailscale()).instalado, false);
  });
});

// ------------------------------------------------------------------
describe('"Não sou um robô" (prova de trabalho)', () => {
  test('o resolvedor do navegador (worker) dá a mesma resposta que o servidor aceita', () => {
    const { resolver } = require('../publico/js/anti-robo-worker');
    const { bitsZeroIniciais } = require('../servidor/servicos/anti-robo');
    for (const dificuldade of [4, 8, 12]) {
      const salt = `${crypto.randomBytes(12).toString('hex')}.${Date.now() + 60000}`;
      const numero = resolver(salt, dificuldade);
      const hash = crypto.createHash('sha256').update(`${salt}${numero}`).digest();
      assert.ok(bitsZeroIniciais(hash) >= dificuldade, `dificuldade ${dificuldade}`);
    }
  });

  test('cadastro sem a verificação é recusado', async () => {
    const r = await new Cliente(servidor.base).post('/api/cadastro', { nome: 'Robô', email: 'robo1@x.com', senha: 'Robo123456', aceite: true }, { semAntiRobo: true });
    assert.equal(r.status, 400);
    assert.equal(r.dados.codigo, 'anti-robo');
  });

  test('com a verificação passa; reutilizar a mesma resposta não passa', async () => {
    const cliente = new Cliente(servidor.base);
    const prova = await cliente.antiRobo();
    const r1 = await cliente.post('/api/cadastro', { nome: 'Pessoa Real', email: 'pessoa@x.com', senha: 'Pessoa12345', aceite: true, antiRobo: prova });
    assert.equal(r1.status, 200);
    const outro = new Cliente(servidor.base);
    const r2 = await outro.post('/api/cadastro', { nome: 'Copia', email: 'copia@x.com', senha: 'Copia12345', aceite: true, antiRobo: prova });
    assert.equal(r2.status, 400);
    assert.match(r2.dados.erro, /já foi usada/);
  });

  test('resposta forjada (assinatura ou dificuldade alterada) é recusada', async () => {
    const cliente = new Cliente(servidor.base);
    const prova = await cliente.antiRobo();
    const forjada = { ...prova, assinatura: 'a'.repeat(64) };
    assert.equal((await cliente.post('/api/cadastro', { nome: 'X Y', email: 'f1@x.com', senha: 'Forja12345', aceite: true, antiRobo: forjada })).status, 400);
    const facil = { ...prova, dificuldade: 1 };
    assert.equal((await cliente.post('/api/cadastro', { nome: 'X Y', email: 'f2@x.com', senha: 'Forja12345', aceite: true, antiRobo: facil })).status, 400);
    const errada = { ...prova, numero: prova.numero + 1 };
    const r = await cliente.post('/api/cadastro', { nome: 'X Y', email: 'f3@x.com', senha: 'Forja12345', aceite: true, antiRobo: errada });
    assert.equal(r.status, 400);
  });

  test('login pede a verificação só depois de 2 senhas erradas', async () => {
    const cliente = new Cliente(servidor.base, '203.0.113.50');
    const e1 = await cliente.post('/api/entrar', { email: 'pessoa@x.com', senha: 'errada1' });
    assert.equal(e1.status, 401);
    assert.equal(e1.dados.codigo, undefined);
    const e2 = await cliente.post('/api/entrar', { email: 'pessoa@x.com', senha: 'errada2' });
    assert.equal(e2.dados.codigo, 'anti-robo', 'avisa o navegador para mostrar a caixa');
    const semProva = await cliente.post('/api/entrar', { email: 'pessoa@x.com', senha: 'Pessoa12345' });
    assert.equal(semProva.status, 400);
    const comProva = await cliente.post('/api/entrar', { email: 'pessoa@x.com', senha: 'Pessoa12345', antiRobo: await cliente.antiRobo() });
    assert.equal(comProva.status, 200);
  });
});

// ------------------------------------------------------------------
describe('login com Google', () => {
  /** Simula: clicar em "Entrar com Google", o Google aprovar e voltar ao StylOS. */
  async function entrarComGoogle(cliente, declaracoes, { voltar, modo, alterarState, chaveErrada } = {}) {
    const consulta = new URLSearchParams();
    if (voltar) consulta.set('voltar', voltar);
    if (modo) consulta.set('modo', modo);
    const ida = await fetch(`${servidor.base}/auth/google?${consulta}`, { redirect: 'manual', headers: { 'x-forwarded-for': cliente.ip, cookie: cliente.cookie } });
    assert.equal(ida.status, 302);
    const destino = new URL(ida.headers.get('location'));
    const cookieOauth = ida.headers.getSetCookie().find((c) => c.startsWith('stylos_oauth=')).split(';')[0];
    const nonce = destino.searchParams.get('nonce');
    const codigo = crypto.randomBytes(8).toString('hex');
    const chave = chaveErrada ? crypto.generateKeyPairSync('rsa', { modulusLength: 2048 }).privateKey : google.estado.chavesOauth.privateKey;
    google.estado.codigos.set(codigo, {
      desafioPkce: destino.searchParams.get('code_challenge'),
      segredoEsperado: CLIENT_SECRET,
      idToken: assinarIdToken(chave, google.estado.kid, {
        iss: 'https://accounts.google.com', aud: CLIENT_ID, exp: Math.floor(Date.now() / 1000) + 3600, iat: Math.floor(Date.now() / 1000),
        nonce, email_verified: true, ...declaracoes,
      }),
    });
    const state = alterarState ? 'state-forjado-xxxxxxxxxxxxxxxxxxxxxxxxxxx' : destino.searchParams.get('state');
    const volta = await fetch(`${servidor.base}/auth/google/retorno?code=${codigo}&state=${state}`, {
      redirect: 'manual', headers: { 'x-forwarded-for': cliente.ip, cookie: [cookieOauth, cliente.cookie].filter(Boolean).join('; ') },
    });
    const sessao = volta.headers.getSetCookie().find((c) => c.startsWith('stylos_sessao=') && !c.startsWith('stylos_sessao=;'));
    if (sessao) cliente.cookie = sessao.split(';')[0];
    return { status: volta.status, local: volta.headers.get('location'), destinoGoogle: destino };
  }

  test('sem configurar, o botão leva a uma mensagem clara', async () => {
    const r = await fetch(`${servidor.base}/auth/google`, { redirect: 'manual' });
    assert.equal(r.headers.get('location'), '/entrar?erro=google-desligado');
    assert.equal((await new Cliente(servidor.base).get('/api/sessao')).dados.loginGoogle, false);
  });

  test('dono configura (ID inválido é recusado) e o endereço de retorno é o público', async () => {
    assert.equal((await cliDono.put('/api/dono/google-login', { clientId: 'qualquer-coisa', clientSecret: CLIENT_SECRET })).status, 400);
    const r = await cliDono.put('/api/dono/google-login', { clientId: CLIENT_ID, clientSecret: CLIENT_SECRET });
    assert.equal(r.status, 200);
    const config = await cliDono.get('/api/dono/google-login');
    assert.equal(config.dados.urlRetorno, 'https://notebook.tail1234.ts.net/auth/google/retorno');
    assert.equal((await new Cliente(servidor.base).get('/api/sessao')).dados.loginGoogle, true);
  });

  test('ida ao Google leva state, nonce e PKCE; a chave secreta nunca vai ao navegador', async () => {
    const cliente = new Cliente(servidor.base);
    const ida = await fetch(`${servidor.base}/auth/google`, { redirect: 'manual', headers: { 'x-forwarded-for': cliente.ip } });
    const destino = new URL(ida.headers.get('location'));
    assert.equal(destino.searchParams.get('client_id'), CLIENT_ID);
    assert.equal(destino.searchParams.get('code_challenge_method'), 'S256');
    assert.equal(destino.searchParams.get('scope'), 'openid email profile');
    assert.ok(destino.searchParams.get('state').length >= 30);
    assert.ok(!ida.headers.get('location').includes(CLIENT_SECRET));
    assert.match(ida.headers.getSetCookie().join(';'), /stylos_oauth=.*HttpOnly/);
  });

  test('cliente nova entra com Google: conta criada sozinha', async () => {
    const cliente = new Cliente(servidor.base);
    const r = await entrarComGoogle(cliente, { sub: 'google-111', email: 'nova@gmail.com', name: 'Nova Cliente' });
    assert.equal(r.status, 302);
    assert.equal(r.local, '/minha-conta');
    const sessao = await cliente.get('/api/sessao');
    assert.equal(sessao.dados.usuario.papel, 'usuario');
    assert.equal(sessao.dados.usuario.nome, 'Nova Cliente');
    assert.equal(sessao.dados.usuario.googleVinculado, true);
    assert.equal(sessao.dados.usuario.temSenha, false);
    // Conta sem senha: não entra por senha nenhuma
    assert.equal((await new Cliente(servidor.base).post('/api/entrar', { email: 'nova@gmail.com', senha: '!sem-senha' })).status, 401);
    // Pode criar uma senha sem informar a "atual"
    assert.equal((await cliente.post('/api/trocar-senha', { senhaAtual: '', novaSenha: 'NovaSenha2026' })).status, 200);
  });

  test('state alterado, token assinado por outra chave ou e-mail não verificado: recusados', async () => {
    assert.equal((await entrarComGoogle(new Cliente(servidor.base), { sub: 'g-2', email: 'a@gmail.com' }, { alterarState: true })).local, '/entrar?erro=google');
    assert.equal((await entrarComGoogle(new Cliente(servidor.base), { sub: 'g-3', email: 'b@gmail.com' }, { chaveErrada: true })).local, '/entrar?erro=google');
    assert.equal((await entrarComGoogle(new Cliente(servidor.base), { sub: 'g-4', email: 'c@gmail.com', email_verified: false })).local, '/entrar?erro=google-email');
  });

  test('pré-tomada de conta: senha criada por terceiro é anulada quando a dona do e-mail entra pelo Google', async () => {
    const intruso = new Cliente(servidor.base);
    assert.equal((await intruso.post('/api/cadastro', { nome: 'Intruso', email: 'vitima@gmail.com', senha: 'Intruso123', aceite: true })).status, 200);
    const vitima = new Cliente(servidor.base);
    const r = await entrarComGoogle(vitima, { sub: 'google-vitima', email: 'vitima@gmail.com', name: 'Vítima' });
    assert.equal(r.local, '/minha-conta');
    assert.equal((await intruso.get('/api/cliente/agendamentos')).status, 401, 'sessão do intruso derrubada');
    assert.equal((await new Cliente(servidor.base).post('/api/entrar', { email: 'vitima@gmail.com', senha: 'Intruso123' })).status, 401, 'senha do intruso não vale mais');
  });

  test('e-mail de ADM NÃO é vinculado automaticamente (só pela própria conta, logado)', async () => {
    const criado = await cliDono.post('/api/dono/adms', { nome: 'Ana ADM', email: 'ana.adm@gmail.com' });
    const adm = new Cliente(servidor.base);
    const r = await entrarComGoogle(adm, { sub: 'google-ana', email: 'ana.adm@gmail.com' });
    assert.equal(r.local, '/entrar?erro=google-vincular');
    // Logada com a senha, ela vincula pelo painel
    await adm.post('/api/entrar', { email: 'ana.adm@gmail.com', senha: criado.dados.senhaTemporaria });
    await adm.post('/api/trocar-senha', { senhaAtual: criado.dados.senhaTemporaria, novaSenha: 'AnaAdm20266' });
    const vinculo = await entrarComGoogle(adm, { sub: 'google-ana', email: 'ana.adm@gmail.com' }, { modo: 'vincular', voltar: '/painel#conta' });
    assert.equal(vinculo.local, '/painel?google=vinculado#conta');
    const depois = new Cliente(servidor.base);
    const entrada = await entrarComGoogle(depois, { sub: 'google-ana', email: 'ana.adm@gmail.com' });
    assert.equal(entrada.local, '/painel');
    assert.equal((await depois.get('/api/sessao')).dados.usuario.papel, 'adm');
  });

  test('"voltar" para outro site é ignorado (sem redirecionamento aberto)', async () => {
    const r = await entrarComGoogle(new Cliente(servidor.base), { sub: 'google-222', email: 'outra@gmail.com' }, { voltar: '//site-malicioso.com' });
    assert.equal(r.local, '/minha-conta');
  });
});

// ------------------------------------------------------------------
describe('recuperação de senha por e-mail', () => {
  test('sem e-mail configurado avisa claramente', async () => {
    const r = await new Cliente(servidor.base).post('/api/recuperar-senha', { email: 'pessoa@x.com' });
    assert.equal(r.status, 503);
  });

  test('dono configura o SMTP e envia teste (senha não volta para o navegador)', async () => {
    const r = await cliDono.put('/api/dono/email', { servidor: '127.0.0.1', porta: smtp.porta, usuario: 'robo@stylos.test', senha: 'senhadeappteste', nomeRemetente: 'Salão Ção' });
    assert.equal(r.status, 200);
    const config = await cliDono.get('/api/dono/email');
    assert.equal(config.dados.senha, undefined);
    const teste = await cliDono.post('/api/dono/email/teste', {});
    assert.equal(teste.dados.ok, true, teste.dados.mensagem);
    assert.match(smtp.mensagens.at(-1), /Subject: =\?UTF-8\?B\?/);
  });

  test('senha de app errada vira mensagem amigável', async () => {
    await cliDono.put('/api/dono/email', { servidor: '127.0.0.1', porta: smtp.porta, usuario: 'robo@stylos.test', senha: 'errada', nomeRemetente: 'X' });
    const teste = await cliDono.post('/api/dono/email/teste', {});
    assert.equal(teste.dados.ok, false);
    assert.match(teste.dados.mensagem, /SENHA DE APP/);
    await cliDono.put('/api/dono/email', { servidor: '127.0.0.1', porta: smtp.porta, usuario: 'robo@stylos.test', senha: 'senhadeappteste', nomeRemetente: 'StylOS' });
  });

  test('mesma resposta para e-mail que existe e que não existe', async () => {
    const antes = smtp.mensagens.length;
    const r1 = await new Cliente(servidor.base).post('/api/recuperar-senha', { email: 'ninguem@x.com' });
    const r2 = await new Cliente(servidor.base).post('/api/recuperar-senha', { email: 'pessoa@x.com' });
    assert.equal(r1.status, 200);
    assert.equal(r1.dados.mensagem, r2.dados.mensagem);
    await new Promise((resolver) => setTimeout(resolver, 400));
    assert.equal(smtp.mensagens.length, antes + 1, 'só a conta existente recebe e-mail');
  });

  test('link do e-mail usa o endereço público, vale uma vez e derruba as sessões', async () => {
    const logada = new Cliente(servidor.base);
    await logada.post('/api/entrar', { email: 'pessoa@x.com', senha: 'Pessoa12345', antiRobo: await logada.antiRobo() });
    assert.equal((await logada.get('/api/cliente/agendamentos')).status, 200);

    const texto = textoDoEmail(smtp.mensagens.at(-1));
    const link = texto.match(/https:\/\/notebook\.tail1234\.ts\.net\/redefinir-senha#t=([A-Za-z0-9_-]{43})/);
    assert.ok(link, texto);
    const token = link[1];
    const anonimo = new Cliente(servidor.base);
    assert.equal((await anonimo.post('/api/redefinir-senha', { token, novaSenha: '123' })).status, 400, 'senha fraca recusada');
    assert.equal((await anonimo.post('/api/redefinir-senha', { token, novaSenha: 'Recuperada2026' })).status, 200);
    assert.equal((await anonimo.post('/api/redefinir-senha', { token, novaSenha: 'OutraSenha2026' })).status, 400, 'link vale uma vez');
    assert.equal((await logada.get('/api/cliente/agendamentos')).status, 401, 'sessões antigas encerradas');
    const nova = new Cliente(servidor.base);
    assert.equal((await nova.post('/api/entrar', { email: 'pessoa@x.com', senha: 'Recuperada2026' })).status, 200);
  });

  test('cabeçalho Host forjado não muda o link do e-mail (anti-envenenamento)', async () => {
    const corpo = JSON.stringify({ email: 'pessoa@x.com', antiRobo: await new Cliente(servidor.base, '198.51.100.200').antiRobo() });
    const antes = smtp.mensagens.length;
    await new Promise((resolver, rejeitar) => {
      const url = new URL(servidor.base);
      const pedido = http.request({
        hostname: url.hostname, port: url.port, path: '/api/recuperar-senha', method: 'POST',
        headers: { host: 'site-do-atacante.com', 'content-type': 'application/json', 'x-stylos': '1', 'x-forwarded-for': '198.51.100.200', 'content-length': Buffer.byteLength(corpo) },
      }, (resposta) => { resposta.resume(); resposta.on('end', resolver); });
      pedido.on('error', rejeitar);
      pedido.end(corpo);
    });
    await new Promise((resolver) => setTimeout(resolver, 400));
    assert.equal(smtp.mensagens.length, antes + 1);
    const texto = textoDoEmail(smtp.mensagens.at(-1));
    assert.ok(!texto.includes('site-do-atacante'));
    assert.match(texto, /https:\/\/notebook\.tail1234\.ts\.net\/redefinir-senha#t=/);
  });

  test('token inventado é recusado', async () => {
    const r = await new Cliente(servidor.base).post('/api/redefinir-senha', { token: 'A'.repeat(43), novaSenha: 'Qualquer2026' });
    assert.equal(r.status, 400);
  });
});

// ------------------------------------------------------------------
describe('escudo contra DDoS (servidor com limites baixos)', () => {
  let servidorApertado;
  before(async () => {
    servidorApertado = await iniciarServidor({ ESCUDO_PEDIDOS_POR_SEGUNDO: '5', ESCUDO_RAJADA: '10', ESCUDO_SIMULTANEOS_POR_IP: '50' });
  });
  after(() => pararServidor(servidorApertado));

  const pedirRapido = (base, ip, quantidade) => Promise.all(Array.from({ length: quantidade }, () => fetch(`${base}/api/sessao`, { headers: { 'x-forwarded-for': ip } })));

  test('rajada de um IP é cortada com 429 + Retry-After; outro IP continua normal', async () => {
    const respostas = await pedirRapido(servidorApertado.base, '203.0.113.7', 30);
    const recusadas = respostas.filter((r) => r.status === 429);
    assert.ok(recusadas.length >= 15, `recusadas: ${recusadas.length}`);
    assert.ok(Number(recusadas[0].headers.get('retry-after')) >= 1);
    const outro = await fetch(`${servidorApertado.base}/api/sessao`, { headers: { 'x-forwarded-for': '198.51.100.77' } });
    assert.equal(outro.status, 200);
  });

  test('quem insiste fica bloqueado mesmo depois de esperar; o dono pode desbloquear', async () => {
    await pedirRapido(servidorApertado.base, '203.0.113.8', 60);
    await new Promise((resolver) => setTimeout(resolver, 1200)); // o balde já teria fichas de novo...
    const depois = await fetch(`${servidorApertado.base}/api/sessao`, { headers: { 'x-forwarded-for': '203.0.113.8' } });
    assert.equal(depois.status, 429, '...mas o IP está BLOQUEADO');
    assert.ok(Number(depois.headers.get('retry-after')) > 60);

    const dono = new Cliente(servidorApertado.base, '198.51.100.90');
    await dono.post('/api/configuracao-inicial', { codigo: servidorApertado.codigoInicial, nome: 'Dono', email: 'd@x.com', senha: 'DonoForte2026' });
    const situacao = await dono.get('/api/dono/escudo');
    assert.ok(situacao.dados.ipsBloqueados >= 1);
    await dono.post('/api/dono/escudo/desbloquear', {});
    const liberado = await fetch(`${servidorApertado.base}/api/sessao`, { headers: { 'x-forwarded-for': '203.0.113.8' } });
    assert.equal(liberado.status, 200);
  });

  test('IPv6: trocar de endereço dentro do mesmo bloco /64 não escapa do limite', async () => {
    const { chaveDoIp } = require('../servidor/servicos/escudo');
    assert.equal(chaveDoIp('2804:14c:1:2:aaaa::1'), chaveDoIp('2804:14c:1:2:bbbb:cccc:dddd:eeee'));
    assert.notEqual(chaveDoIp('2804:14c:1:2::1'), chaveDoIp('2804:14c:1:3::1'));
    assert.equal(chaveDoIp('::ffff:10.0.0.1'), '10.0.0.1');
  });

  test('cabeçalho X-Forwarded-For com vários IPs: vale o último (o que o túnel colocou)', () => {
    const seguranca = require('../servidor/seguranca');
    const ip = seguranca.ipDoCliente({ headers: { 'x-forwarded-for': '1.1.1.1, 203.0.113.99' }, socket: { remoteAddress: '127.0.0.1' } });
    assert.equal(ip, '203.0.113.99');
  });

  test('dono liga o modo de defesa na mão e o "Não sou um robô" fica mais difícil', async () => {
    const dono = new Cliente(servidorApertado.base, '198.51.100.90');
    await dono.post('/api/entrar', { email: 'd@x.com', senha: 'DonoForte2026' });
    const antes = await (await fetch(`${servidorApertado.base}/api/anti-robo/desafio`, { headers: { 'x-forwarded-for': '198.51.100.91' } })).json();
    const r = await dono.put('/api/dono/escudo', { modo: 'ligado' });
    assert.equal(r.dados.modoDefesa, true);
    const durante = await (await fetch(`${servidorApertado.base}/api/anti-robo/desafio`, { headers: { 'x-forwarded-for': '198.51.100.92' } })).json();
    assert.equal(durante.dificuldade, antes.dificuldade + 3);
    await dono.put('/api/dono/escudo', { modo: null });
  });
});
