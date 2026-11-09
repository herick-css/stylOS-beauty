/**
 * rotas/google-login.js — "Entrar com Google" (OpenID Connect + PKCE)
 * ------------------------------------------------------------------
 * Configuração (uma vez, pelo DONO, no painel "Integração Google"):
 *   Google Cloud → APIs e serviços → Credenciais → Criar "ID do cliente OAuth"
 *   (Aplicativo da Web), com o URI de redirecionamento que o painel mostra.
 *   Só pedimos nome e e-mail (escopos básicos): o Google NÃO exige verificação.
 *
 * Fluxo:
 *   /auth/google           → guarda state/nonce/PKCE num cookie assinado e manda ao Google
 *   /auth/google/retorno   → confere o state, troca o código pelo token,
 *                            CONFERE A ASSINATURA do token com as chaves do Google,
 *                            e entra (ou cria a conta de cliente).
 *
 * Regras de segurança das contas:
 *   - Cliente novo com e-mail verificado pelo Google → conta criada sozinha.
 *   - Cliente que já tinha conta com o mesmo e-mail → vinculada automaticamente.
 *   - ADM e DONO NUNCA são vinculados automaticamente: precisam entrar com a
 *     senha e clicar em "Vincular conta Google" (evita tomada de conta).
 */
'use strict';

const crypto = require('node:crypto');
const { configuracao } = require('../configuracao');
const { abrirBanco, registrarAuditoria, lerConfiguracaoGlobal, gravarConfiguracaoGlobal } = require('../banco');
const seguranca = require('../seguranca');
const { ErroHttp, lerCorpoJson, textoLimpo } = require('../utilitarios');

const CHAVE_CONFIG = 'google_login';
const NOME_COOKIE = 'stylos_oauth';
const EMISSORES_VALIDOS = new Set(['https://accounts.google.com', 'accounts.google.com']);

// ------------------------------------------------------------------
// Configuração (guardada criptografada)
// ------------------------------------------------------------------
function lerConfig() {
  const cifrado = lerConfiguracaoGlobal(CHAVE_CONFIG);
  if (!cifrado) return null;
  try {
    return JSON.parse(seguranca.descriptografar(cifrado));
  } catch {
    return null;
  }
}

function loginGoogleAtivo() {
  return Boolean(lerConfig());
}

// ------------------------------------------------------------------
// Cookie temporário assinado (guarda state, nonce e o segredo do PKCE)
// ------------------------------------------------------------------
function assinar(texto) {
  return crypto.createHmac('sha256', `stylos-oauth:${configuracao.segredo}`).update(texto).digest('base64url');
}

function criarCookieTemporario(dados, requisicao) {
  const valor = Buffer.from(JSON.stringify(dados)).toString('base64url');
  const partes = [`${NOME_COOKIE}=${valor}.${assinar(valor)}`, 'Path=/auth/google', 'HttpOnly', 'SameSite=Lax', 'Max-Age=600'];
  if (seguranca.requisicaoEhHttps(requisicao)) partes.push('Secure');
  return partes.join('; ');
}

function apagarCookieTemporario() {
  return `${NOME_COOKIE}=; Path=/auth/google; HttpOnly; SameSite=Lax; Max-Age=0`;
}

function lerCookieTemporario(requisicao) {
  const bruto = seguranca.lerCookies(requisicao)[NOME_COOKIE];
  if (!bruto || bruto.length > 2000) return null;
  const [valor, assinatura] = bruto.split('.');
  if (!valor || !assinatura) return null;
  const esperada = Buffer.from(assinar(valor));
  const recebida = Buffer.from(assinatura);
  if (esperada.length !== recebida.length || !crypto.timingSafeEqual(esperada, recebida)) return null;
  try {
    const dados = JSON.parse(Buffer.from(valor, 'base64url').toString('utf8'));
    return dados.expira > Date.now() ? dados : null;
  } catch {
    return null;
  }
}

// ------------------------------------------------------------------
// Chaves públicas do Google (para conferir a assinatura do id_token)
// ------------------------------------------------------------------
let cacheChaves = { chaves: new Map(), expiraEm: 0, ultimaBusca: 0 };

async function buscarChavesGoogle(forcar = false) {
  const agora = Date.now();
  if (!forcar && cacheChaves.expiraEm > agora) return cacheChaves.chaves;
  if (forcar && agora - cacheChaves.ultimaBusca < 60 * 1000) return cacheChaves.chaves; // no máx. 1x/min
  const controlador = new AbortController();
  const temporizador = setTimeout(() => controlador.abort(), 8000);
  try {
    const resposta = await fetch(configuracao.googleUrlCertificados, { signal: controlador.signal });
    if (!resposta.ok) throw new Error(`certificados ${resposta.status}`);
    const { keys } = await resposta.json();
    const chaves = new Map();
    for (const jwk of keys || []) {
      if (jwk.kty === 'RSA' && jwk.kid) chaves.set(jwk.kid, crypto.createPublicKey({ key: jwk, format: 'jwk' }));
    }
    const maxAge = Number((resposta.headers.get('cache-control') || '').match(/max-age=(\d+)/)?.[1] || 3600);
    cacheChaves = { chaves, expiraEm: agora + Math.min(maxAge, 86400) * 1000, ultimaBusca: agora };
    return chaves;
  } finally {
    clearTimeout(temporizador);
  }
}

