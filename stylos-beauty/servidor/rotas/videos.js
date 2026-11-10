/**
 * rotas/videos.js — envio de VÍDEOS pelos ADMs (em pedaços) e acompanhamento
 * ------------------------------------------------------------------
 * Por que em pedaços de 4 MB?
 *  - vídeo de celular é grande (50–300 MB) e a internet pode oscilar:
 *    se um pedaço falhar, o navegador manda só ele de novo;
 *  - túneis têm limite por pedido (a Cloudflare grátis recusa > 100 MB);
 *  - o servidor nunca segura o vídeo inteiro na memória.
 *
 * Fluxo:
 *   POST /api/adm/videos                    { nome, tamanho } → { id, tamanhoPedaco }
 *   PUT  /api/adm/videos/:id/pedaco?inicio=N   (bytes do pedaço)
 *   POST /api/adm/videos/:id/concluir       → confere e coloca na fila de otimização
 *   GET  /api/adm/videos/:id                → situação (na fila, otimizando 45%, pronto...)
 *   GET  /api/adm/videos                    → meus vídeos
 *   DELETE /api/adm/videos/:id
 */
'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { abrirBanco, registrarAuditoria } = require('../banco');
const { configuracao } = require('../configuracao');
const seguranca = require('../seguranca');
const video = require('../servicos/video');
const { ErroHttp, lerCorpoJson, lerCorpoBruto, textoLimpo } = require('../utilitarios');

const ADM_OU_DONO = { papeis: ['adm', 'dono'] };

function videoDoUsuario(id, usuarioId) {
  if (!video.PADRAO_ID.test(String(id))) throw new ErroHttp(404, 'Vídeo não encontrado.');
  const linha = abrirBanco().prepare('SELECT * FROM videos WHERE id = ? AND dono_id = ?').get(id, usuarioId);
  if (!linha) throw new ErroHttp(404, 'Vídeo não encontrado.');
  return linha;
}

/** Formato enviado ao navegador. */
function resumoDoVideo(linha) {
  return {
    id: linha.id,
    url: `/arquivos/videos/${linha.id}`,
    nome: linha.nome_original || '',
    status: linha.status,
    progresso: linha.progresso,
    posicaoNaFila: linha.status === 'na_fila' ? video.posicaoNaFila(linha.id) : 0,
    mensagem: linha.mensagem || '',
    enviado: linha.tamanho_recebido,
    tamanhoEsperado: linha.tamanho_esperado,
    tamanhoOriginal: linha.tamanho_original,
    tamanhoFinal: linha.tamanho_final,
    tamanhoMovel: linha.tamanho_movel,
    duracao: linha.duracao,
    largura: linha.largura,
    altura: linha.altura,
    temAudio: Boolean(linha.tem_audio),
    criadoEm: linha.criado_em,
  };
}

function videoEmUso(usuarioId, id) {
  const marcador = `/arquivos/videos/${id}`;
  return Boolean(abrirBanco()
    .prepare("SELECT 1 FROM paginas WHERE dono_id = ? AND (instr(conteudo_rascunho, ?) > 0 OR instr(COALESCE(conteudo_publicado, ''), ?) > 0) LIMIT 1")
    .get(usuarioId, marcador, marcador));
}

