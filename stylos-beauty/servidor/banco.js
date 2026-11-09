/**
 * banco.js
 * ------------------------------------------------------------------
 * Banco de dados SQLite usando o módulo "node:sqlite", que já vem
 * dentro do Node.js (versão 22.13 ou mais nova). Não precisa instalar nada.
 *
 * O banco inteiro é UM arquivo: dados/stylos.sqlite.
 * Para fazer backup basta copiar esse arquivo (o sistema já faz isso
 * sozinho todo dia, em dados/backups).
 *
 * IMPORTANTE (segurança): todas as consultas usam "prepared statements"
 * com parâmetros (?), nunca concatenação de texto — isso impede SQL injection.
 */
'use strict';

const { DatabaseSync } = require('node:sqlite');
const { configuracao } = require('./configuracao');

/** Versão do esquema. Ao mudar tabelas, crie uma nova migração abaixo. */
const MIGRACOES = [
  // ---------- versão 1: estrutura inicial ----------
  `
  CREATE TABLE usuarios (
    id                 INTEGER PRIMARY KEY,
    nome               TEXT NOT NULL,
    email              TEXT NOT NULL UNIQUE COLLATE NOCASE,
    telefone           TEXT,
    senha_hash         TEXT NOT NULL,
    papel              TEXT NOT NULL CHECK (papel IN ('dono', 'adm', 'usuario')),
    ativo              INTEGER NOT NULL DEFAULT 1,
    deve_trocar_senha  INTEGER NOT NULL DEFAULT 0,
    tutorial_painel    INTEGER NOT NULL DEFAULT 0,
    tutorial_editor    INTEGER NOT NULL DEFAULT 0,
    criado_por         INTEGER REFERENCES usuarios(id) ON DELETE SET NULL,
    criado_em          TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
  );

  CREATE TABLE sessoes (
    token_hash   TEXT PRIMARY KEY,           -- guardamos só o HASH do token, nunca o token
    usuario_id   INTEGER NOT NULL REFERENCES usuarios(id) ON DELETE CASCADE,
    criada_em    INTEGER NOT NULL,
    expira_em    INTEGER NOT NULL,
    ip           TEXT,
    navegador    TEXT
  );
  CREATE INDEX idx_sessoes_usuario ON sessoes(usuario_id);

  CREATE TABLE paginas (
    id                  INTEGER PRIMARY KEY,
    dono_id             INTEGER NOT NULL REFERENCES usuarios(id) ON DELETE CASCADE,
    titulo              TEXT NOT NULL,
    slug                TEXT UNIQUE,         -- gerado na 1ª publicação: /p/<slug>
    conteudo_rascunho   TEXT NOT NULL,       -- JSON com tema + seções (o que está sendo editado)
    conteudo_publicado  TEXT,                -- JSON da última versão confirmada (o que o público vê)
    publicada           INTEGER NOT NULL DEFAULT 0,
    exemplo             INTEGER NOT NULL DEFAULT 0,
    criada_em           TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
    atualizada_em       TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
    publicada_em        TEXT
  );
  CREATE INDEX idx_paginas_dono ON paginas(dono_id);

  CREATE TABLE agendas (
    usuario_id        INTEGER PRIMARY KEY REFERENCES usuarios(id) ON DELETE CASCADE,
    whatsapp          TEXT,                  -- só dígitos com DDI: 5592999999999
    google_agenda_id  TEXT,                  -- normalmente o Gmail do ADM
    fuso              TEXT NOT NULL,
    config            TEXT NOT NULL,         -- JSON: expediente, serviços, regras
    callmebot_cripto  TEXT                   -- chave opcional do aviso automático (criptografada)
  );

  CREATE TABLE agendamentos (
    id                INTEGER PRIMARY KEY,
    codigo            TEXT NOT NULL UNIQUE,
    pagina_id         INTEGER REFERENCES paginas(id) ON DELETE SET NULL,
    adm_id            INTEGER NOT NULL REFERENCES usuarios(id) ON DELETE CASCADE,
    cliente_id        INTEGER REFERENCES usuarios(id) ON DELETE SET NULL,
    servico           TEXT NOT NULL,
    duracao_min       INTEGER NOT NULL,
    inicio            INTEGER NOT NULL,      -- milissegundos UTC
    fim               INTEGER NOT NULL,
    nome_cliente      TEXT NOT NULL,
    telefone_cliente  TEXT NOT NULL,
    observacoes       TEXT,
    status            TEXT NOT NULL DEFAULT 'pendente'
                      CHECK (status IN ('pendente', 'confirmado', 'cancelado', 'concluido')),
    criado_em         TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
  );
  CREATE INDEX idx_agendamentos_adm_inicio ON agendamentos(adm_id, inicio);
  CREATE INDEX idx_agendamentos_cliente ON agendamentos(cliente_id);

  CREATE TABLE arquivos (
    id         INTEGER PRIMARY KEY,
    nome       TEXT NOT NULL UNIQUE,         -- nome aleatório no disco
    dono_id    INTEGER NOT NULL REFERENCES usuarios(id) ON DELETE CASCADE,
    tipo       TEXT NOT NULL,
    tamanho    INTEGER NOT NULL,
    criado_em  TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
  );
  CREATE INDEX idx_arquivos_dono ON arquivos(dono_id);

  CREATE TABLE configuracoes (
    chave  TEXT PRIMARY KEY,
    valor  TEXT
  );

  CREATE TABLE auditoria (
    id          INTEGER PRIMARY KEY,
    quando      TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
    usuario_id  INTEGER,
    acao        TEXT NOT NULL,
    detalhe     TEXT,
    ip          TEXT
  );
  `,
  // ---------- versão 2: login com Google e recuperação de senha por e-mail ----------
  `
  ALTER TABLE usuarios ADD COLUMN google_sub TEXT;      -- identificador fixo da conta Google vinculada
  CREATE UNIQUE INDEX idx_usuarios_google ON usuarios(google_sub) WHERE google_sub IS NOT NULL;

  CREATE TABLE redefinicoes_senha (
    token_hash  TEXT PRIMARY KEY,                       -- só o HASH do link enviado por e-mail
    usuario_id  INTEGER NOT NULL REFERENCES usuarios(id) ON DELETE CASCADE,
    expira_em   INTEGER NOT NULL,
    usado_em    INTEGER
  );
  CREATE INDEX idx_redefinicoes_usuario ON redefinicoes_senha(usuario_id);
  `,
];