/** Confere o id_token do Google e devolve os dados da pessoa (claims). */
async function verificarIdToken(idToken, clientId, nonceEsperado) {
  const partes = String(idToken || '').split('.');
  if (partes.length !== 3) throw new Error('token malformado');
  const cabecalho = JSON.parse(Buffer.from(partes[0], 'base64url').toString('utf8'));
  if (cabecalho.alg !== 'RS256' || !cabecalho.kid) throw new Error('algoritmo não aceito');
  let chave = (await buscarChavesGoogle()).get(cabecalho.kid);
  if (!chave) chave = (await buscarChavesGoogle(true)).get(cabecalho.kid); // o Google troca as chaves de tempos em tempos
  if (!chave) throw new Error('chave desconhecida');
  const assinaturaOk = crypto.verify('RSA-SHA256', Buffer.from(`${partes[0]}.${partes[1]}`), chave, Buffer.from(partes[2], 'base64url'));
  if (!assinaturaOk) throw new Error('assinatura inválida');
  const dados = JSON.parse(Buffer.from(partes[1], 'base64url').toString('utf8'));
  const agoraSegundos = Math.floor(Date.now() / 1000);
  if (!EMISSORES_VALIDOS.has(dados.iss)) throw new Error('emissor inválido');
  if (dados.aud !== clientId) throw new Error('token de outro aplicativo');
  if (!(dados.exp > agoraSegundos - 60)) throw new Error('token expirado');
  if (dados.nonce !== nonceEsperado) throw new Error('nonce não confere');
  if (!dados.sub) throw new Error('sem identificador');
  return dados;
}

// ------------------------------------------------------------------
// Rotas de navegação
// ------------------------------------------------------------------
function redirecionar(resposta, destino, cookies = []) {
  resposta.writeHead(302, { Location: destino, 'Cache-Control': 'no-store', 'Referrer-Policy': 'no-referrer', ...(cookies.length ? { 'Set-Cookie': cookies } : {}) });
  resposta.end();
}

