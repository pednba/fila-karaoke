import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { abrirBanco } from '../db.js';
import { criarApp } from '../app.js';

const TOKEN = 'token-de-setup-para-testes';
let dataDir;
let db;
let servidor;
let base;

before(async () => {
  dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'karaoke-operacao-'));
  db = abrirBanco(path.join(dataDir, 'karaoke.db'));
  const app = criarApp({
    db,
    config: { dataDir, publicUrl: 'https://karaoke.exemplo.com.br', setupToken: TOKEN, cookieSecret: 'segredo-dos-cookies-de-teste', cookiesSeguros: false },
  });
  await new Promise((ok) => (servidor = app.listen(0, '127.0.0.1', ok)));
  base = `http://127.0.0.1:${servidor.address().port}`;
});

after(() => {
  servidor.close();
  db.close();
  fs.rmSync(dataDir, { recursive: true, force: true });
});

// Um "aparelho": guarda os cookies que o servidor manda.
function aparelho() {
  const cookies = new Map();
  const chamar = async (metodo, rota, { corpo, headers = {}, form } = {}) => {
    const h = { ...headers };
    if (cookies.size) h.Cookie = [...cookies].map(([k, v]) => `${k}=${v}`).join('; ');
    let body;
    if (form) body = form;
    else if (corpo !== undefined) {
      h['Content-Type'] = 'application/json';
      body = JSON.stringify(corpo);
    }
    const res = await fetch(base + rota, { method: metodo, headers: h, body });
    for (const c of res.headers.getSetCookie()) {
      const [par] = c.split(';');
      const i = par.indexOf('=');
      cookies.set(par.slice(0, i), par.slice(i + 1));
    }
    const dados = (res.headers.get('content-type') ?? '').includes('json') ? await res.json() : null;
    return { status: res.status, dados, res };
  };
  return { chamar, cookies };
}

const adm = aparelho();
const ana = aparelho();
const bia = aparelho();
const caio = aparelho();

const CSV = [
  'cod;titulo;artista;inicio;idioma',
  '1001;EVIDÊNCIAS;Chitãozinho e Xororó;Quando eu digo que deixei de te amar;BRA',
  '1002;AMOR I LOVE YOU;Marisa Monte;Deixa eu dizer que te amo;BRA',
  '1003;EVIDENCE;Faith No More;You smile 100% of the time;ING',
  '1004;AISHITERU;Banda Amor;Ai shiteru;JAP',
  '1005;TREM DAS ONZE;Adoniran Barbosa;Não posso ficar;BRA',
  '1006;SEM AMOR;Fulano;Evidências da vida;BRA',
  '1007;HEY JUDE;The Beatles;Hey Jude dont make it bad;ING',
].join('\n');

const estado = async (quem) => (await quem.chamar('GET', '/api/estado')).dados;
const naVezNoBanco = () => db.prepare("SELECT COUNT(*) FROM pedidos WHERE status = 'na_vez'").pluck().get();

test('festa em rascunho: ninguém entra', async () => {
  const r = await ana.chamar('POST', '/api/pessoas', { corpo: { nome: 'Ana' } });
  assert.equal(r.status, 403);
  assert.equal(r.dados.erro, 'festa_fechada');
});

test('preparar e abrir a festa', async () => {
  const t = { headers: { 'X-Setup-Token': TOKEN } };
  assert.equal((await adm.chamar('PUT', '/api/setup/pin', { ...t, corpo: { pin: '1357' } })).status, 200);
  await adm.chamar('PUT', '/api/setup/festa', {
    corpo: { nome_destaque: 'Helena', inicio_em: '2026-12-05T20:00:00-03:00', duracao_horas: 4, convidados: 40 },
  });
  await adm.chamar('PUT', '/api/setup/regras', { corpo: { minimo_votos: 1, minimo_performances: 1, pulos_ate_sair: 2 } });
  const form = new FormData();
  form.append('arquivo', new Blob([CSV], { type: 'text/csv' }), 'cat.csv');
  const { dados } = await adm.chamar('POST', '/api/setup/catalogo', { form });
  await adm.chamar('POST', '/api/setup/catalogo/confirmar', { corpo: { token: dados.token } });
  assert.equal((await adm.chamar('POST', '/api/festa/abrir')).dados.status, 'aberta');
});

