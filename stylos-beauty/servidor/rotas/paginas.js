/**
 * rotas/paginas.js
 * ------------------------------------------------------------------
 * Páginas montadas pelos ADMs.
 *
 * Fluxo:  monta (rascunho, salvo sozinho)  →  PUBLICAR (passa pelas
 * regras de boas práticas)  →  o conteúdo é copiado para "publicado" e
 * um link fixo /p/<slug> é gerado. Editar depois NÃO muda o que o
 * público vê até publicar de novo.
 *
 * Cada ADM só enxerga e altera AS PRÓPRIAS páginas (toda consulta filtra
 * por dono_id = usuário logado).
 */
'use strict';

const crypto = require('node:crypto');
const { abrirBanco, registrarAuditoria } = require('../banco');
const { configuracao } = require('../configuracao');
const esquemas = require('../../publico/js/esquemas-secoes');
const { ErroHttp, lerCorpoJson, textoLimpo, idValido } = require('../utilitarios');

const ADM_OU_DONO = { papeis: ['adm', 'dono'] };
const MAXIMO_PAGINAS_POR_ADM = 20;

/** "Studio Bela Flor!" → "studio-bela-flor-k3f9" (único) */
function gerarSlugUnico(titulo) {
  const base = String(titulo || 'pagina')
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '')
    .slice(0, 40) || 'pagina';
  const banco = abrirBanco();
  for (let tentativa = 0; tentativa < 10; tentativa++) {
    const sufixo = crypto.randomBytes(3).toString('hex').slice(0, 4);
    const slug = `${base}-${sufixo}`;
    if (!banco.prepare('SELECT 1 FROM paginas WHERE slug = ?').get(slug)) return slug;
  }
  throw new ErroHttp(500, 'Não foi possível gerar o link. Tente de novo.');
}

/** Busca uma página garantindo que pertence ao usuário logado. */
function paginaDoUsuario(id, usuarioId) {
  const pagina = abrirBanco().prepare('SELECT * FROM paginas WHERE id = ? AND dono_id = ?').get(id, usuarioId);
  if (!pagina) throw new ErroHttp(404, 'Página não encontrada.');
  return pagina;
}

function resumoDaPagina(pagina) {
  return {
    id: pagina.id,
    titulo: pagina.titulo,
    slug: pagina.slug,
    publicada: Boolean(pagina.publicada),
    exemplo: Boolean(pagina.exemplo),
    temAlteracoesNaoPublicadas: Boolean(pagina.publicada) && pagina.conteudo_publicado !== pagina.conteudo_rascunho,
    tema: (() => {
      try { return JSON.parse(pagina.conteudo_rascunho).tema; } catch { return esquemas.TEMA_PADRAO; }
    })(),
    criadaEm: pagina.criada_em,
    atualizadaEm: pagina.atualizada_em,
    publicadaEm: pagina.publicada_em,
  };
}