function registrar(roteador) {
  // ---------------- Começar um envio ----------------
  roteador.post('/api/adm/videos', async (contexto) => {
    const ferramentas = await video.detectarFerramentas();
    if (ferramentas.indisponivel) throw new ErroHttp(503, ferramentas.indisponivel);
    if (!seguranca.limitador.permitir(`video-novo:${contexto.usuario.id}`, 20, 60 * 60 * 1000)) {
      throw new ErroHttp(429, 'Muitos vídeos em pouco tempo. Aguarde um pouco.');
    }
    const corpo = await lerCorpoJson(contexto.requisicao);
    const tamanho = Math.round(Number(corpo.tamanho));
    const maximo = configuracao.videoTamanhoMaximoMb * 1024 * 1024;
    if (!Number.isFinite(tamanho) || tamanho < 1024) throw new ErroHttp(400, 'Arquivo de vídeo inválido.');
    if (tamanho > maximo) throw new ErroHttp(413, `Vídeo grande demais: o limite é ${configuracao.videoTamanhoMaximoMb} MB.`);
    const banco = abrirBanco();
    const total = banco.prepare("SELECT COUNT(*) AS total FROM videos WHERE dono_id = ? AND status <> 'erro'").get(contexto.usuario.id).total;
    if (total >= configuracao.videoMaximoPorAdm) {
      throw new ErroHttp(400, `Limite de ${configuracao.videoMaximoPorAdm} vídeos atingido. Apague vídeos que não usa mais.`);
    }
    // Espaço no disco: pede o dobro do vídeo livre (original + versões otimizadas)
    try {
      const disco = fs.statfsSync(configuracao.pastaUploads);
      if (disco.bavail * disco.bsize < tamanho * 2 + 500 * 1024 * 1024) throw new ErroHttp(507, 'Pouco espaço livre no computador do servidor para este vídeo.');
    } catch (erro) {
      if (erro instanceof ErroHttp) throw erro;
    }
    const id = video.iniciarEnvio(contexto.usuario.id, textoLimpo(corpo.nome, 120), tamanho);
    return { id, tamanhoPedaco: configuracao.videoTamanhoPedaco };
  }, ADM_OU_DONO);

  // ---------------- Receber um pedaço ----------------
  roteador.put('/api/adm/videos/:id/pedaco', async (contexto) => {
    const linha = videoDoUsuario(contexto.parametros.id, contexto.usuario.id);
    if (linha.status !== 'enviando') throw new ErroHttp(409, 'Este envio já foi concluído.');
    const inicio = Number(contexto.consulta.get('inicio'));
    if (!Number.isInteger(inicio) || inicio < 0) throw new ErroHttp(400, 'Pedaço inválido.');
    const dados = await lerCorpoBruto(contexto.requisicao, configuracao.videoTamanhoPedaco);
    if (!dados.length) throw new ErroHttp(400, 'Pedaço vazio.');
    // O navegador reenviou um pedaço que já tinha chegado (internet oscilou): só confirma
    if (inicio + dados.length <= linha.tamanho_recebido) return { recebido: linha.tamanho_recebido };
    if (inicio !== linha.tamanho_recebido) throw new ErroHttp(409, 'Pedaço fora de ordem.', { recebido: linha.tamanho_recebido });
    if (inicio + dados.length > linha.tamanho_esperado) throw new ErroHttp(400, 'O arquivo ficou maior que o informado.');
    video.acrescentarPedaco(linha.id, dados);
    return { recebido: inicio + dados.length };
  }, ADM_OU_DONO);

  // ---------------- Terminar o envio → fila de otimização ----------------
  roteador.post('/api/adm/videos/:id/concluir', async (contexto) => {
    const linha = videoDoUsuario(contexto.parametros.id, contexto.usuario.id);
    if (linha.status !== 'enviando') return resumoDoVideo(linha);
    if (linha.tamanho_recebido !== linha.tamanho_esperado) throw new ErroHttp(400, 'O envio está incompleto. Tente de novo.');
    const original = path.join(video.pastaDoVideo(linha.id), 'original.bin');
    const formato = video.detectarFormatoPelosBytes(original);
    if (!formato) {
      video.apagarArquivos(linha.id);
      abrirBanco().prepare('DELETE FROM videos WHERE id = ?').run(linha.id);
      throw new ErroHttp(415, 'Formato não aceito. Envie um vídeo MP4, MOV, WEBM, MKV ou AVI.');
    }
    try {
      await video.analisar(original, formato); // confere ANTES de entrar na fila (resposta rápida)
    } catch (erro) {
      video.apagarArquivos(linha.id);
      abrirBanco().prepare('DELETE FROM videos WHERE id = ?').run(linha.id);
      throw new ErroHttp(400, erro.message);
    }
    video.enfileirar(linha.id);
    registrarAuditoria(contexto.usuario.id, 'video-enviado', `${linha.nome_original || linha.id} (${Math.round(linha.tamanho_esperado / 1048576)} MB)`, contexto.ip);
    return resumoDoVideo(abrirBanco().prepare('SELECT * FROM videos WHERE id = ?').get(linha.id));
  }, ADM_OU_DONO);

  // ---------------- Situação ----------------
  roteador.get('/api/adm/videos/:id', async (contexto) => resumoDoVideo(videoDoUsuario(contexto.parametros.id, contexto.usuario.id)), ADM_OU_DONO);

  roteador.get('/api/adm/videos', async (contexto) => {
    await video.detectarFerramentas();
    const linhas = abrirBanco()
      .prepare("SELECT * FROM videos WHERE dono_id = ? AND status <> 'enviando' ORDER BY criado_em DESC")
      .all(contexto.usuario.id);
    return {
      ...video.situacaoFerramentas(),
      tamanhoMaximoMb: configuracao.videoTamanhoMaximoMb,
      duracaoMaximaSeg: configuracao.videoDuracaoMaximaSeg,
      videos: linhas.map(resumoDoVideo),
    };
  }, ADM_OU_DONO);

  // ---------------- Apagar ----------------
  roteador.delete('/api/adm/videos/:id', async (contexto) => {
    const linha = videoDoUsuario(contexto.parametros.id, contexto.usuario.id);
    if (linha.status === 'processando') throw new ErroHttp(409, 'Este vídeo está sendo otimizado agora. Aguarde terminar para apagar.');
    if (videoEmUso(contexto.usuario.id, linha.id)) throw new ErroHttp(409, 'Este vídeo está sendo usado em uma das suas páginas. Troque-o lá antes de apagar.');
    video.apagarArquivos(linha.id);
    abrirBanco().prepare('DELETE FROM videos WHERE id = ?').run(linha.id);
    return { ok: true };
  }, ADM_OU_DONO);

  // ---------------- Dono: procurar o FFmpeg de novo (depois de instalar) ----------------
  roteador.post('/api/dono/videos/verificar', async () => {
    await video.detectarFerramentas(true);
    return video.situacaoFerramentas();
  }, { papeis: ['dono'] });
}