test('GET /api/festa: dados públicos, sem PIN', async () => {
  const { dados } = await caio.chamar('GET', '/api/festa');
  assert.equal(dados.status, 'aberta');
  assert.equal(dados.titulo, 'Karaokê da Helena');
  assert.equal(dados.tema.preset, 'dourado');
  assert.equal(dados.regras.minimo_votos, 1);
  assert.equal(JSON.stringify(dados).includes('scrypt'), false);
  assert.equal(dados.admin_pin_hash, undefined);
});

test('entrar: cookie kid, nome único sem acento e sem caixa', async () => {
  const r = await ana.chamar('POST', '/api/pessoas', { corpo: { nome: '  Ana  ' } });
  assert.equal(r.status, 201);
  const kid = r.res.headers.getSetCookie().find((c) => c.startsWith('kid='));
  assert.match(kid, /HttpOnly/i);
  assert.match(kid, /SameSite=Lax/i);
  assert.match(kid, /Expires=Mon, 07 Dec 2026/); // fim (6/12 00:00 -03) + 24 h
  assert.match(ana.cookies.get('kid'), /^[0-9a-f-]{36}$/);

  assert.equal((await bia.chamar('POST', '/api/pessoas', { corpo: { nome: 'ÁNA' } })).dados.erro, 'nome_em_uso');
  assert.equal((await bia.chamar('POST', '/api/pessoas', { corpo: { nome: ' ' } })).dados.erro, 'nome_vazio');
  assert.equal((await bia.chamar('POST', '/api/pessoas', { corpo: { nome: 'Bia' } })).status, 201);
  assert.equal((await caio.chamar('POST', '/api/pessoas', { corpo: { nome: 'Caio' } })).status, 201);
  // Quem já entrou recebe a própria pessoa de volta.
  assert.deepEqual((await ana.chamar('POST', '/api/pessoas', { corpo: { nome: 'Outra' } })).dados, { me: { nome: 'Ana' } });
});

test('busca: sem acento, título antes de artista e letra, JAP por último, filtros', async () => {
  const busca = async (qs) => (await caio.chamar('GET', `/api/musicas?${qs}`)).dados;

  const evid = await busca('q=evidencia');
  assert.deepEqual(evid.musicas.map((m) => m.cod), ['1001', '1006']); // título antes da letra
  assert.equal(evid.total, 2);

  const amor = await busca('q=AMOR');
  assert.deepEqual(amor.musicas.map((m) => m.cod), ['1002', '1006', '1004']); // títulos, depois JAP

  assert.deepEqual((await busca('q=amor&filtro=nacionais')).musicas.map((m) => m.cod), ['1002', '1006']);
  assert.deepEqual((await busca('q=amor&filtro=internacionais')).musicas.map((m) => m.cod), ['1004']);
  // Pontuação vira espaço (SPEC 5.4): "100%" busca "100", e % não vira curinga do LIKE.
  assert.deepEqual((await busca('q=100%25%20of%20the')).musicas.map((m) => m.cod), ['1003']);
  assert.equal((await busca('q=1005')).musicas[0].titulo, 'TREM DAS ONZE');
  assert.equal((await busca('')).total, 7);
  assert.equal((await caio.chamar('GET', '/api/musicas?filtro=xyz')).dados.erro, 'filtro_invalido');
});

