/**
 * rotas/autenticacao.js
 * ------------------------------------------------------------------
 * Entrar, sair, cadastro de clientes (papel "usuario"), troca de senha
 * e a CONFIGURAÇÃO INICIAL (cria a conta do DONO na primeira execução).
 *
 * Papéis:
 *   dono    → só existe um (você). Cadastra e gerencia os ADMs.
 *   adm     → monta páginas, configura agenda e WhatsApp. Criado SÓ pelo dono.
 *   usuario → cliente. Pode se cadastrar sozinho; vê os próprios agendamentos.
 */
'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { configuracao } = require('../configuracao');
const { abrirBanco, registrarAuditoria, emTransacao } = require('../banco');
const seguranca = require('../seguranca');
const { ErroHttp, lerCorpoJson, textoLimpo, emailValido, soDigitos } = require('../utilitarios');
const { criarDadosIniciaisDoAdm } = require('../servicos/dados-iniciais');

// ------------------------------------------------------------------
// Código da configuração inicial
// ------------------------------------------------------------------
// Enquanto não existir um DONO, o servidor gera um código e mostra na tela
// preta (e salva em dados/CODIGO-CONFIGURACAO-INICIAL.txt). Só quem está
// no computador do servidor vê esse código — assim ninguém na internet
// consegue "se cadastrar como dono" antes de você.
let codigoConfiguracaoInicial = null;
const CAMINHO_CODIGO = () => path.join(configuracao.pastaDados, 'CODIGO-CONFIGURACAO-INICIAL.txt');

function existeDono() {
  return Boolean(abrirBanco().prepare("SELECT 1 FROM usuarios WHERE papel = 'dono' LIMIT 1").get());
}

/** Chamado na inicialização do servidor. Devolve o código (ou null se já há dono). */
function prepararConfiguracaoInicial() {
  if (existeDono()) {
    try { fs.unlinkSync(CAMINHO_CODIGO()); } catch { /* já não existe */ }
    codigoConfiguracaoInicial = null;
    return null;
  }
  codigoConfiguracaoInicial = `${seguranca.gerarCodigoCurto(4)}-${seguranca.gerarCodigoCurto(4)}`;
  fs.writeFileSync(
    CAMINHO_CODIGO(),
    `Código de configuração inicial do StylOS Beauty:\n\n    ${codigoConfiguracaoInicial}\n\nUse em /configuracao-inicial para criar a conta do DONO.\nEste arquivo é apagado sozinho depois disso.\n`,
    { mode: 0o600 },
  );
  return codigoConfiguracaoInicial;
}

/** Dados do usuário que podem ir para o navegador (nunca o hash da senha). */
function usuarioPublico(usuario) {
  if (!usuario) return null;
  return {
    id: usuario.id,
    nome: usuario.nome,
    email: usuario.email,
    telefone: usuario.telefone || '',
    papel: usuario.papel,
    deveTrocarSenha: Boolean(usuario.deve_trocar_senha),
    tutorialPainel: Boolean(usuario.tutorial_painel),
    tutorialEditor: Boolean(usuario.tutorial_editor),
  };
}

function urlPublicaAtual() {
  const { lerConfiguracaoGlobal } = require('../banco');
  return lerConfiguracaoGlobal('url_publica') || configuracao.urlPublica || '';
}

function iniciarSessaoNaResposta(contexto, usuarioId) {
  const token = seguranca.criarSessao(usuarioId, contexto.ip, contexto.requisicao.headers['user-agent']);
  contexto.cabecalhosResposta['Set-Cookie'] = seguranca.cookieDeSessao(token, contexto.requisicao);
}

