/**
 * apoio.js — ferramentas para os testes automáticos.
 *  - sobe um servidor StylOS de verdade numa pasta temporária;
 *  - sobe um "Google falso" (token + freeBusy) para testar a agenda sem internet;
 *  - cliente HTTP que guarda o cookie de sessão (como um navegador).
 */
'use strict';

const { spawn } = require('node:child_process');
const http = require('node:http');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');

const RAIZ = path.resolve(__dirname, '..');

/** Google falso: confere a assinatura do JWT e devolve blocos ocupados configuráveis. */
function iniciarGoogleFalso() {
  const chavesOauth = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 });
  const estado = { chavePublica: null, ocupadosPorAgenda: {}, pedidos: [], codigos: new Map(), chavesOauth, kid: 'chave-teste-1' };
  const servidor = http.createServer((requisicao, resposta) => {
    let corpo = '';
    requisicao.on('data', (pedaco) => { corpo += pedaco; });
    requisicao.on('end', () => {
      estado.pedidos.push({ url: requisicao.url, corpo, autorizacao: requisicao.headers.authorization });
      if (requisicao.url === '/certs') {
        const jwk = estado.chavesOauth.publicKey.export({ format: 'jwk' });
        resposta.writeHead(200, { 'content-type': 'application/json', 'cache-control': 'public, max-age=3600' });
        resposta.end(JSON.stringify({ keys: [{ ...jwk, kid: estado.kid, alg: 'RS256', use: 'sig' }] }));
        return;
      }
      if (requisicao.url === '/token' && new URLSearchParams(corpo).get('grant_type') === 'authorization_code') {
        const parametros = new URLSearchParams(corpo);
        const pedido = estado.codigos.get(parametros.get('code'));
        const pkceOk = pedido && crypto.createHash('sha256').update(parametros.get('code_verifier') || '').digest('base64url') === pedido.desafioPkce;
        if (!pedido || !pkceOk || parametros.get('client_secret') !== pedido.segredoEsperado) {
          resposta.writeHead(400, { 'content-type': 'application/json' });
          resposta.end(JSON.stringify({ error: 'invalid_grant' }));
          return;
        }
        estado.codigos.delete(parametros.get('code'));
        resposta.writeHead(200, { 'content-type': 'application/json' });
        resposta.end(JSON.stringify({ access_token: 'x', id_token: pedido.idToken }));
        return;
      }
      if (requisicao.url === '/token') {
        const assercao = new URLSearchParams(corpo).get('assertion') || '';
        const [cabecalho, declaracoes, assinatura] = assercao.split('.');
        const valida = estado.chavePublica && crypto.verify('RSA-SHA256', Buffer.from(`${cabecalho}.${declaracoes}`), estado.chavePublica, Buffer.from(assinatura || '', 'base64url'));
        if (!valida) {
          resposta.writeHead(400, { 'content-type': 'application/json' });
          resposta.end(JSON.stringify({ error: 'invalid_grant' }));
          return;
        }
        resposta.writeHead(200, { 'content-type': 'application/json' });
        resposta.end(JSON.stringify({ access_token: 'token-falso', expires_in: 3600 }));
        return;
      }
      if (requisicao.url === '/api/freeBusy') {
        if (requisicao.headers.authorization !== 'Bearer token-falso') {
          resposta.writeHead(401);
          resposta.end('{}');
          return;
        }
        const pedido = JSON.parse(corpo);
        const calendars = {};
        for (const { id } of pedido.items) {
          calendars[id] = estado.ocupadosPorAgenda[id] === 'naoEncontrada'
            ? { errors: [{ domain: 'global', reason: 'notFound' }] }
            : { busy: estado.ocupadosPorAgenda[id] || [] };
        }
        resposta.writeHead(200, { 'content-type': 'application/json' });
        resposta.end(JSON.stringify({ calendars }));
        return;
      }
      resposta.writeHead(404);
      resposta.end();
    });
  });
  return new Promise((resolver) => {
    servidor.listen(0, '127.0.0.1', () => resolver({ servidor, estado, porta: servidor.address().port }));
  });
}