test('pedir: fila vazia vai direto ao palco; validações', async () => {
  const sem = aparelho();
  assert.equal((await sem.chamar('POST', '/api/pedidos', { corpo: { musica_cod: '1001' } })).dados.erro, 'sem_cadastro');

  const p1 = await ana.chamar('POST', '/api/pedidos', { corpo: { musica_cod: '1001' } });
  assert.equal(p1.status, 201);
  assert.equal(p1.dados.posicao_estimada, 0);
  assert.equal(p1.dados.pedido.status, 'na_vez');

  assert.equal((await ana.chamar('POST', '/api/pedidos', { corpo: { musica_cod: '1001' } })).dados.erro, 'ja_pedida');
  assert.equal((await ana.chamar('POST', '/api/pedidos', { corpo: { musica_cod: '9999' } })).dados.erro, 'musica_inexistente');

  assert.equal((await ana.chamar('POST', '/api/pedidos', { corpo: { musica_cod: '1002' } })).dados.posicao_estimada, 1);
  // Bia nunca cantou e passa à frente do segundo pedido da Ana (a Ana está no palco).
  assert.equal((await bia.chamar('POST', '/api/pedidos', { corpo: { musica_cod: '1005' } })).dados.posicao_estimada, 1);
  await ana.chamar('POST', '/api/pedidos', { corpo: { musica_cod: '1003' } });
  assert.equal((await ana.chamar('POST', '/api/pedidos', { corpo: { musica_cod: '1007' } })).dados.erro, 'limite_atingido');
  assert.equal(naVezNoBanco(), 1);

  const e = await estado(ana);
  assert.equal(e.atual.cod, '1001');
  assert.equal(e.atual.meu, true);
  assert.deepEqual(e.proximos.map((p) => [p.cantor, p.cod]), [['Bia', '1005'], ['Ana', '1002'], ['Ana', '1003']]);
  assert.equal(e.total_fila, 3);
  assert.deepEqual([e.ultimo_pedido.cantor, e.ultimo_pedido.cod, e.ultimo_pedido.posicao], ['Ana', '1003', 3]);
  assert.deepEqual(e.limite, { maximo: 3, ativos: 3 });
  assert.deepEqual(e.meus_pedidos.map((p) => [p.cod, p.posicao, p.espera_min]), [['1001', 0, null], ['1002', 2, 10], ['1003', 3, 15]]);
  assert.equal((await caio.chamar('GET', '/api/musicas?q=1001')).dados.musicas[0].na_fila, false);
  assert.equal((await ana.chamar('GET', '/api/musicas?q=1001')).dados.musicas[0].na_fila, true);
});

test('o estado público não expõe ids de pessoas (o id é o cookie)', async () => {
  const texto = JSON.stringify(await estado(caio));
  for (const kid of [ana.cookies.get('kid'), bia.cookies.get('kid')]) assert.equal(texto.includes(kid), false);
});

test('polling: ETag por versão e pessoa; 304 sem mudança', async () => {
  const r1 = await ana.chamar('GET', '/api/estado');
  const etag = r1.res.headers.get('etag');
  assert.match(etag, /^"\d+-[0-9a-f-]+"$/);
  assert.notEqual((await bia.chamar('GET', '/api/estado')).res.headers.get('etag'), etag);
  assert.equal((await ana.chamar('GET', '/api/estado', { headers: { 'If-None-Match': etag } })).status, 304);

  await bia.chamar('POST', '/api/pedidos', { corpo: { musica_cod: '1007' } });
  assert.equal((await ana.chamar('GET', '/api/estado', { headers: { 'If-None-Match': etag } })).status, 200);
});

test('cancelar: só o dono e só pendente', async () => {
  const meu = (await estado(bia)).meus_pedidos.find((p) => p.cod === '1007');
  assert.equal((await ana.chamar('DELETE', `/api/pedidos/${meu.id}`)).dados.erro, 'pedido_inexistente');
  const naVez = (await estado(ana)).atual;
  assert.equal((await ana.chamar('DELETE', `/api/pedidos/${naVez.id}`)).dados.erro, 'pedido_nao_pendente');
  assert.equal((await bia.chamar('DELETE', `/api/pedidos/${meu.id}`)).status, 204);
  assert.equal((await estado(bia)).meus_pedidos.some((p) => p.cod === '1007'), false);
});