/**
 * Usado ao PUBLICAR: todos os vídeos da página precisam estar prontos e ser do
 * próprio ADM. Devolve uma lista de erros no formato das boas práticas.
 */
function errosDeVideosNaPagina(conteudo, usuarioId) {
  const ids = [...new Set((JSON.stringify(conteudo).match(/\/arquivos\/videos\/[a-f0-9]{32}/g) || []).map((url) => url.split('/').pop()))];
  const erros = [];
  for (const id of ids) {
    const linha = abrirBanco().prepare('SELECT status, progresso, dono_id, nome_original FROM videos WHERE id = ?').get(id);
    const secao = conteudo.secoes.find((item) => JSON.stringify(item.dados).includes(id));
    const secaoId = secao ? secao.id : null;
    if (!linha || linha.dono_id !== usuarioId) {
      erros.push({ secaoId, campo: null, mensagem: 'Há um vídeo que não existe mais ou não é seu. Escolha outro.' });
    } else if (linha.status === 'erro') {
      erros.push({ secaoId, campo: null, mensagem: `O vídeo "${linha.nome_original || 'enviado'}" deu erro ao otimizar. Envie de novo ou escolha outro.` });
    } else if (linha.status !== 'pronto') {
      erros.push({ secaoId, campo: null, mensagem: `O vídeo "${linha.nome_original || 'enviado'}" ainda está sendo otimizado (${linha.progresso}%). Aguarde alguns minutos e publique de novo.` });
    }
  }
  return erros;
}

module.exports = { registrar, errosDeVideosNaPagina };
