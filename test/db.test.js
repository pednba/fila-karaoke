import { test } from 'node:test';
import assert from 'node:assert/strict';
import { abrirBanco, migrar, lerVersao, escrever, lerMeta, gravarMeta } from '../db.js';

test('cria as tabelas da seção 6 e começa na versão 0', () => {
  const db = abrirBanco(':memory:');
  const tabelas = db
    .prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' ORDER BY name")
    .pluck()
    .all();
  assert.deepEqual(tabelas, ['festa', 'generos_artista', 'meta', 'musicas', 'pedidos', 'pessoas', 'votos']);
  assert.equal(lerVersao(db), 0);
  assert.equal(db.pragma('foreign_keys', { simple: true }), 1);
});

test('migrar é idempotente', () => {
  const db = abrirBanco(':memory:');
  migrar(db);
  assert.equal(db.pragma('user_version', { simple: true }), 6);
  assert.equal(lerVersao(db), 0);
});

test('festa aceita só a linha id = 1', () => {
  const db = abrirBanco(':memory:');
  const inserir = db.prepare("INSERT INTO festa (id, tema, regras) VALUES (?, '{}', '{}')");
  inserir.run(1);
  assert.throws(() => inserir.run(2), /CHECK/);
});

test('escrever incrementa a versão; erro desfaz tudo', () => {
  const db = abrirBanco(':memory:');
  escrever(db, () => db.prepare("INSERT INTO pessoas (id, nome, nome_norm) VALUES ('a', 'Ana', 'ana')").run());
  assert.equal(lerVersao(db), 1);

  assert.throws(() =>
    escrever(db, () => {
      db.prepare("INSERT INTO pessoas (id, nome, nome_norm) VALUES ('b', 'Bia', 'bia')").run();
      throw new Error('falhou');
    })
  );
  assert.equal(lerVersao(db), 1);
  assert.equal(db.prepare("SELECT COUNT(*) FROM pessoas WHERE id = 'b'").pluck().get(), 0);
});

test('chaves estrangeiras e nota 0 a 10 são verificadas', () => {
  const db = abrirBanco(':memory:');
  assert.throws(
    () => db.prepare("INSERT INTO pedidos (pessoa_id, musica_cod, t_fila) VALUES ('x', '1', 0)").run(),
    /FOREIGN KEY/
  );
  db.prepare("INSERT INTO pessoas (id, nome, nome_norm) VALUES ('a', 'Ana', 'ana')").run();
  db.prepare("INSERT INTO musicas (cod, titulo, artista, busca) VALUES ('1', 'T', 'A', 't a 1')").run();
  const { lastInsertRowid } = db.prepare("INSERT INTO pedidos (pessoa_id, musica_cod, t_fila) VALUES ('a', '1', 0)").run();
  assert.throws(
    () => db.prepare("INSERT INTO votos (pedido_id, pessoa_id, nota) VALUES (?, 'a', 11)").run(lastInsertRowid),
    /CHECK/
  );
});

test('meta guarda e lê valores', () => {
  const db = abrirBanco(':memory:');
  assert.equal(lerMeta(db, 'ultimo_cantor_id'), null);
  gravarMeta(db, 'ultimo_cantor_id', 'a');
  assert.equal(lerMeta(db, 'ultimo_cantor_id'), 'a');
});
