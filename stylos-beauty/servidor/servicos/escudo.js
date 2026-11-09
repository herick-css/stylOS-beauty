/**
 * escudo.js — proteção contra abuso e DDoS NA APLICAÇÃO
 * ------------------------------------------------------------------
 * LEIA: um notebook numa internet doméstica NÃO aguenta um DDoS de
 * verdade (milhões de pedidos/gigabits). Esse tipo de ataque só se
 * barra ANTES de chegar no computador (no túnel: o relay do Tailscale
 * já limita banda; a Cloudflare filtra DDoS). Este escudo cuida do que
 * dá para cuidar aqui dentro, gastando o mínimo de processamento:
 *
 *  1. Balde de fichas por IP: cada IP pode fazer X pedidos/segundo,
 *     com uma "rajada" curta permitida (abrir uma página pede vários arquivos).
 *  2. Limite de pedidos simultâneos por IP e no total (corte de carga).
 *  3. Bloqueio temporário de quem insiste: 10 min, depois 20, 40... (máx. 24 h).
 *  4. MODO DE DEFESA: liga sozinho quando o total de pedidos dispara
 *     (ou pelo dono, no painel). Nele os limites caem pela metade e o
 *     "não sou um robô" fica mais difícil e passa a valer também no login.
 *  5. Memória limitada: o próprio ataque não consegue encher a memória.
 *
 * IPv6: agrupado por bloco /64 (um atacante troca de endereço dentro do
 * bloco à vontade; tratar o bloco inteiro como "um IP" impede isso).
 */
'use strict';

const { configuracao } = require('../configuracao');

const MAXIMO_CHAVES = 50000;
const JANELA_INFRACOES_MS = 60 * 1000;
const INFRACOES_PARA_BLOQUEAR = 20;
const BLOQUEIO_BASE_MS = 10 * 60 * 1000;
const BLOQUEIO_MAXIMO_MS = 24 * 60 * 60 * 1000;
const DURACAO_MODO_DEFESA_MS = 15 * 60 * 1000;

const estado = {
  baldes: new Map(),        // chave -> { fichas, atualizado }
  emAndamento: new Map(),   // chave -> pedidos em andamento
  totalEmAndamento: 0,
  infracoes: new Map(),     // chave -> { quantidade, inicio }
  bloqueados: new Map(),    // chave -> { ate, vezes }
  historicoBloqueios: new Map(), // chave -> vezes (para escalar)
  minuto: { inicio: Date.now(), total: 0 },
  pedidosUltimoMinuto: 0,
  modoDefesaAte: 0,
  modoManual: null,         // null = automático | 'ligado' | 'desligado'
  totais: { recusados: 0, bloqueios: 0 },
  aoAtivarModoDefesa: null, // função chamada ao ligar automaticamente (registra auditoria)
};

/** Normaliza o IP: IPv4 como está, IPv4 dentro de IPv6 vira IPv4, IPv6 vira bloco /64. */
function chaveDoIp(ip) {
  const texto = String(ip || 'desconhecido').trim().toLowerCase();
  const ipv4Mapeado = texto.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/);
  if (ipv4Mapeado) return ipv4Mapeado[1];
  if (!texto.includes(':')) return texto;
  // expande "::" para pegar os 4 primeiros grupos (o /64)
  const [esquerda, direita = ''] = texto.split('::');
  const gruposEsquerda = esquerda ? esquerda.split(':') : [];
  const gruposDireita = direita ? direita.split(':') : [];
  const faltando = Math.max(0, 8 - gruposEsquerda.length - gruposDireita.length);
  const grupos = texto.includes('::') ? [...gruposEsquerda, ...Array(faltando).fill('0'), ...gruposDireita] : texto.split(':');
  return `${grupos.slice(0, 4).map((grupo) => grupo.replace(/^0+(?=.)/, '')).join(':')}::/64`;
}

function modoDefesaAtivo(agora = Date.now()) {
  if (estado.modoManual === 'ligado') return true;
  if (estado.modoManual === 'desligado') return false;
  return estado.modoDefesaAte > agora;
}

