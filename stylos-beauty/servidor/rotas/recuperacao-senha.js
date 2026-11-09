/**
 * rotas/recuperacao-senha.js — "Esqueci minha senha" por e-mail
 * ------------------------------------------------------------------
 *  1. A pessoa informa o e-mail (+ "não sou um robô").
 *  2. A resposta é SEMPRE a mesma ("se existir, enviamos") → ninguém
 *     descobre quais e-mails têm conta.
 *  3. O e-mail leva um link de USO ÚNICO que vale 30 minutos. O banco
 *     guarda só o hash do link.
 *  4. Ao criar a nova senha, todas as sessões abertas são encerradas.
 *  O link usa "#t=..." (parte que o navegador NÃO envia a servidores
 *  nem a outros sites), para o código não vazar em registros.
 */
'use strict';

const crypto = require('node:crypto');
const { abrirBanco, registrarAuditoria, emTransacao } = require('../banco');
const seguranca = require('../seguranca');
const email = require('../servicos/email');
const escudo = require('../servicos/escudo');
const { exigirAntiRobo } = require('./protecao');
const { ErroHttp, lerCorpoJson, textoLimpo, emailValido } = require('../utilitarios');

const VALIDADE_MS = 30 * 60 * 1000;
const hash = (texto) => crypto.createHash('sha256').update(texto).digest('hex');

/**
 * Endereço que vai no link do e-mail. NUNCA confiamos no cabeçalho "Host"
 * de quem pediu (ataque de "envenenamento do link": o atacante pede a
 * recuperação da vítima com Host: site-dele.com e recebe o código).
 * Só vale o endereço público configurado/detectado, ou localhost.
 */
function enderecoBase(requisicao) {
  const { urlPublicaAtual } = require('./autenticacao');
  const publica = urlPublicaAtual();
  if (publica) return publica;
  const host = String(requisicao.headers.host || '');
  if (/^(localhost|127\.0\.0\.1)(:\d{1,5})?$/.test(host)) return `http://${host}`;
  return null;
}

