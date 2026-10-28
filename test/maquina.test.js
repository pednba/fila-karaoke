import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { abrirBanco, escrever } from '../db.js';
import { garantirFesta } from '../festa.js';
import { gravarCatalogo } from '../catalogo.js';
import { prepararMusicas } from '../importadores/index.js';
import { hashPin } from '../auth.js';
import { pedir, cantou } from '../operacao.js';
import { criarApp } from '../app.js';
import { criarMaquina, comandoAtual } from '../maquina.js';

const TOKEN = 'token-da-maquina-para-testes';

function festaAberta() {
  const db = abrirBanco(':memory:');
  garantirFesta(db);
  const musicas = ['1001', '1002'].map((cod) => ({ cod, titulo: `M${cod}`, artista: 'X', inicio: '', idioma: 'BRA' }));
  gravarCatalogo(db, { musicas: prepararMusicas(musicas), origem: 'teste', statusFesta: 'rascunho' });
  db.prepare("UPDATE festa SET status = 'aberta', maquina_ativa = 1, admin_pin_hash = ? WHERE id = 1").run(hashPin('1234'));
  for (const nome of ['Ana', 'Bia']) db.prepare('INSERT INTO pessoas (id, nome, nome_norm) VALUES (?, ?, ?)').run(nome, nome, nome.toLowerCase());
  return db;
}

test('comando: só o pedido na vez; muda quando a vez muda e a cada reenvio', () => {
  const db = festaAberta();
  const maquina = criarMaquina({ db, token: TOKEN });
  assert.equal(comandoAtual(db), null);
  escrever(db, () => pedir(db, { pessoa_id: 'Ana', musica_cod: '1001' }));
  escrever(db, () => pedir(db, { pessoa_id: 'Bia', musica_cod: '1002' }));
  const c1 = comandoAtual(db);
  assert.deepEqual({ ...c1, id: undefined }, { id: undefined, cod: '1001', titulo: 'M1001', cantor: 'Ana' });

  escrever(db, () => maquina.reenviar());
  const c2 = comandoAtual(db);
  assert.equal(c2.cod, '1001');
  assert.notEqual(c2.id, c1.id);

  escrever(db, () => cantou(db, {}));
  assert.equal(comandoAtual(db).cod, '1002');
  db.prepare("UPDATE festa SET status = 'encerrada'").run();
  assert.equal(comandoAtual(db), null);
});

test('status: conectada por 30 s depois da consulta; enviado quando o feito é o comando atual', async () => {
  const db = festaAberta();
  escrever(db, () => pedir(db, { pessoa_id: 'Ana', musica_cod: '1001' }));
  let agora = 1_000_000;
  const maquina = criarMaquina({ db, token: TOKEN, agora: () => agora });
  assert.deepEqual(maquina.status(), { ativa: true, conectada: false, enviado: false });
  assert.equal(criarMaquina({ db, token: null }).status(), null);

  const handler = maquina.rotas.stack.at(-1).route.stack[0].handle;
  const consultar = (feito) => {
    let corpo;
    handler({ query: { feito } }, { set() { return this; }, json(c) { corpo = c; } });
    return corpo.comando;
  };
  const { id } = consultar(undefined);
  assert.deepEqual(maquina.status(), { ativa: true, conectada: true, enviado: false });
  consultar(id);
  assert.deepEqual(maquina.status(), { ativa: true, conectada: true, enviado: true });
  agora += 30_000;
  assert.deepEqual(maquina.status(), { ativa: true, conectada: false, enviado: true });
});

async function subir(config) {
  const db = festaAberta();
  const app = criarApp({
    db,
    config: {
      dataDir: fs.mkdtempSync(path.join(os.tmpdir(), 'karaoke-maquina-')), publicUrl: 'https://k.exemplo',
      setupToken: 'token-de-setup-para-testes', cookieSecret: 'segredo-dos-cookies-de-teste', cookiesSeguros: false, ...config,
    },
  });
  const servidor = await new Promise((ok) => { const s = app.listen(0, '127.0.0.1', () => ok(s)); });
  const base = `http://127.0.0.1:${servidor.address().port}`;
  let cookie = '';
  const chamar = async (metodo, rota, { corpo, headers = {} } = {}) => {
    const res = await fetch(base + rota, {
      method: metodo,
      headers: { 'Content-Type': 'application/json', Cookie: cookie, ...headers },
      body: corpo === undefined ? undefined : JSON.stringify(corpo),
    });
    const novo = res.headers.getSetCookie().map((c) => c.split(';')[0]).join('; ');
    if (novo) cookie = novo;
    return { status: res.status, dados: res.status === 304 ? null : await res.json(), etag: res.headers.get('etag') };
  };
  return { db, servidor, chamar };
}

