/**
 * seguranca.js
 * ------------------------------------------------------------------
 * Tudo que protege o sistema fica aqui:
 *  - hash de senhas (scrypt, com "sal" aleatório)
 *  - sessões por cookie HttpOnly (o JavaScript da página não consegue ler)
 *  - proteção contra CSRF (pedidos forjados vindos de outros sites)
 *  - limitador de tentativas (contra robôs que chutam senhas)
 *  - cabeçalhos de segurança (CSP, anti-clickjacking etc.)
 *  - criptografia AES-256-GCM para segredos guardados no banco
 */
'use strict';

const crypto = require('node:crypto');
const { promisify } = require('node:util');
const { configuracao } = require('./configuracao');
const { abrirBanco } = require('./banco');

const scryptAssincrono = promisify(crypto.scrypt);

// ------------------------------------------------------------------
// SENHAS
// ------------------------------------------------------------------

// Custo do scrypt: ~100 ms por tentativa. Lento para robôs, imperceptível para pessoas.
const PARAMETROS_SCRYPT = { N: 32768, r: 8, p: 1, maxmem: 64 * 1024 * 1024 };
const TAMANHO_HASH = 64;

/** Gera o texto guardado no banco: scrypt$N$r$p$sal$hash */
async function gerarHashSenha(senha) {
  const sal = crypto.randomBytes(16);
  const hash = await scryptAssincrono(String(senha).normalize('NFKC'), sal, TAMANHO_HASH, PARAMETROS_SCRYPT);
  const { N, r, p } = PARAMETROS_SCRYPT;
  return `scrypt$${N}$${r}$${p}$${sal.toString('base64')}$${hash.toString('base64')}`;
}

// Hash "falso" usado quando o e-mail não existe, para o tempo de resposta
// ser o mesmo (assim um atacante não descobre quais e-mails estão cadastrados).
let hashFalsoParaTempoConstante = null;

/** Confere a senha digitada com o hash guardado (comparação em tempo constante). */
async function verificarSenha(senha, hashGuardado) {
  if (!hashGuardado) {
    hashFalsoParaTempoConstante ??= await gerarHashSenha('senha-falsa-para-tempo-constante');
    hashGuardado = hashFalsoParaTempoConstante;
    await verificarSenha(senha, hashGuardado);
    return false;
  }
  const partes = String(hashGuardado).split('$');
  if (partes.length !== 6 || partes[0] !== 'scrypt') {
    await verificarSenha(senha, null); // mesmo tempo de resposta (conta sem senha, ex.: criada pelo Google)
    return false;
  }
  const [, N, r, p, salBase64, hashBase64] = partes;
  const esperado = Buffer.from(hashBase64, 'base64');
  const calculado = await scryptAssincrono(String(senha).normalize('NFKC'), Buffer.from(salBase64, 'base64'), esperado.length, {
    N: Number(N), r: Number(r), p: Number(p), maxmem: PARAMETROS_SCRYPT.maxmem,
  });
  return calculado.length === esperado.length && crypto.timingSafeEqual(calculado, esperado);
}

// Senhas fracas mais usadas no Brasil (lista curta; a regra de tamanho faz o resto)
const SENHAS_PROIBIDAS = new Set([
  '12345678', '123456789', '1234567890', '87654321', 'senha123', 'senha1234', 'password', 'password1',
  'qwerty123', 'abc12345', '11111111', '00000000', 'brasil123', 'mudar123', 'stylos123', 'salao123', 'admin123',
]);

/** Devolve uma mensagem de erro (texto) se a senha for fraca, ou null se estiver boa. */
function problemaNaSenha(senha) {
  const texto = String(senha || '');
  if (texto.length < 8) return 'A senha precisa ter pelo menos 8 caracteres.';
  if (texto.length > 128) return 'A senha pode ter no máximo 128 caracteres.';
  if (!/[A-Za-zÀ-ÿ]/.test(texto) || !/\d/.test(texto)) return 'Use letras e números na senha.';
  if (SENHAS_PROIBIDAS.has(texto.toLowerCase())) return 'Essa senha é muito comum. Escolha outra.';
  return null;
}