function registrar(roteador) {
  // ---------------- Minhas páginas ----------------
  roteador.get('/api/adm/paginas', async (contexto) => {
    const paginas = abrirBanco()
      .prepare('SELECT * FROM paginas WHERE dono_id = ? ORDER BY exemplo ASC, atualizada_em DESC')
      .all(contexto.usuario.id);
    return { paginas: paginas.map(resumoDaPagina) };
  }, ADM_OU_DONO);

  // ---------------- Criar página ----------------
  roteador.post('/api/adm/paginas', async (contexto) => {
    const corpo = await lerCorpoJson(contexto.requisicao);
    const titulo = textoLimpo(corpo.titulo, 80);
    if (titulo.length < 2) throw new ErroHttp(400, 'Dê um nome para a página.');
    const tema = esquemas.TEMAS[corpo.tema] ? corpo.tema : esquemas.TEMA_PADRAO;
    const banco = abrirBanco();
    const total = banco.prepare('SELECT COUNT(*) AS total FROM paginas WHERE dono_id = ?').get(contexto.usuario.id).total;
    if (total >= MAXIMO_PAGINAS_POR_ADM) throw new ErroHttp(400, `Limite de ${MAXIMO_PAGINAS_POR_ADM} páginas por ADM. Exclua alguma antes.`);

    const nomeSalao = textoLimpo(corpo.nomeSalao || titulo, 40);
    const conteudo = corpo.modelo === 'completo' ? esquemas.paginaExemplo(nomeSalao, tema) : esquemas.conteudoInicial(nomeSalao, tema);
    const resultado = banco
      .prepare('INSERT INTO paginas (dono_id, titulo, conteudo_rascunho) VALUES (?, ?, ?)')
      .run(contexto.usuario.id, titulo, JSON.stringify(conteudo));
    return { id: Number(resultado.lastInsertRowid) };
  }, ADM_OU_DONO);

  // ---------------- Abrir página no editor ----------------
  roteador.get('/api/adm/paginas/:id', async (contexto) => {
    const pagina = paginaDoUsuario(idValido(contexto.parametros.id), contexto.usuario.id);
    return { ...resumoDaPagina(pagina), conteudo: JSON.parse(pagina.conteudo_rascunho) };
  }, ADM_OU_DONO);

  // ---------------- Salvar rascunho (o editor chama sozinho) ----------------
  roteador.put('/api/adm/paginas/:id', async (contexto) => {
    const id = idValido(contexto.parametros.id);
    paginaDoUsuario(id, contexto.usuario.id);
    const corpo = await lerCorpoJson(contexto.requisicao, configuracao.limiteCorpoJson);
    const conteudo = esquemas.normalizarConteudo(corpo.conteudo);
    const titulo = corpo.titulo !== undefined ? textoLimpo(corpo.titulo, 80) : null;
    if (titulo !== null && titulo.length < 2) throw new ErroHttp(400, 'O nome da página é muito curto.');
    abrirBanco()
      .prepare(`UPDATE paginas SET conteudo_rascunho = ?, titulo = COALESCE(?, titulo),
                atualizada_em = strftime('%Y-%m-%dT%H:%M:%fZ', 'now') WHERE id = ?`)
      .run(JSON.stringify(conteudo), titulo, id);
    // Devolvemos o conteúdo limpo: se algo foi descartado (ex.: link inválido), o editor fica sabendo.
    return { ok: true, conteudo };
  }, ADM_OU_DONO);

  // ---------------- PUBLICAR ----------------
  roteador.post('/api/adm/paginas/:id/publicar', async (contexto) => {
    const id = idValido(contexto.parametros.id);
    const pagina = paginaDoUsuario(id, contexto.usuario.id);
    const { erros, avisos, conteudo } = esquemas.verificarParaPublicar(JSON.parse(pagina.conteudo_rascunho));

    // Regra extra do servidor: se tem agendamento, precisa do WhatsApp e de serviços.
    if (conteudo.secoes.some((secao) => secao.tipo === 'agendamento')) {
      const agenda = abrirBanco().prepare('SELECT whatsapp FROM agendas WHERE usuario_id = ?').get(contexto.usuario.id);
      if (!agenda?.whatsapp) {
        erros.push({ secaoId: null, campo: null, mensagem: 'Cadastre seu número de WhatsApp em "Agenda e WhatsApp" antes de publicar uma página com agendamento.', acao: 'agenda' });
      }
    }
    // Vídeos: precisam estar prontos (já otimizados) e ser do próprio ADM
    erros.push(...require('./videos').errosDeVideosNaPagina(conteudo, contexto.usuario.id));
    if (erros.length) {
      throw new ErroHttp(422, 'A página ainda não segue as boas práticas.', { erros, avisos });
    }

    const slug = pagina.slug || gerarSlugUnico(conteudo.secoes[0]?.dados?.nomeMarca || pagina.titulo);
    const textoConteudo = JSON.stringify(conteudo);
    abrirBanco()
      .prepare(`UPDATE paginas SET slug = ?, conteudo_publicado = ?, conteudo_rascunho = ?, publicada = 1,
                publicada_em = strftime('%Y-%m-%dT%H:%M:%fZ', 'now') WHERE id = ?`)
      .run(slug, textoConteudo, textoConteudo, id);
    registrarAuditoria(contexto.usuario.id, 'pagina-publicada', `${pagina.titulo} (/p/${slug})`, contexto.ip);
    return { slug, caminho: `/p/${slug}`, avisos };
  }, ADM_OU_DONO);

  // ---------------- Tirar do ar ----------------
  roteador.post('/api/adm/paginas/:id/despublicar', async (contexto) => {
    const id = idValido(contexto.parametros.id);
    paginaDoUsuario(id, contexto.usuario.id);
    abrirBanco().prepare('UPDATE paginas SET publicada = 0 WHERE id = ?').run(id);
    return { ok: true };
  }, ADM_OU_DONO);

  // ---------------- Duplicar ----------------
  roteador.post('/api/adm/paginas/:id/duplicar', async (contexto) => {
    const pagina = paginaDoUsuario(idValido(contexto.parametros.id), contexto.usuario.id);
    const banco = abrirBanco();
    const total = banco.prepare('SELECT COUNT(*) AS total FROM paginas WHERE dono_id = ?').get(contexto.usuario.id).total;
    if (total >= MAXIMO_PAGINAS_POR_ADM) throw new ErroHttp(400, `Limite de ${MAXIMO_PAGINAS_POR_ADM} páginas por ADM.`);
    const resultado = banco
      .prepare('INSERT INTO paginas (dono_id, titulo, conteudo_rascunho) VALUES (?, ?, ?)')
      .run(contexto.usuario.id, `${pagina.titulo} (cópia)`.slice(0, 80), pagina.conteudo_rascunho);
    return { id: Number(resultado.lastInsertRowid) };
  }, ADM_OU_DONO);

  // ---------------- Excluir ----------------
  roteador.delete('/api/adm/paginas/:id', async (contexto) => {
    const id = idValido(contexto.parametros.id);
    const pagina = paginaDoUsuario(id, contexto.usuario.id);
    abrirBanco().prepare('DELETE FROM paginas WHERE id = ?').run(id);
    registrarAuditoria(contexto.usuario.id, 'pagina-excluida', pagina.titulo, contexto.ip);
    return { ok: true };
  }, ADM_OU_DONO);

  // ---------------- PÚBLICO: ver página publicada ----------------
  roteador.get('/api/publico/paginas/:slug', async (contexto) => {
    const slug = String(contexto.parametros.slug);
    if (!/^[a-z0-9-]{3,60}$/.test(slug)) throw new ErroHttp(404, 'Página não encontrada.');
    const banco = abrirBanco();
    const pagina = banco.prepare(`
      SELECT p.titulo, p.conteudo_publicado, p.dono_id, u.ativo
        FROM paginas p JOIN usuarios u ON u.id = p.dono_id
       WHERE p.slug = ? AND p.publicada = 1`).get(slug);
    if (!pagina || !pagina.ativo) throw new ErroHttp(404, 'Página não encontrada ou fora do ar.');

    const agenda = banco.prepare('SELECT whatsapp, config FROM agendas WHERE usuario_id = ?').get(pagina.dono_id);
    const configAgenda = agenda ? JSON.parse(agenda.config) : null;
    return {
      titulo: pagina.titulo,
      conteudo: JSON.parse(pagina.conteudo_publicado),
      agenda: {
        ativa: Boolean(agenda?.whatsapp),
        servicos: (configAgenda?.servicos || []).map(({ id, nome, duracaoMin, preco }) => ({ id, nome, duracaoMin, preco })),
        exigirContaCliente: Boolean(configAgenda?.exigirContaCliente),
      },
    };
  }, { publica: true });
}

module.exports = { registrar };
