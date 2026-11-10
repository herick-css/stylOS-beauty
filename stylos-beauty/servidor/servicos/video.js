/**
 * video.js — OTIMIZAÇÃO DE VÍDEOS com o FFmpeg (no próprio computador)
 * ------------------------------------------------------------------
 * A mesma receita usada no vídeo do site da Fernanda, só que automática:
 *
 *   vídeo enviado (ex.: 48 MB do celular, 4K, HEVC/HDR)
 *     → versão COMPUTADOR: H.264, até 1080p, CRF 21  (ex.: ~8 MB)
 *     → versão CELULAR:    H.264, até 720p,  CRF 23  (ex.: ~4 MB)
 *     → CAPA (pôster) em JPG, que aparece na hora enquanto o vídeo carrega
 *
 * "Sem perder qualidade": CRF 21 é visualmente igual ao original numa tela
 * comum. O que some é "desperdício" (bitrate alto demais do celular, 4K que
 * ninguém vê numa página, 60 quadros desnecessários...). E se o resultado
 * ficasse MAIOR que o original (vídeo que já veio otimizado), o sistema
 * guarda o original só reorganizado, sem recomprimir.
 *
 * Carrega mais rápido também porque:
 *  - "faststart": o índice do vídeo vai para o começo do arquivo, então ele
 *    começa a tocar antes de baixar inteiro;
 *  - o celular baixa a versão de 720p;
 *  - a página só toca o vídeo quando ele aparece na tela.
 *
 * SEGURANÇA (o FFmpeg lê arquivos enviados por pessoas):
 *  - aceita só MP4/MOV, WEBM/MKV e AVI, conferindo os primeiros bytes;
 *  - o ffprobe confirma o formato; o FFmpeg é chamado com o formato FORÇADO
 *    e "-protocol_whitelist file" (impede que um arquivo disfarçado de
 *    vídeo faça o FFmpeg ler outros arquivos do computador ou acessar a internet);
 *  - limite de tamanho, duração e resolução; tempo-limite; prioridade baixa
 *    (o notebook continua respondendo as páginas enquanto otimiza).
 */
'use strict';

const { execFile, spawn } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');
const { configuracao } = require('../configuracao');
const { abrirBanco } = require('../banco');

const PASTA_VIDEOS = () => path.join(configuracao.pastaUploads, 'videos');
const pastaDoVideo = (id) => path.join(PASTA_VIDEOS(), id);
const PADRAO_ID = /^[a-f0-9]{32}$/;
const TEMPO_LIMITE_MS = 45 * 60 * 1000;

// Formatos aceitos: nome do "demuxer" do FFmpeg que será FORÇADO na leitura
const FORMATOS = {
  mov: 'mov',        // MP4, MOV, M4V, 3GP (iPhone e Android)
  matroska: 'matroska', // WEBM e MKV
  avi: 'avi',
};

let ferramentas = null; // { ffmpeg, ffprobe, zscale, versao } ou { indisponivel: motivo }

// ------------------------------------------------------------------
// Encontrar o FFmpeg
// ------------------------------------------------------------------
function rodar(programa, argumentos, opcoes = {}) {
  return new Promise((resolver) => {
    execFile(programa, argumentos, { timeout: opcoes.tempo || 15000, windowsHide: true, maxBuffer: 8 * 1024 * 1024 }, (erro, saida, saidaErro) => {
      resolver({ erro, saida: String(saida || ''), saidaErro: String(saidaErro || '') });
    });
  });
}

function candidatos(nome, configurado) {
  const lista = [];
  if (configurado) lista.push(configurado);
  lista.push(nome);
  const exe = process.platform === 'win32' ? `${nome}.exe` : nome;
  if (process.env.LOCALAPPDATA) lista.push(path.join(process.env.LOCALAPPDATA, 'Microsoft', 'WinGet', 'Links', exe)); // instalado pelo winget
  lista.push(path.join('C:\\ffmpeg\\bin', exe), path.join('/usr/local/bin', nome), path.join('/opt/homebrew/bin', nome));
  return lista;
}