test('rotas: token obrigatório, comando, reenviar e estado no admin', async () => {
  const { db, servidor, chamar } = await subir({ maquinaToken: TOKEN });
  const comToken = { headers: { 'X-Maquina-Token': TOKEN } };
  try {
    assert.equal((await chamar('GET', '/api/maquina/comando')).dados.erro, 'token_invalido');
    assert.equal((await chamar('GET', '/api/maquina/comando', { headers: { 'X-Maquina-Token': 'errado' } })).status, 401);
    assert.deepEqual((await chamar('GET', '/api/maquina/comando', comToken)).dados, { comando: null });

    await chamar('POST', '/api/admin/login', { corpo: { pin: '1234' } });
    assert.equal((await chamar('POST', '/api/admin/maquina/reenviar')).dados.erro, 'palco_vazio');
    escrever(db, () => pedir(db, { pessoa_id: 'Ana', musica_cod: '1001' }));

    const { comando } = (await chamar('GET', '/api/maquina/comando', comToken)).dados;
    assert.equal(comando.cod, '1001');
    let adm = await chamar('GET', '/api/admin/estado');
    assert.deepEqual(adm.dados.maquina, { ativa: true, conectada: true, enviado: false });

    await chamar('GET', `/api/maquina/comando?feito=${encodeURIComponent(comando.id)}`, comToken);
    const etag = adm.etag;
    adm = await chamar('GET', '/api/admin/estado', { headers: { 'If-None-Match': etag } });
    assert.equal(adm.status, 200, 'o ETag muda quando a máquina confirma');
    assert.deepEqual(adm.dados.maquina, { ativa: true, conectada: true, enviado: true });

    assert.equal((await chamar('POST', '/api/admin/maquina/reenviar')).status, 200);
    const novo = (await chamar('GET', '/api/maquina/comando', comToken)).dados.comando;
    assert.notEqual(novo.id, comando.id);
    assert.equal((await chamar('GET', '/api/admin/estado')).dados.maquina.enviado, false);
  } finally {
    servidor.close();
  }
});

test('sem MAQUINA_TOKEN: rotas desligadas e admin sem máquina', async () => {
  const { servidor, chamar } = await subir({});
  try {
    assert.equal((await chamar('GET', '/api/maquina/comando', { headers: { 'X-Maquina-Token': 'qualquer' } })).dados.erro, 'maquina_desligada');
    await chamar('POST', '/api/admin/login', { corpo: { pin: '1234' } });
    assert.equal((await chamar('GET', '/api/admin/estado')).dados.maquina, null);
    assert.equal((await chamar('POST', '/api/admin/maquina/reenviar')).dados.erro, 'maquina_desligada');
  } finally {
    servidor.close();
  }
});

test('envio desligado: sem comando, sem reenviar; liga pelo admin e pelo setup', async () => {
  const { db, servidor, chamar } = await subir({ maquinaToken: TOKEN });
  const comToken = { headers: { 'X-Maquina-Token': TOKEN } };
  try {
    db.prepare('UPDATE festa SET maquina_ativa = 0').run();
    escrever(db, () => pedir(db, { pessoa_id: 'Ana', musica_cod: '1001' }));
    assert.deepEqual((await chamar('GET', '/api/maquina/comando', comToken)).dados, { comando: null });

    await chamar('POST', '/api/admin/login', { corpo: { pin: '1234' } }); // com PIN, o setup usa o cookie do admin
    assert.deepEqual((await chamar('GET', '/api/setup')).dados.maquina, { ativa: false });
    assert.deepEqual((await chamar('GET', '/api/admin/estado')).dados.maquina, { ativa: false, conectada: true, enviado: false });
    assert.equal((await chamar('POST', '/api/admin/maquina/reenviar')).dados.erro, 'maquina_pausada');
    assert.equal((await chamar('PUT', '/api/admin/maquina', { corpo: { ativa: 'sim' } })).status, 422);

    assert.equal((await chamar('PUT', '/api/admin/maquina', { corpo: { ativa: true } })).dados.maquina.ativa, true);
    assert.equal((await chamar('GET', '/api/maquina/comando', comToken)).dados.comando.cod, '1001');

    assert.deepEqual((await chamar('PUT', '/api/setup/maquina', { corpo: { ativa: false } })).dados, { maquina: { ativa: false } });
    assert.deepEqual((await chamar('GET', '/api/maquina/comando', comToken)).dados, { comando: null });
  } finally {
    servidor.close();
  }
});

test('festa nova começa com o envio desligado', () => {
  const db = abrirBanco(':memory:');
  garantirFesta(db);
  escrever(db, () => criarMaquina({ db, token: TOKEN }).ligar(true));
  assert.equal(db.prepare('SELECT maquina_ativa FROM festa').pluck().get(), 1);
  db.exec('DELETE FROM festa');
  garantirFesta(db);
  assert.equal(db.prepare('SELECT maquina_ativa FROM festa').pluck().get(), 0);
});
