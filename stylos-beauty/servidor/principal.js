/**
 * principal.js  —  PONTO DE ENTRADA DO SERVIDOR
 * ------------------------------------------------------------------
 * Para rodar:   node servidor/principal.js     (ou dois cliques em INICIAR-STYLOS.bat)
 *
 * O que este arquivo faz:
 *   1. carrega configuração, segredo e banco;
 *   2. registra as rotas da API (/api/...);
 *   3. serve as telas (HTML/CSS/JS da pasta "publico") e as fotos enviadas;
 *   4. aplica segurança em TODO pedido (sessão, CSRF, limites, cabeçalhos);
 *   5. agenda backup diário e limpezas.
 */
'use strict';

const http = require('node:http');
const path = require('node:path');
const { configuracao, prepararPastasESegredo } = require('./configuracao');
const { abrirBanco, fecharBanco } = require('./banco');
const seguranca = require('./seguranca');
const { ErroHttp, responderJson, servirArquivo, Roteador } = require('./utilitarios');
const { agendarManutencao } = require('./servicos/manutencao');
const escudo = require('./servicos/escudo');
const antiRobo = require('./servicos/anti-robo');
const { registrarAuditoria } = require('./banco');

const rotasAutenticacao = require('./rotas/autenticacao');
const rotasDono = require('./rotas/dono');
const rotasPaginas = require('./rotas/paginas');
const rotasAgenda = require('./rotas/agenda');
const rotasArquivos = require('./rotas/arquivos');
const rotasProtecao = require('./rotas/protecao');
const rotasGoogleLogin = require('./rotas/google-login');
const rotasRecuperacao = require('./rotas/recuperacao-senha');
const rotasVideos = require('./rotas/videos');
const servicoVideo = require('./servicos/video');

// ------------------------------------------------------------------
// Rotas da API
// ------------------------------------------------------------------
const roteador = new Roteador();
rotasAutenticacao.registrar(roteador);
rotasDono.registrar(roteador);
rotasPaginas.registrar(roteador);
rotasAgenda.registrar(roteador);
rotasArquivos.registrar(roteador);
rotasProtecao.registrar(roteador);
rotasRecuperacao.registrar(roteador);
rotasGoogleLogin.registrar(roteador);
rotasVideos.registrar(roteador);

// O anti-robô fica mais difícil quando o escudo liga o modo de defesa
antiRobo.definirFonteModoDefesa(() => escudo.modoDefesaAtivo());
escudo.aoAtivarModoDefesa((motivo) => {
  console.warn(`[escudo] MODO DE DEFESA ligado: ${motivo}`);
  registrarAuditoria(null, 'modo-defesa-ativado', motivo, '');
});

/** Atende um pedido para /api/... */
async function tratarApi(requisicao, resposta, endereco, ip) {
  const sessao = seguranca.lerSessao(requisicao);
  const contexto = {
    requisicao,
    resposta,
    consulta: endereco.searchParams,
    parametros: {},
    ip,
    modoDefesa: escudo.modoDefesaAtivo(),
    sessao,
    usuario: sessao?.usuario || null,
    cabecalhosResposta: {},
  };

  try {
    if (!seguranca.limitador.permitir(`api:${contexto.ip}`, 300, 60 * 1000)) {
      throw new ErroHttp(429, 'Muitos pedidos seguidos. Aguarde um minuto.');
    }
    const encontrado = roteador.encontrar(requisicao.method, endereco.pathname);
    if (!encontrado) throw new ErroHttp(404, 'Endereço não encontrado.');
    if (encontrado.metodoNaoPermitido) throw new ErroHttp(405, 'Método não permitido.');
    const { rota, parametros } = encontrado;
    contexto.parametros = parametros;

    // Proteção CSRF em tudo que altera dados
    if (requisicao.method !== 'GET' && requisicao.method !== 'HEAD' && !seguranca.pedidoTemOrigemValida(requisicao)) {
      throw new ErroHttp(403, 'Pedido bloqueado por segurança. Recarregue a página e tente de novo.');
    }
    // Controle de acesso por papel
    if (!rota.opcoes.publica) {
      if (!contexto.usuario) throw new ErroHttp(401, 'Você precisa entrar na sua conta.');
      if (rota.opcoes.papeis && !rota.opcoes.papeis.includes(contexto.usuario.papel)) {
        throw new ErroHttp(403, 'Você não tem permissão para isso.');
      }
      if (contexto.usuario.deve_trocar_senha && !rota.opcoes.permitirTrocaPendente) {
        throw new ErroHttp(403, 'Troque a sua senha temporária antes de continuar.', { codigo: 'trocar-senha' });
      }
    }

    const resultado = await rota.manipulador(contexto);
    if (!resposta.writableEnded) responderJson(resposta, 200, resultado ?? { ok: true }, contexto.cabecalhosResposta);
  } catch (erro) {
    if (resposta.writableEnded) return;
    if (erro instanceof ErroHttp) {
      responderJson(resposta, erro.status, { erro: erro.message, ...(erro.detalhes || {}) }, contexto.cabecalhosResposta);
    } else {
      console.error('[erro interno]', requisicao.method, endereco.pathname, erro);
      responderJson(resposta, 500, { erro: 'Erro interno. Tente de novo; se continuar, avise o responsável.' });
    }
  }
}

