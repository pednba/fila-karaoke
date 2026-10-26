// Banco SQLite: schema (SPEC seção 6), migrações e helpers de transação.
import fs from 'node:fs';
import path from 'node:path';
import Database from 'better-sqlite3';

// Cada item é uma migração; o índice + 1 é o PRAGMA user_version após aplicá-la.
// Nunca editar uma migração já publicada: acrescentar uma nova no fim.
const MIGRACOES = [
  `
  CREATE TABLE festa (
    id           INTEGER PRIMARY KEY CHECK (id = 1),
    status       TEXT NOT NULL DEFAULT 'rascunho',  -- rascunho | aberta | encerrada
    nome_destaque TEXT NOT NULL DEFAULT '',
    titulo       TEXT NOT NULL DEFAULT '',
    subtitulo    TEXT NOT NULL DEFAULT '',
    inicio_em    TEXT,                -- ISO 8601 com fuso
    duracao_min  INTEGER NOT NULL DEFAULT 240,
    local        TEXT NOT NULL DEFAULT '',
    convidados   INTEGER NOT NULL DEFAULT 30,
    arte_arquivo TEXT,                -- caminho em data/uploads
    tema         TEXT NOT NULL,       -- JSON: preset + tokens finais (seção 11)
    regras       TEXT NOT NULL,       -- JSON com as regras do passo 5
    admin_pin_hash TEXT,              -- scrypt
    catalogo_origem TEXT,             -- nome do arquivo importado + data
    atualizado_em TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE musicas (
    cod      TEXT PRIMARY KEY,
    titulo   TEXT NOT NULL,
    artista  TEXT NOT NULL,
    inicio   TEXT NOT NULL DEFAULT '',
    idioma   TEXT NOT NULL DEFAULT 'BRA',
    busca    TEXT NOT NULL
  );

  CREATE TABLE pessoas (
    id         TEXT PRIMARY KEY,           -- UUID do cookie; criadas pelo admin: 'adm-<uuid>'
    nome       TEXT NOT NULL,
    nome_norm  TEXT NOT NULL UNIQUE,
    vip        INTEGER NOT NULL DEFAULT 0,
    criado_em  TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE pedidos (
    id             INTEGER PRIMARY KEY AUTOINCREMENT,
    pessoa_id      TEXT NOT NULL REFERENCES pessoas(id),
    musica_cod     TEXT NOT NULL REFERENCES musicas(cod),
    status         TEXT NOT NULL DEFAULT 'pendente',
                   -- pendente | na_vez | cantou | cancelado | removido
    t_fila         REAL NOT NULL,
    pulos          INTEGER NOT NULL DEFAULT 0,
    ordem_manual   INTEGER,
    bypass         INTEGER NOT NULL DEFAULT 0,
    votacao_aberta INTEGER NOT NULL DEFAULT 0,
    criado_em      TEXT NOT NULL DEFAULT (datetime('now')),
    na_vez_em      TEXT,
    finalizado_em  TEXT
  );

  CREATE TABLE votos (
    pedido_id  INTEGER NOT NULL REFERENCES pedidos(id),
    pessoa_id  TEXT NOT NULL REFERENCES pessoas(id),
    nota       INTEGER NOT NULL CHECK (nota BETWEEN 0 AND 10),
    atualizado_em TEXT NOT NULL DEFAULT (datetime('now')),
    PRIMARY KEY (pedido_id, pessoa_id)
  );

  CREATE TABLE meta (chave TEXT PRIMARY KEY, valor TEXT);  -- versao, ultimo_cantor_id

  INSERT INTO meta (chave, valor) VALUES ('versao', '0');
  `,
  // Reimportar o catálogo com a festa aberta: músicas que sumiram mas já têm pedidos
  // ficam na tabela (chave estrangeira, ranking), escondidas da busca.
  `
  ALTER TABLE musicas ADD COLUMN fora_do_catalogo INTEGER NOT NULL DEFAULT 0;
  `,
];

export function migrar(db) {
  const atual = db.pragma('user_version', { simple: true });
  for (let v = atual; v < MIGRACOES.length; v++) {
    db.transaction(() => {
      db.exec(MIGRACOES[v]);
      db.pragma(`user_version = ${v + 1}`);
    })();
  }
}

// Abre (ou cria) o banco. Sem argumento usa DATA_DIR/karaoke.db; ':memory:' serve para testes.
export function abrirBanco(arquivo = path.join(process.env.DATA_DIR || './data', 'karaoke.db')) {
  if (arquivo !== ':memory:') fs.mkdirSync(path.dirname(arquivo), { recursive: true });
  const db = new Database(arquivo);
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');
  migrar(db);
  return db;
}

export function lerMeta(db, chave) {
  return db.prepare('SELECT valor FROM meta WHERE chave = ?').pluck().get(chave) ?? null;
}

export function gravarMeta(db, chave, valor) {
  db.prepare(
    'INSERT INTO meta (chave, valor) VALUES (?, ?) ON CONFLICT(chave) DO UPDATE SET valor = excluded.valor'
  ).run(chave, valor === null ? null : String(valor));
}

export function lerVersao(db) {
  return Number(lerMeta(db, 'versao'));
}

// Toda escrita passa por aqui: roda fn numa transação e incrementa meta.versao (SPEC 8.4).
// Se fn lançar, nada é gravado e a versão não muda.
export function escrever(db, fn) {
  return db.transaction(() => {
    const resultado = fn(db);
    db.prepare("UPDATE meta SET valor = CAST(valor AS INTEGER) + 1 WHERE chave = 'versao'").run();
    return resultado;
  })();
}
