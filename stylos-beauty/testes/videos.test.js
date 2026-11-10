/**
 * Testes dos VÍDEOS: envio em pedaços, otimização real com o FFmpeg,
 * qualidade (SSIM), "faststart", Range (iPhone), segurança e publicação.
 * Precisa do FFmpeg instalado (se não houver, os testes são pulados).
 * Rode com: npm run testar
 */
'use strict';
const { describe, test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync, spawnSync } = require('node:child_process');
const { iniciarServidor, pararServidor, Cliente } = require('./apoio');

let temFfmpeg = true;
try { execFileSync('ffmpeg', ['-version'], { stdio: 'ignore' }); } catch { temFfmpeg = false; }

const pastaTemp = fs.mkdtempSync(path.join(os.tmpdir(), 'videos-teste-'));
const gerar = (nome, argumentos) => {
  const destino = path.join(pastaTemp, nome);
  execFileSync('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-y', ...argumentos, destino]);
  return destino;
};
const sondar = (arquivo, campos) => JSON.parse(execFileSync('ffprobe', ['-v', 'error', '-show_entries', campos, '-of', 'json', arquivo]).toString());

let servidor;
let adm1;
let adm2;
let videos;

/** Envia um arquivo pela API em pedaços e espera ficar pronto (ou dar erro). */
async function enviarEOtimizar(cliente, arquivo, { esperar = true } = {}) {
  const dados = fs.readFileSync(arquivo);
  const inicio = await cliente.post('/api/adm/videos', { nome: path.basename(arquivo), tamanho: dados.length });
  assert.equal(inicio.status, 200, JSON.stringify(inicio.dados));
  const { id, tamanhoPedaco } = inicio.dados;
  for (let posicao = 0; posicao < dados.length; posicao += tamanhoPedaco) {
    const r = await cliente.pedir('PUT', `/api/adm/videos/${id}/pedaco?inicio=${posicao}`, undefined, { binario: dados.subarray(posicao, posicao + tamanhoPedaco) });
    assert.equal(r.status, 200, JSON.stringify(r.dados));
  }
  const concluido = await cliente.post(`/api/adm/videos/${id}/concluir`, {});
  if (concluido.status !== 200 || !esperar) return concluido;
  let situacao = concluido.dados;
  const limite = Date.now() + 120000;
  while (!['pronto', 'erro'].includes(situacao.status) && Date.now() < limite) {
    await new Promise((resolver) => setTimeout(resolver, 400));
    situacao = (await cliente.get(`/api/adm/videos/${id}`)).dados;
  }
  return { status: 200, dados: situacao };
}

before(async () => {
  if (!temFfmpeg) return;
  // Vídeos de teste gerados na hora (sem internet)
  videos = {
    celular4k: gerar('celular-4k.mp4', ['-f', 'lavfi', '-i', 'testsrc2=size=2160x3840:rate=30:duration=3', '-f', 'lavfi', '-i', 'sine=frequency=440:duration=3',
      '-c:v', 'libx264', '-preset', 'ultrafast', '-crf', '8', '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-shortest']),
    jaOtimizado: gerar('ja-otimizado.mp4', ['-f', 'lavfi', '-i', 'testsrc2=size=640x360:rate=24:duration=3', '-c:v', 'libx264', '-preset', 'veryslow', '-crf', '35', '-pix_fmt', 'yuv420p', '-an']),
    hdr: gerar('iphone-hdr.mov', ['-f', 'lavfi', '-i', 'testsrc2=size=1280x720:rate=30:duration=2', '-c:v', 'libx264', '-preset', 'ultrafast', '-pix_fmt', 'yuv420p10le',
      '-color_primaries', 'bt2020', '-color_trc', 'arib-std-b67', '-colorspace', 'bt2020nc']),
    webm: gerar('tela.webm', ['-f', 'lavfi', '-i', 'testsrc2=size=1280x720:rate=25:duration=2', '-c:v', 'libvpx-vp9', '-deadline', 'realtime', '-b:v', '1M']),
    longo: gerar('longo.mp4', ['-f', 'lavfi', '-i', 'color=c=pink:size=320x240:rate=10:duration=25', '-c:v', 'libx264', '-preset', 'ultrafast', '-pix_fmt', 'yuv420p']),
  };
  fs.writeFileSync(path.join(pastaTemp, 'falso.mp4'), `${'isto não é um vídeo '.repeat(200)}`);
  fs.writeFileSync(path.join(pastaTemp, 'playlist.mp4'), `#EXTM3U\n#EXT-X-TARGETDURATION:10\n#EXTINF:10,\nfile:///etc/passwd\n${' '.repeat(2000)}`);

  servidor = await iniciarServidor({ VIDEO_TAMANHO_MAXIMO_MB: '200', VIDEO_DURACAO_MAXIMA_SEG: '20', VIDEO_PRESET: 'veryfast' });
  const dono = new Cliente(servidor.base);
  await dono.post('/api/configuracao-inicial', { codigo: servidor.codigoInicial, nome: 'Dono', email: 'dono@v.test', senha: 'DonoForte2026' });
  await dono.put('/api/adm/agenda', { whatsapp: '92999990000', googleAgendaId: '', fuso: 'America/Manaus', config: (await dono.get('/api/adm/agenda')).dados.config });
  adm1 = dono;
  const criado = await dono.post('/api/dono/adms', { nome: 'Bia', email: 'bia@v.test' });
  adm2 = new Cliente(servidor.base);
  await adm2.post('/api/entrar', { email: 'bia@v.test', senha: criado.dados.senhaTemporaria });
  await adm2.post('/api/trocar-senha', { senhaAtual: criado.dados.senhaTemporaria, novaSenha: 'BiaSenha2026' });
});