function registrar(roteador) {
  // ---------------- Quem sou eu? ----------------
  roteador.get('/api/sessao', async (contexto) => ({
    usuario: usuarioPublico(contexto.sessao?.usuario),
    configuracaoInicialPendente: !existeDono(),
    urlPublica: urlPublicaAtual(),
  }), { publica: true });

  // ---------------- Configuração inicial (cria o DONO) ----------------
  roteador.post('/api/configuracao-inicial', async (contexto) => {
    if (!seguranca.limitador.permitir(`inicial:${contexto.ip}`, 10, 15 * 60 * 1000)) {
      throw new ErroHttp(429, 'Muitas tentativas. Aguarde 15 minutos.');
    }
    if (existeDono()) throw new ErroHttp(409, 'O sistema já foi configurado.');
    const corpo = await lerCorpoJson(contexto.requisicao);
    const codigoDigitado = String(corpo.codigo || '').trim().toUpperCase();
    if (!codigoConfiguracaoInicial || codigoDigitado !== codigoConfiguracaoInicial) {
      throw new ErroHttp(403, 'Código incorreto. Ele aparece na janela do servidor e no arquivo dados/CODIGO-CONFIGURACAO-INICIAL.txt.');
    }
    const nome = textoLimpo(corpo.nome, 80);
    const email = textoLimpo(corpo.email, 254).toLowerCase();
    if (nome.length < 2) throw new ErroHttp(400, 'Informe seu nome.');
    if (!emailValido(email)) throw new ErroHttp(400, 'E-mail inválido.');
    const problema = seguranca.problemaNaSenha(corpo.senha);
    if (problema) throw new ErroHttp(400, problema);

    const hash = await seguranca.gerarHashSenha(corpo.senha);
    const usuarioId = emTransacao((banco) => {
      if (banco.prepare("SELECT 1 FROM usuarios WHERE papel = 'dono'").get()) throw new ErroHttp(409, 'O sistema já foi configurado.');
      const resultado = banco
        .prepare("INSERT INTO usuarios (nome, email, senha_hash, papel) VALUES (?, ?, ?, 'dono')")
        .run(nome, email, hash);
      return Number(resultado.lastInsertRowid);
    });
    criarDadosIniciaisDoAdm(usuarioId, nome);
    prepararConfiguracaoInicial(); // apaga o código
    registrarAuditoria(usuarioId, 'configuracao-inicial', 'Conta do dono criada', contexto.ip);
    iniciarSessaoNaResposta(contexto, usuarioId);
    return { ok: true };
  }, { publica: true });

  // ---------------- Entrar ----------------
  roteador.post('/api/entrar', async (contexto) => {
    const corpo = await lerCorpoJson(contexto.requisicao);
    const email = textoLimpo(corpo.email, 254).toLowerCase();
    const chaveConta = `login:${contexto.ip}:${email}`;
    if (!seguranca.limitador.permitir(`login-ip:${contexto.ip}`, 30, 15 * 60 * 1000) ||
        !seguranca.limitador.permitir(chaveConta, 8, 15 * 60 * 1000)) {
      throw new ErroHttp(429, 'Muitas tentativas de login. Aguarde 15 minutos e tente de novo.');
    }
    const usuario = abrirBanco().prepare('SELECT * FROM usuarios WHERE email = ?').get(email);
    const senhaConfere = await seguranca.verificarSenha(String(corpo.senha || ''), usuario?.senha_hash);
    if (!usuario || !senhaConfere) {
      registrarAuditoria(usuario?.id, 'login-falhou', email, contexto.ip);
      throw new ErroHttp(401, 'E-mail ou senha incorretos.'); // mensagem igual nos dois casos (não revela se o e-mail existe)
    }
    if (!usuario.ativo) throw new ErroHttp(403, 'Esta conta está desativada. Fale com o responsável pelo sistema.');
    seguranca.limitador.zerar(chaveConta);
    registrarAuditoria(usuario.id, 'login', '', contexto.ip);
    iniciarSessaoNaResposta(contexto, usuario.id);
    return { usuario: usuarioPublico(usuario) };
  }, { publica: true });

  // ---------------- Sair ----------------
  roteador.post('/api/sair', async (contexto) => {
    if (contexto.sessao) seguranca.encerrarSessao(contexto.sessao.tokenHash);
    contexto.cabecalhosResposta['Set-Cookie'] = seguranca.cookieDeSessao('', contexto.requisicao, true);
    return { ok: true };
  }, { publica: true });

  // ---------------- Cadastro de CLIENTE ----------------
  roteador.post('/api/cadastro', async (contexto) => {
    if (!seguranca.limitador.permitir(`cadastro:${contexto.ip}`, 5, 60 * 60 * 1000)) {
      throw new ErroHttp(429, 'Muitos cadastros a partir desta conexão. Tente mais tarde.');
    }
    const corpo = await lerCorpoJson(contexto.requisicao);
    if (corpo.site) throw new ErroHttp(400, 'Não foi possível concluir o cadastro.'); // armadilha para robôs (campo escondido)
    const nome = textoLimpo(corpo.nome, 80);
    const email = textoLimpo(corpo.email, 254).toLowerCase();
    const telefone = soDigitos(corpo.telefone).slice(0, 15);
    if (nome.length < 2) throw new ErroHttp(400, 'Informe seu nome.');
    if (!emailValido(email)) throw new ErroHttp(400, 'E-mail inválido.');
    if (telefone && (telefone.length < 10 || telefone.length > 13)) throw new ErroHttp(400, 'Telefone inválido. Use DDD + número.');
    if (!corpo.aceite) throw new ErroHttp(400, 'É preciso concordar com o uso dos dados para agendamentos.');
    const problema = seguranca.problemaNaSenha(corpo.senha);
    if (problema) throw new ErroHttp(400, problema);

    const banco = abrirBanco();
    if (banco.prepare('SELECT 1 FROM usuarios WHERE email = ?').get(email)) {
      throw new ErroHttp(409, 'Já existe uma conta com este e-mail. Tente entrar.');
    }
    const hash = await seguranca.gerarHashSenha(corpo.senha);
    const resultado = banco
      .prepare("INSERT INTO usuarios (nome, email, telefone, senha_hash, papel) VALUES (?, ?, ?, ?, 'usuario')")
      .run(nome, email, telefone || null, hash);
    const usuarioId = Number(resultado.lastInsertRowid);
    registrarAuditoria(usuarioId, 'cadastro-cliente', '', contexto.ip);
    iniciarSessaoNaResposta(contexto, usuarioId);
    return { usuario: usuarioPublico(banco.prepare('SELECT * FROM usuarios WHERE id = ?').get(usuarioId)) };
  }, { publica: true });

  // ---------------- Trocar senha ----------------
  roteador.post('/api/trocar-senha', async (contexto) => {
    const corpo = await lerCorpoJson(contexto.requisicao);
    if (!seguranca.limitador.permitir(`troca:${contexto.usuario.id}`, 10, 15 * 60 * 1000)) {
      throw new ErroHttp(429, 'Muitas tentativas. Aguarde alguns minutos.');
    }
    const banco = abrirBanco();
    const usuario = banco.prepare('SELECT * FROM usuarios WHERE id = ?').get(contexto.usuario.id);
    if (!(await seguranca.verificarSenha(String(corpo.senhaAtual || ''), usuario.senha_hash))) {
      throw new ErroHttp(400, 'A senha atual não confere.');
    }
    const problema = seguranca.problemaNaSenha(corpo.novaSenha);
    if (problema) throw new ErroHttp(400, problema);
    if (corpo.novaSenha === corpo.senhaAtual) throw new ErroHttp(400, 'A nova senha precisa ser diferente da atual.');
    const hash = await seguranca.gerarHashSenha(corpo.novaSenha);
    banco.prepare('UPDATE usuarios SET senha_hash = ?, deve_trocar_senha = 0 WHERE id = ?').run(hash, usuario.id);
    seguranca.encerrarOutrasSessoes(usuario.id, contexto.sessao.tokenHash);
    registrarAuditoria(usuario.id, 'senha-trocada', '', contexto.ip);
    return { ok: true };
  }, { papeis: ['dono', 'adm', 'usuario'], permitirTrocaPendente: true });

  // ---------------- Atualizar dados da conta ----------------
  roteador.put('/api/conta', async (contexto) => {
    const corpo = await lerCorpoJson(contexto.requisicao);
    const nome = textoLimpo(corpo.nome, 80);
    const telefone = soDigitos(corpo.telefone).slice(0, 15);
    if (nome.length < 2) throw new ErroHttp(400, 'Informe seu nome.');
    if (telefone && (telefone.length < 10 || telefone.length > 13)) throw new ErroHttp(400, 'Telefone inválido. Use DDD + número.');
    abrirBanco().prepare('UPDATE usuarios SET nome = ?, telefone = ? WHERE id = ?').run(nome, telefone || null, contexto.usuario.id);
    return { ok: true };
  }, { papeis: ['dono', 'adm', 'usuario'] });

  // ---------------- Marcar tutorial como visto ----------------
  roteador.post('/api/tutorial', async (contexto) => {
    const corpo = await lerCorpoJson(contexto.requisicao);
    const coluna = corpo.qual === 'editor' ? 'tutorial_editor' : 'tutorial_painel';
    abrirBanco().prepare(`UPDATE usuarios SET ${coluna} = ? WHERE id = ?`).run(corpo.concluido === false ? 0 : 1, contexto.usuario.id);
    return { ok: true };
  }, { papeis: ['dono', 'adm'] });
}

module.exports = { registrar, prepararConfiguracaoInicial, usuarioPublico, urlPublicaAtual, existeDono };