/** Senha temporária legível (o dono passa para o ADM; ele troca no 1º acesso). */
function gerarSenhaTemporaria() {
  const silabas = ['ba', 'be', 'bi', 'bo', 'ca', 'ce', 'da', 'de', 'fa', 'fi', 'ga', 'la', 'le', 'li', 'ma', 'me', 'mi', 'na', 'ne', 'pa', 'pe', 'ra', 're', 'sa', 'se', 'ta', 'te', 'va', 've', 'za'];
  let senha = '';
  for (let i = 0; i < 4; i++) senha += silabas[crypto.randomInt(silabas.length)];
  return `${senha}-${crypto.randomInt(1000, 9999)}`;
}

// ------------------------------------------------------------------
// SESSÕES (login)
// ------------------------------------------------------------------

const NOME_COOKIE_SESSAO = 'stylos_sessao';

function hashDoToken(token) {
  return crypto.createHash('sha256').update(token).digest('hex');
}

/** Cria uma sessão nova e devolve o token (que vai no cookie). */
function criarSessao(usuarioId, ip, navegador) {
  const token = crypto.randomBytes(32).toString('base64url');
  const agora = Date.now();
  abrirBanco()
    .prepare('INSERT INTO sessoes (token_hash, usuario_id, criada_em, expira_em, ip, navegador) VALUES (?, ?, ?, ?, ?, ?)')
    .run(hashDoToken(token), usuarioId, agora, agora + configuracao.duracaoSessaoMs, ip || '', String(navegador || '').slice(0, 200));
  return token;
}

/** Lê os cookies do cabeçalho em um objeto { nome: valor }. */
function lerCookies(requisicao) {
  const cookies = {};
  const cabecalho = requisicao.headers.cookie || '';
  for (const parte of cabecalho.split(';')) {
    const posicao = parte.indexOf('=');
    if (posicao === -1) continue;
    const nome = parte.slice(0, posicao).trim();
    const valor = parte.slice(posicao + 1).trim();
    if (nome) cookies[nome] = decodeURIComponent(valor);
  }
  return cookies;
}

/**
 * Descobre quem está logado. Devolve { usuario, tokenHash } ou null.
 * A sessão é "deslizante": cada uso renova o prazo de 7 dias.
 */
function lerSessao(requisicao) {
  const token = lerCookies(requisicao)[NOME_COOKIE_SESSAO];
  if (!token || token.length > 100) return null;
  const banco = abrirBanco();
  const tokenHash = hashDoToken(token);
  const linha = banco.prepare(`
    SELECT s.expira_em, u.id, u.nome, u.email, u.telefone, u.papel, u.ativo,
           u.deve_trocar_senha, u.tutorial_painel, u.tutorial_editor, u.google_sub,
           (substr(u.senha_hash, 1, 1) <> '!') AS tem_senha
      FROM sessoes s JOIN usuarios u ON u.id = s.usuario_id
     WHERE s.token_hash = ?`).get(tokenHash);
  if (!linha) return null;
  const agora = Date.now();
  if (linha.expira_em < agora || !linha.ativo) {
    banco.prepare('DELETE FROM sessoes WHERE token_hash = ?').run(tokenHash);
    return null;
  }
  // Renova o prazo no máximo 1x por hora (evita escrever no banco a cada clique)
  if (linha.expira_em - agora < configuracao.duracaoSessaoMs - 60 * 60 * 1000) {
    banco.prepare('UPDATE sessoes SET expira_em = ? WHERE token_hash = ?').run(agora + configuracao.duracaoSessaoMs, tokenHash);
  }
  const { expira_em, ativo, ...usuario } = linha;
  return { usuario, tokenHash };
}

