/**
 * redefinir-senha-dono.js — para quando o DONO esquecer a senha.
 * Só funciona NO COMPUTADOR DO SERVIDOR (quem tem acesso físico manda).
 *
 * Uso (com o servidor desligado ou ligado):
 *   node --disable-warning=ExperimentalWarning scripts/redefinir-senha-dono.js
 * Mostra uma senha temporária; no próximo login o sistema pede uma nova.
 */
'use strict';
const { prepararPastasESegredo } = require('../servidor/configuracao');
const { abrirBanco, registrarAuditoria, fecharBanco } = require('../servidor/banco');
const { gerarHashSenha, gerarSenhaTemporaria } = require('../servidor/seguranca');

(async () => {
  prepararPastasESegredo();
  const banco = abrirBanco();
  const dono = banco.prepare("SELECT id, email FROM usuarios WHERE papel = 'dono'").get();
  if (!dono) {
    console.log('Ainda não existe dono. Ligue o servidor e use /configuracao-inicial.');
    return;
  }
  const senha = gerarSenhaTemporaria();
  banco.prepare('UPDATE usuarios SET senha_hash = ?, deve_trocar_senha = 1 WHERE id = ?').run(await gerarHashSenha(senha), dono.id);
  banco.prepare('DELETE FROM sessoes WHERE usuario_id = ?').run(dono.id);
  registrarAuditoria(dono.id, 'senha-dono-redefinida-localmente', '', 'local');
  fecharBanco();
  console.log(`\nE-mail do dono: ${dono.email}\nSenha temporária: ${senha}\nEntre e crie uma senha nova.\n`);
})();
