/**
 * tailscale.js — descobre SOZINHO o endereço público do túnel Tailscale.
 * ------------------------------------------------------------------
 * Antes, sem "Endereço público" configurado, o link das páginas saía
 * como http://localhost:3000/p/... — que só funciona no próprio notebook.
 *
 * Agora, de 5 em 5 minutos, perguntamos ao Tailscale instalado:
 *   tailscale status --json         → nome do computador na rede (ex.: notebook.tail1234.ts.net)
 *   tailscale funnel status --json  → o Funnel (publicação na internet) está ligado? aponta para a nossa porta?
 * Se estiver tudo certo, os links passam a usar https://notebook.tail1234.ts.net.
 *
 * O "Endereço público" digitado pelo dono no painel continua tendo prioridade.
 */
'use strict';

const { execFile } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');
const { configuracao } = require('../configuracao');

let situacaoAtual = {
  instalado: false,
  conectado: false,
  url: '',
  funnelAtivo: false,
  apontaParaPorta: false,
  verificadoEm: null,
  dica: 'Tailscale ainda não verificado.',
};

/** Onde está o programa "tailscale" (Windows, macOS ou Linux). */
function caminhoDoTailscale() {
  if (configuracao.tailscaleCaminho) return configuracao.tailscaleCaminho;
  const candidatos = [
    process.env.ProgramFiles && path.join(process.env.ProgramFiles, 'Tailscale', 'tailscale.exe'),
    'C:\\Program Files\\Tailscale\\tailscale.exe',
    '/Applications/Tailscale.app/Contents/MacOS/Tailscale',
  ].filter(Boolean);
  return candidatos.find((caminho) => {
    try { return fs.statSync(caminho).isFile(); } catch { return false; }
  }) || 'tailscale';
}

function executarJson(argumentos) {
  return new Promise((resolver) => {
    execFile(caminhoDoTailscale(), argumentos, { timeout: 6000, windowsHide: true, maxBuffer: 2 * 1024 * 1024 }, (erro, saida) => {
      if (erro && erro.code === 'ENOENT') return resolver({ naoInstalado: true });
      try {
        resolver({ dados: JSON.parse(String(saida || '').trim() || 'null') });
      } catch {
        resolver({ erro: erro || new Error('resposta inesperada') });
      }
    });
  });
}

/** Consulta o Tailscale e atualiza a situação. Nunca lança erro. */
async function verificarTailscale() {
  const agora = new Date().toISOString();
  const status = await executarJson(['status', '--json']);
  if (status.naoInstalado) {
    situacaoAtual = { instalado: false, conectado: false, url: '', funnelAtivo: false, apontaParaPorta: false, verificadoEm: agora, dica: 'Tailscale não encontrado neste computador. Rode o INSTALAR-WINDOWS.bat e escolha instalar o Tailscale.' };
    return situacaoAtual;
  }
  const self = status.dados && status.dados.Self;
  const nome = self && String(self.DNSName || '').replace(/\.$/, '').toLowerCase();
  const conectado = Boolean(status.dados && status.dados.BackendState === 'Running' && nome && /^[a-z0-9-]+(\.[a-z0-9-]+)*\.ts\.net$/.test(nome));
  if (!conectado) {
    situacaoAtual = { instalado: true, conectado: false, url: '', funnelAtivo: false, apontaParaPorta: false, verificadoEm: agora, dica: 'O Tailscale está instalado mas desconectado. Abra-o e faça login (ou rode "tailscale up").' };
    return situacaoAtual;
  }

  const funil = await executarJson(['funnel', 'status', '--json']);
  const config = (funil.dados && typeof funil.dados === 'object') ? funil.dados : {};
  const permitidos = config.AllowFunnel || {};
  const funnelAtivo = Object.keys(permitidos).some((chave) => permitidos[chave] && chave.toLowerCase().startsWith(`${nome}:`));
  // Algum caminho publicado aponta para a porta do StylOS?
  const textoWeb = JSON.stringify(config.Web || {});
  const apontaParaPorta = new RegExp(`(127\\.0\\.0\\.1|localhost):${configuracao.porta}\\b`).test(textoWeb);
  // Funnel na porta 443 dá https://nome; em 8443/10000 o endereço leva a porta
  const portaPublica = Object.keys(permitidos).map((chave) => chave.split(':').pop()).find((porta) => ['443', '8443', '10000'].includes(porta)) || '443';
  const url = `https://${nome}${portaPublica === '443' ? '' : `:${portaPublica}`}`;

  let dica = 'Tudo certo: o StylOS está publicado na internet pelo Tailscale Funnel.';
  if (!funnelAtivo) dica = `O Funnel está desligado. Rode: tailscale funnel --bg ${configuracao.porta}`;
  else if (!apontaParaPorta) dica = `O Funnel está ligado, mas não aponta para a porta ${configuracao.porta}. Rode: tailscale funnel --bg ${configuracao.porta}`;

  situacaoAtual = { instalado: true, conectado: true, url, funnelAtivo, apontaParaPorta, verificadoEm: agora, dica };
  return situacaoAtual;
}

/** Endereço público detectado — só quando o Funnel está ligado E aponta para nós. */
function urlDetectada() {
  return situacaoAtual.funnelAtivo && situacaoAtual.apontaParaPorta ? situacaoAtual.url : '';
}

function situacao() {
  return { ...situacaoAtual };
}

/** Verifica agora e depois a cada 5 minutos. */
function iniciarVerificacaoPeriodica() {
  const executar = () => verificarTailscale().catch(() => {});
  const primeira = executar();
  const temporizador = setInterval(executar, 5 * 60 * 1000);
  temporizador.unref();
  return primeira;
}

module.exports = { verificarTailscale, urlDetectada, situacao, iniciarVerificacaoPeriodica };