/** Monta o cabeçalho Set-Cookie da sessão. */
function cookieDeSessao(token, requisicao, apagar = false) {
  const partes = [
    `${NOME_COOKIE_SESSAO}=${apagar ? '' : token}`,
    'Path=/',
    'HttpOnly',          // JavaScript não lê → protege contra roubo por XSS
    'SameSite=Lax',      // não vai junto em formulários de outros sites
    `Max-Age=${apagar ? 0 : Math.floor(configuracao.duracaoSessaoMs / 1000)}`,
  ];
  if (requisicaoEhHttps(requisicao)) partes.push('Secure');
  return partes.join('; ');
}

function encerrarSessao(tokenHash) {
  abrirBanco().prepare('DELETE FROM sessoes WHERE token_hash = ?').run(tokenHash);
}

/** Ao trocar a senha, derruba as outras sessões abertas (ex.: num PC esquecido logado). */
function encerrarOutrasSessoes(usuarioId, tokenHashAtual) {
  abrirBanco().prepare('DELETE FROM sessoes WHERE usuario_id = ? AND token_hash <> ?').run(usuarioId, tokenHashAtual || '');
}

function limparSessoesExpiradas() {
  abrirBanco().prepare('DELETE FROM sessoes WHERE expira_em < ?').run(Date.now());
}

// ------------------------------------------------------------------
// REDE: IP real, HTTPS e proteção CSRF
// ------------------------------------------------------------------

/**
 * IP do visitante. Atrás do túnel, o IP real vem num cabeçalho:
 *  - Cloudflare: CF-Connecting-IP (a Cloudflare sobrescreve o que vier do visitante);
 *  - Tailscale Funnel: X-Forwarded-For. Usamos o ÚLTIMO endereço da lista,
 *    que é o que o túnel (confiável) acrescentou — os anteriores podem ter
 *    sido forjados pelo visitante.
 * Só confiamos nesses cabeçalhos quando o servidor escuta apenas em 127.0.0.1.
 */
function ipDoCliente(requisicao) {
  if (configuracao.confiarProxy) {
    const ultimoDaLista = (texto) => {
      const lista = String(texto || '').split(',').map((parte) => parte.trim()).filter(Boolean);
      return lista.length ? lista[lista.length - 1].slice(0, 64) : '';
    };
    // 1) Veio pelo Tailscale Funnel? O Tailscale APAGA e recoloca este cabeçalho em
    //    todo pedido do Funnel, então o visitante não consegue removê-lo nem forjá-lo.
    //    Nesse caso vale o X-Forwarded-For que o Tailscale escreveu — e IGNORAMOS um
    //    CF-Connecting-IP, que um atacante poderia mandar falso para fugir do escudo.
    if (requisicao.headers['tailscale-funnel-request']) {
      const ip = ultimoDaLista(requisicao.headers['x-forwarded-for']);
      if (ip) return ip;
    }
    // 2) Veio pela Cloudflare (cloudflared)? A Cloudflare sobrescreve este cabeçalho.
    const cloudflare = requisicao.headers['cf-connecting-ip'];
    if (cloudflare) return String(cloudflare).trim().slice(0, 64);
    // 3) Outro túnel/proxy local: o último endereço é o que o proxy acrescentou.
    const encaminhado = ultimoDaLista(requisicao.headers['x-forwarded-for']);
    if (encaminhado) return encaminhado;
  }
  return requisicao.socket.remoteAddress || 'desconhecido';
}

function requisicaoEhHttps(requisicao) {
  if (requisicao.socket.encrypted) return true;
  if (configuracao.confiarProxy && String(requisicao.headers['x-forwarded-proto'] || '').startsWith('https')) return true;
  // Pedido chegou pelo endereço público (https) cadastrado no .env ou no painel do dono?
  const { lerConfiguracaoGlobal } = require('./banco');
  const enderecoPublico = lerConfiguracaoGlobal('url_publica') || configuracao.urlPublica;
  if (!enderecoPublico.startsWith('https://')) return false;
  try {
    const hostPedido = requisicao.headers['x-forwarded-host'] || requisicao.headers.host;
    return new URL(enderecoPublico).host === hostPedido;
  } catch {
    return false;
  }
}