/** Sobe o StylOS numa pasta temporária. Devolve { base, pasta, processo, codigoInicial }. */
function iniciarServidor(variaveisExtras = {}) {
  const pasta = fs.mkdtempSync(path.join(os.tmpdir(), 'stylos-teste-'));
  const processo = spawn(process.execPath, ['--disable-warning=ExperimentalWarning', path.join(RAIZ, 'servidor/principal.js')], {
    env: {
      ...process.env, PASTA_DADOS: pasta, PORTA: '0', HOST: '127.0.0.1', STYLOS_MODO_TESTE: '1',
      ANTI_ROBO_DIFICULDADE: '4', ESCUDO_PEDIDOS_POR_SEGUNDO: '2000', ESCUDO_RAJADA: '5000', ESCUDO_SIMULTANEOS_POR_IP: '500',
      TAILSCALE_CAMINHO: path.join(os.tmpdir(), 'nao-existe-tailscale'),
      ...variaveisExtras,
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let saida = '';
  return new Promise((resolver, rejeitar) => {
    const limite = setTimeout(() => rejeitar(new Error(`Servidor não subiu:\n${saida}`)), 8000);
    processo.stderr.on('data', (pedaco) => { saida += pedaco; });
    processo.stdout.on('data', (pedaco) => {
      saida += pedaco;
      const porta = saida.match(/localhost:(\d+)/);
      const codigo = saida.match(/código:\s+([A-Z0-9]{4}-[A-Z0-9]{4})/);
      if (porta && codigo) {
        clearTimeout(limite);
        resolver({ base: `http://127.0.0.1:${porta[1]}`, pasta, processo, codigoInicial: codigo[1], saida: () => saida });
      }
    });
  });
}

function pararServidor(instancia) {
  instancia.processo.kill('SIGTERM');
  fs.rmSync(instancia.pasta, { recursive: true, force: true });
}

/** Cliente que se comporta como um navegador: guarda cookie e manda X-StylOS. */
class Cliente {
  constructor(base, ip) {
    this.base = base;
    this.cookie = '';
    this.ip = ip || `10.0.${Math.floor(Math.random() * 250)}.${Math.floor(Math.random() * 250)}`;
  }

  /** Pede e resolve um desafio "Não sou um robô" (como o navegador faria). */
  async antiRobo() {
    const { resolverDesafio } = require('../servidor/servicos/anti-robo');
    const resposta = await fetch(`${this.base}/api/anti-robo/desafio`, { headers: { 'x-forwarded-for': this.ip } });
    return resolverDesafio(await resposta.json());
  }

  async pedir(metodo, caminho, corpo, { semCabecalhoCsrf = false, cabecalhos = {}, binario, tipo, semAntiRobo = false } = {}) {
    // Rotas com "Não sou um robô": anexa a prova sozinho (a não ser que o teste peça para não anexar)
    if (!semAntiRobo && corpo && typeof corpo === 'object' && corpo.antiRobo === undefined && /\/api\/(cadastro|recuperar-senha)$|\/agendamentos$/.test(caminho) && metodo === 'POST') {
      corpo = { ...corpo, antiRobo: await this.antiRobo() };
    }
    const opcoes = {
      method: metodo,
      headers: { 'x-forwarded-for': this.ip, ...(this.cookie ? { cookie: this.cookie } : {}), ...(semCabecalhoCsrf ? {} : { 'x-stylos': '1' }), ...cabecalhos },
      redirect: 'manual',
    };
    if (binario) {
      opcoes.body = binario;
      opcoes.headers['content-type'] = tipo || 'application/octet-stream';
    } else if (corpo !== undefined) {
      opcoes.body = JSON.stringify(corpo);
      opcoes.headers['content-type'] = 'application/json';
    }
    const resposta = await fetch(this.base + caminho, opcoes);
    const definirCookie = resposta.headers.get('set-cookie');
    if (definirCookie) this.cookie = definirCookie.split(';')[0].endsWith('=') ? '' : definirCookie.split(';')[0];
    const texto = await resposta.text();
    let dados;
    try { dados = JSON.parse(texto); } catch { dados = texto; }
    return { status: resposta.status, dados, cabecalhos: resposta.headers };
  }

  get(caminho, opcoes) { return this.pedir('GET', caminho, undefined, opcoes); }
  post(caminho, corpo = {}, opcoes) { return this.pedir('POST', caminho, corpo, opcoes); }
  put(caminho, corpo, opcoes) { return this.pedir('PUT', caminho, corpo, opcoes); }
  delete(caminho, opcoes) { return this.pedir('DELETE', caminho, undefined, opcoes); }
}

/** Gera uma "chave de conta de serviço" falsa (formato igual ao do Google). */
function gerarContaServicoFalsa() {
  const { privateKey, publicKey } = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 });
  return {
    json: JSON.stringify({
      type: 'service_account',
      project_id: 'stylos-teste',
      client_email: 'stylos-agenda@stylos-teste.iam.gserviceaccount.com',
      private_key: privateKey.export({ type: 'pkcs8', format: 'pem' }),
    }),
    chavePublica: publicKey,
  };
}

/** PNG mínimo válido (1x1) para testar envio de fotos. */
const PNG_MINIMO = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64');

/** Monta um id_token JWT assinado (como o Google faria). */
function assinarIdToken(chavePrivada, kid, declaracoes) {
  const codificar = (objeto) => Buffer.from(JSON.stringify(objeto)).toString('base64url');
  const cabecalho = codificar({ alg: 'RS256', kid, typ: 'JWT' });
  const corpo = codificar(declaracoes);
  const assinatura = crypto.sign('RSA-SHA256', Buffer.from(`${cabecalho}.${corpo}`), chavePrivada).toString('base64url');
  return `${cabecalho}.${corpo}.${assinatura}`;
}

/** SMTP falso: aceita a conversa e guarda as mensagens recebidas. */
function iniciarSmtpFalso() {
  const net = require('node:net');
  const mensagens = [];
  const servidor = net.createServer((socket) => {
    let lendoDados = false;
    let dados = '';
    let buffer = '';
    socket.write('220 smtp-falso pronto\r\n');
    socket.on('data', (pedaco) => {
      buffer += pedaco.toString('utf8');
      if (lendoDados) {
        const fim = buffer.indexOf('\r\n.\r\n');
        if (fim === -1) return;
        dados += buffer.slice(0, fim);
        buffer = buffer.slice(fim + 5);
        lendoDados = false;
        mensagens.push(dados);
        socket.write('250 recebido\r\n');
      }
      let posicao;
      while (!lendoDados && (posicao = buffer.indexOf('\r\n')) !== -1) {
        const linha = buffer.slice(0, posicao);
        buffer = buffer.slice(posicao + 2);
        if (/^EHLO/i.test(linha)) socket.write('250-smtp-falso\r\n250 AUTH LOGIN\r\n');
        else if (/^AUTH LOGIN/i.test(linha)) socket.write('334 VXNlcm5hbWU6\r\n');
        else if (linha === Buffer.from('robo@stylos.test').toString('base64')) socket.write('334 UGFzc3dvcmQ6\r\n');
        else if (linha === Buffer.from('senhadeappteste').toString('base64')) socket.write('235 ok\r\n');
        else if (/^(MAIL|RCPT)/i.test(linha)) socket.write('250 ok\r\n');
        else if (/^DATA/i.test(linha)) { lendoDados = true; dados = ''; socket.write('354 manda\r\n'); }
        else if (/^QUIT/i.test(linha)) { socket.write('221 tchau\r\n'); socket.end(); }
        else if (linha) socket.write('535 credenciais invalidas\r\n');
      }
    });
    socket.on('error', () => {});
  });
  return new Promise((resolver) => servidor.listen(0, '127.0.0.1', () => resolver({ servidor, mensagens, porta: servidor.address().port })));
}

/** Decodifica o corpo base64 de uma mensagem recebida pelo SMTP falso. */
function textoDoEmail(mensagem) {
  const [, corpo] = mensagem.split('\r\n\r\n');
  return Buffer.from(corpo.replace(/\r\n/g, ''), 'base64').toString('utf8');
}

module.exports = {
  assinarIdToken, iniciarSmtpFalso, textoDoEmail, iniciarServidor, pararServidor, iniciarGoogleFalso, Cliente, gerarContaServicoFalsa, PNG_MINIMO };