/** Procura ffmpeg/ffprobe (uma vez; o painel pode pedir para procurar de novo). */
async function detectarFerramentas(forcar = false) {
  if (ferramentas && !forcar) return ferramentas;
  let ffmpeg = null;
  let ffprobe = null;
  for (const caminho of candidatos('ffmpeg', configuracao.ffmpegCaminho)) {
    const r = await rodar(caminho, ['-hide_banner', '-version']);
    if (!r.erro && /ffmpeg version/i.test(r.saida)) { ffmpeg = caminho; break; }
  }
  for (const caminho of candidatos('ffprobe', configuracao.ffprobeCaminho)) {
    const r = await rodar(caminho, ['-hide_banner', '-version']);
    if (!r.erro && /ffprobe version/i.test(r.saida)) { ffprobe = caminho; break; }
  }
  if (!ffmpeg || !ffprobe) {
    ferramentas = { indisponivel: 'FFmpeg não encontrado neste computador. Rode o INSTALAR-WINDOWS.bat e aceite instalar o FFmpeg (necessário para vídeos).' };
    return ferramentas;
  }
  const [versao, filtros, codificadores] = await Promise.all([
    rodar(ffmpeg, ['-hide_banner', '-version']),
    rodar(ffmpeg, ['-hide_banner', '-filters']),
    rodar(ffmpeg, ['-hide_banner', '-encoders']),
  ]);
  if (!/libx264/.test(codificadores.saida)) {
    ferramentas = { indisponivel: 'O FFmpeg instalado não tem o codificador H.264 (libx264). Instale a versão "full" (winget install Gyan.FFmpeg).' };
    return ferramentas;
  }
  ferramentas = {
    ffmpeg,
    ffprobe,
    zscale: /\bzscale\b/.test(filtros.saida) && /\btonemap\b/.test(filtros.saida), // para vídeos HDR do iPhone
    versao: (versao.saida.match(/ffmpeg version (\S+)/) || [])[1] || '?',
  };
  return ferramentas;
}

function situacaoFerramentas() {
  if (!ferramentas) return { disponivel: false, mensagem: 'Verificando o FFmpeg...' };
  if (ferramentas.indisponivel) return { disponivel: false, mensagem: ferramentas.indisponivel };
  return { disponivel: true, mensagem: `FFmpeg ${ferramentas.versao} pronto${ferramentas.zscale ? ' (com conversão de HDR)' : ''}.`, versao: ferramentas.versao };
}

// ------------------------------------------------------------------
// Conferências do arquivo enviado
// ------------------------------------------------------------------
/** Tipo pelo começo do arquivo (assinatura). Devolve 'mov' | 'matroska' | 'avi' | null. */
function detectarFormatoPelosBytes(caminho) {
  const descritor = fs.openSync(caminho, 'r');
  const inicio = Buffer.alloc(16);
  try {
    fs.readSync(descritor, inicio, 0, 16, 0);
  } finally {
    fs.closeSync(descritor);
  }
  const caixa = inicio.subarray(4, 8).toString('latin1');
  if (['ftyp', 'moov', 'mdat', 'wide', 'free', 'skip'].includes(caixa)) return 'mov';
  if (inicio[0] === 0x1a && inicio[1] === 0x45 && inicio[2] === 0xdf && inicio[3] === 0xa3) return 'matroska';
  if (inicio.subarray(0, 4).toString('latin1') === 'RIFF' && inicio.subarray(8, 12).toString('latin1') === 'AVI ') return 'avi';
  return null;
}