test('votar: sem voto próprio, voto alterável, parcial escondida', async () => {
  const { atual, votacoes } = await estado(caio);
  assert.equal(votacoes.length, 1);
  assert.equal(votacoes[0].pedido_id, atual.id);

  assert.equal((await ana.chamar('PUT', '/api/votos', { corpo: { pedido_id: atual.id, nota: 10 } })).dados.erro, 'voto_proprio');
  assert.equal((await bia.chamar('PUT', '/api/votos', { corpo: { pedido_id: atual.id, nota: 11 } })).dados.erro, 'nota_invalida');
  assert.equal((await bia.chamar('PUT', '/api/votos', { corpo: { pedido_id: atual.id, nota: 6 } })).dados.n_votos, 1);
  assert.equal((await bia.chamar('PUT', '/api/votos', { corpo: { pedido_id: atual.id, nota: 9 } })).dados.n_votos, 1);
  assert.equal((await caio.chamar('PUT', '/api/votos', { corpo: { pedido_id: atual.id, nota: 7 } })).dados.n_votos, 2);

  const [v] = (await estado(bia)).votacoes;
  assert.deepEqual(v, { pedido_id: atual.id, status: 'na_vez', titulo: 'EVIDÊNCIAS', artista: 'Chitãozinho e Xororó', cantor: 'Ana', meu: false, n_votos: 2, meu_voto: 9 });
  const adminVotos = JSON.stringify((await adm.chamar('GET', '/api/admin/estado')).dados.votacoes);
  assert.equal(adminVotos.includes('nota'), false);
  assert.equal((await caio.chamar('GET', '/api/ranking?tipo=performances')).dados.ranking.length, 0);
});

test('cantou: o próximo da fila não marca; votação fecha quando a próxima termina', async () => {
  const primeiro = (await estado(ana)).atual;
  assert.equal((await bia.chamar('POST', `/api/pedidos/${primeiro.id}/cantou`)).dados.erro, 'pedido_alheio');
  assert.equal((await ana.chamar('POST', '/api/pedidos/99999/cantou')).dados.erro, 'nao_esta_na_vez');
  assert.equal((await ana.chamar('POST', `/api/pedidos/${primeiro.id}/cantou`)).status, 200);

  let e = await estado(caio);
  assert.equal(e.atual.cantor, 'Bia');
  assert.deepEqual(e.votacoes.map((v) => v.cantor), ['Bia', 'Ana']); // duas abertas
  assert.equal(naVezNoBanco(), 1);

  await caio.chamar('PUT', '/api/votos', { corpo: { pedido_id: e.atual.id, nota: 8 } });
  assert.equal((await adm.chamar('POST', `/api/pedidos/${e.atual.id}/cantou`)).status, 200); // admin pela rota pública

  e = await estado(caio);
  assert.deepEqual(e.votacoes.map((v) => v.cantor), ['Ana', 'Bia']);
  assert.equal(e.votacoes[0].pedido_id, e.atual.id);

  const perf = (await caio.chamar('GET', '/api/ranking?tipo=performances')).dados.ranking;
  assert.deepEqual(perf.map((p) => [p.posicao, p.cantor, p.nota, p.nota_texto, p.n_votos]), [[1, 'Ana', 8, '8,0', 2]]);
  const pessoas = (await caio.chamar('GET', '/api/ranking?tipo=pessoas')).dados.ranking;
  assert.deepEqual(pessoas, [{ posicao: 1, nome: 'Ana', media: 8, melhor: 8, n_performances: 1, media_texto: '8,0' }]);
  assert.equal((await caio.chamar('GET', '/api/ranking?tipo=x')).dados.erro, 'tipo_invalido');
});

test('admin: rotas exigem cookie', async () => {
  for (const [m, rota] of [['GET', '/api/admin/estado'], ['POST', '/api/admin/cantou'], ['POST', '/api/admin/pular'], ['GET', '/api/admin/pessoas'], ['POST', '/api/admin/pedidos']]) {
    assert.equal((await ana.chamar(m, rota)).status, 401, rota);
  }
});