/**
 * Proteção CSRF para pedidos que ALTERAM dados (POST/PUT/DELETE):
 *  1) exige o cabeçalho "X-StylOS: 1" — outro site não consegue enviá-lo
 *     sem a nossa permissão (o navegador bloqueia por CORS);
 *  2) se o navegador informar a origem, ela tem que ser este próprio site.
 */
function pedidoTemOrigemValida(requisicao) {
  if (requisicao.headers['x-stylos'] !== '1') return false;
  const sitioDoPedido = requisicao.headers['sec-fetch-site'];
  if (sitioDoPedido && !['same-origin', 'none'].includes(sitioDoPedido)) return false;
  const origem = requisicao.headers.origin;
  if (origem) {
    try {
      const hostOrigem = new URL(origem).host;
      const hostsAceitos = new Set([requisicao.headers.host, requisicao.headers['x-forwarded-host']].filter(Boolean));
      if (configuracao.urlPublica) hostsAceitos.add(new URL(configuracao.urlPublica).host);
      if (!hostsAceitos.has(hostOrigem)) return false;
    } catch {
      return false;
    }
  }
  return true;
}

// ------------------------------------------------------------------
// LIMITADOR DE TENTATIVAS (rate limit) — em memória
// ------------------------------------------------------------------

class LimitadorDeTentativas {
  constructor() {
    this.registros = new Map(); // chave -> lista de horários (ms)
  }

  /** Registra uma tentativa e diz se ainda está dentro do limite. */
  permitir(chave, maximo, janelaMs) {
    const agora = Date.now();
    const lista = (this.registros.get(chave) || []).filter((momento) => agora - momento < janelaMs);
    if (lista.length >= maximo) {
      this.registros.set(chave, lista);
      return false;
    }
    lista.push(agora);
    this.registros.set(chave, lista);
    return true;
  }

  /** Quantas tentativas uma chave tem dentro da janela (sem registrar uma nova). */
  contar(chave, janelaMs) {
    const agora = Date.now();
    return (this.registros.get(chave) || []).filter((momento) => agora - momento < janelaMs).length;
  }

  /** Apaga as tentativas de uma chave (ex.: depois de um login correto). */
  zerar(chave) {
    this.registros.delete(chave);
  }

  /** Remove registros velhos (chamado de hora em hora). */
  limpar(janelaMaximaMs = 60 * 60 * 1000) {
    const agora = Date.now();
    for (const [chave, lista] of this.registros) {
      const recentes = lista.filter((momento) => agora - momento < janelaMaximaMs);
      if (recentes.length) this.registros.set(chave, recentes);
      else this.registros.delete(chave);
    }
  }
}

const limitador = new LimitadorDeTentativas();

// ------------------------------------------------------------------
// CABEÇALHOS DE SEGURANÇA
// ------------------------------------------------------------------

/**
 * @param {'painel'|'pagina-publica'|'arquivo'|'api'} tipo
 *  - painel: nunca pode ser embutido em outro site (anti-clickjacking)
 *  - pagina-publica: pode ser embutida nos domínios de PERMITIR_EMBUTIR_EM (ex.: Canva)
 */
