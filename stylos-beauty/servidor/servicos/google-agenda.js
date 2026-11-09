/**
 * google-agenda.js
 * ------------------------------------------------------------------
 * Lê os horários OCUPADOS do Google Agenda de cada ADM, do mesmo jeito
 * do projeto da Fernanda (conta de serviço + consulta "freeBusy"), mas
 * sem a biblioteca @googleapis: fazemos a assinatura JWT com o "crypto"
 * do próprio Node.
 *
 * COMO FUNCIONA (configurado UMA vez pelo dono):
 *   1. O dono cria uma "conta de serviço" no Google Cloud e cola a chave
 *      JSON no painel (fica criptografada no banco).
 *   2. Cada ADM compartilha a própria agenda com o e-mail dessa conta,
 *      com a permissão "Ver apenas livre/ocupado (ocultar detalhes)".
 *   3. O sistema só enxerga BLOCOS OCUPADOS — nunca títulos, nomes ou
 *      descrições dos eventos. Privacidade preservada.
 */
'use strict';

const crypto = require('node:crypto');
const { configuracao } = require('../configuracao');
const { lerConfiguracaoGlobal, gravarConfiguracaoGlobal } = require('../banco');
const { criptografar, descriptografar } = require('../seguranca');

const CHAVE_CONTA_SERVICO = 'google_conta_servico';
const ESCOPO = 'https://www.googleapis.com/auth/calendar.readonly';

let tokenEmCache = null;              // { valor, expiraEm }
const cacheOcupados = new Map();      // agendaId -> { expiraEm, ocupados }
const TEMPO_CACHE_MS = 60 * 1000;     // igual à Fernanda: 60 s

/** Valida e guarda a chave JSON da conta de serviço (criptografada). */
function salvarContaServico(textoJson) {
  let dados;
  try {
    dados = JSON.parse(textoJson);
  } catch {
    throw new Error('O conteúdo colado não é um JSON válido. Copie o arquivo inteiro baixado do Google Cloud.');
  }
  if (dados.type !== 'service_account' || !dados.client_email || !dados.private_key) {
    throw new Error('Esse JSON não é de uma conta de serviço (faltam client_email/private_key).');
  }
  try {
    crypto.createPrivateKey(dados.private_key);
  } catch {
    throw new Error('A chave privada do JSON está corrompida.');
  }
  const essencial = { client_email: String(dados.client_email), private_key: String(dados.private_key) };
  gravarConfiguracaoGlobal(CHAVE_CONTA_SERVICO, criptografar(JSON.stringify(essencial)));
  tokenEmCache = null;
  cacheOcupados.clear();
  return essencial.client_email;
}

function removerContaServico() {
  gravarConfiguracaoGlobal(CHAVE_CONTA_SERVICO, null);
  tokenEmCache = null;
  cacheOcupados.clear();
}

/** Lê a conta de serviço guardada (ou null se o dono ainda não configurou). */
function lerContaServico() {
  const cifrado = lerConfiguracaoGlobal(CHAVE_CONTA_SERVICO);
  if (!cifrado) return null;
  try {
    return JSON.parse(descriptografar(cifrado));
  } catch {
    return null;
  }
}

/** E-mail da conta de serviço — o ADM precisa compartilhar a agenda com ele. */
function emailDaContaServico() {
  return lerContaServico()?.client_email || null;
}

/** fetch com tempo-limite (não deixa o site travar se o Google demorar). */
async function buscarComTempoLimite(url, opcoes = {}, tempoMs = 8000) {
  const controlador = new AbortController();
  const temporizador = setTimeout(() => controlador.abort(), tempoMs);
  try {
    return await fetch(url, { ...opcoes, signal: controlador.signal });
  } finally {
    clearTimeout(temporizador);
  }
}

