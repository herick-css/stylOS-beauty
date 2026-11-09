/**
 * rotas/arquivos.js
 * ------------------------------------------------------------------
 * Envio de FOTOS pelos ADMs.
 *
 * Segurança:
 *  - só aceita JPG, PNG e WEBP, conferindo os primeiros bytes do arquivo
 *    ("assinatura"), não só a extensão — um arquivo disfarçado é recusado;
 *  - SVG e HTML são proibidos (podem carregar scripts);
 *  - o nome no disco é aleatório (o nome original nunca é usado);
 *  - limite de tamanho e de quantidade por ADM.
 *  O navegador já reduz a foto (máx. 1920 px, WEBP) antes de enviar.
 */
'use strict';

const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { abrirBanco } = require('../banco');
const { configuracao } = require('../configuracao');
const seguranca = require('../seguranca');
const { ErroHttp, lerCorpoBruto } = require('../utilitarios');

const ADM_OU_DONO = { papeis: ['adm', 'dono'] };

/** Descobre o tipo REAL da imagem pelos primeiros bytes. */
function detectarTipoImagem(buffer) {
  if (buffer.length < 12) return null;
  if (buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) return { extensao: 'jpg', mime: 'image/jpeg' };
  if (buffer.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return { extensao: 'png', mime: 'image/png' };
  if (buffer.subarray(0, 4).toString('ascii') === 'RIFF' && buffer.subarray(8, 12).toString('ascii') === 'WEBP') return { extensao: 'webp', mime: 'image/webp' };
  return null;
}

/** Verifica se alguma página do usuário usa a foto. */
function fotoEmUso(usuarioId, url) {
  return Boolean(abrirBanco()
    .prepare('SELECT 1 FROM paginas WHERE dono_id = ? AND (instr(conteudo_rascunho, ?) > 0 OR instr(COALESCE(conteudo_publicado, \'\'), ?) > 0) LIMIT 1')
    .get(usuarioId, url, url));
}

function registrar(roteador) {
  // ---------------- Enviar foto ----------------
  roteador.post('/api/adm/arquivos', async (contexto) => {
    if (!seguranca.limitador.permitir(`upload:${contexto.usuario.id}`, 80, 60 * 60 * 1000)) {
      throw new ErroHttp(429, 'Muitos envios em pouco tempo. Aguarde um pouco.');
    }
    const banco = abrirBanco();
    const total = banco.prepare('SELECT COUNT(*) AS total FROM arquivos WHERE dono_id = ?').get(contexto.usuario.id).total;
    if (total >= configuracao.limiteArquivosPorAdm) {
      throw new ErroHttp(400, `Limite de ${configuracao.limiteArquivosPorAdm} fotos atingido. Apague fotos que não usa mais.`);
    }
    const dados = await lerCorpoBruto(contexto.requisicao, configuracao.limiteUploadImagem);
    const tipo = detectarTipoImagem(dados);
    if (!tipo) throw new ErroHttp(415, 'Formato não aceito. Envie uma foto JPG, PNG ou WEBP.');

    const nome = `${crypto.randomBytes(16).toString('hex')}.${tipo.extensao}`;
    fs.writeFileSync(path.join(configuracao.pastaUploads, nome), dados, { mode: 0o644 });
    banco.prepare('INSERT INTO arquivos (nome, dono_id, tipo, tamanho) VALUES (?, ?, ?, ?)').run(nome, contexto.usuario.id, tipo.mime, dados.length);
    return { url: `/arquivos/${nome}`, tamanho: dados.length };
  }, ADM_OU_DONO);

  // ---------------- Minhas fotos ----------------
  roteador.get('/api/adm/arquivos', async (contexto) => {
    const arquivos = abrirBanco()
      .prepare('SELECT nome, tamanho, criado_em FROM arquivos WHERE dono_id = ? ORDER BY id DESC')
      .all(contexto.usuario.id);
    return { arquivos: arquivos.map((arquivo) => ({ url: `/arquivos/${arquivo.nome}`, tamanho: arquivo.tamanho, criadoEm: arquivo.criado_em })) };
  }, ADM_OU_DONO);

  // ---------------- Apagar foto ----------------
  roteador.delete('/api/adm/arquivos/:nome', async (contexto) => {
    const nome = String(contexto.parametros.nome);
    if (!/^[a-f0-9]{32}\.(webp|jpg|png)$/.test(nome)) throw new ErroHttp(400, 'Nome de arquivo inválido.');
    const banco = abrirBanco();
    const arquivo = banco.prepare('SELECT id FROM arquivos WHERE nome = ? AND dono_id = ?').get(nome, contexto.usuario.id);
    if (!arquivo) throw new ErroHttp(404, 'Foto não encontrada.');
    if (fotoEmUso(contexto.usuario.id, `/arquivos/${nome}`)) {
      throw new ErroHttp(409, 'Esta foto está sendo usada em uma das suas páginas. Troque-a lá antes de apagar.');
    }
    banco.prepare('DELETE FROM arquivos WHERE id = ?').run(arquivo.id);
    try { fs.unlinkSync(path.join(configuracao.pastaUploads, nome)); } catch { /* já não existia */ }
    return { ok: true };
  }, ADM_OU_DONO);
}

module.exports = { registrar, detectarTipoImagem };
