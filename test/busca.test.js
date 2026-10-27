import { test } from 'node:test';
import assert from 'node:assert/strict';
import { abrirBanco, migrar } from '../db.js';
import { normalizarBusca } from '../texto.js';
import { prepararMusicas } from '../importadores/index.js';
import { gravarCatalogo } from '../catalogo.js';
import { buscarMusicas } from '../rotas/publico.js';

test('normalizarBusca iguala grafias do mesmo nome', () => {
  const iguais = [
    ['Fabio Junior', 'Fábio Jr.', 'Fabio Júnior', 'FÁBIO JR'],
    ['Sandy Jr', 'Sandy e Junior', 'Sandy & Junior', 'Sandy e Júnior'],
    ["Rock'n'Roll", "rock 'n' roll", "Rock n' Roll", 'Rock N Roll', 'Rock and Roll', 'rock & roll'],
    ['Bruno e Barretto', 'Bruno e Barreto'],
    ['Padre Fábio de Mello', 'Padre Fabio de Melo'],
    ['Anitta feat. Pabllo', 'Anitta ft Pablo', 'Anitta featuring Pabllo'],
  ];
  for (const grupo of iguais) {
    const [primeiro, ...resto] = grupo.map(normalizarBusca);
    for (const [i, n] of resto.entries()) assert.equal(n, primeiro, `${grupo[i + 1]} ≠ ${grupo[0]}`);
  }
  assert.equal(normalizarBusca("Destiny's Child"), 'destinys child');
  assert.equal(normalizarBusca('Sandy e Júnior-Toquinho'), 'sandy junior toquinho');
  assert.equal(normalizarBusca('Babado Novo - Bruno e ...'), 'babado novo bruno');
  assert.equal(normalizarBusca('e'), '');
});

test('normalizarBusca não mexe em números nem no meio das palavras', () => {
  assert.equal(normalizarBusca('2002 1001'), '2002 1001');
  assert.equal(normalizarBusca('Evidências Chitãozinho'), 'evidencias chitaozinho');
  assert.equal(normalizarBusca('Anderson Freire'), 'anderson freire');
  assert.equal(normalizarBusca("Sinead O'Neil"), 'sinead oneil');
});

function bancoCom(musicas) {
  const db = abrirBanco(':memory:');
  gravarCatalogo(db, { musicas: prepararMusicas(musicas.map((m) => ({ inicio: '', idioma: 'BRA', ...m }))), origem: 'teste', statusFesta: 'rascunho' });
  return db;
}

test('busca acha o artista por qualquer grafia', () => {
  const db = bancoCom([
    { cod: '1', titulo: 'Pai', artista: 'Fábio Jr.' },
    { cod: '2', titulo: 'Imortal', artista: 'Sandy e Júnior' },
    { cod: '3', titulo: 'Sweet Child', artista: "Guns n' Roses", idioma: 'EUA' },
    { cod: '4', titulo: 'Rock and Roll', artista: 'Led Zeppelin', idioma: 'EUA' },
  ]);
  const cods = (q) => buscarMusicas(db, { q }).musicas.map((m) => m.cod);
  for (const q of ['fabio junior', 'Fábio Júnior', 'fabio jr', 'FABIO J']) assert.deepEqual(cods(q), ['1'], q);
  for (const q of ['sandy jr', 'Sandy & Junior', 'sandy e junior']) assert.deepEqual(cods(q), ['2'], q);
  assert.deepEqual(cods('guns and roses'), ['3']);
  assert.deepEqual(cods("rock'n'roll"), ['4']);
});

test('migração recalcula a coluna busca de um catálogo antigo', () => {
  const db = bancoCom([{ cod: '1', titulo: 'Pai', artista: 'Fábio Jr.' }]);
  db.prepare("UPDATE musicas SET busca = 'pai fabio jr. 1'").run(); // como era antes
  db.pragma('user_version = 2');
  migrar(db);
  assert.equal(db.prepare('SELECT busca FROM musicas').pluck().get(), 'pai fabio junior 1');
});