// ------------------------------------------------------------------
// Telas (páginas HTML) e arquivos
// ------------------------------------------------------------------

/** Telas que exigem login: se não estiver logado, manda para /entrar. */
const TELAS = {
  '/': { arquivo: 'index.html' },
  '/entrar': { arquivo: 'entrar.html' },
  '/cadastro': { arquivo: 'entrar.html' },
  '/configuracao-inicial': { arquivo: 'configuracao-inicial.html' },
  '/painel': { arquivo: 'painel.html', papeis: ['adm', 'dono'] },
  '/editor': { arquivo: 'editor.html', papeis: ['adm', 'dono'] },
  '/minha-conta': { arquivo: 'minha-conta.html', papeis: ['usuario', 'adm', 'dono'] },
  '/redefinir-senha': { arquivo: 'redefinir-senha.html' },
  '/pre-visualizacao': { arquivo: 'pagina.html', papeis: ['adm', 'dono'] },
};

function redirecionar(resposta, destino) {
  resposta.writeHead(302, { Location: destino, 'Cache-Control': 'no-store' });
  resposta.end();
}

function enviarNaoEncontrado(requisicao, resposta) {
  resposta.statusCode = 404;
  const original = resposta.writeHead.bind(resposta);
  // servirArquivo chama writeHead(200); forçamos 404 mantendo os cabeçalhos
  resposta.writeHead = (status, ...resto) => original(404, ...resto);
  if (!servirArquivo(requisicao, resposta, configuracao.pastaPublica, '404.html', 'painel')) {
    original(404, { 'Content-Type': 'text/plain; charset=utf-8' });
    resposta.end('Página não encontrada');
  }
}

/**
 * MIGRAÇÃO DE ENDEREÇO (ex.: do Tailscale para um domínio próprio na Cloudflare).
 * Se o dono cadastrou um endereço público https que NÃO é do Tailscale, quem
 * chegar pelo endereço antigo (*.ts.net) é levado para o novo — assim os links
 * já divulgados continuam funcionando enquanto o Funnel estiver ligado.
 * (Redirecionamento temporário 302: se voltar atrás, os navegadores não "decoram".)
 */
function destinoDeMigracao(requisicao, endereco) {
  const hostPedido = String(requisicao.headers['x-forwarded-host'] || requisicao.headers.host || '').toLowerCase();
  if (!hostPedido.endsWith('.ts.net')) return null;
  const { lerConfiguracaoGlobal } = require('./banco');
  const novo = lerConfiguracaoGlobal('url_publica') || configuracao.urlPublica;
  if (!novo || !novo.startsWith('https://')) return null;
  try {
    const novoHost = new URL(novo).host.toLowerCase();
    if (novoHost.endsWith('.ts.net') || novoHost === hostPedido) return null;
  } catch {
    return null;
  }
  return `${novo}${endereco.pathname}${endereco.search}`;
}