let bancoAberto = null;

/** Abre o banco (uma única vez) e aplica as migrações pendentes. */
function abrirBanco(caminho = configuracao.caminhoBanco) {
  if (bancoAberto) return bancoAberto;
  const banco = new DatabaseSync(caminho);
  banco.exec('PRAGMA journal_mode = WAL;');   // mais resistente a quedas de energia
  banco.exec('PRAGMA foreign_keys = ON;');
  banco.exec('PRAGMA busy_timeout = 5000;');

  const versaoAtual = banco.prepare('PRAGMA user_version').get().user_version;
  for (let indice = versaoAtual; indice < MIGRACOES.length; indice++) {
    banco.exec('BEGIN');
    try {
      banco.exec(MIGRACOES[indice]);
      banco.exec(`PRAGMA user_version = ${indice + 1}`);
      banco.exec('COMMIT');
    } catch (erro) {
      banco.exec('ROLLBACK');
      throw erro;
    }
  }
  bancoAberto = banco;
  return banco;
}

/** Atalho: executa uma função dentro de uma transação (tudo ou nada). */
function emTransacao(funcao) {
  const banco = abrirBanco();
  banco.exec('BEGIN IMMEDIATE');
  try {
    const resultado = funcao(banco);
    banco.exec('COMMIT');
    return resultado;
  } catch (erro) {
    banco.exec('ROLLBACK');
    throw erro;
  }
}

/** Lê uma configuração global (tabela configuracoes). */
function lerConfiguracaoGlobal(chave) {
  const linha = abrirBanco().prepare('SELECT valor FROM configuracoes WHERE chave = ?').get(chave);
  return linha ? linha.valor : null;
}

/** Grava uma configuração global. */
function gravarConfiguracaoGlobal(chave, valor) {
  abrirBanco()
    .prepare('INSERT INTO configuracoes (chave, valor) VALUES (?, ?) ON CONFLICT(chave) DO UPDATE SET valor = excluded.valor')
    .run(chave, valor);
}

/** Registra uma ação importante (login, criação de ADM, publicação...). */
function registrarAuditoria(usuarioId, acao, detalhe = '', ip = '') {
  abrirBanco()
    .prepare('INSERT INTO auditoria (usuario_id, acao, detalhe, ip) VALUES (?, ?, ?, ?)')
    .run(usuarioId ?? null, acao, String(detalhe).slice(0, 500), ip || '');
}

function fecharBanco() {
  if (bancoAberto) {
    bancoAberto.close();
    bancoAberto = null;
  }
}

module.exports = {
  abrirBanco,
  emTransacao,
  lerConfiguracaoGlobal,
  gravarConfiguracaoGlobal,
  registrarAuditoria,
  fecharBanco,
};
