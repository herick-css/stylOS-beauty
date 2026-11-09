/**
 * utilitarios.js
 * ------------------------------------------------------------------
 * Funções pequenas usadas em todo o servidor: responder JSON, ler o
 * corpo dos pedidos com limite de tamanho, servir arquivos estáticos e
 * um mini-roteador (para não depender do Express).
 */
'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { cabecalhosDeSeguranca } = require('./seguranca');

/** Erro com código HTTP: lance new ErroHttp(400, 'mensagem') em qualquer rota. */
class ErroHttp extends Error {
  constructor(status, mensagem, detalhes) {
    super(mensagem);
    this.status = status;
    this.detalhes = detalhes;
  }
}

/** Responde em JSON com os cabeçalhos de segurança de API. */
function responderJson(resposta, status, corpo, cabecalhosExtras = {}) {
  const texto = JSON.stringify(corpo);
  resposta.writeHead(status, {
    ...cabecalhosDeSeguranca('api'),
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(texto),
    ...cabecalhosExtras,
  });
  resposta.end(texto);
}

/** Lê o corpo cru do pedido, abortando se passar do limite. */
function lerCorpoBruto(requisicao, limiteBytes) {
  return new Promise((resolver, rejeitar) => {
    const tamanhoDeclarado = Number(requisicao.headers['content-length'] || 0);
    if (tamanhoDeclarado > limiteBytes) {
      rejeitar(new ErroHttp(413, 'Arquivo ou conteúdo grande demais.'));
      requisicao.resume();
      return;
    }
    const pedacos = [];
    let total = 0;
    requisicao.on('data', (pedaco) => {
      total += pedaco.length;
      if (total > limiteBytes) {
        rejeitar(new ErroHttp(413, 'Arquivo ou conteúdo grande demais.'));
        requisicao.destroy();
        return;
      }
      pedacos.push(pedaco);
    });
    requisicao.on('end', () => resolver(Buffer.concat(pedacos)));
    requisicao.on('error', rejeitar);
  });
}

/** Lê e interpreta um corpo JSON (exige Content-Type application/json). */
async function lerCorpoJson(requisicao, limiteBytes = 64 * 1024) {
  const tipo = String(requisicao.headers['content-type'] || '');
  if (!tipo.startsWith('application/json')) throw new ErroHttp(415, 'Envie os dados em JSON.');
  const bruto = await lerCorpoBruto(requisicao, limiteBytes);
  if (bruto.length === 0) return {};
  try {
    const dados = JSON.parse(bruto.toString('utf8'));
    if (dados === null || typeof dados !== 'object' || Array.isArray(dados)) throw new Error('formato');
    return dados;
  } catch {
    throw new ErroHttp(400, 'Dados inválidos.');
  }
}

// ------------------------------------------------------------------
// ARQUIVOS ESTÁTICOS (HTML, CSS, JS, imagens da pasta "publico")
// ------------------------------------------------------------------

const TIPOS_MIME = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
  '.txt': 'text/plain; charset=utf-8',
  '.webmanifest': 'application/manifest+json',
};

/**
 * Envia um arquivo de dentro de "pastaBase" com proteção contra
 * "path traversal" (../../ para sair da pasta).
 * Devolve false se o arquivo não existir.
 */