function tratarTela(requisicao, resposta, endereco) {
  const caminho = endereco.pathname;

  const migracao = destinoDeMigracao(requisicao, endereco);
  if (migracao) {
    redirecionar(resposta, migracao);
    return;
  }

  // Fotos enviadas pelos ADMs
  const arquivoEnviado = caminho.match(/^\/arquivos\/([a-f0-9]{32}\.(?:webp|jpg|png))$/);
  if (arquivoEnviado) {
    if (!servirArquivo(requisicao, resposta, configuracao.pastaUploads, arquivoEnviado[1], 'arquivo', 31536000)) {
      enviarNaoEncontrado(requisicao, resposta);
    }
    return;
  }

  // Vídeos otimizados: /arquivos/videos/<id>/1080.mp4 | 720.mp4 | poster.jpg
  const arquivoDeVideo = caminho.match(/^\/arquivos\/videos\/([a-f0-9]{32})\/(1080\.mp4|720\.mp4|poster\.jpg)$/);
  if (arquivoDeVideo) {
    if (!servirArquivo(requisicao, resposta, servicoVideo.pastaDoVideo(arquivoDeVideo[1]), arquivoDeVideo[2], 'arquivo', 31536000)) {
      enviarNaoEncontrado(requisicao, resposta);
    }
    return;
  }

  // Página pública /p/<slug>
  if (/^\/p\/[a-z0-9-]{3,60}$/.test(caminho)) {
    servirArquivo(requisicao, resposta, configuracao.pastaPublica, 'pagina.html', 'pagina-publica');
    return;
  }

  // Telas do sistema
  const tela = TELAS[caminho] || TELAS[caminho.replace(/\/+$/, '')];
  if (tela) {
    if (tela.papeis) {
      const sessao = seguranca.lerSessao(requisicao);
      if (!sessao || !tela.papeis.includes(sessao.usuario.papel)) {
        redirecionar(resposta, `/entrar?voltar=${encodeURIComponent(caminho + endereco.search)}`);
        return;
      }
    }
    servirArquivo(requisicao, resposta, configuracao.pastaPublica, tela.arquivo, 'painel');
    return;
  }

  // CSS, JS e imagens
  if (/^\/(css|js|img)\/[A-Za-z0-9._/-]+$/.test(caminho) && !caminho.includes('..')) {
    if (servirArquivo(requisicao, resposta, configuracao.pastaPublica, caminho, 'painel')) return;
  }
  if (caminho === '/favicon.ico' || caminho === '/favicon.svg') {
    if (servirArquivo(requisicao, resposta, configuracao.pastaPublica, 'img/favicon.svg', 'painel', 86400)) return;
  }
  enviarNaoEncontrado(requisicao, resposta);
}

// ------------------------------------------------------------------
// Servidor HTTP
// ------------------------------------------------------------------