function cabecalhosDeSeguranca(tipo, requisicao) {
  const embutirEm = tipo === 'pagina-publica' ? `'self' ${configuracao.permitirEmbutirEm}`.trim() : "'self'";
  const politicaConteudo = [
    "default-src 'self'",
    "script-src 'self'",                                     // nenhum script de fora, nenhum script embutido
    "style-src 'self' https://fonts.googleapis.com",
    "font-src 'self' https://fonts.gstatic.com",
    "img-src 'self' data: blob:",
    "media-src 'self'",
    "connect-src 'self'",
    "frame-src 'self' https://www.youtube-nocookie.com https://player.vimeo.com",
    `frame-ancestors ${tipo === 'painel' ? "'self'" : embutirEm}`,
    "form-action 'self'",
    "base-uri 'none'",
    "object-src 'none'",
  ].join('; ');

  const cabecalhos = {
    'X-Content-Type-Options': 'nosniff',
    'Referrer-Policy': 'strict-origin-when-cross-origin',
    'Permissions-Policy': 'camera=(), microphone=(), geolocation=(), payment=(), usb=()',
    'Cross-Origin-Opener-Policy': 'same-origin',
    'Cross-Origin-Resource-Policy': 'same-origin',
  };
  if (tipo === 'arquivo') {
    cabecalhos['Content-Security-Policy'] = "default-src 'none'; img-src 'self'; style-src 'unsafe-inline'; sandbox";
    cabecalhos['Cross-Origin-Resource-Policy'] = 'cross-origin'; // permite usar as fotos no site do Canva
  } else if (tipo === 'api') {
    cabecalhos['Content-Security-Policy'] = "default-src 'none'; frame-ancestors 'none'";
    cabecalhos['Cache-Control'] = 'no-store';
  } else {
    cabecalhos['Content-Security-Policy'] = politicaConteudo;
  }
  if (tipo === 'painel') cabecalhos['X-Frame-Options'] = 'SAMEORIGIN';
  if (requisicao && requisicaoEhHttps(requisicao)) {
    cabecalhos['Strict-Transport-Security'] = 'max-age=15552000';
  }
  return cabecalhos;
}

// ------------------------------------------------------------------
// CRIPTOGRAFIA de segredos guardados no banco (AES-256-GCM)
// ------------------------------------------------------------------

function chaveDeCriptografia() {
  if (!configuracao.segredo) throw new Error('Segredo da aplicação não carregado.');
  return crypto.createHash('sha256').update(`stylos-cripto:${configuracao.segredo}`).digest();
}

/** Criptografa um texto. Resultado: iv.tag.dados (base64url). */
function criptografar(textoAberto) {
  const iv = crypto.randomBytes(12);
  const cifra = crypto.createCipheriv('aes-256-gcm', chaveDeCriptografia(), iv);
  const dados = Buffer.concat([cifra.update(String(textoAberto), 'utf8'), cifra.final()]);
  return [iv, cifra.getAuthTag(), dados].map((b) => b.toString('base64url')).join('.');
}

function descriptografar(textoCifrado) {
  const [iv, tag, dados] = String(textoCifrado).split('.').map((parte) => Buffer.from(parte, 'base64url'));
  const decifra = crypto.createDecipheriv('aes-256-gcm', chaveDeCriptografia(), iv);
  decifra.setAuthTag(tag);
  return Buffer.concat([decifra.update(dados), decifra.final()]).toString('utf8');
}

/** Código curto aleatório sem letras confusas (0/O, 1/I). */
function gerarCodigoCurto(tamanho = 6) {
  const alfabeto = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let codigo = '';
  for (let i = 0; i < tamanho; i++) codigo += alfabeto[crypto.randomInt(alfabeto.length)];
  return codigo;
}

module.exports = {
  gerarHashSenha,
  verificarSenha,
  problemaNaSenha,
  gerarSenhaTemporaria,
  criarSessao,
  lerSessao,
  lerCookies,
  cookieDeSessao,
  encerrarSessao,
  encerrarOutrasSessoes,
  limparSessoesExpiradas,
  ipDoCliente,
  requisicaoEhHttps,
  pedidoTemOrigemValida,
  limitador,
  LimitadorDeTentativas,
  cabecalhosDeSeguranca,
  criptografar,
  descriptografar,
  gerarCodigoCurto,
};
