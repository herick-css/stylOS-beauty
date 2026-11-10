/**
 * rotas/dono.js
 * ------------------------------------------------------------------
 * Ações EXCLUSIVAS do dono do sistema:
 *   - cadastrar ADMs (só o dono pode!), desativar, redefinir senha;
 *   - configurar a integração com o Google Agenda (conta de serviço);
 *   - ver todas as páginas e tirar do ar alguma imprópria;
 *   - definir o endereço público e consultar o registro de atividades.
 */
'use strict';

const { abrirBanco, registrarAuditoria, gravarConfiguracaoGlobal, emTransacao } = require('../banco');
const seguranca = require('../seguranca');
const google = require('../servicos/google-agenda');
const { criarDadosIniciaisDoAdm } = require('../servicos/dados-iniciais');
const { urlPublicaAtual } = require('./autenticacao');
const { ErroHttp, lerCorpoJson, textoLimpo, emailValido, idValido } = require('../utilitarios');

const SO_DONO = { papeis: ['dono'] };

function registrar(roteador) {
  // ---------------- Listar ADMs ----------------
  roteador.get('/api/dono/adms', async () => {
    const adms = abrirBanco().prepare(`
      SELECT u.id, u.nome, u.email, u.ativo, u.deve_trocar_senha, u.criado_em,
             (SELECT COUNT(*) FROM paginas p WHERE p.dono_id = u.id) AS total_paginas,
             (SELECT COUNT(*) FROM paginas p WHERE p.dono_id = u.id AND p.publicada = 1) AS paginas_publicadas,
             (SELECT COUNT(*) FROM agendamentos a WHERE a.adm_id = u.id AND a.status IN ('pendente','confirmado') AND a.inicio > ?) AS agendamentos_futuros,
             (SELECT whatsapp IS NOT NULL FROM agendas g WHERE g.usuario_id = u.id) AS tem_whatsapp,
             (SELECT MAX(quando) FROM auditoria au WHERE au.usuario_id = u.id AND au.acao = 'login') AS ultimo_login
        FROM usuarios u
       WHERE u.papel = 'adm'
       ORDER BY u.nome COLLATE NOCASE`).all(Date.now());
    return { adms };
  }, SO_DONO);

  // ---------------- Cadastrar ADM ----------------
  roteador.post('/api/dono/adms', async (contexto) => {
    const corpo = await lerCorpoJson(contexto.requisicao);
    const nome = textoLimpo(corpo.nome, 80);
    const email = textoLimpo(corpo.email, 254).toLowerCase();
    if (nome.length < 2) throw new ErroHttp(400, 'Informe o nome do ADM.');
    if (!emailValido(email)) throw new ErroHttp(400, 'E-mail inválido.');

    const senhaTemporaria = seguranca.gerarSenhaTemporaria();
    const hash = await seguranca.gerarHashSenha(senhaTemporaria);
    const novoId = emTransacao((banco) => {
      const existente = banco.prepare('SELECT papel FROM usuarios WHERE email = ?').get(email);
      if (existente) {
        throw new ErroHttp(409, existente.papel === 'usuario'
          ? 'Este e-mail já é de uma conta de CLIENTE. Use outro e-mail para o ADM.'
          : 'Já existe uma conta com este e-mail.');
      }
      const resultado = banco
        .prepare("INSERT INTO usuarios (nome, email, senha_hash, papel, deve_trocar_senha, criado_por) VALUES (?, ?, ?, 'adm', 1, ?)")
        .run(nome, email, hash, contexto.usuario.id);
      return Number(resultado.lastInsertRowid);
    });
    criarDadosIniciaisDoAdm(novoId, nome);
    registrarAuditoria(contexto.usuario.id, 'adm-criado', `${nome} <${email}>`, contexto.ip);
    // A senha temporária aparece UMA vez para o dono repassar. No 1º acesso o ADM é obrigado a trocar.
    return { id: novoId, senhaTemporaria };
  }, SO_DONO);

  // ---------------- Ativar / desativar ADM ----------------
  roteador.post('/api/dono/adms/:id/ativo', async (contexto) => {
    const id = idValido(contexto.parametros.id);
    const corpo = await lerCorpoJson(contexto.requisicao);
    const banco = abrirBanco();
    const alvo = banco.prepare("SELECT id, nome FROM usuarios WHERE id = ? AND papel = 'adm'").get(id);
    if (!alvo) throw new ErroHttp(404, 'ADM não encontrado.');
    const ativo = corpo.ativo ? 1 : 0;
    banco.prepare('UPDATE usuarios SET ativo = ? WHERE id = ?').run(ativo, id);
    if (!ativo) {
      banco.prepare('DELETE FROM sessoes WHERE usuario_id = ?').run(id);
      // Páginas de ADM desativado saem do ar (o conteúdo continua guardado)
      banco.prepare('UPDATE paginas SET publicada = 0 WHERE dono_id = ?').run(id);
    }
    registrarAuditoria(contexto.usuario.id, ativo ? 'adm-reativado' : 'adm-desativado', alvo.nome, contexto.ip);
    return { ok: true };
  }, SO_DONO);

  // ---------------- Redefinir senha de ADM ----------------
  roteador.post('/api/dono/adms/:id/redefinir-senha', async (contexto) => {
    const id = idValido(contexto.parametros.id);
    const banco = abrirBanco();
    const alvo = banco.prepare("SELECT id, nome FROM usuarios WHERE id = ? AND papel = 'adm'").get(id);
    if (!alvo) throw new ErroHttp(404, 'ADM não encontrado.');
    const senhaTemporaria = seguranca.gerarSenhaTemporaria();
    banco.prepare('UPDATE usuarios SET senha_hash = ?, deve_trocar_senha = 1 WHERE id = ?').run(await seguranca.gerarHashSenha(senhaTemporaria), id);
    banco.prepare('DELETE FROM sessoes WHERE usuario_id = ?').run(id);
    registrarAuditoria(contexto.usuario.id, 'adm-senha-redefinida', alvo.nome, contexto.ip);
    return { senhaTemporaria };
  }, SO_DONO);

  // ---------------- Redefinir senha de CLIENTE (quando ele esquece) ----------------
  roteador.post('/api/dono/clientes/redefinir-senha', async (contexto) => {
    const corpo = await lerCorpoJson(contexto.requisicao);
    const email = textoLimpo(corpo.email, 254).toLowerCase();
    const banco = abrirBanco();
    const alvo = banco.prepare("SELECT id FROM usuarios WHERE email = ? AND papel = 'usuario'").get(email);
    if (!alvo) throw new ErroHttp(404, 'Nenhuma conta de cliente com este e-mail.');
    const senhaTemporaria = seguranca.gerarSenhaTemporaria();
    banco.prepare('UPDATE usuarios SET senha_hash = ?, deve_trocar_senha = 1 WHERE id = ?').run(await seguranca.gerarHashSenha(senhaTemporaria), alvo.id);
    banco.prepare('DELETE FROM sessoes WHERE usuario_id = ?').run(alvo.id);
    registrarAuditoria(contexto.usuario.id, 'cliente-senha-redefinida', email, contexto.ip);
    return { senhaTemporaria };
  }, SO_DONO);

  // ---------------- Integração Google (conta de serviço) ----------------
  roteador.get('/api/dono/google', async () => ({
    configurado: Boolean(google.emailDaContaServico()),
    email: google.emailDaContaServico(),
  }), SO_DONO);

  roteador.put('/api/dono/google', async (contexto) => {
    const corpo = await lerCorpoJson(contexto.requisicao, 32 * 1024);
    try {
      const email = google.salvarContaServico(String(corpo.json || ''));
      registrarAuditoria(contexto.usuario.id, 'google-configurado', email, contexto.ip);
      return { configurado: true, email };
    } catch (erro) {
      throw new ErroHttp(400, erro.message);
    }
  }, SO_DONO);

  roteador.delete('/api/dono/google', async (contexto) => {
    google.removerContaServico();
    registrarAuditoria(contexto.usuario.id, 'google-removido', '', contexto.ip);
    return { configurado: false };
  }, SO_DONO);

  // ---------------- Todas as páginas (moderação) ----------------
  roteador.get('/api/dono/paginas', async () => {
    const paginas = abrirBanco().prepare(`
      SELECT p.id, p.titulo, p.slug, p.publicada, p.atualizada_em, p.publicada_em, u.nome AS autor, u.id AS autor_id
        FROM paginas p JOIN usuarios u ON u.id = p.dono_id
       ORDER BY p.atualizada_em DESC`).all();
    return { paginas };
  }, SO_DONO);

  roteador.post('/api/dono/paginas/:id/despublicar', async (contexto) => {
    const id = idValido(contexto.parametros.id);
    const resultado = abrirBanco().prepare('UPDATE paginas SET publicada = 0 WHERE id = ?').run(id);
    if (!resultado.changes) throw new ErroHttp(404, 'Página não encontrada.');
    registrarAuditoria(contexto.usuario.id, 'pagina-retirada-pelo-dono', String(id), contexto.ip);
    return { ok: true };
  }, SO_DONO);

  // ---------------- Sistema: endereço público, números gerais ----------------
  roteador.get('/api/dono/sistema', async () => {
    const banco = abrirBanco();
    const contar = (sql) => banco.prepare(sql).get().total;
    return {
      urlPublica: urlPublicaAtual(),
      urlPublicaManual: require('../banco').lerConfiguracaoGlobal('url_publica') || '',
      tailscale: require('../servicos/tailscale').situacao(),
      videos: require('../servicos/video').situacaoFerramentas(),
      totais: {
        adms: contar("SELECT COUNT(*) AS total FROM usuarios WHERE papel = 'adm'"),
        clientes: contar("SELECT COUNT(*) AS total FROM usuarios WHERE papel = 'usuario'"),
        paginasPublicadas: contar('SELECT COUNT(*) AS total FROM paginas WHERE publicada = 1'),
        agendamentos: contar('SELECT COUNT(*) AS total FROM agendamentos'),
      },
    };
  }, SO_DONO);

  roteador.put('/api/dono/sistema', async (contexto) => {
    const corpo = await lerCorpoJson(contexto.requisicao);
    let url = String(corpo.urlPublica || '').trim().replace(/\/+$/, '');
    if (url) {
      try {
        const endereco = new URL(url);
        if (endereco.protocol !== 'https:' && endereco.hostname !== 'localhost' && endereco.hostname !== '127.0.0.1') {
          throw new Error('https');
        }
        url = endereco.origin;
      } catch {
        throw new ErroHttp(400, 'Endereço inválido. Use o endereço completo com https:// (o do túnel).');
      }
    }
    gravarConfiguracaoGlobal('url_publica', url || null);
    registrarAuditoria(contexto.usuario.id, 'url-publica-alterada', url || '(automático)', contexto.ip);
    return { urlPublica: urlPublicaAtual() };
  }, SO_DONO);

  // ---------------- Verificar o Tailscale agora (botão do painel) ----------------
  roteador.post('/api/dono/tailscale/verificar', async (contexto) => {
    if (!seguranca.limitador.permitir(`tailscale:${contexto.usuario.id}`, 20, 10 * 60 * 1000)) throw new ErroHttp(429, 'Aguarde um pouco.');
    const situacao = await require('../servicos/tailscale').verificarTailscale();
    return { tailscale: situacao, urlPublica: urlPublicaAtual() };
  }, SO_DONO);

  // ---------------- Registro de atividades ----------------
  roteador.get('/api/dono/auditoria', async () => {
    const registros = abrirBanco().prepare(`
      SELECT a.quando, a.acao, a.detalhe, a.ip, u.nome AS usuario
        FROM auditoria a LEFT JOIN usuarios u ON u.id = a.usuario_id
       ORDER BY a.id DESC LIMIT 200`).all();
    return { registros };
  }, SO_DONO);
}

module.exports = { registrar };