function criarServidor() {
  const servidor = http.createServer((requisicao, resposta) => {
    // 1º de tudo: o ESCUDO. Pedido recusado aqui custa quase nada ao computador.
    const ip = seguranca.ipDoCliente(requisicao);
    const avaliacao = escudo.avaliar(ip);
    if (!avaliacao.permitido) {
      resposta.writeHead(avaliacao.status, {
        'Content-Type': 'text/plain; charset=utf-8',
        'Retry-After': String(avaliacao.tentarEmSegundos),
        'Cache-Control': 'no-store',
        Connection: 'close',
      });
      resposta.end(avaliacao.status === 503 ? 'Sistema ocupado. Tente em alguns segundos.' : 'Muitos pedidos. Aguarde e tente de novo.');
      requisicao.resume();
      return;
    }
    resposta.on('close', avaliacao.liberar);

    let endereco;
    try {
      endereco = new URL(requisicao.url, 'http://localhost');
    } catch {
      resposta.writeHead(400);
      resposta.end();
      return;
    }
    if (endereco.pathname.startsWith('/api/')) {
      tratarApi(requisicao, resposta, endereco, ip);
      return;
    }
    if (requisicao.method !== 'GET' && requisicao.method !== 'HEAD') {
      resposta.writeHead(405, { Allow: 'GET, HEAD' });
      resposta.end();
      return;
    }
    // Login com Google: rotas de navegação (não são /api, o navegador vai e volta do Google)
    if (endereco.pathname === '/auth/google' || endereco.pathname === '/auth/google/retorno') {
      rotasGoogleLogin.tratar(requisicao, resposta, endereco, ip).catch((erro) => {
        console.error('[login google]', erro);
        if (!resposta.headersSent) redirecionar(resposta, '/entrar?erro=google');
      });
      return;
    }
    try {
      tratarTela(requisicao, resposta, endereco);
    } catch (erro) {
      console.error('[erro ao servir tela]', erro);
      if (!resposta.headersSent) resposta.writeHead(500);
      resposta.end();
    }
  });
  // Tempos-limite contra conexões "penduradas" (ataque slowloris)
  servidor.headersTimeout = 15 * 1000;
  servidor.requestTimeout = 60 * 1000;
  servidor.keepAliveTimeout = 5 * 1000;
  servidor.maxConnections = 1000;            // teto de conexões abertas ao mesmo tempo
  servidor.maxRequestsPerSocket = 200;
  return servidor;
}

function iniciar() {
  prepararPastasESegredo();
  abrirBanco();
  const codigoInicial = rotasAutenticacao.prepararConfiguracaoInicial();
  if (!configuracao.modoTeste) agendarManutencao();
  escudo.iniciarLimpezaPeriodica();

  const servidor = criarServidor();
  const verificacaoTailscale = require('./servicos/tailscale').iniciarVerificacaoPeriodica();
  // Vídeos: procura o FFmpeg e retoma otimizações interrompidas (ex.: o notebook desligou)
  servicoVideo.detectarFerramentas().then((ferramentas) => {
    if (ferramentas.indisponivel) console.log(`  [vídeos] ${ferramentas.indisponivel}`);
    servicoVideo.retomarPendentes();
  });
  servidor.listen(configuracao.porta, configuracao.host, async () => {
    await verificacaoTailscale; // para já mostrar o endereço público na tela
    const linha = '='.repeat(64);
    console.log(`\n${linha}\n  StylOS Beauty está LIGADO\n${linha}`);
    const portaReal = servidor.address().port;
    console.log(`  Neste computador:  http://localhost:${portaReal}`);
    const urlPublica = rotasAutenticacao.urlPublicaAtual();
    if (urlPublica) console.log(`  Na internet:       ${urlPublica}`);
    else console.log(`  Na internet:       (ainda não) ${require('./servicos/tailscale').situacao().dica}`);
    if (codigoInicial) {
      console.log(`\n  PRIMEIRA VEZ? Abra http://localhost:${portaReal}/configuracao-inicial`);
      console.log(`  e use o código:  ${codigoInicial}`);
    }
    console.log(`\n  Deixe esta janela aberta. Para desligar: feche-a ou aperte Ctrl+C.\n${linha}\n`);
  });

  const desligar = () => {
    console.log('\nDesligando com segurança...');
    servidor.close(() => {
      fecharBanco();
      process.exit(0);
    });
    setTimeout(() => process.exit(0), 3000).unref();
  };
  process.on('SIGINT', desligar);
  process.on('SIGTERM', desligar);
  return servidor;
}

if (require.main === module) {
  const [maior, menor] = process.versions.node.split('.').map(Number);
  if (maior < 22 || (maior === 22 && menor < 13)) {
    console.error(`\nO StylOS precisa do Node.js 22.13 ou mais novo (você tem ${process.versions.node}).\nInstale a versão LTS em https://nodejs.org e rode de novo.\n`);
    process.exit(1);
  }
  iniciar();
}

module.exports = { criarServidor, iniciar, roteador, pastaRaiz: path.resolve(__dirname, '..') };