/** Gera o token de acesso OAuth2 (JWT assinado com RS256). Reaproveitado por ~55 min. */
async function obterTokenDeAcesso() {
  if (tokenEmCache && tokenEmCache.expiraEm > Date.now() + 60 * 1000) return tokenEmCache.valor;
  const conta = lerContaServico();
  if (!conta) throw new ErroGoogle('nao-configurado', 'A integração com o Google ainda não foi configurada pelo dono do sistema.');

  const agoraSegundos = Math.floor(Date.now() / 1000);
  const codificar = (objeto) => Buffer.from(JSON.stringify(objeto)).toString('base64url');
  const cabecalho = codificar({ alg: 'RS256', typ: 'JWT' });
  const declaracoes = codificar({
    iss: conta.client_email,
    scope: ESCOPO,
    aud: configuracao.googleUrlToken,
    iat: agoraSegundos,
    exp: agoraSegundos + 3600,
  });
  const assinatura = crypto.createSign('RSA-SHA256').update(`${cabecalho}.${declaracoes}`).sign(conta.private_key).toString('base64url');

  const resposta = await buscarComTempoLimite(configuracao.googleUrlToken, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
      assertion: `${cabecalho}.${declaracoes}.${assinatura}`,
    }),
  });
  const dados = await resposta.json().catch(() => ({}));
  if (!resposta.ok || !dados.access_token) {
    throw new ErroGoogle('token', 'O Google recusou a conta de serviço. Confira se a Google Calendar API está ativada no projeto.');
  }
  tokenEmCache = { valor: dados.access_token, expiraEm: Date.now() + (dados.expires_in || 3600) * 1000 };
  return tokenEmCache.valor;
}

class ErroGoogle extends Error {
  constructor(codigo, mensagem) {
    super(mensagem);
    this.codigo = codigo;
  }
}

/**
 * Busca os blocos ocupados de UMA agenda entre dois instantes (ms).
 * @returns [{ inicio: ms, fim: ms }]
 */
async function buscarOcupados(agendaId, inicioMs, fimMs, { ignorarCache = false } = {}) {
  const chaveCache = `${agendaId}|${Math.floor(inicioMs / 3600000)}|${Math.floor(fimMs / 3600000)}`;
  const emCache = cacheOcupados.get(chaveCache);
  if (!ignorarCache && emCache && emCache.expiraEm > Date.now()) return emCache.ocupados;

  const token = await obterTokenDeAcesso();
  const resposta = await buscarComTempoLimite(`${configuracao.googleUrlApi}/freeBusy`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      timeMin: new Date(inicioMs).toISOString(),
      timeMax: new Date(fimMs).toISOString(),
      items: [{ id: agendaId }],
    }),
  });
  const dados = await resposta.json().catch(() => ({}));
  if (!resposta.ok) throw new ErroGoogle('api', 'O Google Agenda não respondeu como esperado. Tente de novo em alguns minutos.');

  const agenda = dados.calendars?.[agendaId];
  if (!agenda) throw new ErroGoogle('api', 'Resposta do Google sem a agenda pedida.');
  if (agenda.errors?.length) {
    const motivo = agenda.errors[0].reason;
    if (motivo === 'notFound') {
      throw new ErroGoogle('sem-acesso', 'Agenda não encontrada ou não compartilhada com o e-mail da integração. Refaça o passo de compartilhar.');
    }
    throw new ErroGoogle('api', `O Google informou um problema com a agenda (${motivo}).`);
  }
  const ocupados = (agenda.busy || [])
    .map((bloco) => ({ inicio: Date.parse(bloco.start), fim: Date.parse(bloco.end) }))
    .filter((bloco) => Number.isFinite(bloco.inicio) && Number.isFinite(bloco.fim));

  cacheOcupados.set(chaveCache, { expiraEm: Date.now() + TEMPO_CACHE_MS, ocupados });
  if (cacheOcupados.size > 500) cacheOcupados.clear();
  return ocupados;
}

/** Limpa o cache de uma agenda (ex.: depois de um agendamento novo). */
function esquecerCache() {
  cacheOcupados.clear();
}

module.exports = {
  salvarContaServico,
  removerContaServico,
  emailDaContaServico,
  buscarOcupados,
  esquecerCache,
  ErroGoogle,
};
