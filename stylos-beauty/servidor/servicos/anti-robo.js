/**
 * anti-robo.js — "Não sou um robô" por PROVA DE TRABALHO
 * ------------------------------------------------------------------
 * Como funciona (sem Google reCAPTCHA, sem cadastro em serviço externo,
 * sem rastrear ninguém — bom para a LGPD):
 *
 *  1. O navegador pede um DESAFIO: um texto aleatório + "dificuldade",
 *     assinado pelo servidor (HMAC) para não poder ser falsificado.
 *  2. O navegador procura um número tal que SHA-256(desafio + número)
 *     comece com N bits zero. Uma pessoa espera ~1 segundo; um robô que
 *     quer fazer milhares de cadastros/pedidos gasta MUITO processamento.
 *  3. O servidor confere a resposta (uma conta só) e marca o desafio
 *     como usado — cada desafio vale UMA vez e expira em 5 minutos.
 *
 * Em "modo de defesa" (ataque detectado) a dificuldade sobe sozinha.
 */
'use strict';

const crypto = require('node:crypto');
const { configuracao } = require('../configuracao');

const VALIDADE_MS = 5 * 60 * 1000;
const MAXIMO_USADOS = 100000;           // memória limitada mesmo sob ataque
const desafiosUsados = new Map();       // salt -> expira_em

let obterModoDefesa = () => false;      // ligado pelo escudo (evita dependência circular)

function definirFonteModoDefesa(funcao) {
  obterModoDefesa = funcao;
}

/** Dificuldade atual em bits. Cada +1 bit dobra o trabalho do robô. */
function dificuldadeAtual() {
  const base = configuracao.antiRoboDificuldade;
  return obterModoDefesa() ? base + 3 : base;
}

function assinar(texto) {
  return crypto.createHmac('sha256', `stylos-anti-robo:${configuracao.segredo}`).update(texto).digest('hex');
}

/** Cria um desafio novo para o navegador resolver. */
function criarDesafio() {
  const dificuldade = dificuldadeAtual();
  const expira = Date.now() + VALIDADE_MS;
  const salt = `${crypto.randomBytes(12).toString('hex')}.${expira}`;
  return { algoritmo: 'SHA-256', salt, dificuldade, assinatura: assinar(`${salt}|${dificuldade}`) };
}

/** Quantos bits zero no começo do hash? */
function bitsZeroIniciais(buffer) {
  let total = 0;
  for (const byte of buffer) {
    if (byte === 0) {
      total += 8;
      continue;
    }
    total += Math.clz32(byte) - 24;
    break;
  }
  return total;
}

/**
 * Confere a solução enviada pelo formulário.
 * @returns {string|null} mensagem de erro, ou null se estiver tudo certo.
 */
function verificarSolucao(solucao) {
  if (!solucao || typeof solucao !== 'object') return 'Confirme que você não é um robô.';
  const { salt, dificuldade, assinatura, numero } = solucao;
  if (typeof salt !== 'string' || salt.length > 80 || !Number.isInteger(dificuldade) || typeof assinatura !== 'string' || !Number.isInteger(numero) || numero < 0) {
    return 'Verificação inválida. Tente de novo.';
  }
  const esperada = Buffer.from(assinar(`${salt}|${dificuldade}`), 'hex');
  const recebida = Buffer.from(assinatura.slice(0, 64), 'hex');
  if (esperada.length !== recebida.length || !crypto.timingSafeEqual(esperada, recebida)) return 'Verificação inválida. Tente de novo.';
  const expira = Number(salt.split('.')[1]);
  if (!Number.isFinite(expira) || expira < Date.now()) return 'A verificação expirou. Marque a caixa de novo.';
  if (dificuldade < configuracao.antiRoboDificuldade) return 'Verificação inválida. Tente de novo.';
  if (desafiosUsados.has(salt)) return 'Esta verificação já foi usada. Marque a caixa de novo.';
  const hash = crypto.createHash('sha256').update(`${salt}${numero}`).digest();
  if (bitsZeroIniciais(hash) < dificuldade) return 'Verificação incorreta. Tente de novo.';

  if (desafiosUsados.size >= MAXIMO_USADOS) limparUsados();
  // Memória cheia (ataque enorme): recusa em vez de esquecer desafios ainda válidos,
  // o que permitiria reutilizar uma mesma resposta.
  if (desafiosUsados.size >= MAXIMO_USADOS) return 'Muitas verificações agora. Tente de novo em instantes.';
  desafiosUsados.set(salt, expira);
  return null;
}

/** Remove desafios vencidos (chamado de hora em hora e quando a memória enche). */
function limparUsados() {
  const agora = Date.now();
  for (const [salt, expira] of desafiosUsados) {
    if (expira < agora) desafiosUsados.delete(salt);
  }
}

/** Resolve um desafio (usado só pelos testes automáticos). */
function resolverDesafio(desafio) {
  for (let numero = 0; ; numero++) {
    const hash = crypto.createHash('sha256').update(`${desafio.salt}${numero}`).digest();
    if (bitsZeroIniciais(hash) >= desafio.dificuldade) return { ...desafio, numero };
  }
}

module.exports = { criarDesafio, verificarSolucao, limparUsados, dificuldadeAtual, definirFonteModoDefesa, resolverDesafio, bitsZeroIniciais };
