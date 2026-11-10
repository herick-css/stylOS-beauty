/**
 * manutencao.js
 * ------------------------------------------------------------------
 * Tarefas automáticas que rodam sozinhas enquanto o servidor está ligado:
 *  - BACKUP diário do banco em dados/backups (mantém os últimos N dias).
 *    Dica: sincronize essa pasta com o Google Drive para Computador
 *    e você terá cópia fora da máquina.
 *  - LGPD: apaga nome/telefone de clientes de agendamentos muito antigos.
 *  - Limpeza de sessões vencidas e do limitador de tentativas.
 */
'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { abrirBanco } = require('../banco');
const { configuracao } = require('../configuracao');
const { limparSessoesExpiradas, limitador } = require('../seguranca');

/** Copia o banco para dados/backups/stylos-AAAA-MM-DD.sqlite (uma vez por dia). */
function fazerBackupDiario(agora = new Date()) {
  const hoje = agora.toISOString().slice(0, 10);
  const destino = path.join(configuracao.pastaBackups, `stylos-${hoje}.sqlite`);
  if (fs.existsSync(destino)) return null;
  // VACUUM INTO gera uma cópia consistente mesmo com o sistema em uso
  abrirBanco().exec(`VACUUM INTO '${destino.replace(/'/g, "''")}'`);

  const antigos = fs.readdirSync(configuracao.pastaBackups)
    .filter((nome) => /^stylos-\d{4}-\d{2}-\d{2}\.sqlite$/.test(nome))
    .sort()
    .reverse()
    .slice(configuracao.backupsMantidos);
  for (const nome of antigos) fs.unlinkSync(path.join(configuracao.pastaBackups, nome));
  return destino;
}

/** Remove dados pessoais de agendamentos que terminaram há mais de N dias. */
function aplicarRetencaoDeDados(agora = Date.now()) {
  const limite = agora - configuracao.diasRetencaoAgendamentos * 24 * 60 * 60 * 1000;
  return abrirBanco()
    .prepare("UPDATE agendamentos SET nome_cliente = '(dados removidos)', telefone_cliente = '', observacoes = NULL WHERE fim < ? AND telefone_cliente <> ''")
    .run(limite).changes;
}

function executarManutencao() {
  try {
    limparSessoesExpiradas();
    limitador.limpar();
    require('./anti-robo').limparUsados();
    require('./video').limparEnviosAbandonados();
    // links de redefinição de senha vencidos
    abrirBanco().prepare('DELETE FROM redefinicoes_senha WHERE expira_em < ?').run(Date.now() - 24 * 60 * 60 * 1000);
    const backup = fazerBackupDiario();
    if (backup) console.log(`[manutenção] backup criado: ${path.basename(backup)}`);
    const anonimizados = aplicarRetencaoDeDados();
    if (anonimizados) console.log(`[manutenção] ${anonimizados} agendamento(s) antigo(s) anonimizados (LGPD).`);
  } catch (erro) {
    console.error('[manutenção] falhou:', erro);
  }
}

/** Roda agora e depois a cada hora. */
function agendarManutencao() {
  executarManutencao();
  const temporizador = setInterval(executarManutencao, 60 * 60 * 1000);
  temporizador.unref();
  return temporizador;
}

module.exports = { agendarManutencao, fazerBackupDiario, aplicarRetencaoDeDados };