test('admin: pular apaga votos, volta ao fim da rodada e remove no limite', async () => {
  let a = (await adm.chamar('GET', '/api/admin/estado')).dados;
  const pulado = a.atual;
  assert.equal(pulado.cantor, 'Ana');
  await bia.chamar('PUT', '/api/votos', { corpo: { pedido_id: pulado.id, nota: 5 } });
  await bia.chamar('POST', '/api/pedidos', { corpo: { musica_cod: '1006' } });

  const r = await adm.chamar('POST', '/api/admin/pular');
  assert.deepEqual(r.dados, { id: pulado.id, status: 'pendente', pulos: 1 });
  assert.equal(db.prepare('SELECT COUNT(*) FROM votos WHERE pedido_id = ?').pluck().get(pulado.id), 0);

  // O pulado vai para o fim da rodada: o outro pedido da Ana (mais antigo) e o da Bia passam à frente.
  a = (await adm.chamar('GET', '/api/admin/estado')).dados;
  assert.equal(a.atual.cod, '1003');
  assert.deepEqual(a.fila.map((p) => [p.id === pulado.id ? 'pulado' : p.cantor, p.pulos]), [['Bia', 0], ['pulado', 1]]);

  await adm.chamar('POST', '/api/admin/cantou');
  await adm.chamar('POST', '/api/admin/cantou');
  a = (await adm.chamar('GET', '/api/admin/estado')).dados;
  assert.equal(a.atual.id, pulado.id);
  assert.deepEqual((await adm.chamar('POST', '/api/admin/pular')).dados, { id: pulado.id, status: 'removido', pulos: 2 });
  a = (await adm.chamar('GET', '/api/admin/estado')).dados;
  assert.equal(a.atual, null);
  assert.equal(a.fila.length, 0);
  assert.equal((await adm.chamar('POST', '/api/admin/pular')).dados.erro, 'palco_vazio');
});

test('admin: mover, bypass, VIP e pedido para quem não tem celular', async () => {
  await caio.chamar('POST', '/api/pedidos', { corpo: { musica_cod: '1007' } });
  await caio.chamar('POST', '/api/pedidos', { corpo: { musica_cod: '1005' } });
  await bia.chamar('POST', '/api/pedidos', { corpo: { musica_cod: '1001' } });
  let a = (await adm.chamar('GET', '/api/admin/estado')).dados;
  assert.equal(a.atual.cantor, 'Caio');
  const nomes = () => a.fila.map((p) => `${p.cantor}:${p.cod}`);
  assert.deepEqual(nomes(), ['Bia:1001', 'Caio:1005']); // Caio está no palco: não canta duas seguidas

  assert.equal((await adm.chamar('POST', `/api/admin/pedidos/${a.fila[0].id}/mover`, { corpo: { direcao: 'cima' } })).dados.erro, 'nao_move');
  assert.equal((await adm.chamar('POST', `/api/admin/pedidos/${a.fila[1].id}/mover`, { corpo: { direcao: 'lado' } })).dados.erro, 'direcao_invalida');
  assert.equal((await adm.chamar('POST', `/api/admin/pedidos/${a.fila[1].id}/mover`, { corpo: { direcao: 'cima' } })).status, 200);
  a = (await adm.chamar('GET', '/api/admin/estado')).dados;
  assert.deepEqual(nomes(), ['Caio:1005', 'Bia:1001']);
  assert.ok(a.fila.every((p) => p.manual));

  // Pedido novo entra depois da ordem manual; Dona Lurdes não tem celular.
  const novo = await adm.chamar('POST', '/api/admin/pedidos', { corpo: { nome: 'Dona Lurdes', musica_cod: '1002' } });
  assert.equal(novo.status, 201);
  assert.equal(novo.dados.posicao_estimada, 3);
  assert.match(novo.dados.pedido.pessoa_id, /^adm-/);
  await adm.chamar('POST', '/api/admin/pedidos', { corpo: { nome: 'dona lurdes', musica_cod: '1003' } });
  const pessoas = (await adm.chamar('GET', '/api/admin/pessoas')).dados.pessoas;
  const lurdes = pessoas.filter((p) => p.nome === 'Dona Lurdes');
  assert.equal(lurdes.length, 1);
  assert.equal(lurdes[0].na_fila, 2);
  assert.equal(lurdes[0].sem_celular, true);

  // VIP e bypass.
  const bia_ = pessoas.find((p) => p.nome === 'Bia');
  assert.equal((await adm.chamar('PATCH', `/api/admin/pessoas/${bia_.id}`, { corpo: { vip: 'sim' } })).dados.erro, 'valor_invalido');
  assert.equal((await adm.chamar('PATCH', `/api/admin/pessoas/${bia_.id}`, { corpo: { vip: true } })).status, 200);
  a = (await adm.chamar('GET', '/api/admin/estado')).dados;
  assert.equal(a.contadores.vips, 1);
  const ultimo = a.fila.at(-1);
  assert.equal((await adm.chamar('PATCH', `/api/admin/pedidos/${ultimo.id}`, { corpo: { bypass: true } })).status, 200);
  a = (await adm.chamar('GET', '/api/admin/estado')).dados;
  assert.equal(a.fila.find((p) => p.id === ultimo.id).bypass, true);
  assert.equal(a.atual.cantor, 'Caio'); // nada disso tira quem está no palco
  assert.equal(naVezNoBanco(), 1);
});