/** Caminho interno seguro para voltar depois do login (nunca outro site). */
function caminhoSeguro(texto, padrao) {
  return typeof texto === 'string' && /^\/(?!\/)[A-Za-z0-9/_\-?=&#%.]*$/.test(texto) ? texto : padrao;
}

/** Junta "?google=..." a um caminho que pode ter #âncora. */
function comParametro(caminho, chave, valor) {
  const [semAncora, ancora] = caminho.split('#');
  const separador = semAncora.includes('?') ? '&' : '?';
  return `${semAncora}${separador}${chave}=${encodeURIComponent(valor)}${ancora !== undefined ? `#${ancora}` : ''}`;
}

/** Endereço de retorno: o público (túnel) ou o local, conforme por onde a pessoa entrou. */
function enderecoDeRetorno(requisicao) {
  const { urlPublicaAtual } = require('./autenticacao');
  const publica = urlPublicaAtual();
  const host = String(requisicao.headers['x-forwarded-host'] || requisicao.headers.host || '');
  if (publica && new URL(publica).host === host) return `${publica}/auth/google/retorno`;
  if (/^(localhost|127\.0\.0\.1)(:\d+)?$/.test(host)) return `http://${host}/auth/google/retorno`;
  return `${publica || `http://${host}`}/auth/google/retorno`;
}

async function tratar(requisicao, resposta, endereco, ip) {
  if (requisicao.method !== 'GET') {
    resposta.writeHead(405);
    resposta.end();
    return;
  }
  const config = lerConfig();
  if (!config) return redirecionar(resposta, '/entrar?erro=google-desligado');
  if (!seguranca.limitador.permitir(`google:${ip}`, 30, 10 * 60 * 1000)) return redirecionar(resposta, '/entrar?erro=muitas-tentativas');

  // ---------------- Ida para o Google ----------------
  if (endereco.pathname === '/auth/google') {
    const modo = endereco.searchParams.get('modo') === 'vincular' ? 'vincular' : 'entrar';
    let usuarioId = null;
    if (modo === 'vincular') {
      const sessao = seguranca.lerSessao(requisicao);
      if (!sessao) return redirecionar(resposta, '/entrar');
      usuarioId = sessao.usuario.id;
    }
    const dados = {
      state: crypto.randomBytes(24).toString('base64url'),
      nonce: crypto.randomBytes(24).toString('base64url'),
      verificador: crypto.randomBytes(48).toString('base64url'),
      voltar: caminhoSeguro(endereco.searchParams.get('voltar'), ''),
      modo,
      usuarioId,
      retorno: enderecoDeRetorno(requisicao),
      expira: Date.now() + 10 * 60 * 1000,
    };
    const desafioPkce = crypto.createHash('sha256').update(dados.verificador).digest('base64url');
    const destino = new URL(configuracao.googleUrlAutorizacao);
    destino.search = new URLSearchParams({
      client_id: config.clientId,
      redirect_uri: dados.retorno,
      response_type: 'code',
      scope: 'openid email profile',
      state: dados.state,
      nonce: dados.nonce,
      code_challenge: desafioPkce,
      code_challenge_method: 'S256',
      prompt: 'select_account',
    }).toString();
    return redirecionar(resposta, destino.toString(), [criarCookieTemporario(dados, requisicao)]);
  }

  // ---------------- Volta do Google ----------------
  const dados = lerCookieTemporario(requisicao);
  const limparCookie = apagarCookieTemporario();
  if (!dados) return redirecionar(resposta, '/entrar?erro=google-expirou', [limparCookie]);
  if (endereco.searchParams.get('error')) return redirecionar(resposta, '/entrar?erro=google-cancelado', [limparCookie]);
  const stateRecebido = Buffer.from(String(endereco.searchParams.get('state') || ''));
  const stateEsperado = Buffer.from(dados.state);
  if (stateRecebido.length !== stateEsperado.length || !crypto.timingSafeEqual(stateRecebido, stateEsperado)) {
    return redirecionar(resposta, '/entrar?erro=google', [limparCookie]);
  }

  // Troca o código pelo token (servidor ↔ Google, com o segredo do PKCE)
  let claims;
  try {
    const controlador = new AbortController();
    const temporizador = setTimeout(() => controlador.abort(), 10000);
    const respostaToken = await fetch(configuracao.googleUrlToken, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        code: String(endereco.searchParams.get('code') || ''),
        client_id: config.clientId,
        client_secret: config.clientSecret,
        redirect_uri: dados.retorno,
        grant_type: 'authorization_code',
        code_verifier: dados.verificador,
      }),
      signal: controlador.signal,
    }).finally(() => clearTimeout(temporizador));
    const token = await respostaToken.json().catch(() => ({}));
    if (!respostaToken.ok || !token.id_token) throw new Error(`troca de código falhou (${respostaToken.status})`);
    claims = await verificarIdToken(token.id_token, config.clientId, dados.nonce);
  } catch (erro) {
    console.warn('[login google] recusado:', erro.message);
    return redirecionar(resposta, '/entrar?erro=google', [limparCookie]);
  }
  if (claims.email_verified !== true && claims.email_verified !== 'true') {
    return redirecionar(resposta, '/entrar?erro=google-email', [limparCookie]);
  }

  const banco = abrirBanco();
  const email = textoLimpo(claims.email, 254).toLowerCase();
  const sub = String(claims.sub).slice(0, 255);

  // ---------- Vincular (pessoa já logada) ----------
  if (dados.modo === 'vincular') {
    const sessao = seguranca.lerSessao(requisicao);
    const destino = caminhoSeguro(dados.voltar, '/painel#conta');
    if (!sessao || sessao.usuario.id !== dados.usuarioId) return redirecionar(resposta, '/entrar', [limparCookie]);
    const outro = banco.prepare('SELECT id FROM usuarios WHERE google_sub = ?').get(sub);
    if (outro && outro.id !== sessao.usuario.id) return redirecionar(resposta, comParametro(destino, 'google', 'em-uso'), [limparCookie]);
    banco.prepare('UPDATE usuarios SET google_sub = ? WHERE id = ?').run(sub, sessao.usuario.id);
    registrarAuditoria(sessao.usuario.id, 'google-vinculado', email, ip);
    return redirecionar(resposta, comParametro(destino, 'google', 'vinculado'), [limparCookie]);
  }

  // ---------- Entrar ----------
  let usuario = banco.prepare('SELECT * FROM usuarios WHERE google_sub = ?').get(sub);
  if (!usuario) {
    const porEmail = banco.prepare('SELECT * FROM usuarios WHERE email = ?').get(email);
    if (porEmail && porEmail.papel !== 'usuario') {
      // ADM/dono: só vincula pela própria conta, com senha (proteção contra tomada de conta)
      return redirecionar(resposta, '/entrar?erro=google-vincular', [limparCookie]);
    }
    if (porEmail) {
      // O cadastro com senha não confirma o e-mail. Então alguém poderia ter criado
      // esta conta com o e-mail de outra pessoa ("pré-tomada de conta"). Como o
      // Google PROVOU quem é a dona do e-mail, anulamos a senha antiga e derrubamos
      // as sessões abertas: só a dona verdadeira continua com acesso.
      banco.prepare("UPDATE usuarios SET google_sub = ?, senha_hash = '!sem-senha', deve_trocar_senha = 0 WHERE id = ?").run(sub, porEmail.id);
      banco.prepare('DELETE FROM sessoes WHERE usuario_id = ?').run(porEmail.id);
      usuario = { ...porEmail, google_sub: sub, senha_hash: '!sem-senha' };
      registrarAuditoria(usuario.id, 'google-vinculado', `${email} (senha anterior anulada)`, ip);
    } else {
      const nome = textoLimpo(claims.name || email.split('@')[0], 80) || 'Cliente';
      const resultado = banco
        .prepare("INSERT INTO usuarios (nome, email, senha_hash, papel, google_sub) VALUES (?, ?, '!sem-senha', 'usuario', ?)")
        .run(nome, email, sub);
      usuario = banco.prepare('SELECT * FROM usuarios WHERE id = ?').get(Number(resultado.lastInsertRowid));
      registrarAuditoria(usuario.id, 'cadastro-cliente-google', email, ip);
    }
  }
  if (!usuario.ativo) return redirecionar(resposta, '/entrar?erro=desativado', [limparCookie]);

  const tokenSessao = seguranca.criarSessao(usuario.id, ip, requisicao.headers['user-agent']);
  registrarAuditoria(usuario.id, 'login-google', '', ip);
  let destino = usuario.papel === 'usuario' ? '/minha-conta' : '/painel';
  const pedido = caminhoSeguro(dados.voltar, '');
  if (pedido && !(usuario.papel === 'usuario' && /^\/(painel|editor)/.test(pedido))) destino = pedido;
  return redirecionar(resposta, destino, [seguranca.cookieDeSessao(tokenSessao, requisicao), limparCookie]);
}