function ativarModoDefesa(motivo, agora = Date.now()) {
  const jaEstava = modoDefesaAtivo(agora);
  estado.modoDefesaAte = agora + DURACAO_MODO_DEFESA_MS;
  if (!jaEstava && estado.aoAtivarModoDefesa) {
    try { estado.aoAtivarModoDefesa(motivo); } catch { /* nunca derrubar por causa do registro */ }
  }
}

/** Mantém a memória limitada mesmo com milhares de IPs diferentes. */
function protegerMemoria(agora) {
  if (estado.baldes.size > MAXIMO_CHAVES) {
    for (const [chave, balde] of estado.baldes) {
      if (agora - balde.atualizado > 60 * 1000) estado.baldes.delete(chave);
    }
    if (estado.baldes.size > MAXIMO_CHAVES) {
      estado.baldes.clear(); // começa de novo; com muitos IPs ao mesmo tempo, isso já é ataque
      ativarModoDefesa('muitos endereços diferentes ao mesmo tempo', agora);
    }
  }
  if (estado.infracoes.size > MAXIMO_CHAVES) estado.infracoes.clear();
  if (estado.bloqueados.size > MAXIMO_CHAVES) {
    for (const [chave, bloqueio] of estado.bloqueados) if (bloqueio.ate < agora) estado.bloqueados.delete(chave);
  }
  if (estado.historicoBloqueios.size > MAXIMO_CHAVES) estado.historicoBloqueios.clear();
}

function registrarInfracao(chave, agora) {
  let registro = estado.infracoes.get(chave);
  if (!registro || agora - registro.inicio > JANELA_INFRACOES_MS) registro = { quantidade: 0, inicio: agora };
  registro.quantidade += 1;
  estado.infracoes.set(chave, registro);
  if (registro.quantidade >= INFRACOES_PARA_BLOQUEAR) {
    const vezes = (estado.historicoBloqueios.get(chave) || 0) + 1;
    estado.historicoBloqueios.set(chave, vezes);
    const duracao = Math.min(BLOQUEIO_MAXIMO_MS, BLOQUEIO_BASE_MS * 2 ** (vezes - 1));
    estado.bloqueados.set(chave, { ate: agora + duracao, vezes });
    estado.infracoes.delete(chave);
    estado.totais.bloqueios += 1;
  }
}

/**
 * Avalia um pedido que acabou de chegar.
 * @returns {{ permitido: true, liberar: Function } | { permitido: false, status: number, motivo: string, tentarEmSegundos: number }}
 */