after(() => {
  if (servidor) pararServidor(servidor);
  fs.rmSync(pastaTemp, { recursive: true, force: true });
});

describe('vídeos', { skip: !temFfmpeg && 'FFmpeg não instalado' }, () => {
  let videoPronto;

  test('o sistema encontra o FFmpeg', async () => {
    const r = await adm1.get('/api/adm/videos');
    assert.equal(r.dados.disponivel, true, r.dados.mensagem);
  });

  test('vídeo 4K vertical de celular: vira 1080p + 720p, muito mais leve e com a mesma qualidade visual', async () => {
    const r = await enviarEOtimizar(adm1, videos.celular4k);
    assert.equal(r.dados.status, 'pronto', r.dados.mensagem);
    videoPronto = r.dados;
    const pasta = path.join(servidor.pasta, 'uploads', 'videos', r.dados.id);
    const v1080 = sondar(path.join(pasta, '1080.mp4'), 'stream=codec_name,width,height,pix_fmt:format=format_name');
    const imagem1080 = v1080.streams.find((s) => s.width);
    assert.deepEqual([imagem1080.codec_name, imagem1080.width, imagem1080.height, imagem1080.pix_fmt], ['h264', 1080, 1920, 'yuv420p']);
    assert.ok(v1080.streams.some((s) => s.codec_name === 'aac'), 'mantém o áudio');
    const v720 = sondar(path.join(pasta, '720.mp4'), 'stream=width,height').streams.find((s) => s.width);
    assert.deepEqual([v720.width, v720.height], [720, 1280]);
    assert.ok(fs.existsSync(path.join(pasta, 'poster.jpg')));
    assert.ok(!fs.existsSync(path.join(pasta, 'original.bin')), 'original apagado depois de otimizar');
    assert.ok(r.dados.tamanhoFinal < r.dados.tamanhoOriginal / 5, `ficou ${r.dados.tamanhoFinal} de ${r.dados.tamanhoOriginal}`);
  });

  test('qualidade medida (SSIM) fica acima de 0,98 — diferença invisível a olho nu', () => {
    // Compara o 1080p com o original reduzido para o mesmo tamanho
    const pasta = path.join(servidor.pasta, 'uploads', 'videos', videoPronto.id);
    const resultado = spawnSync('ffmpeg', ['-hide_banner', '-i', path.join(pasta, '1080.mp4'), '-i', videos.celular4k,
      '-lavfi', '[1:v]scale=1080:1920:flags=lanczos[ref];[0:v][ref]ssim', '-f', 'null', '-']);
    const relatorio = resultado.stderr.toString();
    const ssim = Number((relatorio.match(/All:([\d.]+)/) || [])[1]);
    assert.ok(ssim >= 0.98, `SSIM ${ssim}`);
  });

  test('"faststart": o índice vem antes dos dados (começa a tocar antes de baixar tudo)', () => {
    const dados = fs.readFileSync(path.join(servidor.pasta, 'uploads', 'videos', videoPronto.id, '1080.mp4'));
    const caixas = [];
    for (let i = 0; i < dados.length;) {
      let tamanho = dados.readUInt32BE(i);
      caixas.push(dados.subarray(i + 4, i + 8).toString('latin1'));
      if (tamanho === 1) tamanho = Number(dados.readBigUInt64BE(i + 8));
      i += tamanho;
    }
    assert.ok(caixas.indexOf('moov') < caixas.indexOf('mdat'), caixas.join(','));
  });

  test('servido com Range (necessário no iPhone) e cabeçalhos seguros', async () => {
    const r = await fetch(`${servidor.base}${videoPronto.url}/720.mp4`, { headers: { range: 'bytes=100-1099' } });
    assert.equal(r.status, 206);
    assert.equal((await r.arrayBuffer()).byteLength, 1000);
    assert.match(r.headers.get('content-range'), /^bytes 100-1099\/\d+$/);
    assert.equal(r.headers.get('content-type'), 'video/mp4');
    assert.match(r.headers.get('content-security-policy'), /sandbox/);
    const fora = await fetch(`${servidor.base}${videoPronto.url}/720.mp4`, { headers: { range: 'bytes=999999999-' } });
    assert.equal(fora.status, 416);
    const inteiro = await fetch(`${servidor.base}${videoPronto.url}/poster.jpg`);
    assert.equal(inteiro.status, 200);
    assert.equal(inteiro.headers.get('accept-ranges'), 'bytes');
    assert.equal((await fetch(`${servidor.base}/arquivos/videos/${videoPronto.id}/original.bin`)).status, 404);
    assert.equal((await fetch(`${servidor.base}/arquivos/videos/${videoPronto.id}/..%2F..%2Fstylos.sqlite`)).status, 404);
  });

  test('vídeo que já vinha leve: nunca fica maior que o original', async () => {
    const r = await enviarEOtimizar(adm1, videos.jaOtimizado);
    assert.equal(r.dados.status, 'pronto', r.dados.mensagem);
    assert.ok(r.dados.tamanhoFinal <= r.dados.tamanhoOriginal, `${r.dados.tamanhoFinal} > ${r.dados.tamanhoOriginal}`);
  });

  test('vídeo HDR (como os do iPhone) é convertido para cores comuns', async () => {
    const r = await enviarEOtimizar(adm1, videos.hdr);
    assert.equal(r.dados.status, 'pronto', r.dados.mensagem);
    const info = sondar(path.join(servidor.pasta, 'uploads', 'videos', r.dados.id, '1080.mp4'), 'stream=pix_fmt,color_transfer').streams[0];
    assert.equal(info.pix_fmt, 'yuv420p');
    assert.equal(info.color_transfer, 'bt709');
  });

  test('WEBM é aceito e convertido para MP4', async () => {
    const r = await enviarEOtimizar(adm1, videos.webm);
    assert.equal(r.dados.status, 'pronto', r.dados.mensagem);
  });

  test('arquivo falso e "playlist" disfarçada de vídeo são recusados (proteção do FFmpeg)', async () => {
    const falso = await enviarEOtimizar(adm1, path.join(pastaTemp, 'falso.mp4'));
    assert.equal(falso.status, 415);
    const playlist = await enviarEOtimizar(adm1, path.join(pastaTemp, 'playlist.mp4'));
    assert.equal(playlist.status, 415);
  });

  test('vídeo mais longo que o limite é recusado com mensagem clara', async () => {
    const r = await enviarEOtimizar(adm1, videos.longo);
    assert.equal(r.status, 400);
    assert.match(r.dados.erro, /muito longo/);
  });

  test('envio: limite de tamanho, pedaço fora de ordem, reenvio do mesmo pedaço e tamanho maior que o informado', async () => {
    assert.equal((await adm1.post('/api/adm/videos', { nome: 'grande.mp4', tamanho: 300 * 1024 * 1024 })).status, 413);
    const { dados } = await adm1.post('/api/adm/videos', { nome: 'x.mp4', tamanho: 2048 });
    const pedaco = Buffer.alloc(1024, 1);
    assert.equal((await adm1.pedir('PUT', `/api/adm/videos/${dados.id}/pedaco?inicio=1024`, undefined, { binario: pedaco })).status, 409);
    assert.equal((await adm1.pedir('PUT', `/api/adm/videos/${dados.id}/pedaco?inicio=0`, undefined, { binario: pedaco })).status, 200);
    const repetido = await adm1.pedir('PUT', `/api/adm/videos/${dados.id}/pedaco?inicio=0`, undefined, { binario: pedaco });
    assert.equal(repetido.dados.recebido, 1024, 'reenvio só confirma');
    assert.equal((await adm1.pedir('PUT', `/api/adm/videos/${dados.id}/pedaco?inicio=1024`, undefined, { binario: Buffer.alloc(2000) })).status, 400);
    assert.equal((await adm1.post(`/api/adm/videos/${dados.id}/concluir`, {})).status, 400, 'incompleto');
  });

  test('outro ADM não vê, não apaga e não publica com o vídeo de outra pessoa', async () => {
    assert.equal((await adm2.get(`/api/adm/videos/${videoPronto.id}`)).status, 404);
    assert.equal((await adm2.delete(`/api/adm/videos/${videoPronto.id}`)).status, 404);
    const { id } = (await adm2.post('/api/adm/paginas', { titulo: 'Bia', modelo: 'basico' })).dados;
    const pagina = (await adm2.get(`/api/adm/paginas/${id}`)).dados;
    pagina.conteudo.secoes[0].dados.imagem = videoPronto.url;
    await adm2.put(`/api/adm/paginas/${id}`, { conteudo: pagina.conteudo });
    await adm2.put('/api/adm/agenda', { whatsapp: '92999990001', googleAgendaId: '', fuso: 'America/Manaus', config: (await adm2.get('/api/adm/agenda')).dados.config });
    const r = await adm2.post(`/api/adm/paginas/${id}/publicar`);
    assert.equal(r.status, 422);
    assert.ok(r.dados.erros.some((erro) => /não é seu/.test(erro.mensagem)));
  });

  test('página com vídeo de fundo e na galeria publica; vídeo ainda otimizando bloqueia a publicação', async () => {
    const { id } = (await adm1.post('/api/adm/paginas', { titulo: 'Com vídeo', modelo: 'completo', tema: 'noir-barbearia' })).dados;
    const pagina = (await adm1.get(`/api/adm/paginas/${id}`)).dados;
    const conteudo = pagina.conteudo;
    conteudo.secoes[0].dados.imagem = videoPronto.url;
    conteudo.secoes[0].dados.layout = 'fundo';
    conteudo.secoes.find((s) => s.tipo === 'galeria').dados.imagens.push({ imagem: videoPronto.url, legenda: 'Bastidores' });
    const salvo = await adm1.put(`/api/adm/paginas/${id}`, { conteudo });
    assert.equal(salvo.dados.conteudo.secoes[0].dados.imagem, videoPronto.url, 'o rascunho aceita vídeo no cabeçalho');

    // Um vídeo novo, ainda na fila/otimizando, no destaque:
    const emAndamento = await enviarEOtimizar(adm1, videos.celular4k, { esperar: false });
    conteudo.secoes.find((s) => s.tipo === 'destaque').dados.imagem = emAndamento.dados.url;
    await adm1.put(`/api/adm/paginas/${id}`, { conteudo });
    const bloqueada = await adm1.post(`/api/adm/paginas/${id}/publicar`);
    assert.equal(bloqueada.status, 422);
    assert.ok(bloqueada.dados.erros.some((erro) => /sendo otimizado/.test(erro.mensagem)));

    // Esperou terminar: publica
    let situacao = emAndamento.dados;
    while (situacao.status !== 'pronto') {
      await new Promise((resolver) => setTimeout(resolver, 400));
      situacao = (await adm1.get(`/api/adm/videos/${emAndamento.dados.id}`)).dados;
      assert.notEqual(situacao.status, 'erro', situacao.mensagem);
    }
    const publicada = await adm1.post(`/api/adm/paginas/${id}/publicar`);
    assert.equal(publicada.status, 200, JSON.stringify(publicada.dados));
    const publica = await new Cliente(servidor.base).get(`/api/publico/paginas/${publicada.dados.slug}`);
    assert.equal(publica.dados.conteudo.secoes[0].dados.imagem, videoPronto.url);
  });

  test('não apaga vídeo em uso; apaga o que não está em uso (arquivos somem do disco)', async () => {
    assert.equal((await adm1.delete(`/api/adm/videos/${videoPronto.id}`)).status, 409);
    const lista = (await adm1.get('/api/adm/videos')).dados.videos;
    const livre = lista.find((video) => video.status === 'pronto' && video.nome === 'tela.webm');
    assert.equal((await adm1.delete(`/api/adm/videos/${livre.id}`)).status, 200);
    assert.ok(!fs.existsSync(path.join(servidor.pasta, 'uploads', 'videos', livre.id)));
  });
});