function registrar(roteador) {
  // ---------------- Pedir o link ----------------
  roteador.post('/api/recuperar-senha', async (contexto) => {
    const corpo = await lerCorpoJson(contexto.requisicao);
    if (!email.emailConfigurado()) {
      throw new ErroHttp(503, 'A recuperação por e-mail ainda não foi ativada. Peça ao responsável pelo sistema para gerar uma senha temporária.');
    }
    if (!seguranca.limitador.permitir(`recuperar:${escudo.chaveDoIp(contexto.ip)}`, 5, 60 * 60 * 1000)) {
      throw new ErroHttp(429, 'Muitos pedidos. Tente de novo mais tarde.');
    }
    exigirAntiRobo(corpo);
    const endereco = textoLimpo(corpo.email, 254).toLowerCase();
    if (!emailValido(endereco)) throw new ErroHttp(400, 'E-mail inválido.');

    const resposta = { ok: true, mensagem: 'Se existir uma conta com este e-mail, enviamos um link para criar uma nova senha. Confira também o spam. O link vale 30 minutos.' };
    // Máximo de 3 e-mails por hora para o mesmo endereço (sem avisar, para não revelar nada)
    if (!seguranca.limitador.permitir(`recuperar-email:${endereco}`, 3, 60 * 60 * 1000)) return resposta;

    const usuario = abrirBanco().prepare('SELECT id, nome, email, ativo FROM usuarios WHERE email = ?').get(endereco);
    if (!usuario || !usuario.ativo) return resposta;

    const base = enderecoBase(contexto.requisicao);
    if (!base) {
      console.warn('[recuperação de senha] endereço público não configurado: link não enviado.');
      return resposta;
    }
    const token = crypto.randomBytes(32).toString('base64url');
    abrirBanco()
      .prepare('INSERT INTO redefinicoes_senha (token_hash, usuario_id, expira_em) VALUES (?, ?, ?)')
      .run(hash(token), usuario.id, Date.now() + VALIDADE_MS);
    const link = `${base}/redefinir-senha#t=${token}`;
    registrarAuditoria(usuario.id, 'recuperacao-solicitada', '', contexto.ip);

    // Envia sem esperar: a resposta leva o mesmo tempo exista ou não a conta
    email.enviarEmail({
      para: usuario.email,
      assunto: 'Criar nova senha — StylOS Beauty',
      texto: [
        `Olá, ${usuario.nome.split(' ')[0]}!`,
        '',
        'Recebemos um pedido para criar uma nova senha na sua conta do StylOS Beauty.',
        'Para continuar, abra o link abaixo (vale por 30 minutos e funciona uma vez só):',
        '',
        link,
        '',
        'Se não foi você, ignore este e-mail: sua senha atual continua valendo.',
        '',
        'StylOS Beauty',
      ].join('\n'),
    }).catch((erro) => console.error('[recuperação de senha] falha ao enviar e-mail:', erro.message));
    return resposta;
  }, { publica: true });

  // ---------------- Criar a nova senha ----------------
  roteador.post('/api/redefinir-senha', async (contexto) => {
    if (!seguranca.limitador.permitir(`redefinir:${escudo.chaveDoIp(contexto.ip)}`, 10, 15 * 60 * 1000)) {
      throw new ErroHttp(429, 'Muitas tentativas. Aguarde 15 minutos.');
    }
    const corpo = await lerCorpoJson(contexto.requisicao);
    const token = String(corpo.token || '');
    if (!/^[A-Za-z0-9_-]{43}$/.test(token)) throw new ErroHttp(400, 'Link inválido ou vencido. Peça um novo.');
    const problema = seguranca.problemaNaSenha(corpo.novaSenha);
    if (problema) throw new ErroHttp(400, problema);
    const novoHash = await seguranca.gerarHashSenha(corpo.novaSenha);

    const usuarioId = emTransacao((banco) => {
      const pedido = banco.prepare('SELECT * FROM redefinicoes_senha WHERE token_hash = ?').get(hash(token));
      if (!pedido || pedido.usado_em || pedido.expira_em < Date.now()) throw new ErroHttp(400, 'Link inválido ou vencido. Peça um novo.');
      banco.prepare('UPDATE usuarios SET senha_hash = ?, deve_trocar_senha = 0 WHERE id = ?').run(novoHash, pedido.usuario_id);
      banco.prepare('UPDATE redefinicoes_senha SET usado_em = ? WHERE token_hash = ?').run(Date.now(), pedido.token_hash);
      // invalida outros links pendentes e derruba todas as sessões
      banco.prepare('DELETE FROM redefinicoes_senha WHERE usuario_id = ? AND usado_em IS NULL').run(pedido.usuario_id);
      banco.prepare('DELETE FROM sessoes WHERE usuario_id = ?').run(pedido.usuario_id);
      return pedido.usuario_id;
    });
    registrarAuditoria(usuarioId, 'senha-redefinida-por-email', '', contexto.ip);
    return { ok: true };
  }, { publica: true });

  // ---------------- Configuração pelo dono ----------------
  roteador.get('/api/dono/email', async () => {
    const config = email.lerConfigEmail();
    return config
      ? { configurado: true, servidor: config.servidor, porta: config.porta, usuario: config.usuario, nomeRemetente: config.nomeRemetente }
      : { configurado: false, servidor: 'smtp.gmail.com', porta: 465, usuario: '', nomeRemetente: 'StylOS Beauty' };
  }, { papeis: ['dono'] });

  roteador.put('/api/dono/email', async (contexto) => {
    const corpo = await lerCorpoJson(contexto.requisicao);
    try {
      const config = email.salvarConfigEmail(corpo);
      registrarAuditoria(contexto.usuario.id, 'email-configurado', config.usuario, contexto.ip);
      return { configurado: true };
    } catch (erro) {
      throw new ErroHttp(400, erro.message);
    }
  }, { papeis: ['dono'] });

  roteador.delete('/api/dono/email', async (contexto) => {
    email.removerConfigEmail();
    registrarAuditoria(contexto.usuario.id, 'email-removido', '', contexto.ip);
    return { configurado: false };
  }, { papeis: ['dono'] });

  roteador.post('/api/dono/email/teste', async (contexto) => {
    if (!seguranca.limitador.permitir(`email-teste:${contexto.usuario.id}`, 5, 10 * 60 * 1000)) throw new ErroHttp(429, 'Aguarde alguns minutos.');
    try {
      await email.enviarEmail({ para: contexto.usuario.email, assunto: 'Teste — StylOS Beauty', texto: 'Se você recebeu esta mensagem, o envio de e-mail do StylOS está funcionando!' });
      return { ok: true, mensagem: `E-mail de teste enviado para ${contexto.usuario.email}. Confira a caixa de entrada (e o spam).` };
    } catch (erro) {
      return { ok: false, mensagem: erro.message };
    }
  }, { papeis: ['dono'] });
}

module.exports = { registrar };
