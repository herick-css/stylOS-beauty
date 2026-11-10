/**
 * email.js — envio de e-mail por SMTP (ex.: Gmail), sem bibliotecas.
 * ------------------------------------------------------------------
 * Configuração (pelo DONO, no painel "Sistema e segurança"):
 *   Servidor: smtp.gmail.com   Porta: 465 (ou 587)
 *   Usuário: o Gmail que vai enviar   Senha: uma "SENHA DE APP" de 16 letras
 *   (exige verificação em duas etapas na conta Google; NÃO é a senha normal).
 *   Dica: crie um Gmail só para o sistema (ex.: stylosbeauty26@gmail.com).
 *   Limite do Gmail gratuito: ~500 e-mails por dia.
 *
 * A senha de app fica CRIPTOGRAFADA no banco.
 */
'use strict';

const net = require('node:net');
const tls = require('node:tls');
const crypto = require('node:crypto');
const { lerConfiguracaoGlobal, gravarConfiguracaoGlobal } = require('../banco');
const { criptografar, descriptografar } = require('../seguranca');

const CHAVE_CONFIG = 'email_smtp';
const TEMPO_LIMITE_MS = 20000;

function lerConfigEmail() {
  const cifrado = lerConfiguracaoGlobal(CHAVE_CONFIG);
  if (!cifrado) return null;
  try {
    return JSON.parse(descriptografar(cifrado));
  } catch {
    return null;
  }
}

function emailConfigurado() {
  return Boolean(lerConfigEmail());
}

const ehLocal = (servidor) => ['127.0.0.1', 'localhost', '::1'].includes(servidor);

