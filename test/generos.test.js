import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { abrirBanco } from '../db.js';
import { criarApp } from '../app.js';
import { prepararMusicas } from '../importadores/index.js';
import { gravarCatalogo } from '../catalogo.js';
import { buscarMusicas } from '../rotas/publico.js';
import { artistasPrincipais, classificarLote, resumoGeneros, lerCsvGeneros, gravarGeneros, listarGeneros } from '../generos.js';

const CATALOGO = [
  { cod: '1', titulo: 'Evidências', artista: 'Chitãozinho e Xororó' },
  { cod: '2', titulo: 'Fio de Cabelo', artista: 'Chitãozinho & Xororó' },
  { cod: '3', titulo: 'Página de Amigos', artista: 'Chitãozinho e Xororó - Zezé Di Camargo' },
  { cod: '4', titulo: 'Sozinho', artista: 'Caetano Veloso' },
  { cod: '5', titulo: 'Bohemian Rhapsody', artista: 'Queen', idioma: 'EUA' },
  { cod: '6', titulo: 'Música rara', artista: 'Banda Desconhecida' },
];

function bancoCom(musicas = CATALOGO) {
  const db = abrirBanco(':memory:');
  gravarCatalogo(db, { musicas: prepararMusicas(musicas.map((m) => ({ inicio: '', idioma: 'BRA', ...m }))), origem: 'teste', statusFesta: 'rascunho' });
  return db;
}

// Finge a API da Anthropic: responde com o gênero de cada nome e guarda o que recebeu.
function anthropicFalsa(generos, { status = 200, stop = 'end_turn' } = {}) {
  const chamadas = [];
  const fetch = async (url, opcoes) => {
    const corpo = JSON.parse(opcoes.body);
    chamadas.push({ url, headers: opcoes.headers, corpo });
    const nomes = corpo.messages[0].content.split('\n').slice(1).map((l) => l.replace(/^\d+\. /, ''));
    const artistas = nomes.map((nome, i) => ({ n: i + 1, ...(generos[nome] ?? { genero: '', confianca: 'baixa' }) }));
    return new Response(JSON.stringify({ stop_reason: stop, content: [{ type: 'text', text: JSON.stringify({ artistas }) }] }), { status });
  };
  return { fetch, chamadas };
}

const GENEROS_TESTE = {
  'Chitãozinho e Xororó': { genero: 'Sertanejo', confianca: 'alta' },
  'Caetano Veloso': { genero: 'MPB', confianca: 'alta' },
  Queen: { genero: 'Rock Internacional', confianca: 'media' },
};

test('artista principal é o primeiro participante, com as grafias juntas', () => {
  const db = bancoCom();
  const artistas = artistasPrincipais(db);
  assert.deepEqual(artistas[0], { chave: 'chitaozinho xororo', nome: 'Chitãozinho e Xororó', total: 3 });
  assert.equal(artistas.length, 4);
});

test('classifica em lotes, manda a chave só no cabeçalho e não pergunta de novo', async () => {
  const db = bancoCom();
  const { fetch, chamadas } = anthropicFalsa(GENEROS_TESTE);
  const r1 = await classificarLote(db, { chave: 'sk-ant-teste', lote: 2, fetch });
  assert.deepEqual(r1, { feitos: 2, restantes: 2 });
  const { headers, corpo } = chamadas[0];
  assert.equal(headers['x-api-key'], 'sk-ant-teste');
  assert.equal(corpo.model, 'claude-opus-5-5');
  assert.equal(corpo.fallbacks, 'default');
  assert.equal(corpo.output_config.format.type, 'json_schema');
  assert.doesNotMatch(JSON.stringify(corpo), /sk-ant-teste/);
  assert.match(corpo.messages[0].content, /1\. Chitãozinho e Xororó/);

  const r2 = await classificarLote(db, { chave: 'sk-ant-teste', lote: 2, fetch });
  assert.deepEqual(r2, { feitos: 2, restantes: 0 });
  assert.deepEqual(await classificarLote(db, { chave: 'sk-ant-teste', fetch }), { feitos: 0, restantes: 0 });
  assert.equal(chamadas.length, 2);
  // A chave não fica em lugar nenhum do banco.
  const tudo = JSON.stringify(db.prepare("SELECT * FROM generos_artista").all()) + JSON.stringify(db.prepare('SELECT * FROM festa').all());
  assert.doesNotMatch(tudo, /sk-ant/);
});