/** Lê as informações do vídeo com o ffprobe (formato forçado, só arquivo local). */
async function analisar(caminho, formato) {
  const { ffprobe } = await detectarFerramentas();
  const r = await rodar(ffprobe, [
    '-v', 'error', '-protocol_whitelist', 'file', '-f', FORMATOS[formato],
    '-show_entries', 'format=format_name,duration:stream=index,codec_type,codec_name,width,height,pix_fmt,color_transfer,color_primaries:stream_tags=rotate:stream_side_data=rotation',
    '-of', 'json', caminho,
  ], { tempo: 30000 });
  if (r.erro) throw new Error('Não foi possível ler este arquivo como vídeo. Ele pode estar corrompido.');
  const dados = JSON.parse(r.saida || '{}');
  const video = (dados.streams || []).find((stream) => stream.codec_type === 'video' && stream.width > 0);
  if (!video) throw new Error('O arquivo não tem imagem de vídeo.');
  const duracao = Number(dados.format && dados.format.duration);
  if (!Number.isFinite(duracao) || duracao <= 0) throw new Error('Não foi possível descobrir a duração do vídeo.');
  if (duracao > configuracao.videoDuracaoMaximaSeg) {
    throw new Error(`Vídeo muito longo: no máximo ${Math.round(configuracao.videoDuracaoMaximaSeg / 60)} minutos.`);
  }
  if (video.width > 8192 || video.height > 8192) throw new Error('Resolução grande demais.');
  // Celular gravando "em pé" guarda o vídeo deitado + uma marca de rotação
  const rotacao = Math.abs(Number((video.tags && video.tags.rotate) || ((video.side_data_list || []).find((item) => item.rotation !== undefined) || {}).rotation || 0));
  const deitado = rotacao === 90 || rotacao === 270;
  return {
    duracao,
    largura: deitado ? video.height : video.width,
    altura: deitado ? video.width : video.height,
    codec: video.codec_name,
    pixFmt: video.pix_fmt,
    hdr: ['smpte2084', 'arib-std-b67'].includes(video.color_transfer),
    temAudio: (dados.streams || []).some((stream) => stream.codec_type === 'audio'),
    formatoMp4: /mov|mp4/.test(String(dados.format && dados.format.format_name)),
  };
}

// ------------------------------------------------------------------
// Fila: um vídeo por vez (o notebook não pode travar)
// ------------------------------------------------------------------
const fila = [];
let processandoAgora = null;

function atualizar(id, campos) {
  const chaves = Object.keys(campos);
  abrirBanco()
    .prepare(`UPDATE videos SET ${chaves.map((chave) => `${chave} = ?`).join(', ')}, atualizado_em = strftime('%Y-%m-%dT%H:%M:%fZ', 'now') WHERE id = ?`)
    .run(...chaves.map((chave) => campos[chave]), id);
}

/** Coloca um vídeo (já recebido inteiro) na fila de otimização. */
function enfileirar(id) {
  if (!PADRAO_ID.test(id) || fila.includes(id) || processandoAgora === id) return;
  atualizar(id, { status: 'na_fila', progresso: 0, mensagem: null });
  fila.push(id);
  setImmediate(proximo);
}

function posicaoNaFila(id) {
  const indice = fila.indexOf(id);
  return indice === -1 ? 0 : indice + 1;
}

async function proximo() {
  if (processandoAgora || !fila.length) return;
  processandoAgora = fila.shift();
  const id = processandoAgora;
  try {
    await otimizar(id);
  } catch (erro) {
    console.warn(`[vídeo ${id}] falhou:`, erro.message);
    atualizar(id, { status: 'erro', mensagem: String(erro.message || 'Falha ao otimizar o vídeo.').slice(0, 300) });
  } finally {
    processandoAgora = null;
    setImmediate(proximo);
  }
}

/** Depois de reiniciar o computador: retoma o que estava na fila. */
function retomarPendentes() {
  const pendentes = abrirBanco().prepare("SELECT id FROM videos WHERE status IN ('na_fila', 'processando') ORDER BY criado_em").all();
  for (const { id } of pendentes) {
    if (fs.existsSync(path.join(pastaDoVideo(id), 'original.bin'))) enfileirar(id);
    else atualizar(id, { status: 'erro', mensagem: 'O arquivo original se perdeu. Envie o vídeo de novo.' });
  }
}

// ------------------------------------------------------------------
// A otimização em si
// ------------------------------------------------------------------
/** Filtro de redimensionamento: lado maior até "limite" px, sem aumentar, medidas pares. */
function filtroEscala(limite) {
  return `scale=w='if(gte(iw,ih),2*trunc(min(${limite},iw)/2),-2)':h='if(gte(iw,ih),-2,2*trunc(min(${limite},ih)/2))':flags=lanczos,setsar=1,format=yuv420p`;
}