function servirArquivo(requisicao, resposta, pastaBase, caminhoRelativo, tipoSeguranca = 'painel', cacheSegundos = 0) {
  const caminhoNormalizado = path.normalize(decodeURIComponent(caminhoRelativo)).replace(/^([/\\])+/, '');
  const caminhoFinal = path.join(pastaBase, caminhoNormalizado);
  if (!caminhoFinal.startsWith(pastaBase + path.sep) && caminhoFinal !== pastaBase) return false;
  let estatisticas;
  try {
    estatisticas = fs.statSync(caminhoFinal);
  } catch {
    return false;
  }
  if (!estatisticas.isFile()) return false;
  const extensao = path.extname(caminhoFinal).toLowerCase();
  const tipoMime = TIPOS_MIME[extensao];
  if (!tipoMime) return false;

  const etag = `"${estatisticas.size.toString(16)}-${Math.floor(estatisticas.mtimeMs).toString(16)}"`;
  const cabecalhos = {
    ...cabecalhosDeSeguranca(tipoSeguranca, requisicao),
    'Content-Type': tipoMime,
    ETag: etag,
    'Cache-Control': cacheSegundos > 0 ? `public, max-age=${cacheSegundos}` : 'no-cache',
  };
  if (requisicao.headers['if-none-match'] === etag) {
    resposta.writeHead(304, cabecalhos);
    resposta.end();
    return true;
  }
  cabecalhos['Content-Length'] = estatisticas.size;
  resposta.writeHead(200, cabecalhos);
  if (requisicao.method === 'HEAD') {
    resposta.end();
  } else {
    fs.createReadStream(caminhoFinal).pipe(resposta);
  }
  return true;
}

// ------------------------------------------------------------------
// MINI-ROTEADOR
// ------------------------------------------------------------------

class Roteador {
  constructor() {
    this.rotas = [];
  }

  /**
   * Registra uma rota.
   * @param {string} metodo GET, POST, PUT, DELETE
   * @param {string} padrao ex.: '/api/adm/paginas/:id'
   * @param {Function} manipulador async (contexto) => resposta
   * @param {object} opcoes { papeis: ['adm','dono'], permitirTrocaPendente: false }
   */
  adicionar(metodo, padrao, manipulador, opcoes = {}) {
    const nomesParametros = [];
    const expressao = new RegExp(
      '^' +
        padrao.replace(/:([a-zA-Z]+)/g, (_, nome) => {
          nomesParametros.push(nome);
          return '([^/]+)';
        }) +
        '$',
    );
    this.rotas.push({ metodo, expressao, nomesParametros, manipulador, opcoes });
  }

  get(padrao, manipulador, opcoes) { this.adicionar('GET', padrao, manipulador, opcoes); }
  post(padrao, manipulador, opcoes) { this.adicionar('POST', padrao, manipulador, opcoes); }
  put(padrao, manipulador, opcoes) { this.adicionar('PUT', padrao, manipulador, opcoes); }
  delete(padrao, manipulador, opcoes) { this.adicionar('DELETE', padrao, manipulador, opcoes); }

  /** Procura a rota. Devolve { rota, parametros } ou { metodoNaoPermitido: true } ou null. */
  encontrar(metodo, caminho) {
    let caminhoExiste = false;
    for (const rota of this.rotas) {
      const resultado = rota.expressao.exec(caminho);
      if (!resultado) continue;
      caminhoExiste = true;
      if (rota.metodo !== metodo) continue;
      const parametros = {};
      rota.nomesParametros.forEach((nome, indice) => {
        parametros[nome] = decodeURIComponent(resultado[indice + 1]);
      });
      return { rota, parametros };
    }
    return caminhoExiste ? { metodoNaoPermitido: true } : null;
  }
}

/** Converte texto em número inteiro positivo ou lança erro 400. */
function idValido(valor) {
  const numero = Number(valor);
  if (!Number.isInteger(numero) || numero <= 0) throw new ErroHttp(400, 'Identificador inválido.');
  return numero;
}

/** Texto limpo: tira espaços das pontas, remove caracteres de controle e corta no máximo. */
function textoLimpo(valor, maximo = 200) {
  return String(valor ?? '')
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, '')
    .trim()
    .slice(0, maximo);
}

function emailValido(email) {
  return /^[^\s@]{1,64}@[^\s@]{1,190}\.[^\s@]{2,}$/.test(String(email || ''));
}

/** Deixa só os dígitos de um telefone. */
function soDigitos(texto) {
  return String(texto || '').replace(/\D/g, '');
}

module.exports = {
  ErroHttp,
  responderJson,
  lerCorpoBruto,
  lerCorpoJson,
  servirArquivo,
  Roteador,
  idValido,
  textoLimpo,
  emailValido,
  soDigitos,
};