test('resumo mostra cobertura, confiança e precisão estimada', async () => {
  const db = bancoCom();
  await classificarLote(db, { chave: 'k', fetch: anthropicFalsa(GENEROS_TESTE).fetch });
  const r = resumoGeneros(db);
  assert.equal(r.musicas, 6);
  assert.equal(r.pendentes, 0);
  assert.equal(r.cobertura, 5 / 6);
  assert.deepEqual(r.por_confianca.alta, { artistas: 2, musicas: 4 });
  assert.deepEqual(r.desconhecidos, { artistas: 1, musicas: 1 });
  assert.ok(Math.abs(r.precisao_estimada - (4 * 0.95 + 1 * 0.75) / 5) < 1e-9);
  assert.deepEqual(r.por_genero[0], { nome: 'Sertanejo', total: 3 });
});

test('erros da Anthropic viram mensagens claras', async () => {
  const db = bancoCom();
  await assert.rejects(classificarLote(db, { chave: '', fetch: anthropicFalsa({}).fetch }), { codigo: 'chave_vazia' });
  await assert.rejects(classificarLote(db, { chave: 'k', fetch: anthropicFalsa({}, { status: 401 }).fetch }), { codigo: 'chave_invalida', status: 422 });
  await assert.rejects(classificarLote(db, { chave: 'k', fetch: anthropicFalsa({}, { status: 429 }).fetch }), { codigo: 'anthropic_limite' });
  await assert.rejects(classificarLote(db, { chave: 'k', fetch: anthropicFalsa({}, { stop: 'max_tokens' }).fetch }), { codigo: 'anthropic_indisponivel' });
  await assert.rejects(classificarLote(db, { chave: 'k', fetch: async () => { throw new Error('rede'); } }), { codigo: 'anthropic_indisponivel' });
  assert.equal(resumoGeneros(db).pendentes, 4);
});

test('filtro de gênero no catálogo usa o artista principal', () => {
  const db = bancoCom();
  gravarGeneros(db, [
    { chave: 'chitaozinho xororo', genero: 'Sertanejo', confianca: 'alta' },
    { chave: 'zeze di camargo', genero: 'MPB', confianca: 'alta' },
    { chave: 'quen', genero: 'Rock Internacional', confianca: 'alta' },
  ], 'importado');
  const cods = (opcoes) => buscarMusicas(db, opcoes).musicas.map((m) => m.cod);
  assert.deepEqual(new Set(cods({ genero: 'Sertanejo' })), new Set(['1', '2', '3']));
  assert.deepEqual(cods({ genero: 'MPB' }), []);
  assert.deepEqual(cods({ genero: 'Sertanejo', q: 'cabelo' }), ['2']);
  assert.throws(() => buscarMusicas(db, { genero: 'Jazz' }), { codigo: 'genero_invalido' });
  assert.deepEqual(listarGeneros(db), [{ nome: 'Sertanejo', total: 3 }, { nome: 'Rock Internacional', total: 1 }]);
  assert.deepEqual(listarGeneros(db, { filtro: 'nacionais' }), [{ nome: 'Sertanejo', total: 3 }]);
});

test('CSV de classificação pronta: cabeçalho, acento na confiança e linhas inválidas', () => {
  const { itens, ignoradas } = lerCsvGeneros('artista;genero;confianca;fonte\nFábio Jr.;MPB;média;x\nQueen;Rock Internacional;alta\nAlguém;Jazz;alta\n;MPB;alta\nNinguém;;baixa\n');
  assert.deepEqual(itens, [
    { chave: 'fabio junior', genero: 'MPB', confianca: 'media' },
    { chave: 'quen', genero: 'Rock Internacional', confianca: 'alta' },
    { chave: 'ninguem', genero: '', confianca: 'baixa' },
  ]);
  assert.equal(ignoradas, 2);
});

// ---------- Rotas ----------

const TOKEN = 'token-de-setup-para-testes';
let dataDir;
let db;
let servidor;
let base;
const falsa = anthropicFalsa(GENEROS_TESTE);

before(async () => {
  dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'karaoke-generos-'));
  db = abrirBanco(path.join(dataDir, 'karaoke.db'));
  gravarCatalogo(db, { musicas: prepararMusicas(CATALOGO.map((m) => ({ inicio: '', idioma: 'BRA', ...m }))), origem: 'teste', statusFesta: 'rascunho' });
  const app = criarApp({
    db,
    config: { dataDir, publicUrl: 'https://karaoke.exemplo.com.br', setupToken: TOKEN, cookieSecret: 'segredo-dos-cookies-de-teste', cookiesSeguros: false, fetch: falsa.fetch },
  });
  await new Promise((ok) => (servidor = app.listen(0, '127.0.0.1', ok)));
  base = `http://127.0.0.1:${servidor.address().port}`;
});