test('encerrada: pedidos e votos bloqueados, ranking continua', async () => {
  await adm.chamar('POST', '/api/festa/encerrar');
  assert.equal((await caio.chamar('POST', '/api/pedidos', { corpo: { musica_cod: '1001' } })).dados.erro, 'festa_fechada');
  const { votacoes } = await estado(caio);
  assert.equal(votacoes.length, 0);
  assert.equal((await adm.chamar('POST', '/api/admin/cantou')).dados.erro, 'festa_fechada');
  assert.equal((await caio.chamar('GET', '/api/ranking')).status, 200);
  assert.equal((await estado(caio)).status, 'encerrada');
});

test('sem SMTP configurado, o e-mail do ranking fica desligado', async () => {
  assert.equal((await ana.chamar('GET', '/api/festa')).dados.email_ranking, false);
  const r = await ana.chamar('PUT', '/api/me/email', { corpo: { email: 'ana@exemplo.com' } });
  assert.equal(r.status, 404);
  assert.equal(r.dados.erro, 'email_desligado');
});

test('cantou por quem está na fila: menos o próximo, depois de 2 minutos; estado mostra quando libera', async () => {
  const { garantirFesta } = await import('../festa.js');
  const { gravarCatalogo } = await import('../catalogo.js');
  const { prepararMusicas } = await import('../importadores/index.js');
  const { pedir, cantou } = await import('../operacao.js');
  const { estadoPublico } = await import('../rotas/publico.js');
  const mem = abrirBanco(':memory:');
  garantirFesta(mem);
  const musicas = ['1', '2', '3'].map((cod) => ({ cod, titulo: `M${cod}`, artista: 'X', inicio: '', idioma: 'BRA' }));
  gravarCatalogo(mem, { musicas: prepararMusicas(musicas), origem: 'teste', statusFesta: 'rascunho' });
  mem.prepare("UPDATE festa SET status = 'aberta' WHERE id = 1").run();
  for (const nome of ['ana', 'bia', 'caio', 'davi']) mem.prepare('INSERT INTO pessoas (id, nome, nome_norm) VALUES (?, ?, ?)').run(nome, nome, nome);
  pedir(mem, { pessoa_id: 'ana', musica_cod: '1' });
  pedir(mem, { pessoa_id: 'bia', musica_cod: '2' });
  pedir(mem, { pessoa_id: 'caio', musica_cod: '3' });
  mem.prepare("UPDATE pedidos SET na_vez_em = '2026-11-02 21:00:00' WHERE status = 'na_vez'").run();
  const inicio = Date.parse('2026-11-02T21:00:00Z');
  const pessoa = (id) => ({ id, nome: id, vip: 0 });

  assert.equal(estadoPublico(mem, pessoa('caio')).atual.liberado_em, '2026-11-02T21:02:00.000Z');
  assert.equal(estadoPublico(mem, pessoa('bia')).atual.liberado_em, null);
  assert.equal(estadoPublico(mem, pessoa('davi')).atual.liberado_em, null);
  assert.equal(estadoPublico(mem, pessoa('ana')).atual.liberado_em, null); // dona usa o "Cantou?"

  const tentar = (pessoa_id, agora) => {
    try { cantou(mem, { pessoa_id, agora }); return 'ok'; } catch (e) { return e.codigo; }
  };
  const depois = inicio + 2 * 60_000;
  assert.equal(tentar('bia', depois), 'pedido_alheio');
  assert.equal(tentar('davi', depois), 'pedido_alheio');
  assert.equal(tentar('caio', depois - 1000), 'cedo_demais');
  assert.equal(tentar('caio', depois), 'ok');
  assert.equal(mem.prepare("SELECT pessoa_id FROM pedidos WHERE status = 'na_vez'").pluck().get(), 'bia');
  assert.equal(tentar('bia', inicio), 'ok', 'a dona avança a qualquer momento');
  mem.close();
});
