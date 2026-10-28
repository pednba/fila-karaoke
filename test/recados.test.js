import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { abrirBanco } from '../db.js';
import { garantirFesta, arquivarFesta } from '../festa.js';
import { hashPin } from '../auth.js';
import { criarApp } from '../app.js';
import { contarCaracteres } from '../texto.js';
import { validarTextoAviso } from '../push.js';
import { validarTextoRecado } from '../recados.js';

const pasta = () => fs.mkdtempSync(path.join(os.tmpdir(), 'karaoke-recados-'));

function festaAberta() {
  const db = abrirBanco(':memory:');
  garantirFesta(db);
  db.prepare("UPDATE festa SET status = 'aberta', titulo = 'Festa Teste', nome_destaque = 'Aniversariante', admin_pin_hash = ? WHERE id = 1").run(hashPin('1234'));
  return db;
}

async function subir(db, dataDir = pasta()) {
  const app = criarApp({
    db,
    config: {
      dataDir, publicUrl: 'http://k.exemplo',
      setupToken: 'token-de-setup-para-testes', cookieSecret: 'segredo-dos-cookies-de-teste', cookiesSeguros: false,
    },
  });
  const servidor = await new Promise((ok) => { const s = app.listen(0, '127.0.0.1', () => ok(s)); });
  const base = `http://127.0.0.1:${servidor.address().port}`;
  const cliente = () => {
    let cookie = '';
    return async (metodo, rota, corpo) => {
      const res = await fetch(base + rota, {
        method: metodo,
        headers: { 'Content-Type': 'application/json', Cookie: cookie },
        body: corpo === undefined ? undefined : JSON.stringify(corpo),
      });
      const novo = res.headers.getSetCookie().map((c) => c.split(';')[0]).join('; ');
      if (novo) cookie = novo;
      const texto = await res.text();
      return { status: res.status, dados: texto ? JSON.parse(texto) : null };
    };
  };
  return { servidor, cliente };
}

test('emojis contam um caractere cada, inclusive os compostos (SPEC 9.3)', () => {
  assert.equal(contarCaracteres('Parabéns! 🎉'), 11);
  assert.equal(contarCaracteres('❤️👍🏽👨‍👩‍👧'), 3);
  assert.equal(validarTextoAviso('🎂'.repeat(200)).length, 400, '200 emojis cabem na mensagem do admin');
  assert.throws(() => validarTextoAviso('🎂'.repeat(201)), { codigo: 'texto_longo' });
  assert.equal(validarTextoRecado(`  ${'🎤'.repeat(100)}  `), '🎤'.repeat(100));
  assert.throws(() => validarTextoRecado('a'.repeat(101)), { codigo: 'texto_longo' });
  assert.throws(() => validarTextoRecado(' \n '), { codigo: 'texto_vazio' });
});

test('recados: convidado manda, telão lista, um por minuto, admin apaga (SPEC 9.4)', async () => {
  const db = festaAberta();
  const { servidor, cliente } = await subir(db);
  try {
    const telao = cliente();
    assert.equal((await telao('GET', '/api/festa')).dados.regras.recados, true);
    assert.deepEqual((await telao('GET', '/api/recados')).dados, { recados: [] });
    assert.equal((await telao('POST', '/api/recados', { texto: 'Oi' })).dados.erro, 'sem_cadastro');

    const ana = cliente();
    const bia = cliente();
    await ana('POST', '/api/pessoas', { nome: 'Ana' });
    await bia('POST', '/api/pessoas', { nome: 'Bia' });
    assert.equal((await ana('POST', '/api/recados', { texto: '   ' })).dados.erro, 'texto_vazio');
    assert.equal((await ana('POST', '/api/recados', { texto: 'x'.repeat(101) })).dados.erro, 'texto_longo');

    const versao = (await telao('GET', '/api/estado')).dados.versao;
    const enviado = await ana('POST', '/api/recados', { texto: 'Parabéns! 🎂🎉' });
    assert.equal(enviado.status, 201);
    assert.equal(enviado.dados.recado.nome, 'Ana');
    assert.ok((await telao('GET', '/api/estado')).dados.versao > versao, 'o telão percebe a mudança');

    const rapido = await ana('POST', '/api/recados', { texto: 'De novo' });
    assert.equal(rapido.status, 429);
    assert.equal(rapido.dados.erro, 'recado_rapido');
    db.prepare("UPDATE recados SET criado_em = datetime('now', '-61 seconds')").run();
    assert.equal((await ana('POST', '/api/recados', { texto: 'Segundo' })).status, 201);
    assert.equal((await bia('POST', '/api/recados', { texto: 'Uhul' })).status, 201);

    const lista = (await telao('GET', '/api/recados')).dados.recados;
    assert.deepEqual(lista.map((m) => [m.nome, m.texto]), [['Bia', 'Uhul'], ['Ana', 'Segundo'], ['Ana', 'Parabéns! 🎂🎉']], 'mais novo em cima');

    const ids = db.prepare('SELECT id FROM recados').pluck().all();
    for (let i = 0; i < 5; i++) db.prepare("INSERT INTO recados (pessoa_id, texto) VALUES ((SELECT id FROM pessoas WHERE nome = 'Bia'), ?)").run(`extra ${i}`);
    assert.equal((await telao('GET', '/api/recados')).dados.recados.length, 6, 'o telão mostra só 6');

    // Moderação.
    assert.equal((await ana('DELETE', `/api/admin/recados/${ids[0]}`)).status, 401);
    const admin = cliente();
    await admin('POST', '/api/admin/login', { pin: '1234' });
    assert.equal((await admin('GET', '/api/admin/estado')).dados.recados.length, 8);
    assert.equal((await admin('DELETE', `/api/admin/recados/${ids[0]}`)).status, 204);
    assert.equal((await admin('DELETE', `/api/admin/recados/${ids[0]}`)).status, 404);
    assert.ok(!(await admin('GET', '/api/admin/estado')).dados.recados.some((m) => m.id === ids[0]));

    // Regra desligada: some do telão e não aceita novos.
    const regras = JSON.parse(db.prepare('SELECT regras FROM festa').pluck().get());
    db.prepare('UPDATE festa SET regras = ?').run(JSON.stringify({ ...regras, recados: false }));
    assert.deepEqual((await telao('GET', '/api/recados')).dados.recados, []);
    db.prepare("UPDATE recados SET criado_em = datetime('now', '-61 seconds')").run();
    assert.equal((await bia('POST', '/api/recados', { texto: 'Oi' })).dados.erro, 'recados_desligados');

    db.prepare("UPDATE festa SET status = 'encerrada'").run();
    assert.equal((await bia('POST', '/api/recados', { texto: 'Oi' })).dados.erro, 'festa_fechada');
  } finally {
    servidor.close();
  }
});

test('arquivar apaga os recados e a cópia do banco sai sem eles (SPEC 7.1)', async () => {
  const db = festaAberta();
  db.prepare("INSERT INTO pessoas (id, nome, nome_norm) VALUES ('ana', 'Ana', 'ana')").run();
  db.prepare("INSERT INTO recados (pessoa_id, texto) VALUES ('ana', 'Oi')").run();
  db.prepare("UPDATE festa SET status = 'encerrada'").run();
  const dataDir = pasta();
  const destino = await arquivarFesta(db, dataDir);
  assert.equal(db.prepare('SELECT COUNT(*) FROM recados').pluck().get(), 0);
  const copia = abrirBanco(destino);
  assert.equal(copia.prepare('SELECT COUNT(*) FROM recados').pluck().get(), 0);
  copia.close();
});