after(() => {
  servidor.close();
  db.close();
  fs.rmSync(dataDir, { recursive: true, force: true });
});

async function api(metodo, rota, corpo, token = TOKEN) {
  const headers = { 'Content-Type': 'application/json' };
  if (token) headers['X-Setup-Token'] = token;
  const res = await fetch(base + rota, { method: metodo, headers, body: corpo === undefined ? undefined : JSON.stringify(corpo) });
  return { status: res.status, dados: await res.json() };
}

test('rotas de gênero: exigem token, classificam, ligam o filtro e apagam', async () => {
  assert.equal((await api('POST', '/api/setup/generos/classificar', { chave: 'k' }, null)).status, 401);

  const c = await api('POST', '/api/setup/generos/classificar', { chave: 'sk-ant-rota' });
  assert.equal(c.status, 200);
  assert.equal(c.dados.restantes, 0);
  assert.equal(c.dados.resumo.ativo, false);
  assert.doesNotMatch(JSON.stringify(c.dados), /sk-ant/);

  // Desligado: nada de gênero para o convidado.
  assert.deepEqual((await api('GET', '/api/generos')).dados, { generos: [] });
  assert.equal((await api('GET', '/api/musicas?genero=MPB')).dados.total, 6);
  assert.deepEqual((await api('GET', '/api/artistas?genero=MPB')).dados, (await api('GET', '/api/artistas')).dados);
  assert.equal((await api('GET', '/api/festa')).dados.filtro_genero, false);

  assert.equal((await api('PUT', '/api/setup/generos', { ativo: 'sim' })).status, 422);
  assert.equal((await api('PUT', '/api/setup/generos', { ativo: true })).dados.ativo, true);
  assert.equal((await api('GET', '/api/festa')).dados.filtro_genero, true);
  assert.deepEqual((await api('GET', '/api/generos?filtro=internacionais')).dados.generos, [{ nome: 'Rock Internacional', total: 1 }]);
  const mpb = await api('GET', '/api/musicas?genero=MPB');
  assert.deepEqual(mpb.dados.musicas.map((m) => m.cod), ['4']);
  assert.equal((await api('GET', '/api/musicas?genero=Jazz')).status, 422);
  assert.ok((await api('GET', '/api/artistas?genero=MPB')).dados.artistas.length < (await api('GET', '/api/artistas')).dados.artistas.length);
  assert.equal((await api('GET', '/api/artistas?genero=Jazz')).status, 422);

  const apagado = await api('DELETE', '/api/setup/generos');
  assert.equal(apagado.dados.ativo, false);
  assert.equal(apagado.dados.pendentes, 4);
});

test('chave Pix no passo 2 sai em /api/festa', async () => {
  const corpo = { nome_destaque: 'Helena', inicio_em: '2026-12-05T20:00:00-03:00', duracao_horas: 4, convidados: 30, pix: ' helena@exemplo.com ' };
  assert.equal((await api('PUT', '/api/setup/festa', corpo)).dados.festa.pix, 'helena@exemplo.com');
  assert.equal((await api('GET', '/api/festa')).dados.pix, 'helena@exemplo.com');
  const longo = await api('PUT', '/api/setup/festa', { ...corpo, pix: 'x'.repeat(513) });
  assert.equal(longo.status, 422);
  assert.equal(longo.dados.campo, 'pix');
});

test('Pix copia e cola longo e mensagem do apelo', async () => {
  const brcode = '000201' + '26'.padEnd(200, '9') + '6304ABCD';
  const corpo = { nome_destaque: 'Helena', inicio_em: '2026-12-05T20:00:00-03:00', duracao_horas: 4, convidados: 30, pix: brcode, pix_mensagem: 'Doe R$ 1 para quem ganhar!' };
  assert.equal((await api('PUT', '/api/setup/festa', corpo)).status, 200);
  const festa = (await api('GET', '/api/festa')).dados;
  assert.equal(festa.pix, brcode);
  assert.equal(festa.pix_mensagem, 'Doe R$ 1 para quem ganhar!');
  const longa = await api('PUT', '/api/setup/festa', { ...corpo, pix_mensagem: 'x'.repeat(201) });
  assert.equal(longa.status, 422);
  assert.equal(longa.dados.campo, 'pix_mensagem');
});
