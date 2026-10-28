import { test } from 'node:test';
import assert from 'node:assert/strict';
import { abrirBanco, migrar } from '../db.js';
import { normalizarBusca } from '../texto.js';
import { prepararMusicas } from '../importadores/index.js';
import { gravarCatalogo } from '../catalogo.js';
import { buscarMusicas } from '../rotas/publico.js';
import { listarArtistas, sugerir } from '../artistas.js';

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
  db.exec(`ALTER TABLE pessoas DROP COLUMN email; ALTER TABLE festa DROP COLUMN contato; ALTER TABLE festa DROP COLUMN pix;
    ALTER TABLE festa DROP COLUMN filtro_genero; ALTER TABLE festa DROP COLUMN maquina_ativa; ALTER TABLE festa DROP COLUMN pix_mensagem; DROP TABLE generos_artista;
    DROP TABLE inscricoes_push; DROP TABLE avisos; ALTER TABLE pedidos DROP COLUMN avisado; DROP TABLE recados`); // volta ao schema da versão 2
  db.pragma('user_version = 2');
  migrar(db);
  assert.equal(db.prepare('SELECT busca FROM musicas').pluck().get(), 'pai fabio junior 1');
});

test('busca pagina com offset e recusa offset inválido', () => {
  const db = bancoCom(Array.from({ length: 45 }, (_, i) => ({ cod: String(100 + i), titulo: `Canção ${String(i).padStart(2, '0')}`, artista: 'Banda' })));
  const pagina = (offset) => buscarMusicas(db, { offset });
  assert.equal(pagina(0).musicas.length, 20);
  assert.equal(pagina(0).total, 45);
  assert.equal(pagina(40).musicas.length, 5);
  const todas = [0, 20, 40].flatMap((o) => pagina(o).musicas.map((m) => m.cod));
  assert.equal(new Set(todas).size, 45);
  for (const offset of [-1, 1.5, NaN]) assert.throws(() => buscarMusicas(db, { offset }), { status: 422 });
});

test('filtro por artista pega parcerias e grafias, sem confundir nomes parecidos', () => {
  const db = bancoCom([
    { cod: '1', titulo: 'A', artista: 'Gusttavo Lima' },
    { cod: '2', titulo: 'B', artista: 'Bruninho e Davi - Gusttavo Lima' },
    { cod: '3', titulo: 'C', artista: 'Gusttavo Lima - Marília Mendonça' },
    { cod: '4', titulo: 'D', artista: 'Lima' },
    { cod: '5', titulo: 'E', artista: 'Sandy e Junior - Gustt...' },
  ]);
  const cods = (artista, q = '') => buscarMusicas(db, { artista, q }).musicas.map((m) => m.cod).sort();
  assert.deepEqual(cods('gustavo lima'), ['1', '2', '3']);
  assert.deepEqual(cods('Lima'), ['4']);
  assert.deepEqual(cods('sandy & junior'), ['5']);
  assert.deepEqual(cods('gusttavo lima', 'b'), ['2']);
});

test('listarArtistas separa parcerias, ignora nomes cortados e soma grafias', () => {
  const db = bancoCom([
    { cod: '1', titulo: 'A', artista: 'Fábio Jr.' },
    { cod: '2', titulo: 'B', artista: 'Fábio Jr.' },
    { cod: '3', titulo: 'C', artista: 'Fabio Junior - Zezé' },
    { cod: '4', titulo: 'D', artista: 'Sandy e Junior - Chitã...' },
    { cod: '5', titulo: 'E', artista: 'ABBA', idioma: 'ING' },
  ]);
  assert.deepEqual(listarArtistas(db), [
    { nome: 'ABBA', chave: 'aba', total: 1 },
    { nome: 'Fábio Jr.', chave: 'fabio junior', total: 3 },
    { nome: 'Sandy e Junior', chave: 'sandy junior', total: 1 },
    { nome: 'Zezé', chave: 'zeze', total: 1 },
  ]);
  assert.deepEqual(listarArtistas(db, { filtro: 'internacionais' }).map((a) => a.nome), ['ABBA']);

  // Com gênero, só as músicas cujo artista principal é daquele gênero (SPEC 5.7).
  db.prepare("INSERT INTO generos_artista (chave, genero, confianca, origem) VALUES ('fabio junior', 'MPB', 'alta', 'teste'), ('zeze', 'Sertanejo', 'alta', 'teste')").run();
  assert.deepEqual(listarArtistas(db, { genero: 'MPB' }), [
    { nome: 'Fábio Jr.', chave: 'fabio junior', total: 3 },
    { nome: 'Zezé', chave: 'zeze', total: 1 }, // participa de uma música de MPB
  ]);
  assert.deepEqual(listarArtistas(db, { genero: 'Sertanejo' }), []);
});

test('sugerir: nada antes de cantar; depois, outra do mesmo artista que ela não pediu', () => {
  const db = bancoCom([
    { cod: '1', titulo: 'A', artista: 'Fábio Jr.' },
    { cod: '2', titulo: 'B', artista: 'Fabio Junior' },
    { cod: '3', titulo: 'C', artista: 'Fábio Jr. - Zezé' },
    { cod: '4', titulo: 'D', artista: 'Roberto Carlos' },
    { cod: '5', titulo: 'E', artista: 'Roberto Carlos' },
  ]);
  db.prepare("INSERT INTO pessoas (id, nome, nome_norm) VALUES ('p1', 'Ana', 'ana')").run();
  const pedir = db.prepare("INSERT INTO pedidos (pessoa_id, musica_cod, status, t_fila, finalizado_em) VALUES ('p1', ?, ?, 0, ?)");
  assert.equal(sugerir(db, 'p1'), null);

  pedir.run('1', 'pendente', null);
  assert.equal(sugerir(db, 'p1'), null);
  db.prepare("UPDATE pedidos SET status = 'cantou', finalizado_em = '2026-01-01 20:00' WHERE musica_cod = '1'").run();
  const s = sugerir(db, 'p1');
  assert.equal(s.artista, 'Fábio Jr.');
  assert.ok(['2', '3'].includes(s.musica.cod));
  assert.deepEqual(sugerir(db, 'p1'), s, 'estável entre atualizações');

  pedir.run('2', 'pendente', null);
  pedir.run('3', 'cancelado', null);
  assert.equal(sugerir(db, 'p1'), null, 'já pediu todas do artista');

  pedir.run('4', 'cantou', '2026-01-01 21:00');
  const outra = sugerir(db, 'p1');
  assert.equal(outra.musica.cod, '5');
  assert.equal(outra.artista, 'Roberto Carlos');
});