// ------------------------------------------------------------------
// Configuração pelo dono (API)
// ------------------------------------------------------------------
function registrar(roteador) {
  roteador.get('/api/dono/google-login', async (contexto) => {
    const config = lerConfig();
    // O Google precisa do endereço PÚBLICO (é por ele que as clientes chegam),
    // mesmo que o dono esteja usando o painel pelo localhost.
    const { urlPublicaAtual } = require('./autenticacao');
    const publica = urlPublicaAtual();
    return {
      configurado: Boolean(config),
      clientId: config ? config.clientId : '',
      urlRetorno: publica ? `${publica}/auth/google/retorno` : enderecoDeRetorno(contexto.requisicao),
    };
  }, { papeis: ['dono'] });

  roteador.put('/api/dono/google-login', async (contexto) => {
    const corpo = await lerCorpoJson(contexto.requisicao);
    const clientId = textoLimpo(corpo.clientId, 200);
    const clientSecret = textoLimpo(corpo.clientSecret, 200);
    if (!/^[\w.-]+\.apps\.googleusercontent\.com$/.test(clientId)) throw new ErroHttp(400, 'ID do cliente inválido. Ele termina em ".apps.googleusercontent.com".');
    if (clientSecret.length < 10) throw new ErroHttp(400, 'Cole a "Chave secreta do cliente".');
    gravarConfiguracaoGlobal(CHAVE_CONFIG, seguranca.criptografar(JSON.stringify({ clientId, clientSecret })));
    registrarAuditoria(contexto.usuario.id, 'login-google-configurado', clientId, contexto.ip);
    return { configurado: true, clientId };
  }, { papeis: ['dono'] });

  roteador.delete('/api/dono/google-login', async (contexto) => {
    gravarConfiguracaoGlobal(CHAVE_CONFIG, null);
    registrarAuditoria(contexto.usuario.id, 'login-google-removido', '', contexto.ip);
    return { configurado: false };
  }, { papeis: ['dono'] });

  // Desvincular o Google da própria conta (só se tiver senha, senão ficaria sem acesso)
  roteador.post('/api/conta/google/desvincular', async (contexto) => {
    const banco = abrirBanco();
    const usuario = banco.prepare('SELECT senha_hash FROM usuarios WHERE id = ?').get(contexto.usuario.id);
    if (String(usuario.senha_hash).startsWith('!')) throw new ErroHttp(400, 'Crie uma senha antes de desvincular o Google, senão você ficaria sem acesso.');
    banco.prepare('UPDATE usuarios SET google_sub = NULL WHERE id = ?').run(contexto.usuario.id);
    registrarAuditoria(contexto.usuario.id, 'google-desvinculado', '', contexto.ip);
    return { ok: true };
  }, { papeis: ['dono', 'adm', 'usuario'] });
}

module.exports = { tratar, registrar, loginGoogleAtivo, verificarIdToken };