function avaliar(ip, agora = Date.now()) {
  const limites = configuracao.escudo;
  const chave = chaveDoIp(ip);

  // 1) Contagem global por minuto → liga o modo de defesa sozinho
  if (agora - estado.minuto.inicio >= 60 * 1000) {
    estado.pedidosUltimoMinuto = estado.minuto.total;
    estado.minuto = { inicio: agora, total: 0 };
  }
  estado.minuto.total += 1;
  if (estado.minuto.total > limites.pedidosPorMinutoModoDefesa) ativarModoDefesa('volume de pedidos muito alto', agora);
  const defesa = modoDefesaAtivo(agora);

  const recusar = (status, motivo, tentarEmSegundos) => {
    estado.totais.recusados += 1;
    return { permitido: false, status, motivo, tentarEmSegundos };
  };

  // 2) IP bloqueado?
  const bloqueio = estado.bloqueados.get(chave);
  if (bloqueio) {
    if (bloqueio.ate > agora) return recusar(429, 'bloqueado', Math.ceil((bloqueio.ate - agora) / 1000));
    estado.bloqueados.delete(chave);
  }

  // 3) Balde de fichas (pedidos por segundo com rajada)
  const taxa = defesa ? limites.pedidosPorSegundoPorIp / 2 : limites.pedidosPorSegundoPorIp;
  const capacidade = defesa ? limites.rajadaPorIp / 2 : limites.rajadaPorIp;
  const balde = estado.baldes.get(chave) || { fichas: capacidade, atualizado: agora };
  balde.fichas = Math.min(capacidade, balde.fichas + ((agora - balde.atualizado) / 1000) * taxa);
  balde.atualizado = agora;
  if (balde.fichas < 1) {
    estado.baldes.set(chave, balde);
    registrarInfracao(chave, agora);
    return recusar(429, 'muitos-pedidos', Math.ceil((1 - balde.fichas) / taxa));
  }
  balde.fichas -= 1;
  estado.baldes.set(chave, balde);

  // 4) Pedidos simultâneos por IP e no total
  const doIp = estado.emAndamento.get(chave) || 0;
  if (doIp >= (defesa ? Math.ceil(limites.simultaneosPorIp / 2) : limites.simultaneosPorIp)) {
    registrarInfracao(chave, agora);
    return recusar(429, 'muitos-simultaneos', 2);
  }
  if (estado.totalEmAndamento >= limites.simultaneosTotal) {
    ativarModoDefesa('servidor sobrecarregado', agora);
    return recusar(503, 'sobrecarregado', 5);
  }

  estado.emAndamento.set(chave, doIp + 1);
  estado.totalEmAndamento += 1;
  protegerMemoria(agora);

  let liberado = false;
  return {
    permitido: true,
    liberar() {
      if (liberado) return;
      liberado = true;
      estado.totalEmAndamento = Math.max(0, estado.totalEmAndamento - 1);
      const atual = (estado.emAndamento.get(chave) || 1) - 1;
      if (atual <= 0) estado.emAndamento.delete(chave);
      else estado.emAndamento.set(chave, atual);
    },
  };
}

/** Limpeza periódica (de minuto em minuto). */
function limpar(agora = Date.now()) {
  for (const [chave, balde] of estado.baldes) if (agora - balde.atualizado > 5 * 60 * 1000) estado.baldes.delete(chave);
  for (const [chave, registro] of estado.infracoes) if (agora - registro.inicio > JANELA_INFRACOES_MS) estado.infracoes.delete(chave);
  for (const [chave, bloqueio] of estado.bloqueados) if (bloqueio.ate < agora) estado.bloqueados.delete(chave);
}

/** Resumo para o painel do dono. */
function situacao(agora = Date.now()) {
  const minutoAtualConta = agora - estado.minuto.inicio < 60 * 1000;
  return {
    modoDefesa: modoDefesaAtivo(agora),
    modoManual: estado.modoManual,
    modoDefesaAte: estado.modoDefesaAte > agora ? new Date(estado.modoDefesaAte).toISOString() : null,
    pedidosPorMinuto: Math.max(estado.pedidosUltimoMinuto, minutoAtualConta ? estado.minuto.total : 0),
    pedidosEmAndamento: estado.totalEmAndamento,
    ipsBloqueados: [...estado.bloqueados.values()].filter((bloqueio) => bloqueio.ate > agora).length,
    totalRecusados: estado.totais.recusados,
    totalBloqueios: estado.totais.bloqueios,
    limites: configuracao.escudo,
  };
}

/** Dono liga/desliga na mão: 'ligado' | 'desligado' | null (automático). */
function definirModoManual(valor) {
  estado.modoManual = valor === 'ligado' || valor === 'desligado' ? valor : null;
}

/** Desbloqueia todos (botão de emergência do dono). */
function desbloquearTodos() {
  estado.bloqueados.clear();
  estado.infracoes.clear();
  estado.historicoBloqueios.clear();
  estado.baldes.clear();
}

function aoAtivarModoDefesa(funcao) {
  estado.aoAtivarModoDefesa = funcao;
}

function iniciarLimpezaPeriodica() {
  const temporizador = setInterval(() => limpar(), 60 * 1000);
  temporizador.unref();
}

module.exports = { avaliar, chaveDoIp, modoDefesaAtivo, situacao, definirModoManual, desbloquearTodos, aoAtivarModoDefesa, iniciarLimpezaPeriodica, ativarModoDefesa, _estado: estado };
