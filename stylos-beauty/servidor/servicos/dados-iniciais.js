/**
 * dados-iniciais.js
 * ------------------------------------------------------------------
 * Quando um ADM (ou o dono) é criado, já deixamos pronto:
 *   - uma agenda com expediente e serviços de exemplo;
 *   - uma PÁGINA DE EXEMPLO completa (rascunho), para ver como tudo funciona.
 */
'use strict';

const { abrirBanco } = require('../banco');
const { configuracao } = require('../configuracao');
const esquemas = require('../../publico/js/esquemas-secoes');
const { configuracaoPadraoAgenda } = require('./horarios');

function criarDadosIniciaisDoAdm(usuarioId, nomeDaPessoa) {
  const banco = abrirBanco();
  banco
    .prepare('INSERT OR IGNORE INTO agendas (usuario_id, whatsapp, google_agenda_id, fuso, config) VALUES (?, NULL, NULL, ?, ?)')
    .run(usuarioId, configuracao.fusoPadrao, JSON.stringify(configuracaoPadraoAgenda()));

  const primeiroNome = String(nomeDaPessoa || '').trim().split(/\s+/)[0] || 'Exemplo';
  const conteudo = esquemas.paginaExemplo(`Studio ${primeiroNome}`, 'lavanda-suave');
  banco
    .prepare('INSERT INTO paginas (dono_id, titulo, conteudo_rascunho, exemplo) VALUES (?, ?, ?, 1)')
    .run(usuarioId, 'Página de exemplo', JSON.stringify(conteudo));
}

module.exports = { criarDadosIniciaisDoAdm };