/** Valida e salva a configuração. Senha vazia = manter a atual. */
function salvarConfigEmail({ servidor, porta, usuario, senha, nomeRemetente }) {
  const atual = lerConfigEmail();
  const config = {
    servidor: String(servidor || '').trim().toLowerCase(),
    porta: Number(porta),
    usuario: String(usuario || '').trim(),
    senha: String(senha || '').replace(/\s+/g, '') || (atual && atual.senha) || '',
    nomeRemetente: String(nomeRemetente || 'StylOS Beauty').trim().slice(0, 60),
  };
  if (!/^[a-z0-9.-]{3,100}$/.test(config.servidor)) throw new Error('Servidor SMTP inválido (ex.: smtp.gmail.com).');
  if (![465, 587, 25, 2525].includes(config.porta) && !ehLocal(config.servidor)) throw new Error('Porta inválida. Para o Gmail use 465.');
  if (!/^[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+$/.test(config.usuario)) throw new Error('Usuário deve ser o e-mail completo.');
  if (!config.senha) throw new Error('Informe a senha de app.');
  gravarConfiguracaoGlobal(CHAVE_CONFIG, criptografar(JSON.stringify(config)));
  return config;
}

function removerConfigEmail() {
  gravarConfiguracaoGlobal(CHAVE_CONFIG, null);
}

/** Codifica texto com acentos para cabeçalhos de e-mail (RFC 2047). */
function codificarCabecalho(texto) {
  return /^[\x20-\x7e]*$/.test(texto) ? texto : `=?UTF-8?B?${Buffer.from(texto, 'utf8').toString('base64')}?=`;
}

/** Monta a mensagem (texto puro em UTF-8, corpo em base64). */
function montarMensagem({ de, nomeRemetente, para, assunto, texto }) {
  const corpo = Buffer.from(texto.replace(/\r?\n/g, '\r\n'), 'utf8').toString('base64').replace(/.{76}/g, '$&\r\n');
  return [
    `From: ${codificarCabecalho(nomeRemetente)} <${de}>`,
    `To: <${para}>`,
    `Subject: ${codificarCabecalho(assunto)}`,
    `Date: ${new Date().toUTCString().replace('GMT', '+0000')}`,
    `Message-ID: <${crypto.randomBytes(12).toString('hex')}@stylos.local>`,
    'MIME-Version: 1.0',
    'Content-Type: text/plain; charset=utf-8',
    'Content-Transfer-Encoding: base64',
    '',
    corpo,
  ].join('\r\n');
}

/** Conversa SMTP: manda um comando e espera a resposta com o código esperado. */
class ConversaSmtp {
  constructor(socket) {
    this.trocarSocket(socket);
  }

  trocarSocket(socket) {
    this.socket = socket;
    this.buffer = '';
    this.esperando = null;
    socket.setEncoding('utf8');
    socket.on('data', (pedaco) => {
      this.buffer += pedaco;
      this.tentarEntregar();
    });
    socket.on('error', (erro) => this.falhar(erro));
    socket.on('close', () => this.falhar(new Error('Conexão com o servidor de e-mail foi encerrada.')));
  }

  falhar(erro) {
    if (this.esperando) {
      const { rejeitar } = this.esperando;
      this.esperando = null;
      rejeitar(erro);
    }
  }

  tentarEntregar() {
    if (!this.esperando) return;
    // Resposta completa: última linha no formato "250 texto" (código + espaço)
    const linhas = this.buffer.split('\r\n');
    for (let indice = 0; indice < linhas.length - 1; indice++) {
      if (/^\d{3} /.test(linhas[indice]) || /^\d{3}$/.test(linhas[indice])) {
        const resposta = linhas.slice(0, indice + 1).join('\n');
        const codigo = Number(linhas[indice].slice(0, 3));
        this.buffer = linhas.slice(indice + 1).join('\r\n');
        const { resolver } = this.esperando;
        this.esperando = null;
        resolver({ codigo, texto: resposta });
        return;
      }
    }
  }

  lerResposta() {
    return new Promise((resolver, rejeitar) => {
      this.esperando = { resolver, rejeitar };
      this.tentarEntregar();
    });
  }

  async comando(texto, codigosAceitos) {
    if (texto !== null) this.socket.write(`${texto}\r\n`);
    const resposta = await this.lerResposta();
    if (!codigosAceitos.includes(resposta.codigo)) {
      const erro = new Error(`Servidor de e-mail respondeu: ${resposta.texto.split('\n').at(-1)}`);
      erro.codigoSmtp = resposta.codigo;
      throw erro;
    }
    return resposta;
  }
}

/** Conecta (TLS direto na 465; texto puro + STARTTLS na 587). */
function conectar(config) {
  return new Promise((resolver, rejeitar) => {
    const usarTlsDireto = config.porta === 465;
    if (!usarTlsDireto && config.porta !== 587 && !ehLocal(config.servidor)) {
      rejeitar(new Error('Use a porta 465 ou 587.'));
      return;
    }
    const socket = usarTlsDireto
      ? tls.connect({ host: config.servidor, port: config.porta, servername: config.servidor, minVersion: 'TLSv1.2' })
      : net.connect({ host: config.servidor, port: config.porta });
    socket.setTimeout(TEMPO_LIMITE_MS, () => socket.destroy(new Error('O servidor de e-mail demorou demais para responder.')));
    socket.once(usarTlsDireto ? 'secureConnect' : 'connect', () => resolver(socket));
    socket.once('error', rejeitar);
  });
}

/**
 * Envia um e-mail de texto.
 * @param {{ para: string, assunto: string, texto: string }} mensagem
 */
async function enviarEmail({ para, assunto, texto }) {
  const config = lerConfigEmail();
  if (!config) throw new Error('O envio de e-mail não foi configurado.');
  if (!/^[^\s@<>\r\n]+@[^\s@<>\r\n]+\.[^\s@<>\r\n]+$/.test(para)) throw new Error('Destinatário inválido.'); // impede injeção de cabeçalhos

  const socket = await conectar(config);
  const conversa = new ConversaSmtp(socket);
  try {
    await conversa.comando(null, [220]);
    let ehlo = await conversa.comando('EHLO stylos.local', [250]);
    if (config.porta !== 465) {
      if (/STARTTLS/i.test(ehlo.texto)) {
        await conversa.comando('STARTTLS', [220]);
        const seguro = await new Promise((resolver, rejeitar) => {
          const tlsSocket = tls.connect({ socket, servername: config.servidor, minVersion: 'TLSv1.2' }, () => resolver(tlsSocket));
          tlsSocket.once('error', rejeitar);
        });
        socket.removeAllListeners('data');
        socket.removeAllListeners('close');
        conversa.trocarSocket(seguro);
        ehlo = await conversa.comando('EHLO stylos.local', [250]);
      } else if (!ehLocal(config.servidor)) {
        throw new Error('O servidor de e-mail não oferece conexão segura (STARTTLS). Envio cancelado.');
      }
    }
    await conversa.comando('AUTH LOGIN', [334]);
    await conversa.comando(Buffer.from(config.usuario).toString('base64'), [334]);
    await conversa.comando(Buffer.from(config.senha).toString('base64'), [235]);
    await conversa.comando(`MAIL FROM:<${config.usuario}>`, [250]);
    await conversa.comando(`RCPT TO:<${para}>`, [250, 251]);
    await conversa.comando('DATA', [354]);
    await conversa.comando(`${montarMensagem({ de: config.usuario, nomeRemetente: config.nomeRemetente, para, assunto, texto })}\r\n.`, [250]);
    conversa.socket.write('QUIT\r\n');
  } catch (erro) {
    if (erro.codigoSmtp === 535 || erro.codigoSmtp === 534) {
      erro.message = 'O Gmail recusou o login. Use uma SENHA DE APP (não a senha normal) e confira se a verificação em duas etapas está ativa.';
    }
    throw erro;
  } finally {
    setTimeout(() => conversa.socket.destroy(), 500).unref();
  }
}

module.exports = { enviarEmail, emailConfigurado, lerConfigEmail, salvarConfigEmail, removerConfigEmail, montarMensagem };
