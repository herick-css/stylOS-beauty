/**
 * configuracao.js
 * ------------------------------------------------------------------
 * Lê as configurações do sistema a partir de:
 *   1) variáveis de ambiente (têm prioridade);
 *   2) arquivo ".env" na raiz do projeto (opcional);
 *   3) valores padrão definidos aqui.
 *
 * Também cria (na primeira execução) o arquivo secreto "dados/.segredo",
 * usado para criptografar dados sensíveis guardados no banco
 * (ex.: chave privada da conta de serviço do Google).
 */
'use strict';

const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

const PASTA_RAIZ = path.resolve(__dirname, '..');

/**
 * Lê um arquivo no formato CHAVE=valor (linhas com # são comentários).
 * Não usamos biblioteca (dotenv) para manter o projeto sem dependências.
 */
function lerArquivoEnv(caminhoArquivo) {
  const valores = {};
  if (!fs.existsSync(caminhoArquivo)) return valores;
  const linhas = fs.readFileSync(caminhoArquivo, 'utf8').split(/\r?\n/);
  for (const linha of linhas) {
    const limpa = linha.trim();
    if (!limpa || limpa.startsWith('#')) continue;
    const posicaoIgual = limpa.indexOf('=');
    if (posicaoIgual === -1) continue;
    const chave = limpa.slice(0, posicaoIgual).trim();
    let valor = limpa.slice(posicaoIgual + 1).trim();
    // remove aspas opcionais: CHAVE="valor"
    if ((valor.startsWith('"') && valor.endsWith('"')) || (valor.startsWith("'") && valor.endsWith("'"))) {
      valor = valor.slice(1, -1);
    }
    valores[chave] = valor;
  }
  return valores;
}

const valoresArquivo = lerArquivoEnv(path.join(PASTA_RAIZ, '.env'));

/** Busca uma configuração: ambiente > .env > padrão */
function ler(chave, padrao) {
  if (process.env[chave] !== undefined && process.env[chave] !== '') return process.env[chave];
  if (valoresArquivo[chave] !== undefined && valoresArquivo[chave] !== '') return valoresArquivo[chave];
  return padrao;
}

const pastaDados = path.resolve(PASTA_RAIZ, ler('PASTA_DADOS', 'dados'));
const host = ler('HOST', '127.0.0.1');

const configuracao = {
  pastaRaiz: PASTA_RAIZ,
  pastaPublica: path.join(PASTA_RAIZ, 'publico'),
  pastaDados,
  pastaUploads: path.join(pastaDados, 'uploads'),
  pastaBackups: path.join(pastaDados, 'backups'),
  caminhoBanco: path.join(pastaDados, 'stylos.sqlite'),

  porta: Number(ler('PORTA', '3000')),
  host,
  urlPublica: String(ler('URL_PUBLICA', '')).replace(/\/+$/, ''),

  // Quando o servidor só escuta em 127.0.0.1, quem fala com ele é o túnel
  // (Tailscale/Cloudflare), então podemos confiar no IP real que o túnel informa.
  confiarProxy: ler('CONFIAR_PROXY', host === '127.0.0.1' || host === 'localhost' ? '1' : '0') === '1',

  permitirEmbutirEm: ler('PERMITIR_EMBUTIR_EM', 'https://*.canva.site https://*.my.canva.site'),
  fusoPadrao: ler('FUSO_PADRAO', 'America/Manaus'),
  diasRetencaoAgendamentos: Number(ler('DIAS_RETENCAO_AGENDAMENTOS', '180')),
  backupsMantidos: Number(ler('BACKUPS_MANTIDOS', '14')),

  // Endereços do Google (só mudam nos testes automáticos, que usam um Google "falso")
  googleUrlToken: ler('GOOGLE_URL_TOKEN', 'https://oauth2.googleapis.com/token'),
  googleUrlApi: ler('GOOGLE_URL_API', 'https://www.googleapis.com/calendar/v3'),
  callmebotUrl: ler('CALLMEBOT_URL', 'https://api.callmebot.com/whatsapp.php'),

  // Limites de tamanho
  limiteCorpoJson: 512 * 1024, // 512 KB para o conteúdo de uma página
  limiteUploadImagem: 5 * 1024 * 1024, // 5 MB por foto (o navegador já reduz antes)
  limiteArquivosPorAdm: 300,

  // Sessões
  duracaoSessaoMs: 7 * 24 * 60 * 60 * 1000, // 7 dias sem uso = sai sozinho
  modoTeste: ler('STYLOS_MODO_TESTE', '0') === '1',
};

/**
 * Garante que as pastas de dados existem e devolve o segredo da aplicação.
 * O segredo é gerado UMA vez e fica em dados/.segredo (nunca envie esse arquivo a ninguém).
 */
function prepararPastasESegredo() {
  for (const pasta of [configuracao.pastaDados, configuracao.pastaUploads, configuracao.pastaBackups]) {
    fs.mkdirSync(pasta, { recursive: true });
  }
  const caminhoSegredo = path.join(configuracao.pastaDados, '.segredo');
  if (!fs.existsSync(caminhoSegredo)) {
    fs.writeFileSync(caminhoSegredo, crypto.randomBytes(32).toString('hex'), { mode: 0o600 });
  }
  configuracao.segredo = fs.readFileSync(caminhoSegredo, 'utf8').trim();
  return configuracao.segredo;
}

module.exports = { configuracao, prepararPastasESegredo };