/** Roda o FFmpeg acompanhando o progresso (0-100). */
function executarFfmpeg(argumentos, duracao, aoProgredir) {
  return new Promise((resolver, rejeitar) => {
    const processo = spawn(ferramentas.ffmpeg, argumentos, { windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
    try { os.setPriority(processo.pid, 10); } catch { /* sem permissão: segue normal */ }
    let erroTexto = '';
    let restoSaida = '';
    const limite = setTimeout(() => processo.kill('SIGKILL'), TEMPO_LIMITE_MS);
    processo.stdout.on('data', (pedaco) => {
      restoSaida += pedaco.toString();
      const linhas = restoSaida.split('\n');
      restoSaida = linhas.pop();
      for (const linha of linhas) {
        const tempo = linha.match(/^out_time_us=(\d+)/);
        if (tempo && duracao > 0 && aoProgredir) aoProgredir(Math.min(99, Math.floor((Number(tempo[1]) / 1e6 / duracao) * 100)));
      }
    });
    processo.stderr.on('data', (pedaco) => { erroTexto = (erroTexto + pedaco.toString()).slice(-4000); });
    processo.on('error', (erro) => { clearTimeout(limite); rejeitar(erro); });
    processo.on('close', (codigo) => {
      clearTimeout(limite);
      if (codigo === 0) resolver();
      else rejeitar(new Error(`O FFmpeg não conseguiu otimizar este vídeo.${erroTexto ? ` (${erroTexto.trim().split('\n').pop().slice(0, 160)})` : ''}`));
    });
  });
}

async function otimizar(id) {
  const ferramentasOk = await detectarFerramentas();
  if (ferramentasOk.indisponivel) throw new Error(ferramentasOk.indisponivel);
  const pasta = pastaDoVideo(id);
  const original = path.join(pasta, 'original.bin');
  const formato = detectarFormatoPelosBytes(original);
  if (!formato) throw new Error('Formato não aceito. Envie MP4, MOV, WEBM, MKV ou AVI.');
  const info = await analisar(original, formato);
  atualizar(id, { status: 'processando', progresso: 0, duracao: info.duracao, largura: info.largura, altura: info.altura, tem_audio: info.temAudio ? 1 : 0 });

  const threads = String(Math.max(1, os.cpus().length - 1)); // deixa um núcleo livre para o site
  // HDR (iPhone grava assim): converte as cores para as telas comuns, senão o vídeo fica "lavado"
  const filtroHdr = info.hdr && ferramentas.zscale
    ? 'zscale=t=linear:npl=100,format=gbrpf32le,zscale=p=bt709,tonemap=tonemap=hable:desat=0,zscale=t=bt709:m=bt709:r=tv,'
    : '';
  const filtros = `[0:v:0]${filtroHdr}split=2[a][b];[a]${filtroEscala(1920)}[v1080];[b]${filtroEscala(1280)}[v720]`;
  const comum = ['-c:v', 'libx264', '-preset', configuracao.videoPreset, '-profile:v', 'high', '-pix_fmt', 'yuv420p',
    '-fpsmax', '60', '-color_primaries', 'bt709', '-color_trc', 'bt709', '-colorspace', 'bt709', '-movflags', '+faststart', '-threads', threads];
  const audio = (kbps) => (info.temAudio ? ['-map', '0:a:0?', '-c:a', 'aac', '-b:a', `${kbps}k`, '-ac', '2'] : []);
  const temp1080 = path.join(pasta, '1080.tmp.mp4');
  const temp720 = path.join(pasta, '720.tmp.mp4');
  const tempCapa = path.join(pasta, 'poster.tmp.jpg');

  let ultimoProgresso = -5;
  await executarFfmpeg([
    '-hide_banner', '-nostdin', '-y', '-protocol_whitelist', 'file', '-f', FORMATOS[formato], '-i', original,
    '-filter_complex', filtros,
    '-map', '[v1080]', ...audio(128), ...comum, '-crf', String(configuracao.videoCrf), '-f', 'mp4', temp1080,
    '-map', '[v720]', ...audio(96), ...comum, '-crf', String(configuracao.videoCrf + 2), '-f', 'mp4', temp720,
    '-progress', 'pipe:1', '-nostats',
  ], info.duracao, (progresso) => {
    if (progresso - ultimoProgresso >= 3) {
      ultimoProgresso = progresso;
      atualizar(id, { progresso });
    }
  });

  // Nunca piorar: se o vídeo já vinha otimizado (H.264, até 1080p) e a nossa
  // versão ficou maior, usamos o ORIGINAL só reorganizado (sem recomprimir).
  const tamanhoOriginal = fs.statSync(original).size;
  if (fs.statSync(temp1080).size > tamanhoOriginal && info.codec === 'h264' && info.pixFmt === 'yuv420p' && !info.hdr
      && Math.max(info.largura, info.altura) <= 1920 && info.formatoMp4) {
    const remontado = path.join(pasta, '1080.copia.mp4');
    await executarFfmpeg(['-hide_banner', '-nostdin', '-y', '-protocol_whitelist', 'file', '-f', 'mov', '-i', original,
      '-map', '0:v:0', ...(info.temAudio ? ['-map', '0:a:0?', '-c:a', 'aac', '-b:a', '160k'] : []), '-c:v', 'copy', '-movflags', '+faststart', '-f', 'mp4', remontado], 0);
    if (fs.statSync(remontado).size < fs.statSync(temp1080).size) fs.renameSync(remontado, temp1080);
    else fs.unlinkSync(remontado);
  }

  // Capa: um quadro do começo (ou do meio, se o vídeo for curtinho)
  const instante = Math.min(1, info.duracao / 2).toFixed(2);
  await executarFfmpeg(['-hide_banner', '-nostdin', '-y', '-protocol_whitelist', 'file', '-ss', instante, '-i', temp1080,
    '-frames:v', '1', '-vf', filtroEscala(1280).replace(',format=yuv420p', ''), '-q:v', '3', '-f', 'image2', tempCapa], 0);

  // Só agora os arquivos "aparecem" com o nome final (nunca serve vídeo pela metade)
  fs.renameSync(temp720, path.join(pasta, '720.mp4'));
  fs.renameSync(tempCapa, path.join(pasta, 'poster.jpg'));
  fs.renameSync(temp1080, path.join(pasta, '1080.mp4'));
  fs.unlinkSync(original);
  atualizar(id, {
    status: 'pronto',
    progresso: 100,
    mensagem: null,
    tamanho_original: tamanhoOriginal,
    tamanho_final: fs.statSync(path.join(pasta, '1080.mp4')).size,
    tamanho_movel: fs.statSync(path.join(pasta, '720.mp4')).size,
  });
}

// ------------------------------------------------------------------
// Envio em pedaços (feito pelas rotas)
// ------------------------------------------------------------------
function novoId() {
  return crypto.randomBytes(16).toString('hex');
}

/** Cria a pasta e o registro de um envio novo. */
function iniciarEnvio(donoId, nomeOriginal, tamanho) {
  const id = novoId();
  fs.mkdirSync(pastaDoVideo(id), { recursive: true });
  fs.writeFileSync(path.join(pastaDoVideo(id), 'original.bin'), Buffer.alloc(0));
  abrirBanco()
    .prepare("INSERT INTO videos (id, dono_id, nome_original, status, tamanho_esperado) VALUES (?, ?, ?, 'enviando', ?)")
    .run(id, donoId, String(nomeOriginal || '').slice(0, 120), tamanho);
  return id;
}

/** Acrescenta um pedaço ao arquivo (na ordem). */
function acrescentarPedaco(id, dados) {
  fs.appendFileSync(path.join(pastaDoVideo(id), 'original.bin'), dados);
  abrirBanco().prepare('UPDATE videos SET tamanho_recebido = tamanho_recebido + ? WHERE id = ?').run(dados.length, id);
}

function apagarArquivos(id) {
  if (!PADRAO_ID.test(id)) return;
  fs.rmSync(pastaDoVideo(id), { recursive: true, force: true });
}

/** Limpa envios abandonados (mais de 24 h "enviando"). */
function limparEnviosAbandonados() {
  const abandonados = abrirBanco()
    .prepare("SELECT id FROM videos WHERE status = 'enviando' AND criado_em < strftime('%Y-%m-%dT%H:%M:%fZ', 'now', '-1 day')")
    .all();
  for (const { id } of abandonados) {
    apagarArquivos(id);
    abrirBanco().prepare('DELETE FROM videos WHERE id = ?').run(id);
  }
  return abandonados.length;
}

module.exports = {
  PADRAO_ID,
  pastaDoVideo,
  detectarFerramentas,
  situacaoFerramentas,
  detectarFormatoPelosBytes,
  analisar,
  enfileirar,
  posicaoNaFila,
  retomarPendentes,
  iniciarEnvio,
  acrescentarPedaco,
  apagarArquivos,
  limparEnviosAbandonados,
  FORMATOS,
};
