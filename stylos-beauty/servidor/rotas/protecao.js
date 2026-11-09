/**
 * rotas/protecao.js
 * ------------------------------------------------------------------
 *  - GET  /api/anti-robo/desafio      → desafio do "Não sou um robô"
 *  - Dono: situação do escudo, ligar/desligar modo de defesa, desbloquear IPs
 *  - exigirAntiRobo(): usada pelas rotas de cadastro, login, agendamento
 *    e recuperação de senha.
 */
'use strict';

const antiRobo = require('../servicos/anti-robo');
const escudo = require('../servicos/escudo');
const seguranca = require('../seguranca');
const { registrarAuditoria } = require('../banco');
const { ErroHttp, lerCorpoJson } = require('../utilitarios');

/**
 * Confere a resposta do "Não sou um robô" que veio no corpo do pedido.
 * Lança erro 400 com codigo 'anti-robo' (o formulário mostra a caixa de novo).
 */
function exigirAntiRobo(corpo) {
  const problema = antiRobo.verificarSolucao(corpo && corpo.antiRobo);
  if (problema) throw new ErroHttp(400, problema, { codigo: 'anti-robo' });
}

function registrar(roteador) {
  roteador.get('/api/anti-robo/desafio', async (contexto) => {
    if (!seguranca.limitador.permitir(`desafio:${escudo.chaveDoIp(contexto.ip)}`, 30, 60 * 1000)) {
      throw new ErroHttp(429, 'Muitas verificações seguidas. Aguarde um minuto.');
    }
    return antiRobo.criarDesafio();
  }, { publica: true });

  roteador.get('/api/dono/escudo', async () => escudo.situacao(), { papeis: ['dono'] });

  roteador.put('/api/dono/escudo', async (contexto) => {
    const corpo = await lerCorpoJson(contexto.requisicao);
    const modo = ['ligado', 'desligado'].includes(corpo.modo) ? corpo.modo : null;
    escudo.definirModoManual(modo);
    registrarAuditoria(contexto.usuario.id, 'escudo-modo-alterado', modo || 'automático', contexto.ip);
    return escudo.situacao();
  }, { papeis: ['dono'] });

  roteador.post('/api/dono/escudo/desbloquear', async (contexto) => {
    escudo.desbloquearTodos();
    registrarAuditoria(contexto.usuario.id, 'escudo-desbloqueio', 'todos os IPs', contexto.ip);
    return escudo.situacao();
  }, { papeis: ['dono'] });
}

module.exports = { registrar, exigirAntiRobo };
